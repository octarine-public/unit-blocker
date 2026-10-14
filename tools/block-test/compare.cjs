// Blocking technique profile of saved runs: node compare.cjs tagPrefix [tagPrefix...]
// Only clean runs (no escape) where the hero actually blocked are profiled.
const fs = require("fs")
const path = require("path")
const dir = path.join(__dirname, "out", "runs")
const ORDER = { 1: "move", 10: "hold", 21: "stop", 28: "dir", 3: "amove" }

for (const prefix of process.argv.slice(2)) {
	const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix + "-"))
	const acc = { back: 0, runs: 0, t1: 0, blockTime: 0, heroSpeed: 0, still: 0, orders: 0, stops: 0, gap: 0, lat: 0, contact: 0, samples: 0 }
	for (const file of files) {
		const run = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
		const { r, samples, orders = [] } = run
		if ((r.failed ?? (r.escape !== null || r.escapeRanged !== null)) || r.t1Mean === null) continue
		const first = samples.find(s => s.c.some(c => Math.hypot(c[1] - s.h[0], c[2] - s.h[1]) < 90))
		if (!first) continue
		const end = r.release ?? samples[samples.length - 1].t
		const span = samples.filter(s => s.t >= first.t && s.t <= end)
		if (span.length < 10) continue
		acc.runs++
		acc.t1 += r.t1Mean
		const dur = end - first.t
		acc.blockTime += dur
		acc.heroSpeed += (span[span.length - 1].h[2] - span[0].h[2]) / dur
		let still = 0,
			back = 0
		for (let i = 1; i < span.length; i++) {
			const a = span[i - 1],
				b = span[i]
			if (Math.hypot(b.h[0] - a.h[0], b.h[1] - a.h[1]) / Math.max(1e-3, b.t - a.t) < 40) still += b.t - a.t
			if ((b.h[2] - a.h[2]) / Math.max(1e-3, b.t - a.t) < -60) back += b.t - a.t
			if (b.c.length === 0) continue
			const front = b.c.reduce((m, c) => (c[3] > m[3] ? c : m))
			acc.gap += b.h[2] - front[3]
			acc.lat += Math.abs(front[4] - b.h[3])
			if (Math.hypot(front[1] - b.h[0], front[2] - b.h[1]) < 80) acc.contact++
			acc.samples++
		}
		acc.still += still / dur
		acc.back += back / dur
		const inBlock = orders.filter(o => o.t >= first.t && o.t <= end)
		acc.orders += inBlock.length / dur
		acc.stops += inBlock.filter(o => o.type === 21 || o.type === 10).length / dur
	}
	if (acc.runs === 0) {
		console.log(`${prefix}: no clean runs`)
		continue
	}
	const n = acc.runs
	console.log(
		`${prefix.padEnd(10)} clean ${n}  T1mean ${(acc.t1 / n).toFixed(2)}s  block ${(acc.blockTime / n).toFixed(1)}s  hero fwd ${(acc.heroSpeed / n).toFixed(0)}u/s  still ${((100 * acc.still) / n).toFixed(0)}%  back ${((100 * acc.back) / n).toFixed(1)}%  orders ${(acc.orders / n).toFixed(1)}/s  stops ${(acc.stops / n).toFixed(1)}/s  lead gap ${(acc.gap / acc.samples).toFixed(0)}  |dlat| ${(acc.lat / acc.samples).toFixed(0)}  contact ${((100 * acc.contact) / acc.samples).toFixed(0)}%`
	)
}
console.log("order types:", JSON.stringify(ORDER))
