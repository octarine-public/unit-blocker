const WINDOW = 0.12
const STALE = 0.05
const HISTORY = 8
/** Units a position has to change by between updates to count as moving */
const MOVED = 0.5

interface Track {
	readonly time: number[]
	readonly x: number[]
	readonly y: number[]
	readonly velocity: Vector3
	seen: number
	/** Time of the last position it moved from, while it has stood there since */
	still: Nullable<number>
}

/** Velocity from the unit's own position history: the networked one reads zero on every other update. */
export class MotionTracker {
	private readonly tracks = new Map<Unit, Track>()

	public Update(units: Unit[], now: number): void {
		for (const unit of units) {
			let track = this.tracks.get(unit)
			if (track === undefined) {
				track = {
					time: [],
					x: [],
					y: [],
					velocity: new Vector3(),
					seen: now,
					still: undefined
				}
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
				// frames come faster than ticks: a spot kept for longer than a tick is a stand
				const moved =
					Math.hypot(pos.x - track.x[last], pos.y - track.y[last]) > MOVED
				if (moved) {
					track.still = undefined
				} else if (dt >= STALE) {
					track.still ??= track.time[last]
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

	/** Seconds the unit has stood on one spot (0 while it moves). */
	public StillFor(unit: Unit, now: number): number {
		const still = this.tracks.get(unit)?.still
		return still === undefined ? 0 : now - still
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
