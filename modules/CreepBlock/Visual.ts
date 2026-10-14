import { canvas } from "../../render"
import { LaneObstacle } from "./Lane"
import {
	BlockAction,
	BlockMode,
	BlockPlan,
	CreepRole,
	CreepView,
	PlanTrace,
	TraceClamp
} from "./Planner"

const ROLE_COLORS: Record<CreepRole, Color> = {
	[CreepRole.Approaching]: new Color(255, 255, 255, 170),
	[CreepRole.Pressing]: new Color(60, 220, 90),
	[CreepRole.Flanking]: new Color(255, 200, 40),
	[CreepRole.Detouring]: new Color(255, 50, 50),
	[CreepRole.Passed]: new Color(200, 60, 200),
	[CreepRole.Ignored]: new Color(130, 130, 130, 120)
}

const ROLE_NAMES: Record<CreepRole, string> = {
	[CreepRole.Approaching]: "approach",
	[CreepRole.Pressing]: "pressed",
	[CreepRole.Flanking]: "flank",
	[CreepRole.Detouring]: "TOWER DETOUR",
	[CreepRole.Passed]: "passed",
	[CreepRole.Ignored]: "ignored"
}

const ACTION_COLORS: Record<BlockAction, Color> = {
	[BlockAction.Wait]: new Color(160, 160, 160),
	[BlockAction.Hold]: new Color(60, 220, 90),
	[BlockAction.Move]: new Color(60, 200, 255),
	[BlockAction.Advance]: new Color(255, 70, 70)
}

const LANE_COLOR = new Color(255, 255, 255, 60)
const WINDOW_COLOR = new Color(60, 200, 255, 150)
const THREAT_COLOR = new Color(255, 120, 40, 200)
const TOWER_IDLE = new Color(150, 150, 150, 90)
const TOWER_ACTIVE = new Color(255, 170, 40, 200)
const TOWER_DANGER = new Color(255, 50, 50, 230)
const CIRCLE_STEPS = 24

function Circle(center: Vector3, radius: number): Vector3[] {
	const points: Vector3[] = []
	for (let i = 0; i < CIRCLE_STEPS; i++) {
		const angle = (i / CIRCLE_STEPS) * Math.PI * 2
		points.push(
			new Vector3(
				center.x + Math.cos(angle) * radius,
				center.y + Math.sin(angle) * radius,
				center.z
			)
		)
	}
	return points
}

function WorldLine(a: Vector3, b: Vector3, color: Color, width = 2): void {
	const sa = RendererSDK.WorldToScreen(a),
		sb = RendererSDK.WorldToScreen(b)
	if (sa !== undefined && sb !== undefined) {
		canvas.Line(sa, sb, color, width)
	}
}

function WorldArrow(a: Vector3, b: Vector3, color: Color, width = 2): void {
	const sa = RendererSDK.WorldToScreen(a),
		sb = RendererSDK.WorldToScreen(b)
	if (sa !== undefined && sb !== undefined) {
		canvas.LineArrow(sa, sb, color, width, 10)
	}
}

function WorldText(text: string, pos: Vector3, color: Color, size = 16): void {
	const screen = RendererSDK.WorldToScreen(pos)
	if (screen !== undefined) {
		canvas.Text(text, screen, { color, size, outline: true })
	}
}

function DrawLane(plan: BlockPlan): void {
	const frame = plan.Frame,
		from = Math.max(0, plan.UnitLane.s - 700),
		to = Math.min(frame.Length, plan.UnitLane.s + 1100)
	let prev = frame.PointAt(from)
	for (let s = from + 100; s <= to; s += 100) {
		const next = frame.PointAt(s)
		WorldLine(prev, next, LANE_COLOR, 2)
		prev = next
	}
}

function DrawObstacle(plan: BlockPlan, obstacle: LaneObstacle): void {
	if (Math.abs(obstacle.S - plan.UnitLane.s) > 1600) {
		return
	}
	const detour =
		plan.Creeps.some(view => view.Detour === obstacle) ||
		(plan.Mode === BlockMode.Advance && plan.Obstacle === obstacle)
	const color = detour
		? TOWER_DANGER
		: plan.Obstacle === obstacle
			? TOWER_ACTIVE
			: TOWER_IDLE
	const center = obstacle.Position,
		label = new Vector3(center.x, center.y + obstacle.Radius + 40, center.z)
	canvas.WorldPolygon(Circle(center, obstacle.Radius), color, detour ? 4 : 2)
	if (plan.Obstacle === obstacle && plan.Mode === BlockMode.Passage) {
		WorldText("passage: gap closed", label, color, 14)
	}
	if (plan.Obstacle === obstacle && plan.Mode === BlockMode.Funnel) {
		WorldText("wave split: it closes up here", label, color, 14)
	}
	if (detour) {
		WorldText(
			plan.Mode === BlockMode.Advance
				? "CREEP GOING ROUND TOWER: walking on ahead"
				: "CREEP GOING ROUND TOWER",
			label,
			color,
			16
		)
	}
}

function DrawCreep(plan: BlockPlan, view: CreepView): void {
	const color = ROLE_COLORS[view.Role],
		pos = view.Position,
		isKey = plan.Key === view
	canvas.WorldPolygon(
		Circle(pos, view.Creep.PaddedCollisionRadius),
		color,
		isKey ? 4 : 2
	)
	const vel = view.Velocity
	if (Math.hypot(vel.x, vel.y) > 30) {
		WorldArrow(
			pos,
			new Vector3(pos.x + vel.x * 0.35, pos.y + vel.y * 0.35, pos.z),
			color,
			2
		)
	}
	if (isKey || view.Role === CreepRole.Detouring) {
		WorldText(
			(isKey ? "KEY " : "") + ROLE_NAMES[view.Role],
			new Vector3(pos.x, pos.y - 60, pos.z),
			color,
			14
		)
	}
}

/** The run of creeps the unit stands in front of, from its leftmost to its rightmost creep. */
function DrawWindow(plan: BlockPlan): void {
	const { Low: low, High: high } = plan.Trace
	if (low === undefined || high === undefined || low === high) {
		return
	}
	WorldLine(low.Position, high.Position, WINDOW_COLOR, 3)
}

/** The creep outside the window the unit leans towards. */
function DrawThreat(plan: BlockPlan): void {
	const threat = plan.Trace.Threat
	if (threat === undefined || plan.Trace.Shift === 0) {
		return
	}
	WorldLine(plan.Unit.Position, threat.Position, THREAT_COLOR, 1)
	WorldText("THREAT", new Vector3(threat.Position.x, threat.Position.y - 60, threat.Position.z), THREAT_COLOR, 13)
}

function LeadText(trace: PlanTrace): string {
	const source = trace.Share > 0 && trace.Share === trace.SpeedShare ? "speed" : "side"
	let text = `Lead ${Math.round(trace.Share * 100)}%${trace.Share > 0 ? ` (${source})` : ""}`
	if (trace.Clamp & TraceClamp.NoBackStep) {
		text += ", no back-step"
	}
	return text
}

function DrawTarget(plan: BlockPlan): void {
	const target = plan.Target
	if (target === undefined) {
		return
	}
	const color = ACTION_COLORS[plan.Action],
		unitPos = plan.Unit.Position
	WorldLine(unitPos, target, color, 2)
	canvas.WorldPolygon(Circle(target, 12), color, 3)
	if (plan.Key !== undefined) {
		WorldLine(plan.Key.Position, plan.Key.Predicted, color, 1)
	}
}

export function DrawPlan(plan: BlockPlan, delay: Nullable<number>): void {
	DrawLane(plan)
	for (const obstacle of plan.Frame.Obstacles) {
		DrawObstacle(plan, obstacle)
	}
	for (const view of plan.Creeps) {
		DrawCreep(plan, view)
	}
	DrawWindow(plan)
	DrawThreat(plan)
	DrawTarget(plan)
	const unitPos = plan.Unit.Position,
		color = ACTION_COLORS[plan.Action]
	canvas.WorldPolygon(Circle(unitPos, plan.Unit.PaddedCollisionRadius), color, 2)
	const lines = [plan.Note]
	if (plan.Mode === BlockMode.Block || plan.Mode === BlockMode.Passage) {
		lines.push(LeadText(plan.Trace))
	}
	if (delay !== undefined) {
		lines.push(`Block ${delay >= 0 ? "+" : ""}${delay.toFixed(1)}s`)
	}
	const passed = plan.Creeps.filter(view => view.Role === CreepRole.Passed).length
	if (passed !== 0) {
		lines.push(`Passed: ${passed}`)
	}
	WorldText(
		lines.join("\n"),
		new Vector3(unitPos.x + 70, unitPos.y - 70, unitPos.z),
		color,
		18
	)
}
