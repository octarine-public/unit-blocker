// node plan-trace.cjs <backIndex> <from> <to> [step]
const { execFileSync } = require("child_process")
const path = require("path")
const [back = 1, from = 0, to = 1e9, step = 0.1] = process.argv.slice(2).map(v => (v.endsWith(".json") ? 1 : Number(v)))
const fs = require("fs")
let d
if (process.argv[2] && process.argv[2].endsWith(".json")) {
	d = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
} else {
	d = JSON.parse(execFileSync("node", [path.join(__dirname, "inject.cjs"), "-e", `JSON.stringify(__bt.runs[__bt.runs.length-${back}])`], { maxBuffer: 1 << 28 }).toString())
	if (typeof d === "string") d = JSON.parse(d)
}
console.log(JSON.stringify(d.r))
const A = ["Wait", "Hold", "Move", "Race"]
let next = from
for (const s of d.samples) {
	if (s.t < next || s.t > to) continue
	next = s.t + step
	const [hx, hy, hs, hl] = s.h
	const cs = s.c.map(c => `${c[0] === s.k ? "*" : " "}${String(c[3] - hs).padStart(5)}/${String(c[4]).padStart(4)}${c[5] ? "m" : "s"}`).join(" ")
	const tg = s.tg ? `tg(${s.tg[0] - hx},${s.tg[1] - hy})` : ""
	console.log(`${s.t.toFixed(2)} ${String(s.lat ?? "").padStart(3)}ms H ${hs}/${hl} ${(A[s.a] ?? "-").padEnd(4)} ${tg.padEnd(14)}| ${cs} | ${s.n ?? ""}`)
}
