import { DOTAUnitMoveCapability_t, Entity, EntityManager, ExecuteOrder, Menu as MenuSDK, Unit, Vector3 } from "github.com/octarine-public/wrapper/index"

export let baseCheckUnit = (ent: Unit) =>
	ent.IsAlive
	&& !ent.HasNoCollision
	&& ent.HasMoveCapability(DOTAUnitMoveCapability_t.DOTA_UNIT_CAP_MOVE_GROUND)

export let checkControllable = (ent: Unit) =>
	baseCheckUnit(ent) && ent.IsControllable

export let Controllables = () => EntityManager.GetEntitiesByClass(Unit).filter(unit => baseCheckUnit(unit) && checkControllable(unit))

export let getCenterDirection = (units: Entity[]) =>
	Vector3.GetCenterType(units, unit => unit.InFront(350))

export function MoveUnit(unit: Unit, pos: Vector3): void {
	unit.MoveTo(pos)
	ExecuteOrder.hold_orders_target = pos
}

export let StopUnit = (unit: Unit) => {
	unit.OrderStop()
}

export default function Menu(root: MenuSDK.Node) {

	const ControllablesTree = root.AddNode("Additional settings")

	const StateUnits = ControllablesTree.AddDropdown("Units", [
		"Local Hero",
		// "Selected Unit(s)",
		"Only controllables",
		"All Controllables",
	], 0, "More than two units(or heroes) for\none line of creeps is not recommended")

	const CenterCamera = ControllablesTree.AddToggle("Center Camera", false, "Centering camera on your hero")
	const CountUnits = ControllablesTree.AddSlider("Number of unit", 3, 1, 10, 0, "Number of units to use")

	return {
		ControllablesTree,
		StateUnits,
		CenterCamera,
		CountUnits,
	}
}
