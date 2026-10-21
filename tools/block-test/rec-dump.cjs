// Pulls the recorder's (rec.js) finished sessions out of the game into out/rec/: the ones it stored
// in the script store and any it kept in memory. Usage: node rec-dump.cjs [--flush]
// (--flush closes the session being recorded first)
const { execFileSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const inject = expr =>
	JSON.parse(
		execFileSync("node", [path.join(__dirname, "inject.cjs"), "-e", expr, "--timeout", "60000"], {
			maxBuffer: 1 << 30
		}).toString()
	)
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const parse = v => (typeof v === "string" ? JSON.parse(v) : v)

if (inject("typeof __rec") !== "object") inject(fs.readFileSync(path.join(__dirname, "rec.js"), "utf8"))
if (process.argv.includes("--flush")) {
	inject("__rec.flush(); 1")
	sleep(1500)
}
inject("__rec.load()")
let loaded = null
for (let i = 0; i < 120 && loaded === null; i++) {
	sleep(500)
	loaded = parse(inject("globalThis.__recLoaded ?? null"))
}
if (loaded === null) throw new Error("the store did not answer")
if (!Array.isArray(loaded)) throw new Error(loaded.error)
const sessions = [...loaded, ...parse(inject("__rec.take()"))]
const dir = path.join(__dirname, "out", "rec")
fs.mkdirSync(dir, { recursive: true })
for (const s of sessions) {
	const file = path.join(dir, `rec-${Date.now()}-${Math.round(s.start)}.json`)
	fs.writeFileSync(file, JSON.stringify(s))
	console.log(file, `${s.samples.length} samples, ${s.orders.length} orders`)
}
if (sessions.length === 0) console.log("no finished sessions")
