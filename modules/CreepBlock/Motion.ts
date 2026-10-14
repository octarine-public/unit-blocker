const WINDOW = 0.12
const STALE = 0.05
const HISTORY = 8

interface Track {
	readonly time: number[]
	readonly x: number[]
	readonly y: number[]
	readonly velocity: Vector3
	seen: number
}

/** Velocity from the unit's own position history: the networked one reads zero on every other update. */
export class MotionTracker {
	private readonly tracks = new Map<Unit, Track>()

	public Update(units: Unit[], now: number): void {
		for (const unit of units) {
			let track = this.tracks.get(unit)
			if (track === undefined) {
				track = { time: [], x: [], y: [], velocity: new Vector3(), seen: now }
				this.tracks.set(unit, track)
			}
			track.seen = now
			const pos = unit.Position,
				last = track.time.length - 1
			if (last >= 0) {
				const dt = now - track.time[last]
				if (dt < 1e-3) {
					continue
				}
				if (track.x[last] === pos.x && track.y[last] === pos.y && dt < STALE) {
					continue
				}
			}
			track.time.push(now)
			track.x.push(pos.x)
			track.y.push(pos.y)
			if (track.time.length > HISTORY) {
				track.time.shift()
				track.x.shift()
				track.y.shift()
			}
			this.refresh(track)
		}
		for (const [unit, track] of this.tracks) {
			if (now - track.seen > 1) {
				this.tracks.delete(unit)
			}
		}
	}

	public Velocity(unit: Unit): Vector3 {
		return this.tracks.get(unit)?.velocity ?? new Vector3()
	}

	public Clear(): void {
		this.tracks.clear()
	}

	private refresh(track: Track): void {
		const last = track.time.length - 1
		let first = last
		while (first > 0 && track.time[last] - track.time[first] < WINDOW) {
			first--
		}
		const dt = track.time[last] - track.time[first]
		if (dt < 1e-3) {
			track.velocity.x = 0
			track.velocity.y = 0
			return
		}
		track.velocity.x = (track.x[last] - track.x[first]) / dt
		track.velocity.y = (track.y[last] - track.y[first]) / dt
	}
}
