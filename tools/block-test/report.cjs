// Series report from saved runs.
//   node report.cjs <tag> [tag...] [--detail]   summary, time gained per phase, failure autopsies
//   node report.cjs <tag> --events [n]          event log of attempt n (1-based, default: all)
//   node report.cjs --free                      rebuild out/free-curve.json from the free-* runs
// A trailing * in a tag matches a prefix (r1-*).
const fs = require("fs")
const path = require("path")
const A = require("./analyze.cjs")

const human = (() => {
	const file = path.join(__dirname, "out", "human.json")
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
})()
const baselines = (() => {
	const file = path.join(__dirname, "out", "baseline.json")
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
})()

const sd = a => {
	const m = A.mean(a)
	return Math.sqrt(A.mean(a.map(v => (v - m) ** 2)))
}

function seriesReport(runs, { detail = false, title } = {}) {
	const out = []
	if (runs.length === 0) return "no runs"
	const first = runs[0]
	const lane = first.meta?.lane ?? "mid"
	const key = `${lane}:${(first.meta?.creeps ?? []).filter(c => !c.ranged).length || 3}:${(first.meta?.creeps ?? []).filter(c => c.ranged).length || 1}`
	const base = baselines[key]
	const clean = runs.filter(run => !run.r.failed && run.r.t1Mean !== null)
	const t1 = clean.map(run => run.r.t1Mean - (base?.t1Mean ?? 0))
	const h = human[key]
	out.push(
		`== ${title ?? A.tagOf(first.file)}  ${first.meta?.hero ?? first.r.hero} ${lane}  attempts ${runs.length}  clean ${clean.length}/${runs.length}` +
			(clean.length ? `  T1 mean +${A.mean(t1).toFixed(2)} ±${sd(t1).toFixed(2)}` : "") +
			(h ? `  (human +${h.t1Mean.toFixed(2)})` : "")
	)
	// time gained per phase: clean attempts, and where the failed ones broke
	const phases = new Map()
	for (const run of runs) {
		for (const p of A.phaseGains(run)) {
			if (!phases.has(p.name)) phases.set(p.name, { name: p.name, froms: [], tos: [], gains: [], times: [], frees: [], failed: 0 })
			const acc = phases.get(p.name)
			acc.froms.push(p.from)
			acc.tos.push(p.to)
			acc.frees.push(p.free)
			if (!run.r.failed && p.gain !== undefined) {
				acc.gains.push(p.gain)
				acc.times.push(p.time)
			}
		}
	}
	const failures = runs.map((run, i) => ({ i: i + 1, run, a: A.autopsy(run) })).filter(f => f.a)
	for (const f of failures) {
		const acc = phases.get(f.a.phase)
		if (acc) acc.failed++
	}
	if (phases.size && A.freeCurve(first) !== undefined) {
		out.push("phase      s range      gain (clean)    time (free)   failed here")
		let total = 0
		const order = ["contact", "settle", "T2 pass", "between", "T1 pass"]
		for (const p of [...phases.values()].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))) {
			const g = A.mean(p.gains),
				t = A.mean(p.times)
			p.from = Math.round(A.mean(p.froms))
			p.to = Math.round(A.mean(p.tos))
			p.free = A.mean(p.frees)
			if (!Number.isNaN(g)) total += g
			out.push(
				`${p.name.padEnd(10)} ${`${p.from}-${p.to}`.padEnd(12)} ${Number.isNaN(g) ? "   -   " : A.sign(g)} ±${(p.gains.length ? sd(p.gains) : 0).toFixed(2)}   ${Number.isNaN(t) ? "  -  " : t.toFixed(2) + "s"} (${p.free.toFixed(2)}s)   ${p.failed || ""}`
			)
		}
		out.push(`total      ${A.sign(total)} (sum of phases)`)
	} else if (A.freeCurve(first) === undefined) {
		out.push("(no free-wave curve for this lane: run a free series and `node report.cjs --free`)")
	}
	if (failures.length) {
		const count = new Map()
		for (const f of failures) for (const t of f.a.tags) count.set(t, (count.get(t) ?? 0) + 1)
		out.push(`failures ${failures.length}: ` + [...count].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} x${n}`).join("; "))
		for (const f of failures) {
			out.push(`-- attempt ${f.i}: ${f.a.head}`)
			out.push(`   ${f.a.tags.join("; ")}`)
			if (detail) for (const line of f.a.lines) out.push("   " + line)
		}
	}
	return out.join("\n")
}

module.exports = { seriesReport }

if (require.main === module) {
	const args = process.argv.slice(2)
	if (args.includes("--free")) {
		const curves = A.buildFreeCurve(A.loadRuns(["free*"]))
		A.saveFreeCurve(curves)
		for (const [k, c] of Object.entries(curves)) {
			console.log(`${k}: ${c.runs} runs, up to s ${(c.t.length - 1) * c.grid}`)
		}
		process.exit(0)
	}
	const tags = args.filter(a => !a.startsWith("--") && !/^\d+$/.test(a))
	const runs = A.loadRuns(tags)
	const ev = args.indexOf("--events")
	if (ev >= 0) {
		const n = Number(args[ev + 1])
		const pick = Number.isInteger(n) && n > 0 ? [[n, runs[n - 1]]] : runs.map((run, i) => [i + 1, run])
		for (const [i, run] of pick) {
			if (run === undefined) continue
			const r = run.r
			console.log(`== attempt ${i} ${run.file}  ${r.failed ? "FAILED" : "clean"}  T1 mean ${r.t1Mean ?? "-"}  why ${r.why}`)
			const gains = A.phaseGains(run)
			if (gains.length) console.log("phases: " + gains.map(p => `${p.name} ${p.gain === undefined ? "-" : A.sign(p.gain)}`).join(" | "))
			for (const line of A.events(run)) console.log(line)
			const a = A.autopsy(run)
			if (a) {
				console.log(a.head)
				console.log("   " + a.tags.join("; "))
				for (const line of a.lines) console.log("   " + line)
			}
		}
		process.exit(0)
	}
	const byTag = new Map()
	for (const run of runs) {
		const tag = A.tagOf(run.file)
		if (!byTag.has(tag)) byTag.set(tag, [])
		byTag.get(tag).push(run)
	}
	for (const list of byTag.values()) console.log(seriesReport(list, { detail: args.includes("--detail") }) + "\n")
}
