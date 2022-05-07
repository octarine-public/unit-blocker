import { Menu as MenuSDK } from "wrapper/Imports"

export const Menu = MenuSDK.AddEntryDeep(["Utility", "Unit Blocker"], ["panorama/images/hud/reborn/icon_speed_psd.vtex_c"])
export const stateMain = Menu.AddToggle("State")

export function MenuBase(root: MenuSDK.Node, name: string, enabled = false, defaultKey = "") {
	const BaseTree = root.AddNode(name)

	return {
		BaseTree,
		State: BaseTree.AddToggle("State", enabled),
		Key: BaseTree.AddKeybind("Key", defaultKey),
		KeyStyle: BaseTree.AddDropdown("Key Style", ["Hold key", "Turn on / Turn off"]),
		Sensitivity: BaseTree.AddSlider(
			"Sensitivity",
			16,
			0,
			35,
			0,
			"Biggest value to smaller blocks but more accurately. Default for many heroes - 16",
		),
	}
}

export function MenuDraw(root: MenuSDK.Node) {
	const DrawTree = root.AddNode("Draw")

	return {
		DrawTree,
		DrawState: DrawTree.AddToggle("State Draw", true),
		StatusAroundUnits: DrawTree.AddToggle("Status around units(or Heroes)", true),
		StatusMouse: DrawTree.AddToggle("Status around mouse"),
	}
}
