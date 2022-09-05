import { ParticleAttachment_t, ParticlesSDK, Unit, Vector3 } from "github.com/octarine-public/wrapper/wrapper/Imports"

const particleManager = new ParticlesSDK()

export function GameEnded() {
	particleManager.DestroyAll()
}

export function AddOrUpdateParticle(name: string, unit: Unit, pos: Vector3) {
	particleManager.AddOrUpdate(
		name + unit.Index,
		"particles/newplayer_fx/npx_moveto_goal.vpcf",
		ParticleAttachment_t.PATTACH_ABSORIGIN,
		unit,
		[0, pos],
	)
}

export function RemoveParticle(name: string, unit: Unit) {
	particleManager.DestroyByKey(name + unit.Index)
}
