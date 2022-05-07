import { Menu, MenuBase, MenuDraw } from "../../base/MenuBase"

import MenuControllables from "../Controllables"

const {
	BaseTree,
	State,
	Key,
	KeyStyle,
	Sensitivity,
} = MenuBase(Menu, "Creep Block", true, "4")

const GoToBestPosition = BaseTree.AddToggle(
	"Go to the best position",
	true,
	"Going to the best position when waiting creeps (Visual: Help position)",
)

const SkipRange = BaseTree.AddToggle("Skip range-creeps")

const {
	StateUnits,
	CenterCamera,
	CountUnits,
} = MenuControllables(BaseTree)

const {
	DrawTree,
	DrawState,
	StatusAroundUnits,
	StatusMouse,
} = MenuDraw(BaseTree)

const DrawHelpPosition = DrawTree.AddToggle("Best position", true, "Drawing help particle where the best position for block creeps. Auto removed in 5 min after creating")

export {
	State,
	Key,
	KeyStyle,
	Sensitivity,
	GoToBestPosition,
	SkipRange,

	StateUnits,
	CenterCamera,
	CountUnits,

	DrawState,
	StatusMouse,
	StatusAroundUnits,
	DrawHelpPosition,
}
