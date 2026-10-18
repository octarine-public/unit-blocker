// Creeps' stops against the server's collision rules (notes/creep/REPORT.md in dota2-ida), over
// saved runs: node stops.cjs <tag>[*] ... [--key] [--list]
// - closest hero–creep centre distance while the key is held (hard contact: hull sum, no padding);
// - every stop of a creep (position unchanged between ticks) with its length in ticks, the unit in
//   the way and what it was doing (standing, walking away from the creep, other);
// - the side the creep walks off to after a stop the hero caused, against "the side farther from
//   the hero's centre".
// --key: only stops while the blocker key is held; --list: print every hero stop.
const A = require("./analyze.cjs")

const args = process.argv.slice(2)
const tags = args.filter(a => !a.startsWith("--"))
const keyOnly = args.includes("--key")
const list = args.includes("--list")
// --still: the hero stood still (no key held): distances over every tick and the side creeps pass it on
const keyOff = args.includes("--still")

// server.dll hulls and paddings (BoundsHullName): melee REGULAR 16/20, ranged SMALL 8/10, hero 24/3
const HULL = { melee: 16, ranged: 8, hero: 24 }
const PADDING = { melee: 20, ranged: 10, hero: 3 }
const LOOK_AHEAD = 32
const CONE = 0.7
const STILL = 1.5 // units per tick: the position is rounded to whole units
const MOVING = 5

const norm = (x, y) => {
	const l = Math.hypot(x, y)
	return l < 1e-6 ? [0, 0] : [x / l, y / l]
}
const pct = (a, p) => {
	if (a.length === 0) return NaN
	const s = [...a].sort((x, y) => x - y)
	return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}

const runs = A.loadRuns(tags)
const minDist = { melee: [], ranged: [] }
const allClose = { melee: [], ranged: [] }
const stops = []
const passes = []
for (const run of runs) {
	const info = new Map((run.meta?.creeps ?? []).map(c => [c.idx, c.ranged ? "ranged" : "melee"]))
	const samples = run.samples
	const perCreep = new Map()
	for (const smp of samples) {
		if (!keyOff && smp.a === undefined) continue
		for (const c of smp.c) {
			const kind = info.get(c[0])
			if (kind === undefined) continue
			const d = Math.hypot(c[1] - smp.h[0], c[2] - smp.h[1])
			perCreep.set(c[0], Math.min(perCreep.get(c[0]) ?? Infinity, d))
			if (d < 80) allClose[kind].push(d)
		}
	}
	for (const [idx, d] of perCreep) minDist[info.get(idx)].push(d)

	// side a creep passes a standing hero on, against its lateral offset (harness lane frame) while
	// still 300–150 short of the hero: the rule says the far side from the hero's centre, i.e. the
	// side it is already offset to
	if (keyOff) {
		for (const [idx, kind] of info) {
			let early, level
			for (const smp of samples) {
				const c = smp.c.find(q => q[0] === idx)
				if (c === undefined) continue
				const ds = c[3] - smp.h[2],
					dlat = c[4] - smp.h[3]
				if (ds >= -300 && ds <= -150 && early === undefined) early = dlat
				if (ds >= 0 && early !== undefined) {
					level = { dlat, dist: Math.hypot(c[1] - smp.h[0], c[2] - smp.h[1]) }
					break
				}
			}
			if (early !== undefined && level !== undefined && Math.abs(level.dlat) < 150) {
				passes.push({ kind, early, level: level.dlat })
			}
		}
	}

	// per creep track: [t, x, y, held, sampleIndex]
	for (const [idx, kind] of info) {
		const track = []
		samples.forEach((smp, i) => {
			const c = smp.c.find(q => q[0] === idx)
			if (c !== undefined) track.push({ i, t: smp.t, x: c[1], y: c[2], held: smp.a !== undefined })
		})
		for (let k = 2; k < track.length; k++) {
			const p = track[k - 1],
				q = track[k],
				pp = track[k - 2]
			const moved = Math.hypot(q.x - p.x, q.y - p.y),
				before = Math.hypot(p.x - pp.x, p.y - pp.y)
			if (!(moved < STILL && before > MOVING) || q.i - p.i !== 1) continue
			// a stop starts at p: count the ticks it stays
			let end = k
			while (end + 1 < track.length && Math.hypot(track[end + 1].x - p.x, track[end + 1].y - p.y) < STILL) end++
			if (end + 1 >= track.length) continue
			const ticks = end - k + 1
			if (keyOnly && !p.held) continue
			const [dx, dy] = norm(p.x - pp.x, p.y - pp.y),
				step = before,
				nx = p.x + dx * step,
				ny = p.y + dy * step
			// the tick the mover refused the step (p → q): the other units as they stood at either end
			// of it (the order units move in within a tick is unknown), velocity over that tick
			const smp = samples[q.i],
				prevSmp = samples[p.i],
				dt = smp.t - prevSmp.t
			const units = [
				{
					who: "hero",
					at: [prevSmp.h, smp.h],
					vx: (smp.h[0] - prevSmp.h[0]) / dt,
					vy: (smp.h[1] - prevSmp.h[1]) / dt,
					hull: HULL.hero,
					pad: 0
				}
			]
			for (const c of smp.c) {
				if (c[0] === idx || !info.has(c[0])) continue
				const pc = prevSmp.c.find(r => r[0] === c[0]) ?? c
				const ok = info.get(c[0])
				units.push({
					who: ok === "ranged" ? "R" : "M",
					at: [pc.slice(1), c.slice(1)],
					vx: (c[1] - pc[1]) / dt,
					vy: (c[2] - pc[2]) / dt,
					hull: HULL[ok],
					pad: PADDING[ok] + PADDING[kind]
				})
			}
			let best, nearest
			for (const u of units) {
				for (const [x, y] of u.at) {
					const dNext = Math.hypot(nx - x, ny - y),
						dNow = Math.hypot(p.x - x, p.y - y),
						[ux, uy] = norm(x - p.x, y - p.y),
						cos = dx * ux + dy * uy,
						speed = Math.hypot(u.vx, u.vy),
						away = speed > 20 && ux * u.vx + uy * u.vy > 0
					const hard = HULL[kind] + u.hull + u.pad
					const look = HULL[kind] + LOOK_AHEAD + u.hull
					if (nearest === undefined || dNext - hard < nearest.over) {
						nearest = { who: u.who, over: dNext - hard, cos, speed, away }
					}
					let rule
					if (dNext <= hard + 3) rule = "hard"
					else if (dNext <= look + 3 && cos > CONE && away) rule = "look"
					if (rule === undefined) continue
					const score = dNext - (rule === "hard" ? hard : look)
					if (best === undefined || score < best.score) best = { u, rule, x, y, dNext, dNow, cos, speed, away, score }
				}
			}
			// lateral side of the walk-off: over the 6 ticks after the stop
			const after = track.slice(end + 1, end + 7)
			let side = 0,
				turn = 0
			if (after.length >= 4) {
				const last = after[after.length - 1]
				const [ex, ey] = norm(last.x - p.x, last.y - p.y)
				turn = dx * ey - dy * ex
				side = Math.abs(turn) < 0.17 ? 0 : Math.sign(turn)
			}
			const hero = { ...units[0], x: smp.h[0], y: smp.h[1] },
				endSmp = samples[track[end].i],
				heroOff = dx * (hero.y - p.y) - dy * (hero.x - p.x),
				heroOffEnd = dx * (endSmp.h[1] - p.y) - dy * (endSmp.h[0] - p.x)
			const heroSpeed = Math.hypot(hero.vx, hero.vy),
				[hx, hy] = norm(hero.x - p.x, hero.y - p.y),
				heroAway = heroSpeed > 20 && (hx * hero.vx + hy * hero.vy) / heroSpeed > 0.3,
				heroToward = heroSpeed > 20 && (hx * hero.vx + hy * hero.vy) / heroSpeed < -0.3
			stops.push({
				run: run.file,
				t: p.t,
				idx,
				kind,
				ticks,
				held: p.held,
				blocker: best?.u.who ?? "-",
				blockerOff: best === undefined ? 0 : dx * (best.y - p.y) - dy * (best.x - p.x),
				rule: best?.rule ?? "-",
				dHero: Math.hypot(hero.x - p.x, hero.y - p.y),
				dNextHero: Math.hypot(nx - hero.x, ny - hero.y),
				cosHero: dx * hx + dy * hy,
				heroState: heroSpeed <= 20 ? "still" : heroAway ? "away" : heroToward ? "toward" : "across",
				heroSpeed,
				heroOff,
				heroOffEnd,
				side,
				nearest
			})
		}
	}
}

const fmt = v => (Number.isFinite(v) ? v.toFixed(1) : "-")
console.log(`runs ${runs.length}`)
for (const kind of ["melee", "ranged"]) {
	const m = minDist[kind],
		a = allClose[kind]
	console.log(
		`closest hero–${kind} while the key is held: per creep min ${fmt(Math.min(...m))}, p10 ${fmt(pct(m, 0.1))}, median ${fmt(pct(m, 0.5))} (n ${m.length}); ` +
			`all ticks < 80: p1 ${fmt(pct(a, 0.01))} p5 ${fmt(pct(a, 0.05))} (n ${a.length}); server ${HULL[kind] + HULL.hero}, planner ${PADDING[kind] + HULL[kind] + PADDING.hero + HULL.hero}`
	)
}

const hist = list => {
	const h = {}
	for (const s of list) h[s.ticks] = (h[s.ticks] ?? 0) + 1
	return Object.entries(h)
		.sort((x, y) => x[0] - y[0])
		.map(([k, v]) => `${k}:${v}`)
		.join(" ")
}
const groups = {}
for (const s of stops) {
	const key = s.blocker === "hero" ? `hero ${s.rule} ${s.heroState}` : s.blocker === "-" ? "unexplained" : `creep ${s.rule}`
	;(groups[key] ??= []).push(s)
}
console.log(`\nstops ${stops.length} (${keyOnly ? "key held" : "all"}): ticks histogram per blocker / rule / hero state`)
for (const [key, list] of Object.entries(groups).sort((x, y) => y[1].length - x[1].length)) {
	const short = list.filter(s => s.ticks >= 3 && s.ticks <= 6).length,
		long = list.filter(s => s.ticks >= 11 && s.ticks <= 13).length
	const total = list.reduce((a, s) => a + s.ticks, 0)
	console.log(`${key.padEnd(22)} n ${String(list.length).padStart(4)}  ticks ${String(total).padStart(5)}  3–6 ${short}  11–13 ${long}  | ${hist(list)}`)
}

const heroStops = stops.filter(s => s.blocker === "hero")
for (const kind of ["melee", "ranged"]) {
	const d = heroStops.filter(s => s.kind === kind && s.rule === "hard").map(s => s.dHero)
	if (d.length) console.log(`hero hard stops, ${kind}: distance at the stop p10 ${fmt(pct(d, 0.1))} median ${fmt(pct(d, 0.5))} p90 ${fmt(pct(d, 0.9))} (n ${d.length})`)
}

// walk-off side: "farther from the blocker's centre" = opposite to the blocker's lateral offset
// from the creep's line; side over the 6 ticks after the stop (straight: turned less than 10°)
console.log(`\nwalk-off after a stop: side vs the blocker's centre offset from the creep's line (far = the rule)`)
const walkOff = (title, list, offOf) => {
	const rows = {}
	for (const s of list) {
		const off = offOf(s),
			b = Math.abs(off) < 5 ? "<5" : Math.abs(off) < 15 ? "5–15" : Math.abs(off) < 30 ? "15–30" : "30+"
		const r = (rows[b] ??= { far: 0, near: 0, straight: 0 })
		if (s.side === 0) r.straight++
		else if (s.side === -Math.sign(off)) r.far++
		else r.near++
	}
	const order = ["<5", "5–15", "15–30", "30+"]
	console.log(
		`${title.padEnd(30)} ` +
			order
				.filter(b => rows[b])
				.map(b => `|off| ${b}: far ${rows[b].far} near ${rows[b].near} straight ${rows[b].straight}`)
				.join("; ")
	)
}
walkOff("hero hard, hero at the stop", heroStops.filter(s => s.rule === "hard"), s => s.blockerOff)
walkOff("hero hard, hero when it ends", heroStops.filter(s => s.rule === "hard"), s => s.heroOffEnd)
walkOff("hero look-ahead", heroStops.filter(s => s.rule === "look"), s => s.blockerOff)
walkOff("creep hard", stops.filter(s => s.blocker !== "hero" && s.rule === "hard"), s => s.blockerOff)
if (list) {
	for (const s of stops.filter(s => s.blocker === "-")) {
		const n = s.nearest
		console.log(
			`unexplained ${s.run.slice(0, 22)} t ${s.t.toFixed(2)} ${s.kind[0]} ${s.ticks}t held ${s.held ? 1 : 0} nearest ${n?.who} ${n ? `beyond hard ${n.over.toFixed(0)} cos ${n.cos.toFixed(2)} v ${n.speed.toFixed(0)} away ${n.away}` : ""} | hero d ${s.dHero.toFixed(0)} next ${s.dNextHero.toFixed(0)} cos ${s.cosHero.toFixed(2)} ${s.heroState}`
		)
	}
	for (const s of heroStops) {
		console.log(
			`${s.run.slice(0, 28)} t ${s.t.toFixed(2)} ${s.kind[0]} ${String(s.ticks).padStart(2)}t ${s.rule.padEnd(4)} ${s.heroState.padEnd(6)} v ${s.heroSpeed.toFixed(0).padStart(3)} d ${s.dHero.toFixed(0)} next ${s.dNextHero.toFixed(0)} cos ${s.cosHero.toFixed(2)} off ${s.heroOff.toFixed(0)}/${s.heroOffEnd.toFixed(0)} side ${s.side}`
		)
	}
}
if (keyOff && passes.length > 0) {
	const rows = {}
	for (const p of passes) {
		const b = Math.abs(p.early) < 20 ? "<20" : Math.abs(p.early) < 50 ? "20–50" : Math.abs(p.early) < 100 ? "50–100" : "100+"
		const r = (rows[b] ??= { same: 0, other: 0, gap: [] })
		if (Math.sign(p.level) === Math.sign(p.early)) r.same++
		else r.other++
		r.gap.push(Math.abs(p.level))
	}
	console.log(`\npassing the standing hero: side at ds 0 vs the offset 300–150 before it (same = far side from the hero's centre)`)
	for (const b of ["<20", "20–50", "50–100", "100+"]) {
		const r = rows[b]
		if (r) console.log(`|offset before| ${b.padEnd(6)} same ${r.same} other ${r.other}  |dlat| level with the hero median ${fmt(pct(r.gap, 0.5))}`)
	}
}
