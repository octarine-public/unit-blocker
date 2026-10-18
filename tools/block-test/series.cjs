// Runs a series through __bt and waits for it: node series.cjs '{"tag":"x","n":5}' [--no-start]
// Appends every result to out/results.jsonl and prints a summary against the free baseline.
const net = require("net")
const fs = require("fs")
const path = require("path")

const opts = JSON.parse(process.argv[2] ?? "{}")
const noStart = process.argv.includes("--no-start")
const outFile = path.join(__dirname, "out", "results2.jsonl")
fs.mkdirSync(path.join(__dirname, "out", "runs"), { recursive: true })
const saved = []

function evalInGame(code) {
	return new Promise((resolve, reject) => {
		const tag = "series-" + process.pid + "-" + Date.now() + Math.random()
		const socket = net.connect(9223, "127.0.0.1")
		let buffer = ""
		const timer = setTimeout(() => {
			socket.destroy()
			reject(new Error("timeout"))
		}, 15000)
		socket.on("connect", () => socket.write(JSON.stringify({ op: "eval", code, tag }) + "\n"))
		socket.on("data", chunk => {
			buffer += chunk.toString("utf8")
			const lines = buffer.split("\n")
			buffer = lines.pop()
			for (const line of lines) {
				let msg
				try {
					msg = JSON.parse(line)
				} catch {
					continue
				}
				if (msg.ev === "result" && msg.tag === tag) {
					clearTimeout(timer)
					socket.end()
					if (!msg.ok) return reject(new Error(msg.text))
					let value = msg.text
					for (let i = 0; i < 2 && typeof value === "string"; i++) {
						try {
							value = JSON.parse(value)
						} catch {
							break
						}
					}
					resolve(value)
				}
			}
		})
		socket.on("error", reject)
	})
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const baseFile = path.join(__dirname, "out", "baseline.json")
const baselines = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, "utf8")) : {}
const full = { mode: "block", lane: "mid", melee: 3, ranged: 1, ...opts }
const baseKey = `${full.lane}:${full.melee}:${full.ranged}`
const FREE = baselines[baseKey] ?? { t1First: 0, t1Mean: 0, finish: 0 }

function fmt(r) {
	const d = (v, b) => (v === null ? "  -  " : (v - b >= 0 ? "+" : "") + (v - b).toFixed(2))
	const e1 = r.escape ? `ESC@${r.escape.t}s s${r.escape.s} lat${r.escape.lat} hero(${r.escape.heroS},${r.escape.heroLat})` : ""
	const e2 = r.escapeRanged ? ` rng@${r.escapeRanged.t}s s${r.escapeRanged.s} lat${r.escapeRanged.lat}` : ""
	const esc = e1 + e2
	const fail = r.failed ? (r.why === "escape" ? "FAIL(abort) " : "FAIL ") : "ok   "
	return `${fail}${r.tag.padEnd(10)} T1 ${d(r.t1First, FREE.t1First)} mean ${d(r.t1Mean, FREE.t1Mean)} fin ${d(r.finish, FREE.finish)} t2 ${r.t2} t1 ${r.t1} ahead ${r.maxAhead} ${esc}`
}

const humanFile = path.join(__dirname, "out", "human.json")
const human = fs.existsSync(humanFile) ? JSON.parse(fs.readFileSync(humanFile, "utf8"))[baseKey] : undefined

/** A config is dropped early once it fails too often or clearly trails the recorded human blocks. */
function Reject(results) {
	if (full.mode !== "block") return undefined
	const fails = results.filter(r => r.failed).length
	const maxFail = full.maxFail ?? 3
	if (fails >= maxFail) return `${fails} failed attempts`
	const ok = results.filter(r => !r.failed && r.t1Mean !== null)
	if (human !== undefined && full.vsHuman !== false && ok.length >= 4) {
		const avg = ok.reduce((a, r) => a + r.t1Mean, 0) / ok.length - FREE.t1Mean
		if (avg < human.t1Mean - (full.humanMargin ?? 0.5)) return `mean +${avg.toFixed(2)}s trails human +${human.t1Mean.toFixed(2)}s`
	}
	return undefined
}

;(async () => {
	const startCount = await evalInGame("__bt.results.length")
	if (!noStart) await evalInGame(`JSON.stringify(__bt.run(${JSON.stringify({ ...opts, freeT1: FREE.t1Mean })}))`)
	const t0 = Date.now()
	let printed = startCount
	for (;;) {
		await sleep(2500)
		let st
		try {
			st = await evalInGame("JSON.stringify(__bt.status())")
		} catch (e) {
			console.error("poll failed:", e.message)
			continue
		}
		if (st.results > printed) {
			const fresh = await evalInGame(`JSON.stringify(__bt.results.slice(${printed}))`)
			const runs = await evalInGame(`JSON.stringify(__bt.runs.slice(-${fresh.length}))`)
			for (const run of runs) {
				const file = path.join(__dirname, "out", "runs", `${run.r.tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`)
				fs.writeFileSync(file, JSON.stringify(run))
				saved.push(path.basename(file))
			}
			for (const r of fresh) {
				console.log(fmt(r))
				fs.appendFileSync(outFile, JSON.stringify({ ...r, opts, at: new Date().toISOString() }) + "\n")
			}
			printed = st.results
			const done = await evalInGame(`JSON.stringify(__bt.results.slice(${startCount}))`)
			const verdict = Reject(done)
			if (verdict !== undefined) {
				await evalInGame("__bt.stop(); 1")
				console.log("REJECTED: " + verdict)
				break
			}
		}
		if (st.queue <= 0 && st.phase === null) break
		if (Date.now() - t0 > 15 * 60 * 1000) break
	}
	const all = await evalInGame(`JSON.stringify(__bt.results.slice(${startCount}))`)
	const block = all.filter(r => r.n > 0)
	const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
	const vals = k => block.map(r => r[k]).filter(v => v !== null)
	if (full.mode === "free" && block.length > 0 && (baselines[baseKey] === undefined || opts.saveBaseline)) {
		baselines[baseKey] = {
			t1First: +mean(vals("t1First")).toFixed(2),
			t1Mean: +mean(vals("t1Mean")).toFixed(2),
			finish: +mean(vals("finish")).toFixed(2)
		}
		fs.writeFileSync(baseFile, JSON.stringify(baselines, null, 1))
	}
	if (full.mode === "manual" && block.length > 0) {
		const ok = block.filter(r => !r.failed)
		const humans = fs.existsSync(humanFile) ? JSON.parse(fs.readFileSync(humanFile, "utf8")) : {}
		const okVals = k => ok.map(r => r[k]).filter(v => v !== null)
		humans[baseKey] = {
			t1First: +(mean(okVals("t1First")) - FREE.t1First).toFixed(2),
			t1Mean: +(mean(okVals("t1Mean")) - FREE.t1Mean).toFixed(2),
			attempts: block.length,
			clean: ok.length
		}
		fs.writeFileSync(humanFile, JSON.stringify(humans, null, 1))
		console.log("HUMAN reference saved: " + JSON.stringify(humans[baseKey]))
	}
	const okRuns = block.filter(r => !r.failed)
	const okMean = k => mean(okRuns.map(r => r[k]).filter(v => v !== null))
	console.log(`CLEAN ${okRuns.length}/${block.length}  clean T1first +${(okMean("t1First") - FREE.t1First).toFixed(2)} clean T1mean +${(okMean("t1Mean") - FREE.t1Mean).toFixed(2)}`)
	console.log(
		`SUMMARY ${opts.tag ?? ""} n=${block.length} T1first ${(mean(vals("t1First")) - FREE.t1First).toFixed(2)} T1mean ${(mean(vals("t1Mean")) - FREE.t1Mean).toFixed(2)} finish ${(mean(vals("finish")) - FREE.finish).toFixed(2)} escapes ${block.filter(r => r.escape).length}`
	)
	if (saved.length > 0 && full.mode !== "free") {
		const A = require("./analyze.cjs")
		const { seriesReport } = require("./report.cjs")
		const runs = A.loadRuns([...new Set(saved.map(A.tagOf))]).filter(run => saved.includes(run.file))
		console.log("")
		console.log(seriesReport(runs, { title: opts.tag }))
	}
	process.exit(0)
})()
