// Analysis of saved runs (out/runs): the free wave's timing curve, time gained per phase of the
// block, a compact event log of an attempt and the autopsy of a failed one. Used by report.cjs and
// series.cjs.
const fs = require("fs")
const path = require("path")

const OUT = path.join(__dirname, "out")
const RUNS = path.join(OUT, "runs")
const CURVE_FILE = path.join(OUT, "free-curve.json")

const ROLE = ["approach", "press", "flank", "detour", "passed", "ignored"]
const ACTION = ["Wait", "Hold", "Move", "Advance"]
const MODE = ["Idle", "Block", "Passage", "Advance", "Funnel"]
const HERO_PAD = 27
const PAD = { melee: 36, ranged: 18 }
// Radiant mid in the harness frame (corner polyline), for runs saved before `meta` existed
const MID_GEO = { t2: { s: 2393, lat: -135 }, t1: { s: 4641, lat: -72 } }
const GRID = 25

const tagOf = file => file.replace(/-\d{13}-[a-z0-9]+\.json$/, "")
const stampOf = file => Number(/-(\d{13})-[a-z0-9]+\.json$/.exec(file)?.[1] ?? 0)
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const sign = v => (v >= 0 ? "+" : "") + v.toFixed(2)

/** Saved runs whose tag equals one of `tags` (a trailing `*` matches a prefix), oldest first. */
function loadRuns(tags) {
	const match = tag => tags.some(p => (p.endsWith("*") ? tag.startsWith(p.slice(0, -1)) : tag === p))
	return fs
		.readdirSync(RUNS)
		.filter(f => f.endsWith(".json") && match(tagOf(f)))
		.sort((a, b) => stampOf(a) - stampOf(b))
		.map(file => ({ file, ...JSON.parse(fs.readFileSync(path.join(RUNS, file), "utf8")) }))
}

const geoOf = run => run.meta?.geo ?? MID_GEO
const waveKey = run => {
	const cs = run.meta?.creeps
	const melee = cs ? cs.filter(c => !c.ranged).length : 3
	return `${run.meta?.lane ?? "mid"}:${melee}:${cs ? cs.length - melee : 1}`
}

/** Display names (M1, M2, M3, R1) and padded contact distances of the wave's creeps. */
function creepInfo(run) {
	const info = new Map()
	const list = run.meta?.creeps ?? (run.samples.find(s => s.c.length)?.c ?? []).map(c => ({ idx: c[0], ranged: false }))
	let m = 0,
		rg = 0
	for (const c of list) {
		info.set(c.idx, {
			name: c.ranged ? `R${++rg}` : `M${++m}`,
			ranged: c.ranged,
			contact: HERO_PAD + (c.ranged ? PAD.ranged : PAD.melee)
		})
	}
	return info
}

/** Time (since spawn) each creep first reaches lane position s, linearly interpolated. */
function reachTime(samples, idx, s) {
	let prev
	for (const smp of samples) {
		const c = smp.c.find(q => q[0] === idx)
		if (c === undefined) continue
		if (c[3] >= s) {
			if (prev === undefined || prev[1] >= s) return smp.t
			return prev[0] + ((s - prev[1]) / (c[3] - prev[1])) * (smp.t - prev[0])
		}
		prev = [smp.t, c[3]]
	}
	return undefined
}

/** Mean over the wave of the time to reach s; undefined until every creep got there. */
function waveTime(run, s) {
	const times = [...creepInfo(run).keys()].map(idx => reachTime(run.samples, idx, s))
	return times.some(t => t === undefined) ? undefined : mean(times)
}

/** Free-wave curve (mean creep time to reach s) from the saved `free-<lane>` runs. */
function buildFreeCurve(runs) {
	const curves = {}
	const byKey = new Map()
	for (const run of runs) {
		if (run.r.mode !== "free") continue
		const key = waveKey(run)
		if (!byKey.has(key)) byKey.set(key, [])
		byKey.get(key).push(run)
	}
	for (const [key, list] of byKey) {
		const t = []
		for (let s = 0; ; s += GRID) {
			const times = list.map(run => waveTime(run, s))
			if (times.some(v => v === undefined)) break
			t.push(+mean(times).toFixed(3))
		}
		curves[key] = { grid: GRID, runs: list.length, t }
	}
	return curves
}

let curvesCache
function freeCurve(run) {
	curvesCache ??= fs.existsSync(CURVE_FILE) ? JSON.parse(fs.readFileSync(CURVE_FILE, "utf8")) : {}
	return curvesCache[waveKey(run)]
}

function curveAt(curve, s) {
	const i = Math.max(0, s / curve.grid)
	const lo = Math.min(curve.t.length - 1, Math.floor(i)),
		hi = Math.min(curve.t.length - 1, lo + 1)
	return curve.t[lo] + (curve.t[hi] - curve.t[lo]) * (i - lo)
}

/** Seconds the wave is behind the free wave when it reaches s (mean over creeps). */
function delayAt(run, curve, s) {
	const t = waveTime(run, s)
	return t === undefined || curve === undefined ? undefined : t - curveAt(curve, s)
}

/** Instantaneous lag of the wave at a sample: time now minus when the free wave stood there. */
function lagAt(curve, smp) {
	if (curve === undefined || smp.c.length === 0) return undefined
	return smp.t - curveAt(curve, mean(smp.c.map(c => c[3])))
}

function firstContact(run) {
	const info = creepInfo(run)
	return run.samples.find(smp =>
		smp.c.some(c => Math.hypot(c[1] - smp.h[0], c[2] - smp.h[1]) < (info.get(c[0])?.contact ?? 63) + 25)
	)
}

/** Lane-position checkpoints that split a block into phases; contact and settle shrink when the wave meets the hero late. */
function phaseBounds(run) {
	const geo = geoOf(run)
	const contact = firstContact(run)
	if (contact === undefined || !geo.t1) return []
	const c0 = Math.round(mean(contact.c.map(c => c[3])))
	const t2in = geo.t2 ? geo.t2.s - 450 : geo.t1.s - 450
	const marks = [
		["contact", c0],
		["settle", Math.min(c0 + 250, t2in)],
		["T2 pass", geo.t2 ? Math.max(c0, t2in) : undefined],
		["between", geo.t2 ? Math.max(c0, geo.t2.s + 150) : undefined],
		["T1 pass", Math.max(c0, geo.t1.s - 450)],
		["T1", geo.t1.s]
	].filter(([, s]) => s !== undefined)
	const phases = []
	for (let i = 0; i + 1 < marks.length; i++) {
		if (marks[i + 1][1] - marks[i][1] < 60) continue
		phases.push({ name: marks[i][0], from: marks[i][1], to: marks[i + 1][1] })
	}
	return phases
}

/** Seconds gained in each phase (and the time the wave spent in it); undefined once the wave did not get there. */
function phaseGains(run) {
	const curve = freeCurve(run)
	if (curve === undefined) return []
	return phaseBounds(run).map(p => {
		const d0 = delayAt(run, curve, p.from),
			d1 = delayAt(run, curve, p.to),
			t0 = waveTime(run, p.from),
			t1 = waveTime(run, p.to)
		return {
			...p,
			gain: d0 === undefined || d1 === undefined ? undefined : d1 - d0,
			start: d0,
			time: t0 === undefined || t1 === undefined ? undefined : t1 - t0,
			free: curveAt(curve, p.to) - curveAt(curve, p.from)
		}
	})
}

/** Emits a change of a per-sample value once the new value has held for `hold` seconds. */
function Debounce(hold) {
	let stable,
		cand,
		since,
		init = false
	return (t, v, emit) => {
		if (!init) {
			init = true
			stable = v
			emit(t, undefined, v)
			return
		}
		if (v === stable) {
			cand = undefined
			return
		}
		if (v !== cand) {
			cand = v
			since = t
			return
		}
		if (t - since >= hold) {
			const was = stable
			stable = v
			cand = undefined
			emit(since, was, v)
		}
	}
}

/** Lateral spread of the creeps around the hero (from 350 behind it to 40 ahead). */
function spreadAt(smp) {
	const lats = smp.c.filter(c => c[3] - smp.h[2] < 40 && c[3] - smp.h[2] > -350).map(c => c[4])
	return lats.length > 1 ? Math.max(...lats) - Math.min(...lats) : 0
}

/** Compact event log of an attempt: decisions, roles, contacts, stops, tower passes, escapes. */
function events(run) {
	const { r, samples } = run
	const info = creepInfo(run)
	const geo = geoOf(run)
	const curve = freeCurve(run)
	const name = idx => info.get(idx)?.name ?? (idx < 0 ? "-" : `#${idx}`)
	const list = []
	const at = t => samples.find(smp => smp.t >= t) ?? samples[samples.length - 1]
	const push = (t, text) => list.push({ t, text })

	const modeT = Debounce(0.15),
		keyT = Debounce(0.25),
		heroT = Debounce(0.15),
		clampT = Debounce(0.2),
		lagT = Debounce(0.1),
		splitT = Debounce(0.3)
	const roleT = new Map(),
		levelT = new Map(),
		stepT = new Map(),
		passed = new Map()
	let standSince
	let prev
	for (const smp of samples) {
		const [hx, hy, hs, hl] = smp.h
		const dt = prev ? smp.t - prev.t : 0
		if (smp.a !== undefined) {
			modeT(smp.t, MODE[smp.m] ?? "?", (t, a, b) => push(t, `mode ${b}`))
			keyT(smp.t, smp.k, (t, a, b) => b >= 0 && push(t, `key -> ${name(b)}`))
			clampT(smp.t, (smp.w?.cl ?? 0) & 1 ? "on" : "off", (t, a, b) => a !== undefined && push(t, `no-back-step clamp ${b}`))
			lagT(smp.t, (smp.lat ?? 0) > 250 || (smp.q ?? 0) >= 3 ? "spike" : "ok", (t, a, b) =>
				a !== undefined && push(t, b === "spike" ? `order latency spike ${at(t).lat}ms queue ${at(t).q}` : "latency normal")
			)
		}
		if (prev && dt > 0) {
			const speed = Math.hypot(hx - prev.h[0], hy - prev.h[1]) / dt
			heroT(smp.t, speed < 40 ? "stand" : "move", (t, a, b) => {
				if (a === undefined) return
				if (b === "stand") {
					standSince = t
					push(t, "hero stops")
				} else push(t, `hero moves${standSince !== undefined ? ` (stood ${(t - standSince).toFixed(2)}s)` : ""}`)
			})
		}
		const melee = smp.c.filter(c => !info.get(c[0])?.ranged).map(c => c[4])
		if (melee.length > 1) {
			const spread = Math.max(...melee) - Math.min(...melee)
			splitT(smp.t, spread > 150 ? "split" : "compact", (t, a, b) =>
				a !== undefined && push(t, b === "split" ? `wave splits: melee lateral spread ${spread}` : "wave compact again")
			)
		}
		for (const c of smp.c) {
			const [idx, x, y, cs, cl] = c
			const ci = info.get(idx)
			if (ci === undefined) continue
			const ds = cs - hs,
				dl = cl - hl,
				rel = `ds ${ds} dlat ${dl > 0 ? "+" : ""}${dl}`
			if (c[6] !== undefined && c[6] >= 0) {
				if (!roleT.has(idx)) roleT.set(idx, Debounce(0.12))
				roleT.get(idx)(smp.t, c[6], (t, a, b) => a !== undefined && push(t, `${ci.name} ${ROLE[a]} -> ${ROLE[b]} (${rel})`))
			}
			if (!levelT.has(idx)) levelT.set(idx, Debounce(0.1))
			const level = ds >= -15 && Math.abs(dl) >= ci.contact * 0.8 && ds < 150
			levelT.get(idx)(smp.t, level ? (dl > 0 ? "L" : "R") : "no", (t, a, b) =>
				a !== undefined && b !== "no" && push(t, `${ci.name} level with hero on ${b} (${rel})`)
			)
			const p = prev?.c.find(q => q[0] === idx)
			if (p && dt > 0) {
				const vl = (cl - p[4]) / dt
				if (!stepT.has(idx)) stepT.set(idx, Debounce(0.1))
				stepT.get(idx)(smp.t, Math.abs(vl) > 140 && Math.abs(ds) < 250 ? (vl > 0 ? "L" : "R") : "no", (t, a, b) =>
					a !== undefined && b !== "no" && push(t, `${ci.name} sidesteps ${b} (${rel})`)
				)
			}
			for (const tw of ["t2", "t1"]) {
				const g = geo[tw]
				const key = idx + tw
				if (g && !passed.has(key) && cs >= g.s) {
					passed.set(key, true)
					push(smp.t, `${ci.name} passes ${tw.toUpperCase()} on ${cl > g.lat ? "L" : "R"} (${rel})`)
				}
			}
		}
		prev = smp
	}
	for (const kind of ["escape", "escapeRanged"]) {
		const e = r[kind]
		if (e) push(e.t, `ESCAPE: creep past the escape threshold ahead of the hero at s ${e.s} lat ${e.lat}, hero ${e.heroS}/${e.heroLat}`)
	}
	if (r.release !== null && r.release !== undefined) push(r.release, "blocker released")
	if (r.why === "escape") push(samples[samples.length - 1].t, "attempt aborted (creep 150 ahead)")
	list.sort((a, b) => a.t - b.t)
	return list.map(e => {
		const smp = at(e.t)
		const lag = lagAt(curve, smp)
		return `${e.t.toFixed(2).padStart(6)} H ${String(smp.h[2]).padStart(4)}/${String(smp.h[3]).padStart(4)} lag ${lag === undefined ? "  ?  " : sign(lag)} | ${e.text}`
	})
}

/** Why a failed attempt failed: the escaping creep, the moment the block was lost and a verdict. */
function autopsy(run) {
	const { r, samples } = run
	const esc = r.escape ?? r.escapeRanged
	if (!r.failed || !esc) return undefined
	const info = creepInfo(run)
	const geo = geoOf(run)
	const name = idx => info.get(idx)?.name ?? (idx < 0 ? "-" : `#${idx}`)
	let at = samples.findIndex(smp => smp.t >= esc.t)
	if (at < 0) at = samples.length - 1
	const escC = samples[at].c.find(c => c[3] === esc.s) ?? samples[at].c.reduce((a, c) => (c[3] > a[3] ? c : a))
	const idx = escC[0]
	const ci = info.get(idx) ?? { name: "?", contact: 63, ranged: false }
	const rel = smp => {
		const c = smp.c.find(q => q[0] === idx)
		return c ? { ds: c[3] - smp.h[2], dl: c[4] - smp.h[3], role: c[6], s: c[3], lat: c[4] } : undefined
	}
	// the block is lost once the creep stops being in front of the hero for good
	let loss = at
	while (loss > 0) {
		const q = rel(samples[loss - 1])
		if (q === undefined || q.ds < -ci.contact * 0.6) break
		loss--
	}
	const L = samples[loss]
	const q = rel(L)
	const heroS = L.h[2]
	const phase = phaseBounds(run).find(p => q.s >= p.from && q.s < p.to)?.name ?? (q.s < (phaseBounds(run)[0]?.from ?? 0) ? "before contact" : "after T1")
	const tower = geo.t2 && Math.abs(heroS - geo.t2.s) < 700 ? geo.t2 : geo.t1 && Math.abs(heroS - geo.t1.s) < 700 ? geo.t1 : undefined
	const towerSide = tower ? Math.sign(tower.lat - L.h[3]) : 0
	const winLats = L.w ? [L.w.lo, L.w.hi].map(i => L.c.find(c => c[0] === i)?.[4]).filter(v => v !== undefined) : []
	const inWindow = winLats.length === 2 && q.lat >= Math.min(...winLats) - 5 && q.lat <= Math.max(...winLats) + 5
	const recent = samples.filter(smp => smp.t >= L.t - 2 && smp.t <= esc.t)
	const holdShare = mean(recent.filter(smp => smp.t >= L.t - 0.5 && smp.t <= L.t).map(smp => (smp.a === 1 ? 1 : 0)))
	const others = L.c.filter(c => {
		const o = info.get(c[0])
		const ds = c[3] - L.h[2],
			dl = c[4] - L.h[3]
		return c[0] !== idx && o !== undefined && ds > -o.contact - 60 && ds < 40 && Math.sign(dl) !== Math.sign(q.dl) && Math.abs(dl) > 15
	})
	const tags = []
	if (others.length) tags.push("two-sided: another creep pressed on the other side")
	if (ci.ranged) tags.push("ranged creep slipped")
	if (recent.some(smp => rel(smp)?.role === 3)) tags.push("far-side tower detour")
	if (L.m === 2 && towerSide !== 0 && Math.sign(q.dl) === towerSide) tags.push("through the gap between hero and tower")
	if (L.k !== idx) tags.push(inWindow ? "in the cover window but not the key creep" : "outside the cover window (planner was covering other creeps)")
	else tags.push(holdShare > 0.6 ? "key creep: hero was holding when it slid past" : "key creep: hero moved but lost the lateral race")
	if ((L.w?.cl ?? 0) & 1) tags.push("no-back-step clamp active")
	if (samples.some(smp => smp.t >= L.t - 0.6 && smp.t <= L.t + 0.1 && (smp.lat ?? 0) >= 300)) tags.push("order latency spike before the loss")
	let compact = loss
	while (compact > 0 && spreadAt(samples[compact]) >= 110) compact--
	const splitT = samples[compact].t
	const before = samples.filter(smp => smp.t >= splitT - 0.6 && smp.t <= splitT && smp.a !== undefined)
	const splitNote =
		loss - compact > 1
			? `wave split ${(L.t - splitT).toFixed(2)}s before the loss (hero holding ${Math.round(100 * mean(before.map(smp => (smp.a === 1 ? 1 : 0))))}% of the 0.6s before)`
			: "wave compact at the loss"
	const side = q.dl > 0 ? "L" : "R"
	const head = `${ci.name} escaped on ${side} in ${phase}: lost at t ${L.t.toFixed(2)} (hero s ${heroS}, creep ds ${q.ds} dlat ${q.dl}, role ${ROLE[q.role] ?? "?"}), escaped (threshold ahead) at t ${esc.t}; ${splitNote}`
	const lines = []
	for (let i = 0, next = L.t - 1; i < samples.length; i++) {
		const smp = samples[i]
		if (smp.t < next || smp.t > esc.t + 0.05) continue
		next = smp.t + 0.15
		const e = rel(smp)
		const w = smp.w
		lines.push(
			`${smp.t.toFixed(2).padStart(6)} H ${smp.h[2]}/${smp.h[3]} ${(ACTION[smp.a] ?? "-").padEnd(4)} ${ci.name} ds ${String(e?.ds ?? "?").padStart(4)} dlat ${String(e?.dl ?? "?").padStart(4)} ${(ROLE[e?.role] ?? "?").padEnd(8)} key ${name(smp.k)}${w ? ` win ${name(w.lo)}..${name(w.hi)}${w.th !== undefined && w.th >= 0 ? ` threat ${name(w.th)} shift ${w.sf}` : ""} share ${w.sh} (side ${w.ss} speed ${w.sp}) clamp ${w.cl}` : ""} ${smp.lat ?? "?"}ms | ${smp.n ?? ""}`
		)
	}
	return { creep: ci.name, phase, side, tags, head, lines }
}

function saveFreeCurve(curves) {
	const all = fs.existsSync(CURVE_FILE) ? JSON.parse(fs.readFileSync(CURVE_FILE, "utf8")) : {}
	Object.assign(all, curves)
	fs.writeFileSync(CURVE_FILE, JSON.stringify(all))
	curvesCache = all
}

module.exports = {
	ACTION,
	MODE,
	ROLE,
	loadRuns,
	tagOf,
	mean,
	sign,
	creepInfo,
	buildFreeCurve,
	saveFreeCurve,
	freeCurve,
	delayAt,
	lagAt,
	phaseGains,
	events,
	autopsy,
	spreadAt,
	geoOf
}
