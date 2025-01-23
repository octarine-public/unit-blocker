import {
	DOTAUnitMoveCapability,
	Entity,
	EntityManager,
	ExecuteOrder,
	Menu as MenuSDK,
	Unit,
	Vector3
} from "github.com/octarine-public/wrapper/index"

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

export function MoveUnit(unit: Unit, pos: Vector3): void {
	unit.MoveTo(pos, false, true)
	ExecuteOrder.HoldOrdersTarget = pos
}

export const StopUnit = (unit: Unit) => {
	unit.OrderStop()
}

export function MenuControllables(root: MenuSDK.Node) {
	const ControllablesTree = root.AddNode("Additional settings")

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

	const CenterCamera = ControllablesTree.AddToggle(
		"Center Camera",
		false,
		"Centering camera on your hero"
	)
	const CountUnits = ControllablesTree.AddSlider(
		"Number of unit",
		3,
		1,
		10,
		0,
		"Number of units to use"
	)

	return {
		ControllablesTree,
		StateUnits,
		CenterCamera,
		CountUnits
	}
}
