import { LaneFrame, LaneObstacle, LanePoint } from "./Lane"
import { MotionTracker } from "./Motion"

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
	readonly Contact: number
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
	ShadowGuard = 8
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
	cornerCut: 320,
	gap: 6,
	holdTolerance: 16,
	lookAhead: 0.15,
	movingSpeed: 80,
	groupDepth: 140,
	frontHysteresis: 20,
	coverWidth: 1,
	threatBias: 0.5,
	threatDepth: 300,
	windowRoom: 0.5,
	rangedWeight: 0.6,
	forwardShare: 0,
	alignedShare: 0.3,
	alignedRange: 0.5,
	leadSpeedGap: 45,
	pressSpread: 0,
	pressRange: 60,
	passedLateral: 0.7,
	passageBefore: 300,
	passageGap: 80,
	passageLead: 40,
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
	turnBackReach: 0,
	extraLatency: 0.03,
	orderMinShift: 30,
	orderShiftShare: 0.35,
	orderRefresh: 1
}

const MIN_PASSED = 25

interface Lead {
	readonly view: CreepView
	readonly s: number
	readonly lat: number
	readonly weight: number
}

const detourSince = new Map<Creep, number>()
const fronts = new Map<Unit, Creep>()
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

function UpdateDetours(views: CreepView[], frame: LaneFrame, unit: Unit, unitLane: LanePoint, now: number): void {
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

/** The widest run of creeps, by lane offset, one unit can stand in front of; it always holds `front`. */
function CoverWindow(group: Lead[], front: Lead): [Lead, Lead] {
	const pivot = group.indexOf(front)
	let bestFrom = pivot,
		bestTo = pivot,
		bestWeight = -1
	for (let from = 0; from <= pivot; from++) {
		let weight = 0
		for (let to = from; to < group.length; to++) {
			const width =
				Math.min(group[from].view.Contact, group[to].view.Contact) * Tuning.coverWidth
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
			((lead.view.Creep.MoveSpeed - unitSpeed) / Tuning.leadSpeedGap) * PressShare(spread),
		share = Math.min(1, Math.max(0, sideShare, speedShare))
	trace.SideShare = sideShare
	trace.SpeedShare = speedShare
	trace.Share = share
	return lead.view.Lane.s + (lead.s - lead.view.Lane.s) * share
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
	const room = Math.max(0, key.view.Contact * Tuning.windowRoom - (high.lat - low.lat) / 2)
	trace.Threat = threat.view
	trace.Shift = Math.sign(threat.lat - (low.lat + high.lat) / 2) * room * Tuning.threatBias
	return trace.Shift
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
			Math.abs(view.Lane.lat - obstacle.Lat) < obstacle.Radius + view.Creep.PaddedCollisionRadius
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
	if (Offset(frame, obstacle.S, obstacle.Position, view.Position).s <= obstacle.Radius) {
		return false
	}
	const off = Offset(frame, unitLane.s, unit.Position, view.Position)
	return Math.abs(off.lat) < Tuning.advanceMerge || off.s > -view.Contact * 2
}

export function ResetPlanner(): void {
	detourSince.clear()
	fronts.clear()
	advances.clear()
	funnelSince.clear()
}

export function PlanBlock(
	unit: Unit,
	creeps: Creep[],
	frame: LaneFrame,
	motion: MotionTracker,
	skipRanged: boolean,
	now: number
): BlockPlan {
	const unitLane = frame.Project(unit.Position),
		unitPad = unit.PaddedCollisionRadius,
		latency =
			GameState.InputLag +
			GameState.TickInterval +
			ExecuteOrder.EstimateDispatchDelay() +
			Tuning.extraLatency

	const views: CreepView[] = []
	for (const creep of creeps) {
		const pos = creep.Position,
			vel = motion.Velocity(creep),
			lane = frame.Project(pos),
			contact = unitPad + creep.PaddedCollisionRadius,
			ahead = lane.s - unitLane.s
		const view: CreepView = {
			Creep: creep,
			Position: pos,
			Velocity: vel,
			Predicted: new Vector3(pos.x + vel.x * latency, pos.y + vel.y * latency, pos.z),
			Lane: lane,
			Contact: contact,
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
		} else if (pos.Distance2D(unit.Position) < contact + 24) {
			view.Role = CreepRole.Pressing
		} else if (Math.abs(lane.lat - unitLane.lat) > contact && ahead > -contact * 2) {
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
		const tracked = views.find(view => view.Creep === advance?.creep)
		if (
			tracked === undefined ||
			tracked.Role === CreepRole.Passed ||
			now - advance.since > Tuning.advanceTimeout ||
			TurnedBack(frame, tracked, advance.obstacle) ||
			Rejoined(frame, tracked, unit, unitLane, advance.obstacle)
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
	const tracked = advance === undefined ? undefined : views.find(view => view.Creep === advance?.creep)
	if (advance !== undefined && tracked !== undefined) {
		trace.DetourGap = Math.abs(Offset(frame, unitLane.s, unit.Position, tracked.Position).lat)
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

	const lookAhead = latency + Tuning.lookAhead
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
	if (kept !== undefined && kept.s >= front.s - Tuning.frontHysteresis) {
		front = kept
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
	if (funnel !== undefined && now - (funnelSince.get(unit) ?? now) >= Tuning.funnelConfirm) {
		const wait = frame.PointAt(funnel.S - (funnel.Radius + unitPad + Tuning.towerHug) / 2)
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
	let targetLat = (low.lat + high.lat) / 2 + ThreatShift(leads, front, low, high, key, trace),
		targetS = LeadS(key, unitLane, unitSpeed, spread, trace) + key.view.Contact + Tuning.gap
	plan.Mode = BlockMode.Block

	const obstacle = PassageObstacle(frame, front.s, unitLane.s, unitPad)
	if (obstacle !== undefined) {
		targetS =
			LeadS(front, unitLane, unitSpeed, spread, trace) + front.view.Contact + Tuning.passageLead
		const reach = obstacle.Radius + unitPad + Tuning.towerHug,
			approach = (obstacle.S - reach - targetS) / Tuning.passageBefore
		targetLat *= Math.min(1, Math.max(0, approach))
		const hug = HugLat(obstacle, unitPad, targetS)
		if (hug !== undefined) {
			const smallest = Math.min(...active.map(view => view.Creep.PaddedCollisionRadius)),
				open = Math.max(0, smallest * 2 - Tuning.towerHug - Tuning.gapMargin),
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

	const shift = Math.abs(targetLat - unitLane.lat),
		minS = unitLane.s + (shift > Tuning.holdTolerance ? shift * Tuning.forwardShare : 0)
	if (targetS < minS) {
		targetS = minS
		trace.Clamp |= TraceClamp.NoBackStep
	}
	const target = frame.PointAt(targetS, targetLat)
	if (PushOutOfObstacles(frame, target, unitPad)) {
		trace.Clamp |= TraceClamp.PushedOut
	}
	plan.Target = target

	if (advance !== undefined) {
		const ahead = frame.PointAt(Math.max(targetS, unitLane.s + Tuning.advanceStep), targetLat)
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
	if (holding) {
		plan.Action = BlockAction.Hold
		plan.Note = passage ? "Tower passage: gap closed, holding" : "Holding"
	} else {
		plan.Action = BlockAction.Move
		plan.Note = passage ? "Tower passage: closing the gap" : "Blocking"
	}
	return plan
}
