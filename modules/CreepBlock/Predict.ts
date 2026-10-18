/**
 * A short forecast of how lane creeps move round a blocking unit, by the server's movement rules
 * (dota2-ida notes/creep/REPORT.md): a creep whose next step would touch something stands
 * 0.10–0.20 s and then walks round it on the side away from its centre; a unit inside its cone
 * (cos > 0.7), within hull + 32 + hull of its next position and walking away from it holds it
 * 0.35–0.45 s; creeps touch each other with both paddings, the unit without any, a tower with the
 * creep's padding. Plain numbers, so the planner can try candidate spots for the unit and the
 * bench can check the forecast against recorded runs.
 */

export interface SimCreep {
	x: number
	y: number
	/** Direction the creep heads for when nothing is in its way (its next corner, far ahead) */
	readonly gx: number
	readonly gy: number
	readonly speed: number
	readonly hull: number
	readonly pad: number
	/** Seconds it still stands */
	wait: number
	/** The point it walks to while going round something */
	wx: number
	wy: number
	detour: boolean
}

export interface SimUnit {
	x: number
	y: number
	readonly hull: number
	readonly speed: number
	/** Where it walks to; it stands once there */
	readonly tx: number
	readonly ty: number
	/** Velocity it keeps until its order lands */
	readonly vx: number
	readonly vy: number
	readonly delay: number
	/** Positions per tick to follow instead of walking to the spot (checking against a recording) */
	readonly path?: readonly (readonly [number, number])[]
}

export interface SimObstacle {
	readonly x: number
	readonly y: number
	readonly r: number
}

export interface SimResult {
	/** Summed advance of the creeps along the lane */
	progress: number
	/** Creeps that drew level with the unit outside its contact, or got ahead of it */
	escaped: number
	/** Seconds short, summed over the creeps, for the unit to get across to each creep's line before it draws level */
	race: number
	/** Lateral extent of the creeps at the end */
	spread: number
	/** Seconds each creep stood */
	stood: number[]
	/** Stops each creep began (hard contact or look-ahead) */
	stops: number[]
}

export const SimHardWait = 0.17
export const SimLookWait = 0.42
const LOOK_REACH = 32
const LOOK_CONE = 0.7
const DETOUR_MARGIN = 6

interface Blocker {
	readonly x: number
	readonly y: number
	readonly reach: number
	/** Look-ahead reach from the mover's next position (hull + 32 + hull), 0 for none */
	readonly look?: number
	readonly vx?: number
	readonly vy?: number
}

/** Random draws for an ensemble run (wait lengths, the side of a blocker right in the way); none: means. */
let random: Nullable<() => number>
/**
 * Below this offset of a blocker's centre from a creep's way the side it goes round is a coin flip
 * (recorded walk-rounds: 0–5 off the rule is right 29 %, 5–12 off 64 %, 12–25 off 79 %)
 */
const SIDE_AMBIGUOUS = 8

/** A wait of mean `w`: the server draws it within ±0.05. */
function Wait(w: number): number {
	return random === undefined ? w : w + (random() - 0.5) * 0.1
}

/** The point beside `b` on the side away from its centre, seen along the creep's way. */
function DetourPoint(c: SimCreep, b: Blocker): [number, number] {
	const rx = b.x - c.x,
		ry = b.y - c.y,
		cross = c.gx * ry - c.gy * rx,
		// left of the way is (-gy, gx); the blocker left of it sends the creep right
		side =
			random !== undefined && Math.abs(cross) < SIDE_AMBIGUOUS
				? random() < 0.5
					? -1
					: 1
				: cross > 0
					? -1
					: 1,
		px = -c.gy * side,
		py = c.gx * side,
		r = b.reach + DETOUR_MARGIN
	return [b.x + px * r + c.gx * r * 0.5, b.y + py * r + c.gy * r * 0.5]
}

/** After a wait the server builds a new path round whatever stands in its way now. */
function Replan(c: SimCreep, blockers: Blocker[]): void {
	c.detour = false
	let best: Nullable<Blocker>,
		bestAlong = Infinity
	for (const b of blockers) {
		const rx = b.x - c.x,
			ry = b.y - c.y,
			along = rx * c.gx + ry * c.gy,
			off = Math.abs(c.gx * ry - c.gy * rx)
		if (along > 0 && along < 160 && off < b.reach && along < bestAlong) {
			best = b
			bestAlong = along
		}
	}
	if (best !== undefined) {
		const [wx, wy] = DetourPoint(c, best)
		c.wx = wx
		c.wy = wy
		c.detour = true
	}
}

/**
 * Plays the creeps and the unit forward `horizon` seconds in `tick` steps; `dir` is the lane
 * direction (progress and the escape test are measured along it).
 */
export function Simulate(
	creeps: SimCreep[],
	unit: SimUnit,
	obstacles: readonly SimObstacle[],
	dir: readonly [number, number],
	horizon: number,
	tick: number,
	lookHold = 0,
	/** Called after every tick with the unit's position (for checking against recordings) */
	onTick?: (k: number, ux: number, uy: number) => void,
	/** Draws in [0, 1) for an ensemble run; without it every wait is its mean and every side the rule's */
	rng?: () => number
): SimResult {
	random = rng
	const start = creeps.map(c => c.x * dir[0] + c.y * dir[1])
	const stood = creeps.map(() => 0)
	const stops = creeps.map(() => 0)
	let ux = unit.x,
		uy = unit.y,
		vx = unit.vx,
		vy = unit.vy,
		escaped = 0,
		lvx = 0,
		lvy = 0,
		lastMove = Math.hypot(unit.vx, unit.vy) > 1 ? 0 : -Infinity
	if (lastMove === 0) {
		lvx = unit.vx
		lvy = unit.vy
	}
	const passed = new Set<number>()
	const order = creeps.map((_, i) => i)
	// each creep's last step (the server's per-tick velocity, 0 while it stands)
	const stepX = creeps.map(() => 0),
		stepY = creeps.map(() => 0)
	// paths are built with the unit where it stands now: a creep heading at it already goes round
	// that spot and slides by without stopping; only the unit stepping into its way stops it
	const here: Blocker[] = [{ x: unit.x, y: unit.y, reach: 0 }]
	for (const c of creeps) {
		if (c.wait <= 0 && !c.detour) {
			here[0] = { x: unit.x, y: unit.y, reach: c.hull + unit.hull }
			Replan(c, here)
		}
	}
	for (let t = 0, k = 0; t < horizon; t += tick, k++) {
		const path = unit.path
		if (path !== undefined && k < path.length) {
			vx = (path[k][0] - ux) / tick
			vy = (path[k][1] - uy) / tick
		} else if (t >= unit.delay) {
			// the unit: its old motion until the order lands, then straight to its spot
			const dx = unit.tx - ux,
				dy = unit.ty - uy,
				dist = Math.hypot(dx, dy)
			const step = Math.min(dist, unit.speed * tick)
			vx = dist > 1e-3 ? (dx / dist) * (step / tick) : 0
			vy = dist > 1e-3 ? (dy / dist) * (step / tick) : 0
		}
		let nx = ux + vx * tick,
			ny = uy + vy * tick
		for (const c of creeps) {
			if (Math.hypot(nx - c.x, ny - c.y) < unit.hull + c.hull) {
				nx = ux
				ny = uy
				vx = 0
				vy = 0
				break
			}
		}
		ux = nx
		uy = ny
		// the look-ahead reads the unit's velocity of its last step: it holds for `lookHold` after a stop
		if (Math.hypot(vx, vy) > 1) {
			lvx = vx
			lvy = vy
			lastMove = t
		}
		const moving = t - lastMove <= lookHold

		// leaders first: one walking behind another sees it where it has stepped to this tick
		// (the order that fits recorded stops best, one tick at a time)
		order.sort(
			(a, b) =>
				creeps[b].x * dir[0] +
				creeps[b].y * dir[1] -
				(creeps[a].x * dir[0] + creeps[a].y * dir[1])
		)
		for (const i of order) {
			const c = creeps[i]
			// its step this tick, kept only if it walks
			stepX[i] = 0
			stepY[i] = 0
			const blockers: Blocker[] = [{ x: ux, y: uy, reach: c.hull + unit.hull }]
			for (const o of obstacles) {
				blockers.push({ x: o.x, y: o.y, reach: o.r + c.hull + c.pad })
			}
			for (let n = 0; n < creeps.length; n++) {
				const o = creeps[n]
				if (o !== c) {
					blockers.push({
						x: o.x,
						y: o.y,
						reach: c.hull + o.hull + c.pad + o.pad,
						look: c.hull + LOOK_REACH + o.hull,
						vx: stepX[n],
						vy: stepY[n]
					})
				}
			}
			if (c.wait > 0) {
				c.wait -= tick
				stood[i] += tick
				if (c.wait <= 0) {
					Replan(c, blockers)
				}
				continue
			}
			let hx = c.gx,
				hy = c.gy
			if (c.detour) {
				const dx = c.wx - c.x,
					dy = c.wy - c.y,
					dist = Math.hypot(dx, dy)
				if (dist < c.speed * tick) {
					c.detour = false
				} else {
					hx = dx / dist
					hy = dy / dist
				}
			}
			const step = c.speed * tick,
				nx2 = c.x + hx * step,
				ny2 = c.y + hy * step
			let blocked: Nullable<Blocker>
			for (const b of blockers) {
				if (Math.hypot(nx2 - b.x, ny2 - b.y) <= b.reach) {
					blocked = b
					break
				}
			}
			if (blocked === undefined) {
				// a creep ahead walking on within its look-ahead reach (only a ranged one is ever that
				// close without touching: the padded contact is wider than the reach otherwise)
				for (const b of blockers) {
					if (b.look === undefined || Math.hypot(b.vx ?? 0, b.vy ?? 0) < 0.01) {
						continue
					}
					const bx = b.x - c.x,
						by = b.y - c.y,
						rl = Math.hypot(bx, by)
					if (
						rl > 1e-3 &&
						Math.hypot(nx2 - b.x, ny2 - b.y) <= b.look &&
						(hx * bx + hy * by) / rl > LOOK_CONE &&
						bx * (b.vx ?? 0) + by * (b.vy ?? 0) > 0
					) {
						c.wait = Wait(SimLookWait)
						stops[i]++
						break
					}
				}
				if (c.wait > 0) {
					continue
				}
			}
			if (blocked !== undefined) {
				c.wait = Wait(SimHardWait)
				stops[i]++
				const [wx, wy] = DetourPoint(c, blocked)
				c.wx = wx
				c.wy = wy
				c.detour = true
				continue
			}
			if (moving) {
				const toX = ux - c.x,
					toY = uy - c.y,
					dist = Math.hypot(toX, toY)
				if (
					dist > 1e-3 &&
					Math.hypot(ux - nx2, uy - ny2) <= c.hull + LOOK_REACH + unit.hull &&
					(hx * toX + hy * toY) / dist > LOOK_CONE &&
					toX * lvx + toY * lvy > 0
				) {
					c.wait = Wait(SimLookWait)
					stops[i]++
					continue
				}
			}
			stepX[i] = nx2 - c.x
			stepY[i] = ny2 - c.y
			c.x = nx2
			c.y = ny2
			// drawing level with the unit outside its contact, or ahead of it: gone
			const rx = c.x - ux,
				ry = c.y - uy,
				along = rx * dir[0] + ry * dir[1],
				lat = Math.abs(rx * -dir[1] + ry * dir[0]),
				contact = c.hull + unit.hull
			if (
				!passed.has(i) &&
				(along > contact || (along > -contact * 0.5 && lat > contact + 4))
			) {
				passed.add(i)
				escaped++
			}
		}
		onTick?.(k, ux, uy)
	}
	let progress = 0,
		low = Infinity,
		high = -Infinity,
		race = 0
	creeps.forEach((c, i) => {
		progress += c.x * dir[0] + c.y * dir[1] - start[i]
		const lat = c.x * -dir[1] + c.y * dir[0]
		low = Math.min(low, lat)
		high = Math.max(high, lat)
		if (passed.has(i)) {
			return
		}
		// the race beyond the forecast: the way across to the creep's line against its time to level
		const rx = c.x - ux,
			ry = c.y - uy,
			behind = -(rx * dir[0] + ry * dir[1]),
			gap = Math.abs(rx * -dir[1] + ry * dir[0]) - (c.hull + unit.hull),
			left = Math.max(0, behind) / Math.max(1, c.speed) + Math.max(0, c.wait)
		race += Math.max(0, gap / Math.max(1, unit.speed) - left)
	})
	random = undefined
	return { progress, escaped, spread: high - low, stood, stops, race }
}
