export interface LanePoint {
	/** Distance travelled along the creeps' route from the spawner. */
	s: number
	/** Signed offset from the route, positive to the left of the travel direction. */
	lat: number
}

export interface LaneObstacle {
	readonly Tower: Tower
	readonly Position: Vector3
	readonly S: number
	readonly Lat: number
	readonly Radius: number
	/** Side of the route the tower stands on: 1 left, -1 right. */
	readonly Side: number
}

interface Segment {
	readonly ax: number
	readonly ay: number
	readonly dx: number
	readonly dy: number
	readonly length: number
	readonly start: number
}

interface Circle {
	readonly x: number
	readonly y: number
	readonly r: number
	/** Side of the travel direction the circle is passed on: 1 left, -1 right. */
	readonly side: number
}

const OBSTACLE_REACH = 260
const ROUTE_CLEARANCE = 40
const ARC_STEP = 0.2

function Rotate(x: number, y: number, angle: number): [number, number] {
	const cos = Math.cos(angle),
		sin = Math.sin(angle)
	return [x * cos - y * sin, x * sin + y * cos]
}

/** Tangent point on `circle` for a straight approach from (px, py) that keeps the circle on its `side`. */
function TangentFrom(px: number, py: number, circle: Circle, side: number): Nullable<[number, number]> {
	const vx = circle.x - px,
		vy = circle.y - py,
		dist = Math.hypot(vx, vy)
	if (dist <= circle.r) {
		return undefined
	}
	const angle = Math.asin(circle.r / dist) * -side,
		length = Math.sqrt(dist * dist - circle.r * circle.r),
		[ux, uy] = Rotate(vx / dist, vy / dist, angle)
	return [px + ux * length, py + uy * length]
}

function SegmentDistance(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
	const dx = bx - ax,
		dy = by - ay,
		len2 = dx * dx + dy * dy,
		t = len2 < 1e-6 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2))
	return Math.hypot(ax + dx * t - x, ay + dy * t - y)
}

/**
 * The route creeps actually walk: the corner polyline, wrapped round the towers it would cut
 * through by tangents and arcs, the way their path finding goes round a building.
 */
/** Turns flatter than this (radians) are kept: cutting them moves the route by a few units only. */
const CORNER_MIN_TURN = 0.35

function TurnAngle(from: Vector3, corner: Vector3, next: Vector3): number {
	const a = Math.atan2(corner.y - from.y, corner.x - from.x),
		b = Math.atan2(next.y - corner.y, next.x - corner.x)
	return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))
}

/**
 * The corners as creeps walk them: a creep heads for the next corner once it comes within `cut` of
 * the current one, so every sharp turn is cut short by a straight chord.
 */
function CutCorners(points: Vector3[], cut: number): Vector3[] {
	if (cut <= 0 || points.length < 3) {
		return points
	}
	const route: Vector3[] = [points[0]]
	for (let i = 1; i < points.length - 1; i++) {
		const from = route[route.length - 1],
			corner = points[i],
			dist = from.Distance2D(corner)
		if (TurnAngle(from, corner, points[i + 1]) < CORNER_MIN_TURN) {
			route.push(corner)
			continue
		}
		if (dist <= cut) {
			continue
		}
		const share = (dist - cut) / dist
		route.push(
			new Vector3(
				from.x + (corner.x - from.x) * share,
				from.y + (corner.y - from.y) * share,
				corner.z
			)
		)
	}
	route.push(points[points.length - 1])
	return route
}

function NaturalRoute(points: Vector3[], towers: Tower[], clearance: number): Vector3[] {
	const route: Vector3[] = [points[0]]
	for (let i = 1; i < points.length; i++) {
		const a = route[route.length - 1],
			b = points[i],
			dx = b.x - a.x,
			dy = b.y - a.y,
			length = Math.hypot(dx, dy)
		const blocking: [Circle, number][] = []
		for (const tower of towers) {
			const pos = tower.Position,
				r = tower.HullRadius + clearance
			if (
				length < 1 ||
				pos.Distance2D(a) <= r ||
				pos.Distance2D(b) <= r ||
				SegmentDistance(a.x, a.y, b.x, b.y, pos.x, pos.y) >= r
			) {
				continue
			}
			const cross = dx * (pos.y - a.y) - dy * (pos.x - a.x)
			blocking.push([
				{ x: pos.x, y: pos.y, r, side: cross > 0 ? 1 : -1 },
				((pos.x - a.x) * dx + (pos.y - a.y) * dy) / length
			])
		}
		blocking.sort((l, r) => l[1] - r[1])
		let from: Vector3 = a
		for (const [circle] of blocking) {
			const entry = TangentFrom(from.x, from.y, circle, circle.side),
				exit = TangentFrom(b.x, b.y, circle, -circle.side)
			if (entry === undefined || exit === undefined) {
				continue
			}
			const a0 = Math.atan2(entry[1] - circle.y, entry[0] - circle.x),
				a1 = Math.atan2(exit[1] - circle.y, exit[0] - circle.x),
				clockwise = circle.side < 0
			let sweep = clockwise ? a0 - a1 : a1 - a0
			while (sweep < 0) {
				sweep += Math.PI * 2
			}
			const steps = Math.max(1, Math.ceil(sweep / ARC_STEP))
			for (let k = 0; k <= steps; k++) {
				const angle = a0 + (clockwise ? -1 : 1) * (sweep * k) / steps,
					x = circle.x + Math.cos(angle) * circle.r,
					y = circle.y + Math.sin(angle) * circle.r
				route.push(new Vector3(x, y, b.z))
			}
			from = route[route.length - 1]
		}
		route.push(b)
	}
	return route
}

export class LaneFrame {
	public readonly Obstacles: LaneObstacle[] = []
	public Points: Vector3[] = []
	public Length = 0
	private segments: Segment[] = []
	private towersKey = ""

	constructor(
		public readonly Team: Team,
		public readonly Lane: MapArea,
		public readonly Corners: Vector3[]
	) {
		this.build(Corners)
	}

	public Project(pos: Vector2 | Vector3, out: LanePoint = { s: 0, lat: 0 }): LanePoint {
		let bestDist = Infinity
		for (let i = 0; i < this.segments.length; i++) {
			const seg = this.segments[i],
				rx = pos.x - seg.ax,
				ry = pos.y - seg.ay,
				t = Math.min(seg.length, Math.max(0, rx * seg.dx + ry * seg.dy)),
				ox = rx - seg.dx * t,
				oy = ry - seg.dy * t,
				dist = ox * ox + oy * oy
			if (dist < bestDist) {
				bestDist = dist
				out.s = seg.start + t
				out.lat = rx * -seg.dy + ry * seg.dx
			}
		}
		return out
	}

	public Direction(s: number): Vector3 {
		const seg = this.segmentAt(s)
		return new Vector3(seg.dx, seg.dy, 0)
	}

	public PointAt(s: number, lat = 0): Vector3 {
		const seg = this.segmentAt(s),
			t = Math.min(seg.length, Math.max(0, s - seg.start)),
			x = seg.ax + seg.dx * t - seg.dy * lat,
			y = seg.ay + seg.dy * t + seg.dx * lat
		return new Vector3(x, y, Dota2SDK.GetPositionHeight(new Vector2(x, y)))
	}

	/** The obstacle a creep at route distance `s` passes next, if it is within `before` of it. */
	public NextObstacle(s: number, before: number): Nullable<LaneObstacle> {
		for (const obstacle of this.Obstacles) {
			if (s <= obstacle.S + obstacle.Radius && s >= obstacle.S - obstacle.Radius - before) {
				return obstacle
			}
		}
		return undefined
	}

	/**
	 * Rebuilds the route round the towers standing now and the obstacles along it; `cornerCut` is
	 * how far from a corner creeps already turn for the next one.
	 */
	public Refresh(towers: Tower[], cornerCut: number): void {
		const alive = towers.filter(tower => tower.IsAlive)
		const key = alive.map(tower => tower.Index).join(",") + ":" + cornerCut
		if (key === this.towersKey) {
			return
		}
		this.towersKey = key
		this.build(NaturalRoute(CutCorners(this.Corners, cornerCut), alive, ROUTE_CLEARANCE))
		this.Obstacles.length = 0
		const point: LanePoint = { s: 0, lat: 0 }
		for (const tower of alive) {
			this.Project(tower.Position, point)
			const radius = tower.HullRadius
			if (Math.abs(point.lat) > radius + OBSTACLE_REACH) {
				continue
			}
			this.Obstacles.push({
				Tower: tower,
				Position: tower.Position,
				S: point.s,
				Lat: point.lat,
				Radius: radius,
				Side: point.lat >= 0 ? 1 : -1
			})
		}
		this.Obstacles.sort((a, b) => a.S - b.S)
	}

	private build(points: Vector3[]): void {
		this.Points = points
		this.segments = []
		let walked = 0
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1],
				b = points[i],
				length = a.Distance2D(b)
			if (length < 1) {
				continue
			}
			this.segments.push({
				ax: a.x,
				ay: a.y,
				dx: (b.x - a.x) / length,
				dy: (b.y - a.y) / length,
				length,
				start: walked
			})
			walked += length
		}
		this.Length = walked
	}

	private segmentAt(s: number): Segment {
		const segments = this.segments
		for (let i = 0; i < segments.length; i++) {
			if (s < segments[i].start + segments[i].length) {
				return segments[i]
			}
		}
		return segments[segments.length - 1]
	}
}

const frames = new Map<number, LaneFrame>()

function BuildCorners(spawner: LaneCreepSpawner): Vector3[] {
	const points: Vector3[] = []
	const first = spawner.TargetPath
	if (first === undefined) {
		return points
	}
	const next = first.TargetPath
	if (next !== undefined && next !== first) {
		const toFirst = first.Position.Subtract(spawner.Position),
			toNext = next.Position.Subtract(first.Position)
		if (toFirst.x * toNext.x + toFirst.y * toNext.y > 0) {
			points.push(spawner.Position.Clone())
		}
	}
	const seen = new Set<CreepPathCorner>()
	for (
		let corner: Nullable<CreepPathCorner> = first;
		corner !== undefined && !seen.has(corner);
		corner = corner.TargetPath
	) {
		seen.add(corner)
		points.push(corner.Position.Clone())
	}
	return points
}

export function GetLaneFrame(team: Team, lane: MapArea): Nullable<LaneFrame> {
	const key = team * 16 + lane
	const cached = frames.get(key)
	if (cached !== undefined) {
		return cached
	}
	const spawner = EntityManager.GetEntitiesByClass(LaneCreepSpawner).find(
		ent => ent.Team === team && ent.Lane === lane
	)
	if (spawner === undefined) {
		return undefined
	}
	const corners = BuildCorners(spawner)
	if (corners.length < 2) {
		return undefined
	}
	const frame = new LaneFrame(team, lane, corners)
	frames.set(key, frame)
	return frame
}

export function ResetLaneFrames(): void {
	frames.clear()
}
