// How well modules/CreepBlock/Predict.ts forecasts the creeps: node forecast.cjs <tag>[*] ... [--horizon 1]
// At every 0.5 s of the key held, the creeps (position, velocity, standing time) and the hero are
// taken from the recording, played `horizon` seconds forward with the hero walking to where it
// really was then, and compared with where the creeps really got to: distance error, and whether a
// stop / walk-round was foreseen.
const fs = require("fs")
const path = require("path")
const ts = require(process.env.TYPESCRIPT ?? "C:/github.com/octarine-private/aio/node_modules/typescript")
const A = require("./analyze.cjs")

const source = fs.readFileSync(path.join(__dirname, "../../modules/CreepBlock/Predict.ts"), "utf8")
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const P = {}
new Function("exports", js)(P)

const args = process.argv.slice(2)
const tags = args.filter(a => !a.startsWith("--") && !/^\d/.test(a))
const hi = args.indexOf("--horizon")
const horizon = hi >= 0 ? Number(args[hi + 1]) : 1
const li = args.indexOf("--hold")
const lookHold = li >= 0 ? Number(args[li + 1]) : 0
// --goal D: creeps head for the lane line D ahead (their next corner) instead of along the lane
const gi = args.indexOf("--goal")
const goalAhead = gi >= 0 ? Number(args[gi + 1]) : 0
// --vel: a creep walking freely now heads the way it walks (its own path), the rest for the lane goal
const velHeading = args.includes("--vel")
const TICK = 1 / 30
const HULL = { melee: 16, ranged: 8, hero: 24 }
const PAD = { melee: 20, ranged: 10 }

let alongE = 0,
	alongSigned = 0,
	latE = 0
const bands = {}
let n = 0,
	err = 0,
	errStill = 0,
	nStill = 0,
	errMove = 0,
	nMove = 0,
	naive = 0
const errs = []
for (const run of A.loadRuns(tags)) {
	const info = new Map((run.meta?.creeps ?? []).map(c => [c.idx, c.ranged ? "ranged" : "melee"]))
	const s = run.samples
	// lane direction from the hero's own lane coordinates: world change per s change over the run
	const a = s.find(x => x.a !== undefined),
		b = [...s].reverse().find(x => x.a !== undefined)
	if (!a || !b) continue
	const tower = run.meta?.geo
	let next = a.t
	for (let i = 2; i < s.length; i++) {
		const x = s[i]
		if (x.a === undefined || x.t < next) continue
		next = x.t + 0.5
		const end = s.find(y => y.t >= x.t + horizon - 1e-6)
		if (!end) break
		// direction of the lane here: from the creeps' (s, lat) to world, two creeps' worth of samples
		const p = s[i - 1]
		const dir = (() => {
			let dx = 0,
				dy = 0
			for (const c of x.c) {
				const q = s[Math.max(0, i - 15)].c.find(r => r[0] === c[0])
				if (q && c[3] - q[3] > 20) {
					const k = 1 / (c[3] - q[3])
					dx += (c[1] - q[1]) * k
					dy += (c[2] - q[2]) * k
				}
			}
			const l = Math.hypot(dx, dy)
			return l > 0 ? [dx / l, dy / l] : [Math.SQRT1_2, Math.SQRT1_2]
		})()
		const goalDir = lat => {
			if (!(goalAhead > 0)) return dir
			const gx = dir[0] * goalAhead + dir[1] * lat,
				gy = dir[1] * goalAhead - dir[0] * lat,
				l = Math.hypot(gx, gy)
			return [gx / l, gy / l]
		}
		const creeps = []
		const ids = []
		for (const c of x.c) {
			const kind = info.get(c[0])
			if (!kind) continue
			const q = p.c.find(r => r[0] === c[0])
			if (!q) continue
			// standing time: ticks unchanged going back
			let still = 0
			for (let j = i; j > 0; j--) {
				const u = s[j].c.find(r => r[0] === c[0]),
					v = s[j - 1].c.find(r => r[0] === c[0])
				if (!u || !v || Math.hypot(u[1] - v[1], u[2] - v[2]) > 0.5) break
				still += s[j].t - s[j - 1].t
			}
			const vx = (c[1] - q[1]) / (x.t - p.t),
				vy = (c[2] - q[2]) / (x.t - p.t),
				speed = Math.hypot(vx, vy)
			const near = Math.hypot(c[1] - x.h[0], c[2] - x.h[1]) < HULL[kind] + 32 + HULL.hero + 20
			const sc = {
				x: c[1],
				y: c[2],
				gx: velHeading && speed > 250 ? vx / speed : goalDir(c[4])[0],
				gy: velHeading && speed > 250 ? vy / speed : goalDir(c[4])[1],
				speed: 325,
				hull: HULL[kind],
				pad: PAD[kind],
				wait: still > 0 ? Math.max(0.03, (near ? P.SimLookWait : P.SimHardWait) - still) : 0,
				wx: 0,
				wy: 0,
				detour: false
			}
			if (speed > 80 && (vx * dir[0] + vy * dir[1]) / speed < Math.cos(0.35)) {
				sc.wx = c[1] + (vx / speed) * 80
				sc.wy = c[2] + (vy / speed) * 80
				sc.detour = true
			}
			creeps.push(sc)
			ids.push([c[0], still > 0, c[1] + vx * horizon, c[2] + vy * horizon])
		}
		const hv = [(x.h[0] - p.h[0]) / (x.t - p.t), (x.h[1] - p.h[1]) / (x.t - p.t)]
		// --target: the hero walks straight to where it got to (as the planner's candidates do);
		// otherwise it follows its recorded path tick by tick
		const path = args.includes("--target") ? undefined : s.filter(y => y.t > x.t && y.t <= x.t + horizon + 1e-6).map(y => [y.h[0], y.h[1]])
		const unit = { x: x.h[0], y: x.h[1], hull: HULL.hero, speed: run.meta?.heroSpeed ?? 280, tx: end.h[0], ty: end.h[1], vx: hv[0], vy: hv[1], delay: 0, path }
		const simResult = P.Simulate(creeps, unit, [], dir, horizon, TICK, lookHold)
		creeps.forEach((c, k) => {
			const real = end.c.find(r => r[0] === ids[k][0])
			if (!real) return
			const e = Math.hypot(c.x - real[1], c.y - real[2])
			const ne = Math.hypot(ids[k][2] - real[1], ids[k][3] - real[2])
			const ex = c.x - real[1],
				ey = c.y - real[2]
			alongE += Math.abs(ex * dir[0] + ey * dir[1])
			alongSigned += ex * dir[0] + ey * dir[1]
			// by the creep's distance to the hero at the start: near (in reach) or a follower further back
			const d0 = Math.hypot(x.c.find(r => r[0] === ids[k][0])[1] - x.h[0], x.c.find(r => r[0] === ids[k][0])[2] - x.h[1])
			const band = d0 < 100 ? "near" : d0 < 200 ? "mid" : "far"
			const bb = (bands[band] ??= { n: 0, along: 0 })
			bb.n++
			bb.along += ex * dir[0] + ey * dir[1]
			let realStood = 0,
				realStops = 0,
				wasStill = false
			for (let j = i + 1; j < s.length && s[j].t <= x.t + horizon + 1e-6; j++) {
				const u = s[j].c.find(r => r[0] === ids[k][0]),
					v = s[j - 1].c.find(r => r[0] === ids[k][0])
				const still = u && v && Math.hypot(u[1] - v[1], u[2] - v[2]) < 0.5
				if (still) realStood += s[j].t - s[j - 1].t
				if (still && !wasStill && j > i + 1) realStops++
				wasStill = still
			}
			bb.real = (bb.real ?? 0) + realStood
			bb.sim = (bb.sim ?? 0) + simResult.stood[k]
			bb.realStops = (bb.realStops ?? 0) + realStops
			bb.simStops = (bb.simStops ?? 0) + simResult.stops[k]
			latE += Math.abs(-ex * dir[1] + ey * dir[0])
			n++
			err += e
			naive += ne
			errs.push(e)
			if (ids[k][1]) {
				nStill++
				errStill += e
			} else {
				nMove++
				errMove += e
			}
		})
	}
}
errs.sort((a, b) => a - b)
const pct = p => (errs.length ? errs[Math.floor(p * errs.length)].toFixed(0) : "-")
console.log(
	"along-lane bias by start distance to the hero: " +
		Object.entries(bands)
			.map(([b, v]) => `${b} ${(v.along / v.n).toFixed(1)} (${v.n}, stood real ${(v.real / v.n).toFixed(2)}s sim ${(v.sim / v.n).toFixed(2)}s, stops real ${(v.realStops / v.n).toFixed(2)} sim ${(v.simStops / v.n).toFixed(2)})`)
			.join(", ")
)
console.log(
	`along the lane |error| ${(alongE / n).toFixed(1)} (mean ${(alongSigned / n).toFixed(1)}, + = forecast too far on), across ${(latE / n).toFixed(1)}`
)
console.log(
	`creep positions ${horizon}s ahead, ${n} cases: forecast error mean ${(err / n).toFixed(1)} (median ${pct(0.5)}, p90 ${pct(0.9)}), straight-line guess ${(naive / n).toFixed(1)}; standing at the start ${(errStill / nStill).toFixed(1)} (${nStill}), walking ${(errMove / nMove).toFixed(1)} (${nMove})`
)
