// Situation right before each escape across saved runs: node escapes.cjs tagPrefix [tagPrefix...]
const fs = require("fs")
const path = require("path")
const prefixes = process.argv.slice(2)
const dir = path.join(__dirname, "out", "runs")
const files = fs.readdirSync(dir).filter(f => prefixes.some(p => f.startsWith(p)))
const A = ["Wait", "Hold", "Move", "Race"]
let total = 0
const zones = {}
for (const file of files) {
	const run = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
	const { r, samples } = run
	for (const kind of ["escape", "escapeRanged"]) {
		const esc = r[kind]
		if (!esc) continue
		total++
		const zone = esc.s < 2000 ? "start<2000" : esc.s < 2700 ? "T2 2000-2700" : esc.s < 4300 ? "mid 2700-4300" : "T1 >4300"
		zones[zone] = (zones[zone] ?? 0) + 1
		const at = samples.findIndex(s => s.t >= esc.t)
		const escaping = samples[at]?.c.find(c => Math.round(c[3]) === esc.s) ?? samples[at]?.c.reduce((a, c) => (c[3] > a[3] ? c : a))
		if (!escaping) continue
		const idx = escaping[0]
		let alongside = at
		while (alongside > 0) {
			const s = samples[alongside],
				c = s.c.find(q => q[0] === idx)
			if (!c || c[3] - s.h[2] < -60) break
			alongside--
		}
		const show = i => {
			const s = samples[i]
			if (!s) return ""
			const c = s.c.find(q => q[0] === idx)
			const lats = s.c.map(q => q[4])
			return `t${s.t.toFixed(2)} ds${c ? c[3] - s.h[2] : "?"} dlat${c ? c[4] - s.h[3] : "?"} ${A[s.a] ?? "-"} key${s.k === idx ? "=esc" : "!=esc"} spread${Math.max(...lats) - Math.min(...lats)} ${s.n ?? ""}`
		}
		console.log(`${file.slice(0, 22)} ${kind === "escape" ? "MELEE " : "RANGED"} ${zone.padEnd(14)} before: ${show(alongside)} | at: ${show(at)}`)
	}
}
console.log("escapes", total, JSON.stringify(zones))
