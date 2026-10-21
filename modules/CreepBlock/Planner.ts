import { LaneFrame, LaneObstacle, LanePoint } from "./Lane"
import { MotionTracker } from "./Motion"
import { SimCreep, SimHardWait, SimLookWait, Simulate } from "./Predict"

export const enum CreepRole {
	Approaching,
	Pressing,
	Flanking,
	Detouring,
	Passed,
	Ignored
}

export const enum BlockAction {
	Wait,
	Hold,
	Move,
	Advance
}

export const enum BlockMode {
	Idle,
	Block,
	Passage,
	Advance,
	Funnel
}

export interface CreepView {
	readonly Creep: Creep
	readonly Position: Vector3
	readonly Velocity: Vector3
	readonly Predicted: Vector3
	readonly Lane: LanePoint
	/** Centre distance at which the creep's mover stops against the unit (hull sum, no padding) */
	readonly Contact: number
	/**
	 * Reach of the creep's look-ahead from its next position: a unit within it, inside its cone and
	 * walking away from it, makes the creep wait 0.35–0.45 s
	 */
	readonly LookAhead: number
	Role: CreepRole
	Detour: Nullable<LaneObstacle>
}

/** Why the planner chose its target: read by the evaluation overlay and the test bench. */
export interface PlanTrace {
	/** Front-most creep by predicted position along the route */
	Front: Nullable<CreepView>
	/** Lateral bounds of the run of creeps the unit stands in front of */
	Low: Nullable<CreepView>
	High: Nullable<CreepView>
	/** The most advanced creep outside the window, and how far the unit shifted towards it */
	Threat: Nullable<CreepView>
	Shift: number
	/** Share of the creep's predicted advance the unit leads by, and its two sources */
	Share: number
	SideShare: number
	SpeedShare: number
	/** TraceClamp flags: what overrode the raw target */
	Clamp: number
	/** Lateral distance from the unit to the creep going round a tower while it walks on ahead */
	DetourGap: number
}

export const enum TraceClamp {
	None = 0,
	NoBackStep = 1,
	TowerHug = 2,
	PushedOut = 4,
	ShadowGuard = 8,
	RaceAngle = 16,
	KeyHold = 32
}

export interface BlockPlan {
	readonly Unit: Unit
	readonly Frame: LaneFrame
	readonly UnitLane: LanePoint
	readonly Creeps: CreepView[]
	readonly Latency: number
	Key: Nullable<CreepView>
	Mode: BlockMode
	Action: BlockAction
	Target: Nullable<Vector3>
	Obstacle: Nullable<LaneObstacle>
	Note: string
	readonly Trace: PlanTrace
}

export const Tuning = {
	cornerCut: 300,
	routeClearance: 36,
	hullContact: 1,
	gap: -4.5,
	holdTolerance: 16,
	lookAhead: 0.13,
	movingSpeed: 80,
	groupDepth: 140,
	frontHysteresis: 20,
	frontWeight: 0,
	coverWidth: 0.8,
	sideBias: 0,
	sideMargin: 10,
	sideCover: 0.8,
	sideFlip: 60,
	laPulse: 0,
	laResume: 0.33,
	laMargin: 15,
	laReach: 20,
	laStep: 40,
	followGuard: 90,
	followStep: 60,
	followChain: 1,
	followClear: 60,
	followSplit: 0,
	followPredict: 2,
	jamHerd: 0,
	followClearPassage: 2,
	followAmbiguous: 10,
	followInline: 25,
	frozenFront: 0,
	predictAfter: 400,
	shapeHold: 0,
	splitWalk: 200,
	splitLeadTime: 1.5,
	mpc: 0,
	forecastHorizon: 0.8,
	forecastGoal: 1000,
	forecastStand: 0,
	forecastRace: 300,
	forecastStep: 50,
	forecastShift: 30,
	forecastEscape: 300,
	forecastSpread: 80,
	forecastSpreadCost: 1.5,
	herdOffset: 0,
	coverPair: 0,
	frontLateral: 0,
	splitClose: 140,
	splitDepth: 200,
	splitClear: 30,
	threatBias: 0.5,
	threatDepth: 300,
	windowRoom: 0.8,
	rangedWeight: 0.6,
	forwardShare: 0,
	alignedShare: 0.47,
	alignedRange: 0.79,
	leadSpeedGap: 45,
	pressSpread: 80,
	pressRange: 60,
	passedLateral: 0.7,
	passageBefore: 300,
	passageGap: 80,
	passageLead: 31,
	passageCover: 1,
	passageExit: 1,
	walkFirst: 0,
	walkFirstHold: 0.25,
	passageAfter: 250,
	towerHug: 4,
	gapMargin: 6,
	shadowGuard: 300,
	shadowStep: 60,
	funnelSpread: 320,
	funnelDepth: 400,
	funnelEngage: 500,
	funnelConfirm: 0.25,
	funnelRange: 1800,
	detourReach: 140,
	detourRange: 420,
	detourConfirm: 0.12,
	advance: 1,
	advanceStep: 200,
	advanceMerge: 110,
	advanceTimeout: 8,
	advanceTiming: 0,
	turnBackReach: 0,
	// share of the race angle acos(unit speed / creep speed) the way to the target keeps at least
	// while the key creep is off the unit's line and not past it (0: off)
	raceAngle: 0,
	/** How far behind the unit along the lane the key creep may still be for the race angle */
	raceDepth: 250,
	/** Seconds the front creep is kept in a tower passage before another may take over (0: off) */
	passageKeyHold: 0,
	extraLatency: 0.03,
	/** Ticks between two moves: 4 is the game's own right-button repeat (`MoveUnit`) */
	moveIntervalTicks: 4,
	/** Stop a walk the click rate keeps from turning to the new target (`GuardWithStop`; 0: off) */
	stopGuard: 1,
	/** Share of its speed the unit has to be closing on the new target with, or the guard stops it */
	stopProgress: 0.5,
	/** Share of the ticks a move waits beyond one (the click rate) added to the creeps' lead (0: off) */
	moveLead: 0,
	/** A move shifting the target less than this waits two click intervals (`NeedsOrder`; 0: off) */
	moveReserve: 60,
	orderMinShift: 30,
	orderShiftShare: 0.35,
	orderRefresh: 1
}

const MIN_PASSED = 25
/** Look-ahead reach of the server's mover beyond both hulls, and its cone (cosine) */
const LOOK_AHEAD_REACH = 32
const LOOK_AHEAD_CONE = 0.7

interface Lead {
	readonly view: CreepView
	readonly s: number
	readonly lat: number
	readonly weight: number
}

const detourSince = new Map<Creep, number>()
const fronts = new Map<Unit, Creep>()
/** Since when the unit's front creep has been the one it is */
const frontSince = new Map<Unit, number>()
const sides = new Map<Unit, number>()
const splitWalks = new Set<Unit>()
const advances = new Map<Unit, Advance>()
const funnelSince = new Map<Unit, number>()

interface Advance {
	readonly creep: Creep
	readonly obstacle: LaneObstacle
	readonly since: number
}

/** Whether a moving creep near `obstacle` is heading round its far side, away from the lane. */
function HeadsRoundFarSide(view: CreepView, obstacle: LaneObstacle): boolean {
	const lane = view.Lane
	if (
		lane.s < obstacle.S - obstacle.Radius - Tuning.detourReach ||
		lane.s > obstacle.S + obstacle.Radius
	) {
		return false
	}
	if ((lane.lat - obstacle.Lat) * obstacle.Side > 0) {
		return true
	}
	const vel = view.Velocity,
		speed = Math.hypot(vel.x, vel.y)
	if (speed < Tuning.movingSpeed) {
		return false
	}
	const rx = obstacle.Position.x - view.Position.x,
		ry = obstacle.Position.y - view.Position.y,
		dist = Math.hypot(rx, ry)
	if (dist > obstacle.Radius + view.Contact + Tuning.detourReach) {
		return false
	}
	if (vel.x * rx + vel.y * ry <= 0) {
		return false
	}
	return Math.sign(vel.x * ry - vel.y * rx) === -obstacle.Side
}

function PushOutOfObstacles(frame: LaneFrame, pos: Vector3, radius: number): boolean {
	let pushed = false
	for (const obstacle of frame.Obstacles) {
		const min = obstacle.Radius + radius + Tuning.towerHug,
			dx = pos.x - obstacle.Position.x,
			dy = pos.y - obstacle.Position.y,
			dist = Math.hypot(dx, dy)
		if (dist >= min || dist < 1e-3) {
			continue
		}
		pos.x = obstacle.Position.x + (dx / dist) * min
		pos.y = obstacle.Position.y + (dy / dist) * min
		pushed = true
	}
	return pushed
}

/** The lane offset a unit of `radius` keeps when it hugs `obstacle` from the lane side at `s`. */
function HugLat(obstacle: LaneObstacle, radius: number, s: number): Nullable<number> {
	const reach = obstacle.Radius + radius + Tuning.towerHug,
		ds = s - obstacle.S
	if (Math.abs(ds) >= reach) {
		return undefined
	}
	return obstacle.Lat - obstacle.Side * Math.sqrt(reach * reach - ds * ds)
}

/** Whether the route runs close enough past `obstacle` for creeps to squeeze by it. */
function Squeezes(obstacle: LaneObstacle): boolean {
	return Math.abs(obstacle.Lat) - obstacle.Radius <= Tuning.passageGap
}

/**
 * The obstacle whose lane-side passage the wave front at `s` is about to squeeze through, unless
 * the unit at `unitS` is already well past it (a wave still walking past its own base tower).
 */
function PassageObstacle(
	frame: LaneFrame,
	s: number,
	unitS: number,
	unitPad: number
): Nullable<LaneObstacle> {
	for (const obstacle of frame.Obstacles) {
		if (!Squeezes(obstacle)) {
			continue
		}
		const reach = obstacle.Radius + unitPad + Tuning.towerHug
		if (
			s >= obstacle.S - reach - Tuning.passageBefore &&
			s <= obstacle.S + reach &&
			unitS <= obstacle.S + reach + Tuning.passageAfter
		) {
			return obstacle
		}
	}
	return undefined
}

/** Whether `s` is within `predictAfter` past a squeezing tower. */
function JustPastPassage(frame: LaneFrame, s: number): boolean {
	return frame.Obstacles.some(
		obstacle =>
			Squeezes(obstacle) && s > obstacle.S && s <= obstacle.S + Tuning.predictAfter
	)
}

/**
 * Whether the creep going round `obstacle`'s far side is still more than `advanceTiming` seconds
 * further from coming back to the lane than the unit is from standing in front of that point: its
 * way round (the straight line to the point past the tower, × 1.25 for the arc) and what is left of
 * a stand, against the unit's walk to that point plus the creep's look-ahead reach.
 */
function DetourAhead(
	frame: LaneFrame,
	unitLane: LanePoint,
	unitSpeed: number,
	view: CreepView,
	obstacle: LaneObstacle,
	motion: MotionTracker,
	now: number
): boolean {
	const backS = obstacle.S + obstacle.Radius + view.Contact,
		back = frame.PointAt(backS),
		still = motion.StillFor(view.Creep, now),
		wait = still > 0 ? Math.max(0, SimHardWait - still) : 0,
		creepTime =
			(view.Position.Distance2D(back) * 1.25) / Math.max(1, view.Creep.MoveSpeed) +
			wait,
		unitTime =
			Math.max(0, backS + view.LookAhead - unitLane.s) / Math.max(1, unitSpeed)
	return creepTime - unitTime > Tuning.advanceTiming
}

function UpdateDetours(
	views: CreepView[],
	frame: LaneFrame,
	unit: Unit,
	unitLane: LanePoint,
	now: number
): void {
	for (const creep of detourSince.keys()) {
		if (!views.some(view => view.Creep === creep)) {
			detourSince.delete(creep)
		}
	}
	for (const view of views) {
		if (view.Role === CreepRole.Passed || view.Role === CreepRole.Ignored) {
			detourSince.delete(view.Creep)
			continue
		}
		const obstacle = frame.NextObstacle(view.Lane.s, Tuning.detourReach)
		const heading =
			obstacle !== undefined &&
			Squeezes(obstacle) &&
			view.Position.Distance2D(unit.Position) < Tuning.detourRange &&
			obstacle.S + obstacle.Radius > unitLane.s - obstacle.Radius &&
			HeadsRoundFarSide(view, obstacle)
		if (!heading) {
			detourSince.delete(view.Creep)
			continue
		}
		const since = detourSince.get(view.Creep) ?? now
		detourSince.set(view.Creep, since)
		if (now - since >= Tuning.detourConfirm) {
			view.Role = CreepRole.Detouring
			view.Detour = obstacle
		}
	}
}

/**
 * The widest run of creeps, by lane offset, one unit can stand in front of; it always holds `front`.
 * A creep walks into the unit while its line passes within `Contact` of the unit's centre, so the
 * run spans at most `coverWidth` of that ±contact.
 */
/**
 * How far apart two creeps may walk and still both run into a unit between them. With `coverPair`
 * the unit stands where both keep the same share of their own contact (see `WindowLat`), so the
 * widths add up: two melee creeps 72 apart, the pair a bump leaves, fit (80 × share).
 */
function WindowWidth(low: Lead, high: Lead): number {
	return Tuning.coverPair > 0
		? (low.view.Contact + high.view.Contact) * Tuning.coverPair
		: 2 * Math.min(low.view.Contact, high.view.Contact) * Tuning.coverWidth
}

/** The lateral spot in front of the window: both edge creeps the same share of their contact away. */
function WindowLat(low: Lead, high: Lead): number {
	if (Tuning.coverPair <= 0) {
		return (low.lat + high.lat) / 2
	}
	const sum = low.view.Contact + high.view.Contact
	return low.lat + ((high.lat - low.lat) * low.view.Contact) / sum
}

function CoverWindow(group: Lead[], front: Lead): [Lead, Lead] {
	const pivot = group.indexOf(front)
	let bestFrom = pivot,
		bestTo = pivot,
		bestWeight = -1
	for (let from = 0; from <= pivot; from++) {
		let weight = 0
		for (let to = from; to < group.length; to++) {
			const width = WindowWidth(group[from], group[to])
			if (group[to].lat - group[from].lat > width) {
				break
			}
			weight += group[to].weight + group[to].s * 1e-4
			if (to >= pivot && weight > bestWeight) {
				bestWeight = weight
				bestFrom = from
				bestTo = to
			}
		}
	}
	return [group[bestFrom], group[bestTo]]
}

/**
 * The front creep among those level with the most advanced one (within `frontHysteresis`): the one
 * whose cover window holds the most creeps, the creep kept from before on a tie. A wave arriving
 * split has a front on either side; holding a lone creep there lets the group on the other side
 * walk by.
 */
function WeightiestFront(leads: Lead[], maxS: number, kept: Nullable<Lead>): Lead {
	let best: Nullable<Lead>,
		bestWeight = -Infinity
	for (const candidate of leads) {
		if (candidate.s < maxS - Tuning.frontHysteresis) {
			continue
		}
		const group = leads
			.filter(lead => lead.s >= candidate.s - Tuning.groupDepth)
			.sort((a, b) => a.lat - b.lat)
		const [low, high] = CoverWindow(group, candidate)
		let weight = candidate === kept ? 0.05 : 0
		for (const lead of group) {
			if (lead.lat >= low.lat && lead.lat <= high.lat) {
				weight += lead.weight
			}
		}
		if (weight > bestWeight) {
			bestWeight = weight
			best = candidate
		}
	}
	return best ?? leads[0]
}

/**
 * How far along the route the unit has to stay ahead of a creep: its predicted position while it
 * could still pass on a side, its current one once it walks straight into the unit, so that a
 * unit nearly as fast as creeps waits for the bump instead of running ahead of it.
 */
function LeadS(
	lead: Lead,
	unitLane: LanePoint,
	unitSpeed: number,
	spread: number,
	trace: PlanTrace
): number {
	const offset = Math.abs(lead.lat - unitLane.lat),
		aligned = lead.view.Contact * Tuning.alignedShare,
		sideShare = (offset - aligned) / (lead.view.Contact * Tuning.alignedRange),
		speedShare =
			((lead.view.Creep.MoveSpeed - unitSpeed) / Tuning.leadSpeedGap) *
			PressShare(spread),
		share = Math.min(1, Math.max(0, sideShare, speedShare))
	trace.SideShare = sideShare
	trace.SpeedShare = speedShare
	trace.Share = share
	return lead.view.Lane.s + (lead.s - lead.view.Lane.s) * share
}

/** The middle of the creeps' lateral extent. */
function WaveMiddle(leads: Lead[]): number {
	let low = Infinity,
		high = -Infinity
	for (const lead of leads) {
		low = Math.min(low, lead.lat)
		high = Math.max(high, lead.lat)
	}
	return (low + high) / 2
}

/** Lateral extent of the creeps at or beyond route distance `from`. */
function LateralSpread(leads: Lead[], from: number): number {
	let low = Infinity,
		high = -Infinity
	for (const lead of leads) {
		if (lead.s >= from) {
			low = Math.min(low, lead.lat)
			high = Math.max(high, lead.lat)
		}
	}
	return high - low
}

/**
 * How much of the speed-based lead applies for a wave of this lateral spread: a compact wave is
 * blocked by stopping in front of it, a spread one by staying ahead of its predicted position.
 */
function PressShare(spread: number): number {
	if (Tuning.pressSpread <= 0) {
		return 1
	}
	return Math.min(1, Math.max(0, (spread - Tuning.pressSpread) / Tuning.pressRange))
}

/**
 * Lateral shift inside the room the cover window leaves, towards the most advanced creep outside it
 * (away from it for a negative `threatBias`): the unit still covers the window and is nearer when
 * that creep draws level.
 */
function ThreatShift(
	leads: Lead[],
	front: Lead,
	low: Lead,
	high: Lead,
	key: Lead,
	trace: PlanTrace
): number {
	if (Tuning.threatBias === 0) {
		return 0
	}
	let threat: Nullable<Lead>
	for (const lead of leads) {
		if (
			lead.s >= front.s - Tuning.threatDepth &&
			(lead.lat < low.lat || lead.lat > high.lat) &&
			(threat === undefined || lead.s > threat.s)
		) {
			threat = lead
		}
	}
	if (threat === undefined) {
		return 0
	}
	const room =
		Tuning.coverPair > 0
			? Math.max(0, (WindowWidth(low, high) - (high.lat - low.lat)) / 2)
			: Math.max(0, key.view.Contact * Tuning.windowRoom - (high.lat - low.lat) / 2)
	trace.Threat = threat.view
	trace.Shift = Math.sign(threat.lat - WindowLat(low, high)) * room * Tuning.threatBias
	return trace.Shift
}

/**
 * Lateral spot that keeps every creep of the cover window on one side of the unit's centre: a creep
 * goes round a unit in its way on the side farther from that centre, so with the whole window on
 * one side they all go round the same way and the wave keeps together instead of splitting round
 * both sides. The unit stands on the window's side away from the route line (the creeps' way round
 * is then towards it, where their next corner is) until the window has drifted `sideFlip` past the
 * line; the farthest window creep stays within `sideCover` contacts of it.
 */
function SideLat(unit: Unit, low: Lead, high: Lead, key: Lead): number {
	const center = (low.lat + high.lat) / 2
	let side = sides.get(unit)
	if (side === undefined || center * side < -Tuning.sideFlip) {
		side = center >= 0 ? 1 : -1
	}
	sides.set(unit, side)
	const cover = key.view.Contact * Tuning.sideCover
	return side > 0
		? Math.min(high.lat + Tuning.sideMargin, low.lat + cover)
		: Math.max(low.lat - Tuning.sideMargin, high.lat - cover)
}

/**
 * Whether a creep other than `front` stands in front of `obstacle` within its lateral span: if the
 * lane side is jammed by a standing unit it may path round the obstacle's far side instead.
 */
function InShadow(views: CreepView[], front: CreepView, obstacle: LaneObstacle): boolean {
	const from = obstacle.S - obstacle.Radius - Tuning.shadowGuard,
		to = obstacle.S - obstacle.Radius + 30
	return views.some(
		view =>
			view !== front &&
			view.Lane.s >= from &&
			view.Lane.s <= to &&
			Math.abs(view.Lane.lat - obstacle.Lat) <
				obstacle.Radius + view.Creep.PaddedCollisionRadius
	)
}

/**
 * The tower to wait at while the wave reaching the unit runs split wider than one unit covers:
 * creeps' shortest paths converge on the route where it passes the tower, so the wave closes up
 * there. A wave still far away is not judged, it closes up on its own on most lanes.
 */
function FunnelObstacle(
	frame: LaneFrame,
	unitLane: LanePoint,
	unitPad: number,
	leads: Lead[],
	front: Lead
): Nullable<LaneObstacle> {
	if (Tuning.funnelSpread <= 0 || front.s < unitLane.s - Tuning.funnelEngage) {
		return undefined
	}
	if (LateralSpread(leads, front.s - Tuning.funnelDepth) <= Tuning.funnelSpread) {
		return undefined
	}
	for (const obstacle of frame.Obstacles) {
		const wait = obstacle.S - (obstacle.Radius + unitPad + Tuning.towerHug) / 2
		if (wait > unitLane.s && wait - unitLane.s < Tuning.funnelRange) {
			return obstacle
		}
	}
	return undefined
}

/**
 * Offset of `pos` from `origin` along the lane direction at route distance `s` and across it
 * (positive to the left). World geometry: a creep far off the route projects badly onto it.
 */
function Offset(frame: LaneFrame, s: number, origin: Vector3, pos: Vector3): LanePoint {
	const dir = frame.Direction(s),
		dx = pos.x - origin.x,
		dy = pos.y - origin.y
	return { s: dx * dir.x + dy * dir.y, lat: dx * -dir.y + dy * dir.x }
}

/** Whether a creep that looked like going round `obstacle` reached it on the lane side after all. */
function TurnedBack(frame: LaneFrame, view: CreepView, obstacle: LaneObstacle): boolean {
	const off = Offset(frame, obstacle.S, obstacle.Position, view.Position)
	return (
		off.s >= 0 &&
		off.s <= obstacle.Radius + Tuning.turnBackReach &&
		off.lat * obstacle.Side < 0
	)
}

/**
 * Whether a creep that went round the far side of `obstacle` is back with the wave: past the
 * tower and either near the unit's line or about to draw level with it.
 */
function Rejoined(
	frame: LaneFrame,
	view: CreepView,
	unit: Unit,
	unitLane: LanePoint,
	obstacle: LaneObstacle
): boolean {
	if (
		Offset(frame, obstacle.S, obstacle.Position, view.Position).s <= obstacle.Radius
	) {
		return false
	}
	const off = Offset(frame, unitLane.s, unit.Position, view.Position)
	return Math.abs(off.lat) < Tuning.advanceMerge || off.s > -view.LookAhead * 2
}

/**
 * Whether the creep's mover reacts to the unit already: it stands in contact, or the unit is in
 * its cone within look-ahead reach of its next position (where a unit walking away holds it up).
 */
function Presses(view: CreepView, unit: Unit, tick: number): boolean {
	const pos = view.Position,
		vel = view.Velocity,
		speed = Math.hypot(vel.x, vel.y),
		ux = unit.Position.x - pos.x,
		uy = unit.Position.y - pos.y,
		dist = Math.hypot(ux, uy)
	if (dist <= view.Contact) {
		return true
	}
	if (speed < Tuning.movingSpeed) {
		return dist < view.LookAhead
	}
	const next = Math.hypot(ux - vel.x * tick, uy - vel.y * tick)
	return (
		next < view.LookAhead &&
		(vel.x * ux + vel.y * uy) / (speed * dist) > LOOK_AHEAD_CONE
	)
}

/**
 * Whether a creep behind `front` is about to run into it: within `followGuard` of their contact
 * (creeps pad each other, 72 melee to melee) and closing in. Held up, the front creep becomes an
 * obstacle the follower stops on and paths round, on the side away from its centre: followers
 * either side of it then split the wave round both sides of the unit.
 */
function FollowerClosing(
	views: CreepView[],
	front: CreepView,
	predict = Tuning.followPredict === 1
): boolean {
	const fv = front.Velocity
	return views.some(view => {
		if (view === front || view.Lane.s > front.Lane.s) {
			return false
		}
		const dx = front.Position.x - view.Position.x,
			dy = front.Position.y - view.Position.y,
			dist = Math.hypot(dx, dy)
		if (dist < 1e-3) {
			return false
		}
		const gap =
			dist - view.Creep.PaddedCollisionRadius - front.Creep.PaddedCollisionRadius
		if (gap > Tuning.followGuard) {
			return false
		}
		// with `followInline` only a creep in line behind it: one already beside it (a pair) stops
		// with it and walks round in one in ten stops, one in line walks round in nine in ten
		if (
			Tuning.followInline > 0 &&
			Math.abs(view.Lane.lat - front.Lane.lat) >= Tuning.followInline
		) {
			return false
		}
		// predictive: as if the front creep were stopped already, which a hold or a freeze is about to do
		const ox = predict ? 0 : fv.x,
			oy = predict ? 0 : fv.y,
			closing = ((view.Velocity.x - ox) * dx + (view.Velocity.y - oy) * dy) / dist
		return closing > Tuning.movingSpeed
	})
}

/**
 * Whether any creep of the wave is about to run into the one ahead of it: a creep held up passes
 * the jam back down the column, and every creep that runs into it walks round its far side.
 */
const walkFirsts = new Map<Unit, Creep>()

/**
 * The creep furthest along the lane now (current position, not predicted: a frozen creep's
 * prediction does not move and puts it behind one walking further back), the one from before kept
 * unless another is `frontHysteresis` further on.
 */
function FurthestNow(unit: Unit, leads: Lead[]): Lead {
	const kept = leads.find(lead => lead.view.Creep === walkFirsts.get(unit))
	let best = leads[0]
	for (const lead of leads) {
		if (lead.view.Lane.s > best.view.Lane.s) {
			best = lead
		}
	}
	if (
		kept !== undefined &&
		kept.view.Lane.s >= best.view.Lane.s - Tuning.frontHysteresis
	) {
		best = kept
	}
	walkFirsts.set(unit, best.view.Creep)
	return best
}

/**
 * The creep that reaches the unit first: its way along the lane at its speed plus what is left of
 * its stand when it is waiting (a look-ahead freeze, 0.42 s); the one from before is kept unless
 * another comes `walkFirstHold` seconds sooner. Predicted positions put a frozen creep behind one
 * walking further back, and running to the far side for that loses the frozen one when it goes on.
 */
function FirstToArrive(
	unit: Unit,
	unitLane: LanePoint,
	leads: Lead[],
	motion: MotionTracker,
	now: number
): Lead {
	const kept = walkFirsts.get(unit)
	const arrival = (lead: Lead) => {
		const still = motion.StillFor(lead.view.Creep, now),
			wait = still > 0 ? Math.max(0, SimLookWait - still) : 0
		return (
			Math.max(0, unitLane.s - lead.view.Lane.s) /
				Math.max(1, lead.view.Creep.MoveSpeed) +
			wait
		)
	}
	let best = leads[0],
		bestTime = Infinity,
		keptLead: Nullable<Lead>,
		keptTime = Infinity
	for (const lead of leads) {
		const time = arrival(lead)
		if (time < bestTime) {
			best = lead
			bestTime = time
		}
		if (lead.view.Creep === kept) {
			keptLead = lead
			keptTime = time
		}
	}
	if (keptLead !== undefined && keptTime <= bestTime + Tuning.walkFirstHold) {
		best = keptLead
	}
	walkFirsts.set(unit, best.view.Creep)
	return best
}

/**
 * The side (1 left, -1 right) of `key` the creeps about to run into it come up on, from their mean
 * lateral offset; 0 when none is closing in, the unit's side of the key when they come in line.
 */
function FollowerSide(views: CreepView[], key: CreepView, unitLat: number): number {
	let sum = 0,
		n = 0
	for (const view of views) {
		if (view === key || view.Lane.s > key.Lane.s || !FollowerClosing([view], key)) {
			continue
		}
		sum += view.Lane.lat - key.Lane.lat
		n++
	}
	if (n === 0) {
		return 0
	}
	const mean = sum / n
	if (Math.abs(mean) < Tuning.followAmbiguous) {
		return unitLat >= key.Lane.lat ? 1 : -1
	}
	return Math.sign(mean)
}

function ColumnJammed(views: CreepView[], predict?: boolean): boolean {
	return views.some(view => FollowerClosing(views, view, predict))
}

/**
 * The side (1 left, -1 right) a creep coming up behind `front` goes round it: away from its centre.
 * 0 when `front` is so close to its line that either side may come out.
 */
function RoundSide(view: CreepView, front: CreepView): number {
	const vel = view.Velocity,
		speed = Math.hypot(vel.x, vel.y)
	if (speed < 1e-3) {
		return 0
	}
	const rx = front.Position.x - view.Position.x,
		ry = front.Position.y - view.Position.y,
		offset = (vel.x * ry - vel.y * rx) / speed
	return Math.abs(offset) < Tuning.followAmbiguous ? 0 : -Math.sign(offset)
}

/**
 * Whether the creeps about to run into a creep of the wave go round it on both sides (or one of
 * them in line with it, either side): that splits the wave wider than one unit covers. Going round
 * one side they come up beside it as a pair 72 wide, which the unit still stands in front of.
 */
function SplitJam(views: CreepView[]): boolean {
	return views.some(front => {
		let found = 0
		for (const view of views) {
			if (
				view === front ||
				view.Lane.s > front.Lane.s ||
				!FollowerClosing([view], front)
			) {
				continue
			}
			const side = RoundSide(view, front)
			if (side === 0) {
				return true
			}
			found |= side > 0 ? 1 : 2
		}
		return found === 3
	})
}

/**
 * Whether the unit has to be walking away from a creep now: a unit standing in its way is walked
 * round, one walking away inside its look-ahead reach holds it for another 0.35–0.45 s. That is
 * when the creep will be inside the reach once an order lands, or when it has stood (waiting out a
 * look-ahead) long enough to go on any moment.
 */
function NeedsStep(
	view: CreepView,
	unit: Unit,
	motion: MotionTracker,
	now: number,
	latency: number
): boolean {
	const pos = view.Position,
		ux = unit.Position.x - pos.x,
		uy = unit.Position.y - pos.y,
		dist = Math.hypot(ux, uy)
	if (dist > view.LookAhead + Tuning.laReach + Tuning.laMargin * 2) {
		return false
	}
	const vel = view.Velocity,
		speed = Math.hypot(vel.x, vel.y)
	if (speed < Tuning.movingSpeed) {
		return (
			dist <= view.LookAhead + Tuning.laReach &&
			motion.StillFor(view.Creep, now) >= Tuning.laResume - latency
		)
	}
	if ((vel.x * ux + vel.y * uy) / (speed * dist) <= LOOK_AHEAD_CONE) {
		return false
	}
	const t = latency + GameState.TickInterval
	return Math.hypot(ux - vel.x * t, uy - vel.y * t) <= view.LookAhead + Tuning.laMargin
}

/**
 * The narrowest tower passage the creeps still active fit through: a creep slips between `obstacle`
 * and the unit once the unit stands farther from the tower's centre than the creep's contact with
 * the tower (its hull and padding, the tower has none) plus its contact with the unit.
 */
function PassageFit(obstacle: LaneObstacle, active: CreepView[]): number {
	return (
		obstacle.Radius +
		Math.min(...active.map(view => view.Creep.PaddedCollisionRadius + view.Contact))
	)
}

/** The creeps as the forecast takes them: where they head, and whether they stand or walk round. */
function SimCreeps(
	views: CreepView[],
	frame: LaneFrame,
	unit: Unit,
	motion: MotionTracker,
	now: number
): SimCreep[] {
	return views.map(view => {
		// heading for its next corner: the lane line `forecastGoal` ahead
		const along = frame.Direction(view.Lane.s),
			goal = frame.PointAt(view.Lane.s + Tuning.forecastGoal),
			gx = goal.x - view.Position.x,
			gy = goal.y - view.Position.y,
			gl = Math.hypot(gx, gy),
			dir = gl > 1 ? new Vector3(gx / gl, gy / gl, 0) : along,
			vel = view.Velocity,
			speed = Math.hypot(vel.x, vel.y),
			still = motion.StillFor(view.Creep, now),
			near = view.Position.Distance2D(unit.Position) < view.LookAhead + 20
		const creep: SimCreep = {
			x: view.Position.x,
			y: view.Position.y,
			gx: dir.x,
			gy: dir.y,
			speed: view.Creep.MoveSpeed,
			hull: view.Creep.HullRadius,
			pad: view.Creep.CollisionPadding,
			wait:
				still > 0
					? Math.max(0.03, (near ? SimLookWait : SimHardWait) - still)
					: 0,
			wx: 0,
			wy: 0,
			detour: false
		}
		// walking off the lane direction: it is going round something, keep it on that way
		if (
			speed > Tuning.movingSpeed &&
			(vel.x * dir.x + vel.y * dir.y) / speed < Math.cos(0.35)
		) {
			creep.wx = view.Position.x + (vel.x / speed) * 80
			creep.wy = view.Position.y + (vel.y / speed) * 80
			creep.detour = true
		}
		return creep
	})
}

/**
 * The shift (along, across the lane) of the planned spot chosen by forecast: the spot and its
 * neighbours (and, with `forecastStand`, standing where the unit is), each played
 * `forecastHorizon` seconds forward; the least advance of the creeps wins, a creep getting by, a
 * creep the unit could no longer get in front of, and a wave spread wider than one unit covers
 * weigh heavily against it.
 */
function ForecastShift(
	unit: Unit,
	unitLane: LanePoint,
	frame: LaneFrame,
	views: CreepView[],
	motion: MotionTracker,
	now: number,
	latency: number,
	targetS: number,
	targetLat: number
): [number, number] {
	const unitPad = unit.PaddedCollisionRadius,
		dir = frame.Direction(unitLane.s),
		vel = motion.Velocity(unit),
		obstacles = frame.Obstacles.map(o => ({
			x: o.Position.x,
			y: o.Position.y,
			r: o.Radius
		})),
		tick = GameState.TickInterval
	const candidates: [Nullable<Vector3>, number, number][] =
		Tuning.forecastStand > 0 ? [[undefined, 0, 0]] : []
	for (const along of [0, Tuning.forecastStep]) {
		for (const across of [-2, -1, 0, 1, 2]) {
			const point = frame.PointAt(
				targetS + along,
				targetLat + across * Tuning.forecastShift
			)
			PushOutOfObstacles(frame, point, unitPad)
			candidates.push([point, along, across])
		}
	}
	let best = candidates[0],
		bestCost = Infinity
	for (const candidate of candidates) {
		const at = candidate[0] ?? unit.Position
		const result = Simulate(
			SimCreeps(views, frame, unit, motion, now),
			{
				x: unit.Position.x,
				y: unit.Position.y,
				hull: unit.HullRadius,
				speed: unit.MoveSpeed,
				tx: at.x,
				ty: at.y,
				vx: vel.x,
				vy: vel.y,
				delay: latency
			},
			obstacles,
			[dir.x, dir.y],
			Tuning.forecastHorizon,
			tick
		)
		const cost =
			result.progress +
			result.escaped * Tuning.forecastEscape +
			result.race * Tuning.forecastRace +
			Math.max(0, result.spread - Tuning.forecastSpread) *
				Tuning.forecastSpreadCost +
			// the planned spot wins a tie
			(candidate[1] === 0 && candidate[2] === 0 && candidate[0] !== undefined
				? -1
				: 0)
		if (cost < bestCost) {
			bestCost = cost
			best = candidate
		}
	}
	const [spot, ds, dl] = best
	if (spot === undefined) {
		// standing: the spot where the unit is
		return [unitLane.s - targetS, unitLane.lat - targetLat]
	}
	return [ds, dl * Tuning.forecastShift]
}

export function ResetPlanner(): void {
	detourSince.clear()
	fronts.clear()
	frontSince.clear()
	sides.clear()
	splitWalks.clear()
	walkFirsts.clear()
	advances.clear()
	funnelSince.clear()
}

export function PlanBlock(
	unit: Unit,
	creeps: Creep[],
	frame: LaneFrame,
	motion: MotionTracker,
	skipRanged: boolean,
	now: number,
	/** Where the unit's last order went: the humanizer's cursor glides on from there */
	aim?: Vector3
): BlockPlan {
	// when an order given now lands, as aio's orbwalk counts it: the humanizer's hold for the glide
	// to the spot plus `InputLag`, the game's median answer (the round trip rounded up to ticks and
	// a server tick: one tick on a listen server, three at 60 ms)
	const unitLane = frame.Project(unit.Position),
		unitPad = unit.PaddedCollisionRadius,
		latency =
			ExecuteOrder.EstimateDispatchDelay(aim ?? unit.Position) + GameState.InputLag

	const views: CreepView[] = []
	for (const creep of creeps) {
		const pos = creep.Position,
			vel = motion.Velocity(creep),
			lane = frame.Project(pos),
			hulls = Tuning.hullContact > 0,
			contact = hulls
				? unit.HullRadius + creep.HullRadius
				: unitPad + creep.PaddedCollisionRadius,
			reach = hulls ? contact + LOOK_AHEAD_REACH : contact,
			ahead = lane.s - unitLane.s
		const view: CreepView = {
			Creep: creep,
			Position: pos,
			Velocity: vel,
			Predicted: new Vector3(
				pos.x + vel.x * latency,
				pos.y + vel.y * latency,
				pos.z
			),
			Lane: lane,
			Contact: contact,
			LookAhead: reach,
			Role: CreepRole.Approaching,
			Detour: undefined
		}
		if (skipRanged && creep.IsRangeAttacker) {
			view.Role = CreepRole.Ignored
		} else if (
			ahead > contact ||
			(ahead > MIN_PASSED &&
				Math.abs(lane.lat - unitLane.lat) > contact * Tuning.passedLateral)
		) {
			view.Role = CreepRole.Passed
		} else if (Presses(view, unit, GameState.TickInterval)) {
			view.Role = CreepRole.Pressing
		} else if (Math.abs(lane.lat - unitLane.lat) > contact && ahead > -reach * 2) {
			view.Role = CreepRole.Flanking
		}
		views.push(view)
	}
	UpdateDetours(views, frame, unit, unitLane, now)

	const plan: BlockPlan = {
		Unit: unit,
		Frame: frame,
		UnitLane: unitLane,
		Creeps: views,
		Latency: latency,
		Key: undefined,
		Mode: BlockMode.Idle,
		Action: BlockAction.Wait,
		Target: undefined,
		Obstacle: undefined,
		Note: "Waiting creeps",
		Trace: {
			Front: undefined,
			Low: undefined,
			High: undefined,
			Threat: undefined,
			Shift: 0,
			Share: 0,
			SideShare: 0,
			SpeedShare: 0,
			Clamp: TraceClamp.None,
			DetourGap: 0
		}
	}
	const trace = plan.Trace

	const active = views.filter(
		view => view.Role !== CreepRole.Passed && view.Role !== CreepRole.Ignored
	)
	if (active.length === 0) {
		if (views.some(view => view.Role === CreepRole.Passed)) {
			plan.Note = "Creeps passed"
		}
		return plan
	}

	let advance = advances.get(unit)
	if (advance !== undefined) {
		const followed = views.find(view => view.Creep === advance?.creep)
		if (
			followed === undefined ||
			followed.Role === CreepRole.Passed ||
			now - advance.since > Tuning.advanceTimeout ||
			TurnedBack(frame, followed, advance.obstacle) ||
			Rejoined(frame, followed, unit, unitLane, advance.obstacle)
		) {
			advances.delete(unit)
			advance = undefined
		}
	}
	if (advance === undefined && Tuning.advance > 0) {
		const detouring = active.find(view => view.Role === CreepRole.Detouring)
		if (detouring?.Detour !== undefined) {
			advance = { creep: detouring.Creep, obstacle: detouring.Detour, since: now }
			advances.set(unit, advance)
		}
	}
	const tracked =
		advance === undefined
			? undefined
			: views.find(view => view.Creep === advance?.creep)
	if (advance !== undefined && tracked !== undefined) {
		trace.DetourGap = Math.abs(
			Offset(frame, unitLane.s, unit.Position, tracked.Position).lat
		)
		plan.Obstacle = advance.obstacle
	}
	const blockable = active.filter(
		view => view.Role !== CreepRole.Detouring && view !== tracked
	)
	if (blockable.length === 0) {
		if (advance === undefined) {
			plan.Note = "Creeps go round the tower, they come out behind"
			return plan
		}
		const ahead = frame.PointAt(unitLane.s + Tuning.advanceStep)
		PushOutOfObstacles(frame, ahead, unitPad)
		plan.Target = ahead
		plan.Mode = BlockMode.Advance
		plan.Action = BlockAction.Advance
		plan.Note = "Creeps go round the tower: walking on ahead of them"
		return plan
	}

	// a tick and `extraLatency` on top of the order's arrival: the lead every bench series was
	// measured with (97 ms in all on a listen server), so the tuning keeps its meaning
	// `moveLead`: a move stands until the click rate lets the next one go (up to 4 ticks, the bench
	// tuning was measured with one), so the spot leads the creeps by a share of the wait too
	const lookAhead =
		latency +
		GameState.TickInterval +
		Tuning.extraLatency +
		Tuning.lookAhead +
		Tuning.moveLead * Math.max(0, Tuning.moveIntervalTicks - 1) * GameState.TickInterval
	const leads: Lead[] = blockable.map(view => {
		const vel = view.Velocity,
			dir = frame.Direction(view.Lane.s)
		return {
			view,
			s: view.Lane.s + (vel.x * dir.x + vel.y * dir.y) * lookAhead,
			lat: view.Lane.lat + (vel.x * -dir.y + vel.y * dir.x) * lookAhead,
			weight: view.Creep.IsRangeAttacker ? Tuning.rangedWeight : 1
		}
	})
	let front = leads[0]
	for (const lead of leads) {
		if (lead.s > front.s) {
			front = lead
		}
	}
	const kept = leads.find(lead => lead.view.Creep === fronts.get(unit))
	if (Tuning.frontWeight > 0) {
		front = WeightiestFront(leads, front.s, kept)
	} else if (
		kept !== undefined &&
		// a front far to the side costs the crossing: worth it only for a creep clearly further on
		kept.s >=
			front.s -
				Tuning.frontHysteresis -
				Tuning.frontLateral * Math.abs(front.lat - kept.lat)
	) {
		front = kept
	}
	if (Tuning.frozenFront > 0) {
		// a creep the unit holds frozen (look-ahead or contact) walks on within 0.45 s, straight at the
		// unit's spot; its predicted position does not move meanwhile, so a creep walking round it
		// comes out as the front and the unit would leave for it: the frozen one stays the front
		let frozen: Nullable<Lead>
		for (const lead of leads) {
			const still = motion.StillFor(lead.view.Creep, now)
			if (
				still <= 0 ||
				still > SimLookWait + 0.1 ||
				lead.view.Lane.s < front.view.Lane.s - Tuning.groupDepth ||
				lead.view.Position.Distance2D(unit.Position) >
					lead.view.LookAhead + Tuning.frozenFront
			) {
				continue
			}
			if (frozen === undefined || lead.view.Lane.s > frozen.view.Lane.s) {
				frozen = lead
			}
		}
		if (frozen !== undefined) {
			front = frozen
		}
	}
	// `passageKeyHold`: in a tower passage a creep frozen in front of the unit stops being the front
	// (its predicted position stands while the others' run on) and comes back once it walks again,
	// a new target across the passage each time; the front from before is kept that long instead
	const since = frontSince.get(unit)
	if (
		Tuning.passageKeyHold > 0 &&
		kept !== undefined &&
		front !== kept &&
		since !== undefined &&
		now - since < Tuning.passageKeyHold &&
		PassageObstacle(frame, kept.s, unitLane.s, unitPad) !== undefined
	) {
		front = kept
		trace.Clamp |= TraceClamp.KeyHold
	}
	if (front !== kept || since === undefined) {
		frontSince.set(unit, now)
	}
	fronts.set(unit, front.view.Creep)
	const group = leads
		.filter(lead => lead.s >= front.s - Tuning.groupDepth)
		.sort((a, b) => a.lat - b.lat)
	const [low, high] = CoverWindow(group, front)
	let key = low
	for (const lead of group) {
		if (lead.lat >= low.lat && lead.lat <= high.lat && lead.s > key.s) {
			key = lead
		}
	}
	plan.Key = key.view
	trace.Front = front.view
	trace.Low = low.view
	trace.High = high.view

	const funnel = FunnelObstacle(frame, unitLane, unitPad, leads, front)
	if (funnel === undefined) {
		funnelSince.delete(unit)
	} else if (!funnelSince.has(unit)) {
		funnelSince.set(unit, now)
	}
	if (
		funnel !== undefined &&
		now - (funnelSince.get(unit) ?? now) >= Tuning.funnelConfirm
	) {
		const wait = frame.PointAt(
			funnel.S - (funnel.Radius + unitPad + Tuning.towerHug) / 2
		)
		PushOutOfObstacles(frame, wait, unitPad)
		plan.Mode = BlockMode.Funnel
		plan.Obstacle = funnel
		plan.Target = wait
		const arrived = wait.Distance2D(unit.Position) <= Tuning.holdTolerance
		plan.Action = arrived ? BlockAction.Hold : BlockAction.Move
		plan.Note = arrived
			? "Wave split: waiting where it closes up at the tower"
			: "Wave split: going to the tower where it closes up"
		return plan
	}

	const unitSpeed = unit.MoveSpeed,
		spread = LateralSpread(leads, front.s - Tuning.groupDepth)
	// the unit holds `gap` past the key creep's look-ahead reach: stepping on from there, it is still
	// inside the reach and the creep waits for it instead of bumping and walking round
	const threatShift = ThreatShift(leads, front, low, high, key, trace)
	let targetLat =
			Tuning.sideBias > 0
				? SideLat(unit, low, high, key)
				: WindowLat(low, high) + threatShift,
		targetS =
			LeadS(key, unitLane, unitSpeed, spread, trace) +
			key.view.LookAhead +
			Tuning.gap
	plan.Mode = BlockMode.Block

	const obstacle = PassageObstacle(frame, front.s, unitLane.s, unitPad)
	if (obstacle !== undefined) {
		targetS =
			LeadS(front, unitLane, unitSpeed, spread, trace) +
			front.view.LookAhead +
			Tuning.passageLead
		const reach = obstacle.Radius + unitPad + Tuning.towerHug,
			approach = (obstacle.S - reach - targetS) / Tuning.passageBefore
		targetLat *= Math.min(1, Math.max(0, approach))
		if (Tuning.passageCover > 0) {
			// the ramp to the route line must not take the unit off the key creep: it would walk by on
			// the side the unit leaves, still well short of the tower
			const cover = key.view.Contact * Tuning.coverWidth
			targetLat = Math.min(key.lat + cover, Math.max(key.lat - cover, targetLat))
		}
		// behind the tower's centre the hug would pull the unit to the tower's back while the creeps
		// come out of the passage on the open side: with `passageExit` it stops there
		const hug =
			Tuning.passageExit > 0 && targetS > obstacle.S
				? undefined
				: HugLat(obstacle, unitPad, targetS)
		if (hug !== undefined) {
			const open = Math.max(
					0,
					PassageFit(obstacle, active) - Tuning.gapMargin - reach
				),
				far = hug - obstacle.Side * open,
				free = targetLat
			targetLat =
				obstacle.Side < 0
					? Math.min(far, Math.max(hug, targetLat))
					: Math.max(far, Math.min(hug, targetLat))
			if (targetLat !== free) {
				trace.Clamp |= TraceClamp.TowerHug
			}
		}
		plan.Mode = BlockMode.Passage
		plan.Obstacle = obstacle
	}

	// `followPredict` 2: predictive in a tower passage only, where the column comes single file and a
	// freeze there splits it; on open ground the wave arrives single file too and the guard would
	// keep the unit walking from the meeting on
	// 3: also `predictAfter` past a squeezing tower the front creep has come through: the column leaves
	// the passage single file, and the freezes that split it come just past the tower. 4: only there;
	// inside the passage the tower closes one side, a creep going round a frozen one comes out on the
	// open side as a pair the unit still covers
	const predict =
		Tuning.followPredict === 1 ||
		((Tuning.followPredict === 2 || Tuning.followPredict === 3) &&
			plan.Mode === BlockMode.Passage) ||
		(Tuning.followPredict >= 3 && JustPastPassage(frame, front.s))
	const jammed =
		Tuning.followGuard > 0 &&
		(Tuning.followSplit > 0
			? SplitJam(blockable)
			: Tuning.followChain > 0
				? ColumnJammed(blockable, predict)
				: FollowerClosing(blockable, key.view, predict))
	// a wave split wider than one unit covers: walk on just out of the front creep's look-ahead
	// reach, holding nobody, until it closes up again (creeps head for their next corner and come
	// together); a frozen creep with the others walking round it is how a split gets past
	let walking = false
	if (Tuning.splitWalk > 0 && plan.Mode === BlockMode.Block) {
		const wide = LateralSpread(leads, front.s - Tuning.splitDepth),
			was = splitWalks.has(unit)
		walking = wide > (was ? Tuning.splitClose : Tuning.splitWalk)
		if (walking && Tuning.herdOffset > 0) {
			// herd instead: stand on the outer side of the most advanced creep, so that it goes round
			// the unit inwards (away from the unit's centre), towards the rest of the wave
			splitWalks.add(unit)
			let center = 0
			for (const lead of leads) {
				center += lead.lat / leads.length
			}
			targetLat = front.lat + (front.lat >= center ? 1 : -1) * Tuning.herdOffset
			walking = false
		} else if (walking) {
			splitWalks.add(unit)
			// a unit slower than the creeps is caught up at their speed difference: with `splitLeadTime`
			// it keeps that many seconds of it ahead, or the front creep freezes on it while the other
			// side of the split walks on and becomes the front
			const gain =
					Math.max(0, front.view.Creep.MoveSpeed - unitSpeed) *
					Tuning.splitLeadTime,
				clear =
					LeadS(front, unitLane, unitSpeed, spread, trace) +
					front.view.LookAhead +
					Tuning.splitClear +
					gain
			targetS = Math.max(targetS, clear)
			// in front of the most advanced creep: the creeps walk faster than most units and the
			// first to catch up is the one to stand in front of, not the middle of a split wave
			// `walkFirst` 3: the middle of the wave instead, so that a front flipping between the two
			// sides of a split costs no crossing; across to one side the unit loses its way forward,
			// is caught up and freezes the creep there while the other side walks on
			targetLat =
				Tuning.walkFirst > 2
					? WaveMiddle(leads)
					: Tuning.walkFirst > 1
						? FurthestNow(unit, leads).lat
						: Tuning.walkFirst > 0
							? FirstToArrive(unit, unitLane, leads, motion, now).lat
							: front.lat
		} else {
			splitWalks.delete(unit)
		}
	}
	// a creep about to run into the key creep: stand on the side it comes up on, a little off the key
	// creep's line, so that the key creep goes round the unit away from it and it walks into the
	// unit instead of round the key creep, and the wave stays two lanes wide
	let herding = false
	if (Tuning.jamHerd > 0 && plan.Mode === BlockMode.Block && !walking) {
		const side = FollowerSide(blockable, key.view, unitLane.lat)
		if (side !== 0) {
			targetLat = key.lat + side * Tuning.jamHerd
			herding = true
		}
	}
	// in a tower passage only with `followClearPassage` (1 also there, 2 only there): the lateral
	// target keeps the tower hug, the unit just keeps out of the front creep's reach
	const clearing =
		jammed &&
		Tuning.followClear > 0 &&
		(plan.Mode === BlockMode.Block
			? Tuning.followClearPassage < 2
			: Tuning.followClearPassage > 0)
	if (clearing) {
		// out of the front creep's look-ahead reach: it walks on instead of waiting, so the column
		// behind it does not run into it
		const clear =
			LeadS(front, unitLane, unitSpeed, spread, trace) +
			front.view.LookAhead +
			Tuning.followClear
		targetS = Math.max(targetS, clear)
	}

	if (Tuning.mpc > 0 && plan.Mode === BlockMode.Block && !walking) {
		const [ds, dl] = ForecastShift(
			unit,
			unitLane,
			frame,
			blockable,
			motion,
			now,
			latency,
			targetS,
			targetLat
		)
		targetS += ds
		targetLat += dl
	}
	// `raceAngle`: a key creep off the unit's line, faster than the unit and not past it is a lateral
	// race. Every unit across costs the unit (creep speed − unit speed × cos θ) / (unit speed × sin θ)
	// of its lead, least at cos θ = unit speed / creep speed (30° for 280 against 325); the lead along
	// the lane makes the way flatter than that (11–17° in the recorded losses) and the creep comes
	// level first, so the target comes no further along than that angle allows
	const raceSpeed = key.view.Creep.MoveSpeed,
		raceAhead = key.view.Lane.s - unitLane.s
	if (
		Tuning.raceAngle > 0 &&
		!walking &&
		unitSpeed < raceSpeed &&
		Math.abs(key.view.Lane.lat - unitLane.lat) > key.view.Contact &&
		raceAhead < key.view.Contact &&
		raceAhead > -Tuning.raceDepth
	) {
		const angle = Math.acos(unitSpeed / raceSpeed) * Tuning.raceAngle,
			maxS = unitLane.s + Math.abs(targetLat - unitLane.lat) / Math.tan(angle)
		if (targetS > maxS) {
			targetS = maxS
			trace.Clamp |= TraceClamp.RaceAngle
		}
	}
	const shift = Math.abs(targetLat - unitLane.lat),
		minS =
			unitLane.s + (shift > Tuning.holdTolerance ? shift * Tuning.forwardShare : 0)
	if (targetS < minS) {
		targetS = minS
		trace.Clamp |= TraceClamp.NoBackStep
	}
	const target = frame.PointAt(targetS, targetLat)
	if (PushOutOfObstacles(frame, target, unitPad)) {
		trace.Clamp |= TraceClamp.PushedOut
	}
	plan.Target = target

	// `advanceTiming`: keep blocking the pack while the creep going round the tower is still far from
	// coming back to the lane; walk on ahead only when the unit, leaving now, would get in front of
	// the point it comes back at no more than that many seconds before it
	const advanceNow =
		advance !== undefined &&
		(Tuning.advanceTiming <= 0 ||
			tracked === undefined ||
			!DetourAhead(
				frame,
				unitLane,
				unitSpeed,
				tracked,
				advance.obstacle,
				motion,
				now
			))
	if (advance !== undefined && !advanceNow) {
		plan.Note = "Creep goes round the tower, far from back yet: blocking the others"
	}
	if (advance !== undefined && advanceNow) {
		const ahead = frame.PointAt(
			Math.max(targetS, unitLane.s + Tuning.advanceStep),
			targetLat
		)
		PushOutOfObstacles(frame, ahead, unitPad)
		plan.Target = ahead
		plan.Mode = BlockMode.Advance
		plan.Action = BlockAction.Advance
		plan.Note = "Creep goes round the tower: walking on ahead of it"
		return plan
	}
	const passage = plan.Mode === BlockMode.Passage,
		holding = target.Distance2D(unit.Position) <= Tuning.holdTolerance,
		shadowed =
			holding &&
			passage &&
			obstacle !== undefined &&
			Tuning.shadowGuard > 0 &&
			InShadow(active, front.view, obstacle)
	if (shadowed) {
		const step = frame.PointAt(unitLane.s + Tuning.shadowStep, targetLat)
		PushOutOfObstacles(frame, step, unitPad)
		plan.Target = step
		plan.Action = BlockAction.Move
		plan.Note = "Tower passage: keeping the jam moving"
		trace.Clamp |= TraceClamp.ShadowGuard
		return plan
	}
	if (walking) {
		plan.Action = BlockAction.Move
		plan.Note = "Wave split wide: walking on until it closes up"
		return plan
	}
	// `shapeHold`: a creep walks in line close behind the key creep, which is still more than this
	// beyond its look-ahead reach: stand. Frozen, the key creep would be walked round on a side
	// nobody can foresee (lesson 27); a standing unit is walked round without a stop, and the one
	// behind mostly keeps its way, so the line turns into a pair before anything stops
	if (
		Tuning.shapeHold > 0 &&
		!walking &&
		// only in its way already: standing off its line is just losing the race across to it
		Math.abs(key.view.Lane.lat - unitLane.lat) < key.view.Contact &&
		Math.abs(targetLat - unitLane.lat) <= Tuning.holdTolerance * 2 &&
		key.view.Position.Distance2D(unit.Position) >
			key.view.LookAhead + Tuning.shapeHold &&
		FollowerClosing(blockable, key.view, true)
	) {
		plan.Action = BlockAction.Hold
		plan.Target = unit.Position.Clone()
		plan.Note = "A creep walks in line behind the key one: standing for it to turn"
		return plan
	}
	if (holding && jammed) {
		const step = frame.PointAt(
			Math.max(targetS, unitLane.s + Tuning.followStep),
			targetLat
		)
		PushOutOfObstacles(frame, step, unitPad)
		plan.Target = step
		plan.Action = BlockAction.Move
		plan.Note = "A creep is about to run into the front one: stepping on"
		return plan
	}
	if (clearing) {
		plan.Action = BlockAction.Move
		plan.Note = "The column is jamming: keeping out of the front creep's reach"
		return plan
	}
	const stepping =
		holding &&
		Tuning.laPulse > 0 &&
		blockable.some(
			view =>
				view.Lane.s < unitLane.s && NeedsStep(view, unit, motion, now, latency)
		)
	if (stepping) {
		const step = frame.PointAt(
			Math.max(targetS, unitLane.s + Tuning.laStep),
			targetLat
		)
		PushOutOfObstacles(frame, step, unitPad)
		plan.Target = step
		plan.Action = BlockAction.Move
		plan.Note = passage
			? "Tower passage: stepping on, the creep waits"
			: "Stepping on: the creep waits"
	} else if (holding) {
		plan.Action = BlockAction.Hold
		plan.Note = passage ? "Tower passage: gap closed, holding" : "Holding"
	} else {
		plan.Action = BlockAction.Move
		plan.Note = passage
			? "Tower passage: closing the gap"
			: herding
				? "A creep is about to run into the key one: standing on its side"
				: "Blocking"
	}
	return plan
}
