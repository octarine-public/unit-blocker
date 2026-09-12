import "./Translate"

import * as DrawParticle from "./base/DrawParticle"
import { stateMain } from "./base/MenuBase"
import * as CreepBlock from "./modules/CreepBlock/Block"
import { DrawParticles, RemoveParticles } from "./modules/CreepBlock/ParticleHelp"
import { canvas } from "./render"

const IsValid = () => {
	return (
		stateMain.value &&
		Dota2SDK.LocalPlayer !== undefined &&
		Dota2SDK.LocalPlayer.Hero !== undefined
	)
}

EventsSDK.on("GameEnded", () => {
	DrawParticle.GameEnded()
	CreepBlock.GameEnded()

	RemoveParticles()
})

EventsSDK.on("PostDataUpdate", delta => {
	if (!IsValid() || delta === 0) {
		return
	}

	if (GameState.RawGameTime > 300) {
		RemoveParticles()
	} else {
		DrawParticles()
	}

	if (!stateMain.value) {
		return
	}

	CreepBlock.Update()
})

EventsSDK.on("Draw", () => {
	if (
		!stateMain.value ||
		!Dota2SDK.GameRules?.IsInGame ||
		GameState.UIState !== DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME
	) {
		return
	}

	let textAroundMouse = ""

	textAroundMouse += CreepBlock.Draw() ?? ""
	if (textAroundMouse === "") {
		return
	}

	canvas.CursorText(textAroundMouse, { color: Color.Yellow, size: 30 + 4 })
})

EventsSDK.on("PrepareUnitOrders", () => {
	if (!IsValid()) {
		return true
	}
	return CreepBlock.PrepareUnitOrders()
})

InputEventSDK.on("KeyDown", key => {
	if (!IsValid()) {
		return true
	}
	return CreepBlock.KeyDown(key)
})

InputEventSDK.on("MouseKeyDown", key => {
	if (!IsValid()) {
		return true
	}
	return CreepBlock.MouseDown(key)
})

InputEventSDK.on("KeyUp", key => {
	if (!IsValid()) {
		return true
	}
	CreepBlock.KeyUp(key)
	return true
})

InputEventSDK.on("MouseKeyUp", key => {
	if (!IsValid()) {
		return true
	}
	CreepBlock.MouseUp(key)
	return true
})
