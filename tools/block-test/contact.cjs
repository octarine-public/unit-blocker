// Contact episodes between the hero and creeps across saved runs: node contact.cjs [tagPrefix]
const fs = require("fs")
const path = require("path")
const prefix = process.argv[2] ?? ""
const dir = path.join(__dirname, "out", "runs")
const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix))
const HERO_PAD = 27
const stats = { episodes: 0, passed: 0, stopTime: 0, duration: 0, sameSide: 0, otherSide: 0, byOffset: {} }
for (const file of files) {
	const run = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
	const samples = run.samples
	const open = new Map()
	for (let i = 1; i < samples.length; i++) {
		const s = samples[i],
			p = samples[i - 1],
			dt = s.t - p.t
		if (dt <= 0) continue
		const [hx, hy, hs, hl] = s.h
		for (const c of s.c) {
			const [idx, x, y, cs, cl] = c
			const prev = p.c.find(q => q[0] === idx)
			if (!prev) continue
			const contact = HERO_PAD + (run.r && idx ? 36 : 36)
			const dist = Math.hypot(x - hx, y - hy)
			const speed = Math.hypot(x - prev[1], y - prev[2]) / dt
			let ep = open.get(idx)
			if (ep === undefined && dist < contact + 6 && cs < hs) {
				ep = { t0: s.t, offset: cl - hl, stopped: 0, firstLat: undefined, s0: cs, hs0: hs }
				open.set(idx, ep)
			}
			if (ep === undefined) continue
			if (speed < 60) ep.stopped += dt
			if (ep.firstLat === undefined && speed > 150 && Math.abs(cl - prev[4]) / dt > 120) {
				ep.firstLat = Math.sign(cl - prev[4])
			}
			if (dist > contact + 25 || cs > hs + 20) {
				stats.episodes++
				stats.duration += s.t - ep.t0
				stats.stopTime += ep.stopped
				const passed = cs > hs + 20
				if (passed) stats.passed++
				if (ep.firstLat !== undefined && Math.abs(ep.offset) > 8) {
					if (ep.firstLat === Math.sign(ep.offset)) stats.sameSide++
					else stats.otherSide++
				}
				const bucket = Math.min(60, Math.floor(Math.abs(ep.offset) / 10) * 10)
				const b = (stats.byOffset[bucket] ??= { n: 0, passed: 0, dur: 0, stop: 0, adv: 0 })
				b.n++
				b.passed += passed ? 1 : 0
				b.dur += s.t - ep.t0
				b.stop += ep.stopped
				b.adv += cs - ep.s0
				open.delete(idx)
			}
		}
	}
}
console.log(`files ${files.length} episodes ${stats.episodes} passed ${stats.passed} avg duration ${(stats.duration / stats.episodes).toFixed(2)}s stopped ${(stats.stopTime / stats.episodes).toFixed(2)}s`)
console.log(`first sidestep toward the side the creep was already offset to: ${stats.sameSide}, to the other side: ${stats.otherSide}`)
for (const [k, b] of Object.entries(stats.byOffset)) {
	console.log(`offset ${String(k).padStart(2)}-${Number(k) + 9}: n ${String(b.n).padStart(4)} passed ${(100 * b.passed / b.n).toFixed(0).padStart(3)}% dur ${(b.dur / b.n).toFixed(2)}s stop ${(b.stop / b.n).toFixed(2)}s advance ${(b.adv / b.n).toFixed(0)}`)
}
