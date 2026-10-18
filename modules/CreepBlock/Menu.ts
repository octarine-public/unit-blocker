import { Menu, MenuBase, MenuDraw } from "../../base/MenuBase"
import { MenuIcons } from "../../base/MenuIcons"
import { MenuControllables } from "../Controllables"

const { BaseTree, Key, KeyStyle, Sensitivity } = MenuBase(Menu, "Creep Block", true, "4")

const GoToBestPosition = BaseTree.AddToggle(
	"Go to the best position",
	true,
	"Going to the best position when\nwaiting creeps (Visual: Help position)"
)
GoToBestPosition.IconPath = MenuIcons.BestPosition

const SkipRange = BaseTree.AddToggle("Skip range-creeps")
SkipRange.IconPath = MenuIcons.SkipRange

const { StateUnits, CenterCamera, CountUnits } = MenuControllables(BaseTree)

const { DrawTree, DrawState, StatusAroundUnits, StatusMouse } = MenuDraw(BaseTree)

const DrawHelpPosition = DrawTree.AddToggle(
	"Best position",
	true,
	"Drawing help particle where the best position for block creeps.\nAuto removed in 5 min after creating"
)
DrawHelpPosition.IconPath = MenuIcons.HelpPosition

const DrawEvaluation = DrawTree.AddToggle(
	"Block evaluation",
	true,
	"Lane line, towers, creep roles and velocities,\nthe point the unit is going to and the block time gained"
)
DrawEvaluation.IconPath = MenuIcons.Evaluation

export {
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
}
