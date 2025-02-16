import {
	Creep,
	EntityManager,
	ExecuteOrder,
	GameSleeper,
	GameState,
	LocalPlayer,
	Menu,
	RendererSDK,
	Tower,
	Unit,
	Vector3,
	VKeys,
	VMouseKeys
} from "github.com/octarine-public/wrapper/index"

import { stateMain } from "../../base/MenuBase"
import {
	baseCheckUnit,
	Controllables,
	getCenterDirection,
	MoveUnit
} from "../Controllables"
import {
	CenterCamera,
	CountUnits,
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
import { BestPosition, DrawParticles, RemoveParticles } from "./ParticleHelp"

const sleeper = new GameSleeper()

const SwitchParticles = (caller: Menu.Toggle) =>
	caller.value ? DrawParticles() : RemoveParticles()
let turnStateBlock = false
const ControllablesUnitsDraw = new Map<Unit, string>()

DrawState.OnValue(SwitchParticles)
DrawHelpPosition.OnValue(SwitchParticles)
stateMain.OnValue(SwitchParticles)

CountUnits.OnValue(() => ControllablesUnitsDraw.clear())

Key.OnPressed(() => {
	turnStateBlock = !turnStateBlock

	if (!turnStateBlock) {
		ControllablesUnitsDraw.clear()
	}

	if (KeyStyle.SelectedID === 1) {
		GameState.ExecuteCommand(
			(turnStateBlock ? "+" : "-") + "dota_camera_center_on_hero"
		)
	}
})

Key.OnValue(caller => {
	const isPressed = caller.isPressed

	if (!CenterCamera.value || StateUnits.SelectedID !== 0 || KeyStyle.SelectedID !== 0) {
		return
	}

	GameState.ExecuteCommand((isPressed ? "+" : "-") + "dota_camera_center_on_hero")

	if (!isPressed) {
		ControllablesUnitsDraw.clear()
	}
})

export function GameEnded() {
	sleeper.FullReset()
	turnStateBlock = false
	ControllablesUnitsDraw.clear()
}

export function KeyDown(key: VKeys): boolean {
	if (Key.assignedKey === key && KeyStyle.SelectedID !== 1) {
		turnStateBlock = true
		return false
	}
	return true
}

export function MouseDown(key: VMouseKeys): boolean {
	if (Key.assignedKey === key && KeyStyle.SelectedID !== 1) {
		turnStateBlock = true
		return false
	}
	return true
}

export function KeyUp(key: VKeys) {
	if (Key.assignedKey !== key || KeyStyle.SelectedID === 1) {
		return
	}
	turnStateBlock = false
}

export function MouseUp(key: VMouseKeys) {
	if (Key.assignedKey === key || KeyStyle.SelectedID === 1) {
		return
	}
	turnStateBlock = false
}

let lastEnabled = false
export function Update() {
	const enabled = !(
		(KeyStyle.SelectedID === 1 && !turnStateBlock) ||
		(KeyStyle.SelectedID === 0 && !Key.isPressed)
	)
	if (!enabled && lastEnabled) {
		ExecuteOrder.HoldOrders--
		ExecuteOrder.HoldOrdersTarget = undefined
	} else if (enabled && !lastEnabled) {
		ExecuteOrder.HoldOrders++
	}

	lastEnabled = enabled

	if (!enabled || sleeper.Sleeping("tick")) {
		return
	}

	let countUnits = 0
	switch (StateUnits.SelectedID) {
		case 0: {
			// local
			const localHero = LocalPlayer?.Hero
			if (localHero === undefined || !baseCheckUnit(localHero)) {
				return
			}

			const command = ControllablesUnitsDraw.get(localHero)

			if (command === undefined) {
				ControllablesUnitsDraw.set(localHero, "Waiting Creeps")
			}

			const creeps = GetCreeps(localHero)

			if (creeps.length === 0) {
				if (GoToBestPosition.value && GoingToBestPosition(localHero)) {
					return
				}

				ControllablesUnitsDraw.set(localHero, "Waiting Creeps")
				return
			}

			Stopping(localHero, creeps)
			countUnits = 1
			break
		}
		case 1: {
			const controllables = Controllables()

			if (controllables.length === 0) {
				return
			}

			const localHero = LocalPlayer?.Hero

			if (localHero !== undefined && baseCheckUnit(localHero)) {
				controllables.remove(localHero)
			}

			countUnits += PreparingUnits(controllables) || 0
			break
		}
		// case 1: PreparingUnits(SelectedStopping()); break;
		case 2:
			countUnits += PreparingUnits(Controllables())
			break
		default:
			break
	}
	sleeper.Sleep(countUnits * 25, "tick")
}

export function Draw(): string | undefined {
	if (!stateMain.value || !DrawState.value) {
		return
	}

	if (
		(KeyStyle.SelectedID === 1 && !turnStateBlock) ||
		(KeyStyle.SelectedID === 0 && !Key.isPressed)
	) {
		return
	}

	if (StatusAroundUnits.value) {
		ControllablesUnitsDraw.forEach((text, unit) => {
			const wts = RendererSDK.WorldToScreen(unit.Position)

			if (wts !== undefined) {
				RendererSDK.Text(text, wts)
			}
		})
	}

	return StatusMouse.value ? "CreepBlock: ON" : undefined
}

function GetCreeps(unit?: Unit): Creep[] {
	return EntityManager.GetEntitiesByClass(Creep).filter(creep => {
		if (!creep.IsLaneCreep || creep.IsEnemy()) {
			return false
		}
		if (SkipRange.value && creep.IsRangeAttacker) {
			return false
		}

		if (unit !== undefined && !creep.IsInRange(unit, 500)) {
			return false
		}

		return !creep.IsControllable && !creep.IsWaitingToSpawn && creep.IsAlive
	})
}

function GetGroupsCreeps() {
	const groups: Creep[][] = []
	const creeps = GetCreeps()
	creeps.forEach(creep => {
		const group = creeps.filter(
			creepNear =>
				creep.IsInRange(creepNear, 500) &&
				!groups.some(group_ => group_.some(creep_ => creep_ === creep))
		)
		if (group.length > 0) {
			groups.push(group)
		}
	})
	return groups
}

function CheckTowerNear(unit: Unit): boolean {
	return EntityManager.GetEntitiesByClass(Tower).some(
		tower =>
			tower.IsAlive &&
			((tower.Name === "npc_dota_goodguys_tower1_mid" &&
				tower.IsInRange(unit, 100)) ||
				(tower.Name === "npc_dota_goodguys_tower2_mid" &&
					tower.IsInRange(unit, 150)))
	)
}

function GoingToBestPosition(unit: Unit): boolean {
	const closest = unit.Position.Closest(BestPosition[unit.Team - 2])
	if (unit.IsInRange(closest, 50)) {
		return false
	}
	MoveUnit(unit, closest, sleeper)
	ControllablesUnitsDraw.set(unit, "Moving to the best position")
	return true
}

export function PrepareUnitOrders(): boolean {
	return (
		(KeyStyle.SelectedID === 1 && !turnStateBlock) ||
		(KeyStyle.SelectedID === 0 && !Key.isPressed)
	)
}

function PreparingUnits(controllables: Unit[]) {
	if (controllables.length === 0) {
		return 0
	}

	controllables.splice(CountUnits.value)

	const groups = GetGroupsCreeps()

	controllables.forEach(unit => {
		const command = ControllablesUnitsDraw.get(unit)

		if (command === undefined) {
			ControllablesUnitsDraw.set(unit, "Waiting Creeps")
		}

		if (GoToBestPosition.value) {
			const [group, moveDirection] = unit.ClosestGroup(groups, group_ =>
				getCenterDirection(group_)
			)

			if (!unit.IsInRange(moveDirection, 500)) {
				if (!GoingToBestPosition(unit)) {
					ControllablesUnitsDraw.set(unit, "Waiting Creeps")
				}
				return
			}

			Stopping(unit, group as Creep[], moveDirection)
		} else {
			groups.forEach(group => {
				const moveDirection = getCenterDirection(group)

				if (!unit.IsInRange(moveDirection, 500)) {
					return
				}

				Stopping(unit, group, moveDirection)
			})
		}
	})

	return controllables.length
}

function Stopping(
	unit: Unit,
	creeps: Creep[],
	moveDirection = getCenterDirection(creeps)
) {
	if (CheckTowerNear(unit)) {
		ControllablesUnitsDraw.set(unit, "Less stopping (Tower near)")
		MoveUnit(unit, moveDirection, sleeper)
		return
	}
	ControllablesUnitsDraw.set(unit, "Stopping ")
	creeps = creeps.orderBy(creep => creep.Distance2D(moveDirection))
	const stopping = creeps.some(creep => {
		if (!creep.IsMoving && !creep.IsInRange(unit, 50)) {
			return false
		}

		const creepDistance = creep.Distance2D(moveDirection) + 50,
			unitDistance = unit.Distance2D(moveDirection),
			creepAngle = creep.Position.FindRotationAngle(
				unit.Position,
				creep.RotationRad + Math.degreesToRadian(creep.RotationDifference)
			)

		if ((creepDistance < unitDistance && creepAngle > 2) || creepAngle > 2.5) {
			return false
		}
		const npcSpeed = unit.MoveSpeed,
			creepSpeed = creep.MoveSpeed
		let moveDistance = (((Sensitivity.value + 45) * 10) / npcSpeed) * 100

		if (npcSpeed - creepSpeed > 50) {
			moveDistance -= (npcSpeed - creepSpeed) / 2
		}

		const movePosition = creep.Position.Rotation(
			Vector3.FromAngle(
				creep.RotationRad + Math.degreesToRadian(creep.RotationDifference)
			),
			moveDistance * Math.max(1, creepAngle)
		)
		if (movePosition.Distance2D(moveDirection) - 50 > unitDistance) {
			return false
		}

		if (creepAngle < 0.2 && unit.IsMoving) {
			return false
		}

		MoveUnit(unit, movePosition, sleeper)
		return true
	})

	if (stopping) {
		return
	}

	if (unit.IsMoving) {
		unit.OrderStop()
	} else if (
		unit.Position.FindRotationAngle(
			moveDirection,
			unit.RotationRad + Math.degreesToRadian(unit.RotationDifference)
		) > 1.5
	) {
		MoveUnit(unit, unit.Position.Extend(moveDirection, 10), sleeper)
	}
}
