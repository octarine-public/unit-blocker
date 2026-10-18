// The last seconds before every lost creep, seen through the server's movement rules
// (dota2-ida/notes/creep/REPORT.md): node losses.cjs <tag>[*] ... [--before 3] [--step 0.2]
// Per frame: the hero (action, speed, walking away from the escaping creep or not), and every creep
// relative to the hero (ds along the lane, dlat across, distance), `LA` when the hero is inside its
// look-ahead (cone 0.7, within hull + 32 + hull of its next position, walking away from it: the
// creep waits), `st` when it stands, and the side of the hero's centre from its line (it walks
// round the other side).
const A = require("./analyze.cjs")

const args = process.argv.slice(2)
const tags = args.filter(a => !a.startsWith("--") && !/^\d/.test(a))
const opt = (name, def) => {
	const i = args.indexOf(name)
	return i >= 0 ? Number(args[i + 1]) : def
}
const before = opt("--before", 3),
	step = opt("--step", 0.2)

const HULL = { melee: 16, ranged: 8, hero: 24 }
const ACTION = ["Wait", "Hold", "Move", "Adv"]
const ROLE = ["appr", "press", "flank", "detour", "passed", "ign"]

function lossTime(run) {
	const esc = run.r.escape ?? run.r.escapeRanged
	if (!esc) return undefined
	// the creep that escaped: the one furthest ahead at the escape time
	const smp = run.samples.find(s => s.t >= esc.t) ?? run.samples[run.samples.length - 1]
	let idx,
		best = -Infinity
	for (const c of smp.c) {
		if (c[3] - smp.h[2] > best) {
			best = c[3] - smp.h[2]
			idx = c[0]
		}
	}
	// lost: the last time it was behind the hero along the lane
	let lost = esc.t
	for (const s of run.samples) {
		if (s.t > esc.t) break
		const c = s.c.find(q => q[0] === idx)
		if (c && c[3] - s.h[2] < 0) lost = s.t
	}
	return { idx, lost, esc: esc.t }
}

for (const run of A.loadRuns(tags)) {
	if (!run.r.failed) continue
	const loss = lossTime(run)
	if (!loss) continue
	const info = A.creepInfo(run)
	const kind = idx => (info.get(idx)?.ranged ? "ranged" : "melee")
	console.log(`\n== ${run.file}  ${info.get(loss.idx)?.name} lost at t ${loss.lost.toFixed(2)} (escaped at ${loss.esc.toFixed(2)})`)
	let next = loss.lost - before
	const samples = run.samples
	for (let i = 1; i < samples.length; i++) {
		const s = samples[i],
			p = samples[i - 1]
		if (s.t < next || s.t > loss.lost + 0.6) continue
		next = s.t + step
		const dt = s.t - p.t,
			hvx = (s.h[0] - p.h[0]) / dt,
			hvy = (s.h[1] - p.h[1]) / dt,
			hspeed = Math.hypot(hvx, hvy)
		const cells = []
		for (const c of s.c) {
			const pc = p.c.find(q => q[0] === c[0])
			if (!pc) continue
			const vx = (c[1] - pc[1]) / dt,
				vy = (c[2] - pc[2]) / dt,
				speed = Math.hypot(vx, vy)
			const rx = s.h[0] - c[1],
				ry = s.h[1] - c[2],
				dist = Math.hypot(rx, ry)
			let la = false,
				side = ""
			if (speed > 30) {
				const dx = vx / speed,
					dy = vy / speed,
					nx = c[1] + vx * dt,
					ny = c[2] + vy * dt,
					reach = HULL[kind(c[0])] + 32 + HULL.hero,
					cos = (dx * rx + dy * ry) / dist,
					away = hspeed > 20 && (rx * hvx + ry * hvy) / dist > 0
				la = Math.hypot(s.h[0] - nx, s.h[1] - ny) <= reach && cos > 0.7 && away
				const cross = dx * ry - dy * rx
				if (cos > 0) side = cross > 0 ? "hL" : "hR"
			}
			const name = info.get(c[0])?.name ?? "?"
			const mark = c[0] === loss.idx ? "!" : c[0] === s.k ? "*" : " "
			cells.push(
				`${mark}${name} ${String(c[3] - s.h[2]).padStart(4)}/${String(c[4] - s.h[3]).padStart(4)} d${String(Math.round(dist)).padStart(3)} ${speed < 30 ? "st" : "  "}${la ? "LA" : "  "} ${side.padEnd(2)} ${(ROLE[c[6]] ?? "").padEnd(5)}`
			)
		}
		console.log(
			`${s.t.toFixed(2)} ${(ACTION[s.a] ?? "-").padEnd(4)} v${String(Math.round(hspeed)).padStart(3)} lat${String(s.h[3]).padStart(4)} | ${cells.join("| ")}| ${s.n ?? ""}`
		)
	}
}
