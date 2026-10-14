import { stateMain } from "../../base/MenuBase"
import { canvas } from "../../render"
import { baseCheckUnit, Controllables, MoveUnit } from "../Controllables"
import { GetLaneFrame, ResetLaneFrames } from "./Lane"
import {
	CenterCamera,
	CountUnits,
	DrawEvaluation,
	DrawHelpPosition,
	DrawState,
	GoToBestPosition,
	Key,
	KeyStyle,
	Sensitivity,
	SkipRange,
	StateUnits,
	StatusAroundUnits,
	StatusMouse
} from "./Menu"
import { MotionTracker } from "./Motion"
import { BlockAction, BlockPlan, CreepRole, PlanBlock, ResetPlanner, Tuning } from "./Planner"
import { BestPosition, DrawParticles, RemoveParticles } from "./ParticleHelp"
import { DrawPlan } from "./Visual"

const SEARCH_RANGE = 1200
const FREE_SPEED_SHARE = 0.85

const sleeper = new GameSleeper()
const motion = new MotionTracker()
const plans = new Map<Unit, BlockPlan>()
const statuses = new Map<Unit, string>()
const waveStart = new Map<Creep, number>()
const delays = new Map<Unit, number>()
const lastOrders = new Map<Unit, LastOrder>()

interface LastOrder {
	readonly action: BlockAction
	readonly target: Nullable<Vector3>
	readonly time: number
}

export const DebugPlans = plans

const SwitchParticles = (caller: Menu.Toggle) =>
	caller.value ? DrawParticles() : RemoveParticles()
let turnStateBlock = false
let lastEnabled = false

DrawState.OnValue(SwitchParticles)
DrawHelpPosition.OnValue(SwitchParticles)
stateMain.OnValue(SwitchParticles)

CountUnits.OnValue(() => statuses.clear())

Sensitivity.OnValue(caller => {
	Tuning.lookAhead = 0.07 + caller.value * 0.005
	Tuning.gap = caller.value * 0.375
	Tuning.pressSpread = Math.min(200, Math.max(0, (16 - caller.value) * 20))
})

Key.OnPressed(() => {
	if (KeyStyle.SelectedID !== 1) {
		return
	}
	turnStateBlock = !turnStateBlock
	if (CenterCamera.value && StateUnits.SelectedID === 0) {
		GameState.ExecuteCommand((turnStateBlock ? "+" : "-") + "dota_camera_center_on_hero")
	}
})

Key.OnValue(caller => {
	if (!CenterCamera.value || StateUnits.SelectedID !== 0 || KeyStyle.SelectedID !== 0) {
		return
	}
	GameState.ExecuteCommand((caller.isPressed ? "+" : "-") + "dota_camera_center_on_hero")
})

KeyStyle.OnValue(() => (turnStateBlock = false))

function ResetState() {
	statuses.clear()
	plans.clear()
	delays.clear()
	lastOrders.clear()
	ResetPlanner()
}

export function GameEnded() {
	sleeper.FullReset()
	turnStateBlock = false
	lastEnabled = false
	ResetState()
	motion.Clear()
	waveStart.clear()
	ResetLaneFrames()
}

function IsActive(): boolean {
	return !(
		(KeyStyle.SelectedID === 1 && !turnStateBlock) ||
		(KeyStyle.SelectedID === 0 && !Key.isPressed)
	)
}

function LaneCreeps(): Creep[] {
	return EntityManager.GetEntitiesByClass(Creep).filter(
		creep =>
			creep.IsLaneCreep &&
			creep.IsAlive &&
			!creep.IsControllable &&
			!creep.IsWaitingToSpawn &&
			creep.Lane !== MapArea.Unknown
	)
}

function UpdateWaveStart(plan: BlockPlan, now: number): void {
	for (const view of plan.Creeps) {
		const speed = view.Creep.BaseMoveSpeed,
			dir = plan.Frame.Direction(view.Lane.s),
			forward = view.Velocity.x * dir.x + view.Velocity.y * dir.y
		if (speed <= 0 || forward < speed * FREE_SPEED_SHARE) {
			continue
		}
		const estimate = now - view.Lane.s / speed,
			known = waveStart.get(view.Creep)
		if (known === undefined || estimate < known) {
			waveStart.set(view.Creep, estimate)
		}
	}
	let lag: Nullable<number>
	for (const view of plan.Creeps) {
		if (view.Role === CreepRole.Ignored) {
			continue
		}
		const start = waveStart.get(view.Creep),
			speed = view.Creep.BaseMoveSpeed
		if (start === undefined || speed <= 0) {
			continue
		}
		const creepLag = now - start - view.Lane.s / speed
		lag = lag === undefined ? creepLag : Math.min(lag, creepLag)
	}
	if (lag !== undefined) {
		delays.set(plan.Unit, lag)
	}
}

function NeedsOrder(plan: BlockPlan, now: number): boolean {
	const unit = plan.Unit,
		last = lastOrders.get(unit),
		target = plan.Target
	if (last === undefined || last.action !== plan.Action) {
		return plan.Action !== BlockAction.Hold || unit.IsMoving
	}
	if (plan.Action === BlockAction.Hold) {
		return unit.IsMoving && now - last.time > Tuning.orderRefresh
	}
	if (target === undefined || last.target === undefined) {
		return true
	}
	const shift = target.Distance2D(last.target),
		remaining = unit.Position.Distance2D(target)
	return (
		shift > Math.max(Tuning.orderMinShift, remaining * Tuning.orderShiftShare) ||
		(!unit.IsMoving && remaining > Tuning.orderMinShift) ||
		now - last.time > Tuning.orderRefresh
	)
}

function Execute(plan: BlockPlan, now: number): void {
	const unit = plan.Unit
	if (plan.Action === BlockAction.Wait || !NeedsOrder(plan, now)) {
		return
	}
	if (plan.Action === BlockAction.Hold) {
		unit.OrderStop()
	} else if (plan.Target !== undefined) {
		MoveUnit(unit, plan.Target, sleeper)
	}
	lastOrders.set(unit, { action: plan.Action, target: plan.Target?.Clone(), time: now })
}

function GoingToBestPosition(unit: Unit): boolean {
	const positions = BestPosition[unit.Team - 2]
	if (positions === undefined) {
		return false
	}
	const closest = unit.Position.Closest(positions)
	if (unit.IsInRange(closest, 50)) {
		return false
	}
	MoveUnit(unit, closest, sleeper)
	statuses.set(unit, "Moving to the best position")
	return true
}

function BlockWith(unit: Unit, pool: Creep[], now: number): boolean {
	const creeps = pool.filter(
		creep => creep.Team === unit.Team && creep.IsInRange(unit, SEARCH_RANGE)
	)
	if (creeps.length === 0) {
		plans.delete(unit)
		if (!GoToBestPosition.value || !GoingToBestPosition(unit)) {
			statuses.set(unit, "Waiting creeps")
		}
		return false
	}
	const lanes = new Map<MapArea, number>()
	for (const creep of creeps) {
		lanes.set(creep.Lane, (lanes.get(creep.Lane) ?? 0) + 1)
	}
	let lane = creeps[0].Lane
	for (const [area, count] of lanes) {
		if (count > (lanes.get(lane) ?? 0)) {
			lane = area
		}
	}
	const frame = GetLaneFrame(unit.Team, lane)
	if (frame === undefined) {
		return false
	}
	frame.Refresh(EntityManager.GetEntitiesByClass(Tower), Tuning.cornerCut)
	const plan = PlanBlock(
		unit,
		creeps.filter(creep => creep.Lane === lane),
		frame,
		motion,
		SkipRange.value,
		now
	)
	plans.set(unit, plan)
	statuses.set(unit, plan.Note)
	UpdateWaveStart(plan, now)
	Execute(plan, now)
	return true
}

export function Update() {
	const enabled = IsActive()
	if (!enabled && lastEnabled) {
		ExecuteOrder.HoldOrders--
		ExecuteOrder.HoldOrdersTarget = undefined
		ResetState()
	} else if (enabled && !lastEnabled) {
		ExecuteOrder.HoldOrders++
	}
	lastEnabled = enabled

	const now = GameState.RawGameTime
	const pool = LaneCreeps()
	motion.Update(pool, now)

	if (!enabled) {
		return
	}

	const localHero = Dota2SDK.LocalPlayer?.Hero
	let units: Unit[] = []
	switch (StateUnits.SelectedID) {
		case 0:
			if (localHero !== undefined && baseCheckUnit(localHero)) {
				units = [localHero]
			}
			break
		case 1:
			units = Controllables().filter(unit => unit !== localHero)
			break
		case 2:
			units = Controllables()
			break
		default:
			break
	}
	units.splice(CountUnits.value)
	for (const unit of units) {
		BlockWith(unit, pool, now)
	}
}

export function Draw(): string | undefined {
	if (!stateMain.value || !DrawState.value || !IsActive()) {
		return
	}
	if (DrawEvaluation.value) {
		plans.forEach((plan, unit) => {
			if (unit.IsValid && unit.IsAlive) {
				DrawPlan(plan, delays.get(unit))
			}
		})
	}
	if (StatusAroundUnits.value) {
		statuses.forEach((text, unit) => {
			if (DrawEvaluation.value && plans.has(unit)) {
				return
			}
			const wts = RendererSDK.WorldToScreen(unit.Position)
			if (wts !== undefined) {
				canvas.Text(text, wts, { size: 18 + 4 })
			}
		})
	}
	return StatusMouse.value ? "CreepBlock: ON" : undefined
}

export function PrepareUnitOrders(): boolean {
	return !IsActive()
}
