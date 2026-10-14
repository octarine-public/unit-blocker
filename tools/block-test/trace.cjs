// Prints a compact timeline of a recorded run: node trace.cjs [runIndexFromEnd=1] [step=0.25] [fromT] [toT]
// Each row: t | hero s/lat | per creep: (s - heroS)/lat with m=moving s=stopped
const { execFileSync } = require("child_process")
const path = require("path")

const back = Number(process.argv[2] ?? 1)
const step = Number(process.argv[3] ?? 0.25)
const from = Number(process.argv[4] ?? 0)
const to = Number(process.argv[5] ?? 1e9)
const code = `JSON.stringify((() => { const run = __bt.runs[__bt.runs.length - ${back}]; return run ? { r: run.r, geo: __bt.geo, samples: run.samples } : null })())`
let out = execFileSync("node", [path.join(__dirname, "inject.cjs"), "-e", code], { maxBuffer: 1 << 28 }).toString()
let data = JSON.parse(out)
if (typeof data === "string") data = JSON.parse(data)
if (data === null) {
	console.log("no run")
	process.exit(0)
}
const { r, geo, samples } = data
console.log(JSON.stringify(r))
console.log(`T2 s=${Math.round(geo.t2.s)} lat=${Math.round(geo.t2.lat)}  T1 s=${Math.round(geo.t1.s)} lat=${Math.round(geo.t1.lat)}`)
let next = from
for (const smp of samples) {
	if (smp.t < next || smp.t > to) continue
	next = smp.t + step
	const [, , hs, hl] = smp.h
	const cs = smp.c
		.map(c => `${String(c[3] - hs).padStart(5)}/${String(c[4]).padStart(4)}${c[5] ? "m" : "s"}`)
		.join(" ")
	console.log(`${smp.t.toFixed(2).padStart(6)} H ${String(hs).padStart(5)}/${String(hl).padStart(4)} | ${cs}`)
}
