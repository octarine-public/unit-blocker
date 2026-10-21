import { MenuIcons } from "../base/MenuIcons"

export const baseCheckUnit = (ent: Unit) =>
	ent.IsAlive &&
	!ent.HasNoCollision &&
	ent.HasMoveCapability(DOTAUnitMoveCapability.DOTA_UNIT_CAP_MOVE_GROUND)

export const checkControllable = (ent: Unit) => baseCheckUnit(ent) && ent.IsControllable

export const Controllables = () =>
	EntityManager.GetEntitiesByClass(Unit).filter(
		unit => baseCheckUnit(unit) && checkControllable(unit)
	)

export const getCenterDirection = (units: Entity[]) =>
	Vector3.GetCenterType(units, unit =>
		unit.Position.Rotation(
			Vector3.FromAngle(
				unit.RotationRad + Math.degreesToRadian(unit.RotationDifference)
			),
			350
		)
	)

/**
 * Ticks between two moves: the game's own repeat with the right mouse button held, measured at
 * 133 ms (4 ticks) on every one of 87 repeats; no player clicks faster than that. Stops are not
 * moves and go out at once (`StopUnit`).
 */
export const MOVE_INTERVAL_TICKS = 4

/** Orders the move unless the unit's last move is younger than `ticks`; whether it went. */
export function MoveUnit(
	unit: Unit,
	pos: Vector3,
	sleeper: GameSleeper,
	ticks = MOVE_INTERVAL_TICKS
): boolean {
	ExecuteOrder.HoldOrdersTarget = pos
	const key = unit.Index + "_moveSleep"
	if (sleeper.Sleeping(key)) {
		return false
	}
	unit.MoveTo(pos, false, true)
	sleeper.Sleep(ticks * GameState.TickInterval * 1000, key)
	return true
}

export const StopUnit = (unit: Unit) => {
	unit.OrderStop()
}

export function MenuControllables(root: Menu.Node) {
	const ControllablesTree = root.AddNode("Additional settings", MenuIcons.Additional)

	const StateUnits = ControllablesTree.AddDropdown(
		"Units",
		[
			"Local Hero",
			// "Selected Unit(s)",
			"Only controllables",
			"All Controllables"
		],
		0,
		"More than two units(or heroes) for\none line of creeps is not recommended"
	)
	StateUnits.IconPath = MenuIcons.Units

	const CenterCamera = ControllablesTree.AddToggle(
		"Center Camera",
		false,
		"Centering camera on your hero"
	)
	CenterCamera.IconPath = MenuIcons.CenterCamera
	const CountUnits = ControllablesTree.AddSlider(
		"Number of unit",
		3,
		1,
		10,
		0,
		"Number of units to use"
	)
	CountUnits.IconPath = MenuIcons.CountUnits

	return {
		ControllablesTree,
		StateUnits,
		CenterCamera,
		CountUnits
	}
}
