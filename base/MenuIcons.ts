const Icons = Dota2SDK.Menu.Icons

/** Icons of the menu, from the SDK set. */
export const MenuIcons = {
	State: Icons.Power,
	Key: Icons.Keyboard,
	KeyStyle: Icons.ToggleLeft,
	Sensitivity: Icons.Knob,
	BestPosition: Icons.Anchor,
	SkipRange: Icons.Ban,
	// additional settings
	Additional: Icons.Settings2,
	Units: Icons.IconCreeps,
	CenterCamera: Icons.IconCamera,
	CountUnits: Icons.Rows3,
	// draw
	Draw: Icons.Palette,
	StatusUnits: Icons.Info,
	StatusMouse: Icons.HoverArrow,
	HelpPosition: Icons.Move,
	Evaluation: Icons.Activity
} as const
