import { GameRules, GameState, Hero, LocalPlayer, Vector3 } from "github.com/octarine-public/wrapper/index"

import { AddOrUpdateParticle, RemoveParticle } from "../../base/DrawParticle"
import { stateMain } from "../../base/MenuBase"
import { DrawHelpPosition, DrawState } from "./Menu"

let lastHero: Nullable<Hero>
let particles: string[] = []

export const BestPosition = [
	[
		new Vector3(-6526, -1450, 128), // top
		new Vector3(-3933, -3426, 128), // middle
		new Vector3(-784, -6411, 128), // bottom
	],
	[
		new Vector3(751, 5751, 128), // top
		new Vector3(3429, 2905, 128), // middle
		new Vector3(6339, 849, 128), // bottom
	],
]

export function DrawParticles() {
	if (GameRules === undefined
		|| GameState.MapName.startsWith("hero_demo")
		|| !stateMain.value
		|| !DrawState.value
		|| !DrawHelpPosition.value
		|| !GameRules.IsInGame
		|| GameState.RawGameTime <= 5
	)
		return

	lastHero = LocalPlayer?.Hero

	if (lastHero === undefined || LocalPlayer === undefined)
		return

	const teamParticles = BestPosition[LocalPlayer.Team - 2]

	if (teamParticles === undefined)
		return

	teamParticles.forEach(vec => {
		const name = vec.x.toString()
		if (particles.includes(name))
			return
		AddOrUpdateParticle(name, lastHero!, vec)
		particles.push(name)
	})
}

export function RemoveParticles() {
	if (lastHero === undefined)
		return
	particles.forEach(partcl => RemoveParticle(partcl, lastHero!))
	particles = []
}
