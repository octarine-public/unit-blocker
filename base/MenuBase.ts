import { MenuIcons } from "./MenuIcons"

// the local name shadows the Menu namespace, so the tree is built through the alias object
export const Menu = Dota2SDK.Menu.AddEntryDeep(
	["Utility", "Unit Blocker"],
	["panorama/images/hud/reborn/icon_speed_psd.vtex_c"]
)
export const stateMain = Menu.AddToggle("State")
stateMain.IconPath = MenuIcons.State
// the script's own switch rides the top bar beside the breadcrumb and gates the page
Menu.HeaderControl = stateMain
Menu.Gate = stateMain

export function MenuBase(
	root: MenuSDK.Node,
	_name: string,
	_enabled = false,
	defaultKey = ""
) {
	const BaseTree = root //root.AddNode(name)

	const Key = BaseTree.AddKeybind("Key", defaultKey)
	Key.IconPath = MenuIcons.Key
	const KeyStyle = BaseTree.AddDropdown("Key Style", ["Hold key", "Turn on / Turn off"])
	KeyStyle.IconPath = MenuIcons.KeyStyle
	const Sensitivity = BaseTree.AddSlider(
		"Sensitivity",
		16,
		0,
		35,
		0,
		"Lower blocks tighter and longer but lets a creep slip by more often,\nhigher blocks shorter. Default - 16"
	)
	Sensitivity.IconPath = MenuIcons.Sensitivity
	return { BaseTree, Key, KeyStyle, Sensitivity }
}

export function MenuDraw(root: MenuSDK.Node) {
	const DrawTree = root.AddNode("Draw", MenuIcons.Draw)

	const DrawState = DrawTree.AddToggle("State", true)
	DrawState.IconPath = MenuIcons.State
	DrawTree.HeaderControl = DrawState
	DrawTree.Gate = DrawState
	const StatusAroundUnits = DrawTree.AddToggle("Status around units(or Heroes)", true)
	StatusAroundUnits.IconPath = MenuIcons.StatusUnits
	const StatusMouse = DrawTree.AddToggle("Status around mouse")
	StatusMouse.IconPath = MenuIcons.StatusMouse
	return { DrawTree, DrawState, StatusAroundUnits, StatusMouse }
}
