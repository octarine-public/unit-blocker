// Report on passive recordings (rec.js / rec-dump.cjs): the network, each order's way out
// (queued → sent → the hero reacting) against the latency the planner assumes, and the last
// seconds before every escape.
// Usage: node rec-report.cjs [file ...]   (no files: every out/rec/*.json)   [--before 2]
const fs = require("fs")
const path = require("path")

const args = process.argv.slice(2)
let before = 2
const files = []
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--before") before = Number(args[++i])
	else files.push(args[i])
}
if (files.length === 0) {
	const dir = path.join(__dirname, "out", "rec")
	if (fs.existsSync(dir)) {
		for (const f of fs.readdirSync(dir).sort()) if (f.endsWith(".json")) files.push(path.join(dir, f))
	}
}

const MOVE = 1
const STOP = 21
const HOLD = 10
const ACTIONS = ["Wait", "Hold", "Move", "Advance"]
const MODES = ["Idle", "Block", "Passage", "Advance", "Funnel"]

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const pct = (a, p) => {
	if (!a.length) return NaN
	const s = [...a].sort((x, y) => x - y)
	return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const ms = v => (Number.isFinite(v) ? Math.round(v * 1000) + "ms" : "-")
const stats = a => `n ${a.length}, mean ${ms(mean(a))}, p50 ${ms(pct(a, 0.5))}, p90 ${ms(pct(a, 0.9))}, max ${ms(pct(a, 1))}`

/** First sample at or after `t` where the hero obeys the order: walks towards its point, or stands. */
function reaction(s, o, from) {
	for (let i = 0; i < s.samples.length; i++) {
		const x = s.samples[i]
		if (x.t < from) continue
		if (x.t - from > 1.5) return null
		const [vx, vy] = x.hv,
			sp = Math.hypot(vx, vy)
		if (o.type === STOP || o.type === HOLD) {
			if (sp < 20) return x.t
			continue
		}
		const dx = o.x - x.h[0],
			dy = o.y - x.h[1],
			d = Math.hypot(dx, dy)
		if (d < 20) return x.t
		// already walking that way before the order: nothing to see
		if (sp > 50 && (vx * dx + vy * dy) / (sp * d) > 0.95) return x.t
	}
	return null
}

/** Whether the hero already obeyed the order when it was queued (heading that way / standing). */
function alreadyThere(s, o) {
	const x = s.samples.find(v => v.t >= o.t)
	if (x === undefined) return false
	const [vx, vy] = x.hv,
		sp = Math.hypot(vx, vy)
	if (o.type === STOP || o.type === HOLD) return sp < 20
	const dx = o.x - x.h[0],
		dy = o.y - x.h[1],
		d = Math.hypot(dx, dy)
	return sp > 50 && d > 1 && (vx * dx + vy * dy) / (sp * d) > 0.95
}

/**
 * Creeps that got more than 150 ahead of the hero after being behind it: the creeps of an earlier
 * wave already fighting further up the lane are in the plan too, ahead from the start.
 */
function escapes(s) {
	const behind = new Set(),
		out = []
	for (const x of s.samples) {
		for (const c of x.c) {
			const ahead = c[3] - x.h[2]
			if (ahead <= 0) behind.add(c[0])
			else if (ahead > 150 && behind.has(c[0]) && !out.some(e => e.idx === c[0])) {
				out.push({ t: x.t, idx: c[0], ranged: s.creeps[c[0]]?.ranged === true, s: c[3], lat: c[4], heroS: x.h[2], heroLat: x.h[3] })
			}
		}
	}
	return out
}

for (const file of files) {
	const s = JSON.parse(fs.readFileSync(file, "utf8"))
	s.escapes = escapes(s)
	const dur = s.samples.at(-1).t
	console.log(`\n=== ${path.basename(file)}  ${s.hero} (speed ${s.heroSpeed}), lane ${s.lane}, ${dur.toFixed(1)} s, dedicated ${s.dedicated}`)
	const lin = s.samples.map(x => x.net.in),
		lout = s.samples.map(x => x.net.out),
		il = s.samples.map(x => x.net.il),
		dd = s.samples.map(x => x.net.dd),
		plat = s.samples.map(x => x.lat / 1000),
		gaps = s.samples.slice(1).map((x, i) => x.t - s.samples[i].t)
	console.log(`net: latency in ${stats(lin)}`)
	console.log(`     latency out ${stats(lout)}`)
	console.log(`     InputLag ${stats(il)}; dispatch estimate ${stats(dd)}`)
	console.log(`planner latency (what it predicts creeps over): ${stats(plat)}`)
	console.log(`tick gaps: ${stats(gaps)}; > 2 ticks: ${gaps.filter(g => g > s.tick * 2.5).length}`)

	const scripted = s.orders.filter(o => !o.player)
	const byType = {}
	for (const o of s.orders) byType[o.type + (o.player ? "p" : "")] = (byType[o.type + (o.player ? "p" : "")] ?? 0) + 1
	console.log(`orders: ${s.orders.length} (${(s.orders.length / dur).toFixed(1)}/s), by type ${JSON.stringify(byType)} (p = player)`)
	// the click rate: gaps between our moves (the game repeats a held right button every 133 ms)
	const moves = scripted.filter(o => o.type === MOVE)
	const moveGaps = moves.slice(1).map((o, i) => o.t - moves[i].t)
	console.log(`  gaps between moves: ${stats(moveGaps)}; under 133ms: ${moveGaps.filter(g => g < 0.13).length}`)
	const qToSent = scripted.filter(o => o.sent !== null).map(o => o.sent - o.t)
	console.log(`  queued → sent (humanizer): ${stats(qToSent)}; never sent: ${scripted.filter(o => o.sent === null).length}`)
	const sentToReact = [],
		qToReact = []
	for (const o of scripted) {
		if (o.sent === null || alreadyThere(s, o)) continue
		const r = reaction(s, o, o.sent)
		if (r === null) continue
		sentToReact.push(r - o.sent)
		qToReact.push(r - o.t)
	}
	console.log(`  sent → hero reacts: ${stats(sentToReact)}`)
	console.log(`  queued → hero reacts (end to end): ${stats(qToReact)}  vs planner latency p50 ${ms(pct(plat, 0.5))}`)

	// how often the plan flips and how far its target jumps
	let flips = 0,
		jumps = []
	for (let i = 1; i < s.samples.length; i++) {
		const a = s.samples[i - 1],
			b = s.samples[i]
		if (a.a !== b.a) flips++
		if (a.tg && b.tg) jumps.push(Math.hypot(a.tg[0] - b.tg[0], a.tg[1] - b.tg[1]))
	}
	console.log(`plan: action flips ${flips} (${(flips / dur).toFixed(1)}/s); target jump per tick p50 ${Math.round(pct(jumps, 0.5))}, p90 ${Math.round(pct(jumps, 0.9))}`)
	const notes = {}
	for (const x of s.samples) notes[x.n] = (notes[x.n] ?? 0) + 1
	console.log("notes:", Object.entries(notes).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join(" | "))

	console.log(`escapes: ${s.escapes.length}`)
	for (const e of s.escapes) {
		console.log(`\n  -- ${e.ranged ? "RANGED" : "melee"} #${e.idx} at t ${e.t}: creep s ${e.s} lat ${e.lat}, hero s ${e.heroS} lat ${e.heroLat}`)
		const win = s.samples.filter(x => x.t >= e.t - before && x.t <= e.t)
		let last = ""
		for (const x of win) {
			const c = x.c.find(v => v[0] === e.idx)
			if (c === undefined) continue
			const tgd = x.tg ? Math.round(Math.hypot(x.tg[0] - x.h[0], x.tg[1] - x.h[1])) : "-"
			const sp = Math.round(Math.hypot(x.hv[0], x.hv[1]))
			const line = `${ACTIONS[x.a]}/${MODES[x.m]} key ${x.k} ${x.n}`
			const orders = s.orders.filter(o => o.t > x.t - 0.034 && o.t <= x.t + 1e-6)
			const os = orders.map(o => `${o.type === MOVE ? "MOVE" : o.type === STOP ? "STOP" : o.type}${o.player ? "(player)" : ""} sent+${o.sent === null ? "?" : Math.round((o.sent - o.t) * 1000)}ms`).join(",")
			console.log(
				`   ${x.t.toFixed(2)} hero s ${x.h[2]} lat ${x.h[3]} v ${sp} | creep ahead ${c[3] - x.h[2]} dlat ${c[4] - x.h[3]} mv ${c[5]} role ${c[6]} | tgt ${tgd} | q ${x.net.q} lat ${x.lat}ms` +
					(line !== last ? ` | ${line}` : "") +
					(os ? ` | >> ${os}` : "")
			)
			last = line
		}
	}
}
