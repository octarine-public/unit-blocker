import { DOTAGameUIState_t, EventsSDK, GameRules, GameState, InputEventSDK, LocalPlayer, RendererSDK } from "wrapper/Imports"
import { DrawParticles, RemoveParticles } from "./modules/CreepBlock/ParticleHelp"

import * as DrawParticle from "./base/DrawParticle"
import { stateMain } from "./base/MenuBase"

import * as CreepBlock from "./modules/CreepBlock/Block"
import * as HeroBlock from "./modules/HeroBlock/Block"

const IsValid = () => {
	return stateMain.value
		&& LocalPlayer !== undefined
		&& LocalPlayer.Hero !== undefined
}

EventsSDK.on("GameEnded", () => {
	DrawParticle.GameEnded()
	CreepBlock.GameEnded()
	HeroBlock.GameEnded()
	RemoveParticles()
})

EventsSDK.on("Tick", () => {
	if (!IsValid())
		return

	GameState.RawGameTime > 300
		? RemoveParticles()
		: DrawParticles()

	if (!stateMain.value)
		return

	CreepBlock.Update()
	HeroBlock.Update()
})

EventsSDK.on("Draw", () => {
	if (!stateMain.value || !GameRules?.IsInGame || GameState.UIState !== DOTAGameUIState_t.DOTA_GAME_UI_DOTA_INGAME)
		return

	let textAroundMouse = ""

	textAroundMouse += CreepBlock.Draw() ?? ""

	textAroundMouse += HeroBlock.Draw() ?? ""

	if (textAroundMouse === "")
		return

	RendererSDK.TextAroundMouse(textAroundMouse)
})

EventsSDK.on("PrepareUnitOrders", () => {
	if (!IsValid())
		return true
	return CreepBlock.PrepareUnitOrders()
})

InputEventSDK.on("KeyDown", key => {
	if (!IsValid())
		return true
	return CreepBlock.KeyDown(key)
})

InputEventSDK.on("MouseKeyDown", key => {
	if (!IsValid())
		return true
	return CreepBlock.MouseDown(key)
})

InputEventSDK.on("KeyUp", key => {
	if (!IsValid())
		return true
	CreepBlock.KeyUp(key)
	return true
})

InputEventSDK.on("MouseKeyUp", key => {
	if (!IsValid())
		return true
	CreepBlock.MouseUp(key)
	return true
})
