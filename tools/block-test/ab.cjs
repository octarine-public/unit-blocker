// Interleaved comparison: one attempt of every config per round, so drift in the game hits all of
// them alike. node ab.cjs '{"rounds":10,"base":{"hero":"pudge"},"configs":{"r1":{},"s25":{"tune":{"speedLeadTime":2.5}}}}'
// Each config's runs are saved under its tag (`<name>` or `<name>-<hero>`); a config is dropped after
// `maxFail` failures. Prints every attempt and a report per config at the end.
const net = require("net")
const fs = require("fs")
const path = require("path")
const A = require("./analyze.cjs")
const { seriesReport } = require("./report.cjs")

const spec = JSON.parse(process.argv[2] ?? "{}")
const rounds = spec.rounds ?? 10
const maxFail = spec.maxFail ?? 99
const outFile = path.join(__dirname, "out", "results2.jsonl")
fs.mkdirSync(path.join(__dirname, "out", "runs"), { recursive: true })

function evalInGame(code) {
	return new Promise((resolve, reject) => {
		const tag = "ab-" + process.pid + "-" + Date.now() + Math.random()
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
const retry = async code => {
	for (let i = 0; ; i++) {
		try {
			return await evalInGame(code)
		} catch (e) {
			if (i >= 5) throw e
			await sleep(1000)
		}
	}
}

async function attempt(opts) {
	const before = await retry("__bt.results.length")
	await retry(`JSON.stringify(__bt.run(${JSON.stringify({ ...opts, n: 1, pause: 1 })}))`)
	const t0 = Date.now()
	for (;;) {
		await sleep(1500)
		const st = await retry("JSON.stringify(__bt.status())")
		if (st.results > before && st.queue <= 0 && st.phase === null) break
		if (Date.now() - t0 > 120000) {
			await retry("__bt.stop(); 1")
			return undefined
		}
	}
	const run = await retry("JSON.stringify(__bt.runs[__bt.runs.length - 1])")
	const file = `${run.r.tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`
	fs.writeFileSync(path.join(__dirname, "out", "runs", file), JSON.stringify(run))
	fs.appendFileSync(outFile, JSON.stringify({ ...run.r, opts, at: new Date().toISOString() }) + "\n")
	return file
}

;(async () => {
	const baselines = JSON.parse(fs.readFileSync(path.join(__dirname, "out", "baseline.json"), "utf8"))
	const configs = Object.entries(spec.configs ?? {}).map(([name, cfg]) => {
		const opts = { mode: "block", lane: "mid", melee: 3, ranged: 1, ...spec.base, ...cfg }
		opts.tag = cfg.tag ?? (spec.base?.hero ? `${name}-${spec.base.hero}` : name)
		return { name, opts, files: [], fails: 0, dropped: false }
	})
	for (let round = 1; round <= rounds; round++) {
		for (const c of configs) {
			if (c.dropped) continue
			const file = await attempt(c.opts)
			if (file === undefined) {
				console.log(`${c.opts.tag.padEnd(14)} timeout`)
				continue
			}
			c.files.push(file)
			const { r } = JSON.parse(fs.readFileSync(path.join(__dirname, "out", "runs", file), "utf8"))
			const base = baselines[`${c.opts.lane}:${c.opts.melee}:${c.opts.ranged}`] ?? { t1Mean: 0 }
			if (r.failed) c.fails++
			const esc = r.escape ?? r.escapeRanged
			console.log(
				`r${String(round).padStart(2)} ${c.opts.tag.padEnd(14)} ${r.failed ? "FAIL" : "ok  "} ${r.t1Mean === null ? "   -  " : A.sign(r.t1Mean - base.t1Mean)}` +
					(esc ? `  esc t${esc.t} s${esc.s}` : "")
			)
			if (c.fails >= maxFail) {
				c.dropped = true
				console.log(`${c.opts.tag} dropped: ${c.fails} failures`)
			}
		}
	}
	console.log("")
	for (const c of configs) {
		const runs = A.loadRuns([c.opts.tag]).filter(run => c.files.includes(run.file))
		console.log(seriesReport(runs, { title: c.opts.tag }) + "\n")
	}
	process.exit(0)
})()
