// Interleaved comparison: one attempt of every config per round, so drift in the game hits all of
// them alike. node ab.cjs '{"rounds":10,"base":{"hero":"pudge"},"configs":{"r1":{},"s25":{"tune":{"speedLeadTime":2.5}}}}'
// Each config's runs are saved under its tag (`<name>` or `<name>-<hero>`); a config is dropped after
// `maxFail` failures (a lost creep, or with `minAttemptGain` an attempt gaining less than that). Prints every attempt and a report per config at the end.
const net = require("net")
const fs = require("fs")
const path = require("path")
const A = require("./analyze.cjs")
const { seriesReport } = require("./report.cjs")

const spec = JSON.parse(process.argv[2] ?? "{}")
const rounds = spec.rounds ?? 10
const maxFail = spec.maxFail ?? 99
// a config that blocks too little is dropped too: mean gain of its clean attempts below minGain once it has minGainAfter of them
const minGain = spec.minGain ?? -Infinity
const minGainAfter = spec.minGainAfter ?? 6
// an attempt that keeps every creep but gains less than this at T1 counts as a failure too (LOW)
const minAttemptGain = spec.minAttemptGain ?? -Infinity
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
	let t0 = Date.now(),
		waited = false
	for (;;) {
		await sleep(1500)
		const st = await retry("JSON.stringify(__bt.status())")
		if (st.results > before && st.queue <= 0 && st.phase === null) break
		// the harness holds the attempt back while the game window is minimized: no timeout then
		if (st.waiting) {
			if (!waited) console.log(`   waiting: ${st.waiting}`)
			waited = true
			t0 = Date.now()
		}
		if (Date.now() - t0 > 120000) {
			await retry("__bt.stop(); 1")
			return undefined
		}
	}
	const run = await retry("JSON.stringify(__bt.runs[__bt.runs.length - 1])")
	// an attempt the game was minimized or starved in does not count: saved under void-<tag>
	const voided = run.r.minimized || run.r.slowFrames > 10
	const tag = voided ? `void-${run.r.tag}` : run.r.tag
	const file = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`
	fs.writeFileSync(path.join(__dirname, "out", "runs", file), JSON.stringify(run))
	fs.appendFileSync(outFile, JSON.stringify({ ...run.r, tag, opts, at: new Date().toISOString() }) + "\n")
	return { file, voided }
}

;(async () => {
	const baselines = JSON.parse(fs.readFileSync(path.join(__dirname, "out", "baseline.json"), "utf8"))
	const configs = Object.entries(spec.configs ?? {}).map(([name, cfg]) => {
		const opts = { mode: "block", lane: "mid", melee: 3, ranged: 1, ...spec.base, ...cfg }
		opts.tag = cfg.tag ?? (spec.base?.hero ? `${name}-${spec.base.hero}` : name)
		opts.freeT1 = baselines[`${opts.lane}:${opts.melee}:${opts.ranged}`]?.t1Mean
		return { name, opts, files: [], fails: 0, gains: [], dropped: false }
	})
	for (let round = 1; round <= rounds; round++) {
		for (const c of configs) {
			if (c.dropped) continue
			let res
			for (let tries = 0; tries < 6; tries++) {
				res = await attempt(c.opts)
				if (res === undefined || !res.voided) break
				console.log(`r${String(round).padStart(2)} ${c.opts.tag.padEnd(14)} void (game minimized or stalled), repeating`)
			}
			if (res === undefined || res.voided) {
				console.log(`${c.opts.tag.padEnd(14)} ${res === undefined ? "timeout" : "void six times, skipped"}`)
				continue
			}
			const file = res.file
			c.files.push(file)
			const { r } = JSON.parse(fs.readFileSync(path.join(__dirname, "out", "runs", file), "utf8"))
			const base = baselines[`${c.opts.lane}:${c.opts.melee}:${c.opts.ranged}`] ?? { t1Mean: 0 }
			const low = !r.failed && (r.t1Mean === null || r.t1Mean - base.t1Mean < minAttemptGain)
			if (r.failed || low) c.fails++
			const esc = r.escape ?? r.escapeRanged
			console.log(
				`r${String(round).padStart(2)} ${c.opts.tag.padEnd(14)} ${r.failed ? "FAIL" : low ? "LOW " : "ok  "} ${r.t1Mean === null ? "   -  " : A.sign(r.t1Mean - base.t1Mean)}` +
					(esc ? `  esc t${esc.t} s${esc.s}` : "") +
					(r.slowFrames ? `  game stalled: ${r.slowFrames} slow frames, gap ${r.maxGap}s` : "")
			)
			if (!r.failed && r.t1Mean !== null) c.gains.push(r.t1Mean - base.t1Mean)
			const meanGain = c.gains.length ? c.gains.reduce((a, b) => a + b, 0) / c.gains.length : NaN
			if (c.fails >= maxFail) {
				c.dropped = true
				console.log(`${c.opts.tag} dropped: ${c.fails} failures (a lost creep or under +${minAttemptGain} s)`)
			} else if (c.gains.length >= minGainAfter && meanGain < minGain) {
				c.dropped = true
				console.log(`${c.opts.tag} dropped: blocks too little, mean +${meanGain.toFixed(2)} s < +${minGain}`)
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
