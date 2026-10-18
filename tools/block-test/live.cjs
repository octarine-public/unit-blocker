// Live scoreboard of the running series: node live.cjs [tagPrefix ...]
// Reads out/results2.jsonl (series.cjs and ab.cjs append every attempt there) every 2 s and prints,
// per config, clean attempts, failed ones (a creep got more than escapeAhead past the hero) with the
// creep and where, the mean gain of the clean ones and the last attempts in order.
const fs = require("fs")
const path = require("path")

const prefixes = process.argv.slice(2)
const file = path.join(__dirname, "out", "results2.jsonl")
const baselines = JSON.parse(fs.readFileSync(path.join(__dirname, "out", "baseline.json"), "utf8"))
const started = Date.now()

function read() {
	if (!fs.existsSync(file)) return []
	return fs
		.readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map(line => {
			try {
				return JSON.parse(line)
			} catch {
				return undefined
			}
		})
		.filter(r => r && r.n > 0 && r.mode === "block")
		.filter(r => (prefixes.length ? prefixes.some(p => r.tag.startsWith(p)) : Date.parse(r.at) >= started))
}

function render() {
	const rows = new Map()
	for (const r of read()) {
		const row = rows.get(r.tag) ?? { ok: 0, fail: 0, gains: [], last: [], fails: [] }
		const lane = r.opts?.lane ?? "mid"
		const base = baselines[`${lane}:${r.opts?.melee ?? 3}:${r.opts?.ranged ?? 1}`]?.t1Mean ?? 0
		if (r.failed) {
			row.fail++
			const e = r.escape ?? r.escapeRanged
			row.fails.push(e ? `t ${e.t}s s ${e.s}${r.escape ? "" : " (ranged)"}` : "?")
		} else {
			row.ok++
			if (r.t1Mean !== null) row.gains.push(r.t1Mean - base)
		}
		row.last.push(r.failed ? "X" : ".")
		rows.set(r.tag, row)
	}
	const lines = []
	const now = new Date().toLocaleTimeString()
	lines.push(`Creep block series ${prefixes.length ? prefixes.join(" ") : "(since start)"}   ${now}`)
	lines.push("")
	lines.push(`${"config".padEnd(18)} ${"runs".padStart(4)} ${"clean".padStart(5)} ${"FAIL".padStart(4)}  ${"gain".padStart(6)}  last attempts (. clean, X creep got by)`)
	lines.push("-".repeat(86))
	for (const [tag, row] of rows) {
		const runs = row.ok + row.fail
		const gain = row.gains.length ? row.gains.reduce((a, b) => a + b, 0) / row.gains.length : NaN
		const g = Number.isFinite(gain) ? (gain >= 0 ? "+" : "") + gain.toFixed(2) : "  -"
		lines.push(
			`${tag.padEnd(18)} ${String(runs).padStart(4)} ${String(row.ok).padStart(5)} ${String(row.fail).padStart(4)}  ${g.padStart(6)}  ${row.last.slice(-40).join("")}`
		)
		for (const f of row.fails.slice(-3)) lines.push(`${"".padEnd(18)}   creep got by: ${f}`)
	}
	if (rows.size === 0) lines.push("no attempts yet")
	lines.push("")
	lines.push("FAIL = a creep got more than 150 ahead of the hero along the lane while the key was held")
	process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n") + "\n")
}

render()
setInterval(render, 2000)
