import { ParticleAttachment, ParticlesSDK, Unit, Vector3 } from "github.com/octarine-public/wrapper/index"

const particleManager = new ParticlesSDK()

export function GameEnded() {
	particleManager.DestroyAll()
}

export function AddOrUpdateParticle(name: string, unit: Unit, pos: Vector3) {
	particleManager.AddOrUpdate(
		name + unit.Index,
		"particles/newplayer_fx/npx_moveto_goal.vpcf",
		ParticleAttachment.PATTACH_ABSORIGIN,
		unit,
		[0, pos]
	)
}

export function RemoveParticle(name: string, unit: Unit) {
	particleManager.DestroyByKey(name + unit.Index)
}
