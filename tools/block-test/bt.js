// Creep block test harness for the fps_benchmark custom game (creep_block_* commands).
// Inject with: node inject.cjs bt.js   then drive through globalThis.__bt.
;(() => {
	if (globalThis.__bt?.dispose) globalThis.__bt.dispose()

	const FINISH_RADIUS = 200
	const TEAM = 2

	const LANES = { top: 1, mid: 2, bot: 3 }
	let segs = []
	let path = []
	let geo = null

	function buildPath(lane) {
		const corners = EntityManager.GetEntitiesByClass(CreepPathCorner)
		const byName = new Map(corners.map(c => [c.SelfTargetName.replace(/^\[PR#\]/, ""), c]))
		const spawner = EntityManager.GetEntitiesByClass(LaneCreepSpawner).find(
			s => s.Team === TEAM && s.Lane === LANES[lane]
		)
		const pts = []
		let c = byName.get(`lane_${lane}_pathcorner_goodguys_1`)
		bt.spawner = spawner ? [spawner.Position.x, spawner.Position.y] : null
		if (spawner && c?.TargetPath) {
			const a = c.Position.Subtract(spawner.Position)
			const b = c.TargetPath.Position.Subtract(c.Position)
			if (a.x * b.x + a.y * b.y > 0) pts.push([spawner.Position.x, spawner.Position.y])
		}
		const seen = new Set()
		while (c !== undefined && !seen.has(c)) {
			seen.add(c)
			pts.push([c.Position.x, c.Position.y])
			c = c.TargetPath
		}
		return pts
	}

	// arc length along the lane and signed lateral offset (positive = left of travel direction)
	function project(x, y) {
		let best = null
		for (const g of segs) {
			let t = (x - g.ax) * g.dx + (y - g.ay) * g.dy
			t = Math.max(0, Math.min(g.len, t))
			const px = g.ax + g.dx * t
			const py = g.ay + g.dy * t
			const d = Math.hypot(x - px, y - py)
			if (best === null || d < best.d) {
				best = { d, s: g.s0 + t, lat: (x - g.ax) * -g.dy + (y - g.ay) * g.dx }
			}
		}
		return best
	}

	function setupLane(lane) {
		path = buildPath(lane)
		segs = []
		let walked = 0
		for (let i = 1; i < path.length; i++) {
			const [ax, ay] = path[i - 1]
			const [bx, by] = path[i]
			const len = Math.hypot(bx - ax, by - ay)
			if (len < 1) continue
			segs.push({ ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, len, s0: walked })
			walked += len
		}
		const towerByName = n => EntityManager.GetEntitiesByClass(Tower).find(t => t.Name === n)
		const t1 = towerByName(`npc_dota_goodguys_tower1_${lane}`)
		const t2 = towerByName(`npc_dota_goodguys_tower2_${lane}`)
		const et1 = towerByName(`npc_dota_badguys_tower1_${lane}`)
		const P = e => project(e.Position.x, e.Position.y)
		geo = {
			lane,
			t2: t2 ? P(t2) : null,
			t1: t1 ? P(t1) : null,
			river: t1 && et1 ? (P(t1).s + P(et1).s) / 2 : null
		}
		geo.finish = geo.river - FINISH_RADIUS
		bt.geo = geo
		return geo
	}

	const findKey = () => {
		const mm = Dota2SDK.Menu.MenuManager
		const get = (list, name) => list.find(x => (x.InternalName ?? x.Name) === name)
		const ub = get(get(mm.entries, "Utility")?.entries ?? [], "Unit Blocker")
		return ub ? { ub, key: get(ub.entries, "Key"), state: get(ub.entries, "State"), best: get(ub.entries, "Go to the best position") } : null
	}

	const bt = {
		runs: [],
		results: [],
		cur: null,
		queue: 0,
		opts: null,
		log: [],
		keyHeld: false
	}

	function setKey(on) {
		const m = findKey()
		if (m?.key) m.key.entry.active = on
		if (bt.opts?.camera !== false && bt.keyHeld !== on) {
			SendToConsole((on ? "+" : "-") + "dota_camera_center_on_hero")
		}
		bt.keyHeld = on
	}

	function laneCreeps() {
		return EntityManager.GetEntitiesByClass(Creep).filter(
			c => c.IsLaneCreep && c.IsAlive && c.Team === TEAM && !c.IsWaitingToSpawn
		)
	}

	function startAttempt() {
		const o = bt.opts
		bt.cur = {
			phase: "wait",
			sent: GameState.RawGameTime,
			samples: [],
			creeps: new Map(),
			escape: null,
			maxAhead: -1e9,
			orders: []
		}
		SendToConsole("creep_block_reset")
		SendToConsole(`creep_block_start ${o.lane} ${o.melee} ${o.ranged} river ${o.hero}`)
	}

	// On-screen scoreboard of the attempts run in this game session, per tag: clean ones, failed
	// ones (a creep got more than escapeAhead past the hero) and the attempt in progress. It lives on
	// globalThis so a re-injection keeps the counts; __bt.resetScore() clears them.
	const score = (globalThis.__btScore ??= new Map())
	const canvas = (globalThis.__btCanvas ??= new MenuSDK.Canvas("block-test"))
	bt.resetScore = () => score.clear()

	function addScore(r, o) {
		if (o.mode !== "block" || r.n === 0) return
		const row = score.get(r.tag) ?? { ok: 0, fail: 0, gain: 0, gains: 0, last: "", lost: [] }
		const voided = r.minimized || r.slowFrames > 10
		if (voided) {
			// the game was minimized or starved: the attempt is repeated, not counted
		} else if (r.failed) {
			row.fail++
			const e = r.escape ?? r.escapeRanged
			const stall = r.slowFrames > 0 ? ` (game stalled: ${r.slowFrames} slow frames, gap ${r.maxGap}s)` : ""
			if (e) row.lost.push(`${r.escape ? "melee" : "ranged"} got by at ${e.t}s, s ${e.s}${stall}`)
		} else {
			row.ok++
			if (r.t1Mean !== null && o.freeT1 !== undefined) {
				row.gain += r.t1Mean - o.freeT1
				row.gains++
			}
		}
		row.last = (row.last + (voided ? "-" : r.failed ? "X" : "o")).slice(-30)
		score.delete(r.tag)
		score.set(r.tag, row)
	}

	const frames = { n: 0, since: Date.now(), fps: 0, last: Date.now() }
	// Draw stops while the window is minimized; ticks go on at ~10 Hz
	const minimized = () => Date.now() - frames.last > 500

	function onDraw() {
		frames.n++
		frames.last = Date.now()
		const ms = Date.now() - frames.since
		if (ms >= 1000) {
			frames.fps = Math.round((frames.n * 1000) / ms)
			frames.n = 0
			frames.since = Date.now()
		}
		const cur = bt.cur
		if (bt.showScore === false || (score.size === 0 && cur?.phase !== "run")) return
		const size = RendererSDK.WindowSize,
			w = 470,
			lh = 22,
			x = size.x - w - 16,
			lines = score.size + 3 + (cur?.phase === "run" ? 1 : 0)
		let y = Math.round(size.y * 0.2)
		canvas.Rect(new Vector2(x, y), new Vector2(w, lines * lh + 18), { color: new Color(12, 14, 18, 200), radius: 8 })
		y += 8
		const text = (s, dx, color = Color.White, size = 15) =>
			canvas.Text(String(s), new Vector2(x + dx, y), { color, size, outline: true })
		const cols = [12, 200, 252, 308, 360, 420]
		text("Creep block: attempts this session", cols[0], Color.White, 16)
		text(`${frames.fps} FPS`, cols[4], frames.fps < 30 ? new Color(255, 90, 80) : new Color(170, 170, 170), 14)
		y += lh + 2
		const gray = new Color(170, 170, 170)
		;["config", "runs", "clean", "FAIL", "gain", ""].forEach((h, i) => text(h, cols[i], gray, 14))
		y += lh
		const red = new Color(255, 90, 80),
			green = new Color(110, 220, 120)
		for (const [tag, row] of score) {
			text(tag.length > 22 ? tag.slice(0, 21) + "…" : tag, cols[0])
			text(row.ok + row.fail, cols[1])
			text(row.ok, cols[2], green)
			text(row.fail, cols[3], row.fail > 0 ? red : Color.White)
			text(row.gains ? (row.gain / row.gains >= 0 ? "+" : "") + (row.gain / row.gains).toFixed(2) : "-", cols[4])
			text(row.last.slice(-6), cols[5], row.last.endsWith("X") ? red : green, 14)
			y += lh
		}
		if (cur?.phase === "run") {
			const lead = Math.round(cur.lead ?? -1e9)
			const t = (GameState.RawGameTime - cur.spawn).toFixed(1)
			const near = lead > (bt.opts.escapeAhead ?? 150) * 0.66
			text(
				`now ${bt.opts.tag}: ${t}s, front creep ${lead > -1e8 ? (lead >= 0 ? "+" : "") + lead : "-"} (FAIL at +${bt.opts.escapeAhead ?? 150})`,
				cols[0],
				near ? red : gray,
				14
			)
			y += lh
		}
		const lastFail = [...score].reverse().find(([, row]) => row.lost.length)
		text(
			lastFail ? `last FAIL ${lastFail[0]}: ${lastFail[1].lost[lastFail[1].lost.length - 1]}` : "no creep has got by",
			cols[0],
			lastFail ? red : green,
			14
		)
	}

	function finishAttempt(why) {
		const cur = bt.cur
		const o = bt.opts
		setKey(false)
		const cs = [...cur.creeps.values()]
		const rel = v => (v === undefined ? null : +(v - cur.spawn).toFixed(2))
		const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
		const t1s = cs.map(c => c.tT1).filter(v => v !== undefined)
		const fin = cs.map(c => c.tFin).filter(v => v !== undefined)
		const r = {
			tag: o.tag,
			mode: o.mode,
			hero: o.hero,
			why,
			n: cs.length,
			t1First: t1s.length ? rel(Math.min(...t1s)) : null,
			t1Mean: t1s.length ? +(mean(t1s) - cur.spawn).toFixed(2) : null,
			t1Last: t1s.length ? rel(Math.max(...t1s)) : null,
			finish: fin.length ? rel(Math.min(...fin)) : null,
			escape: cur.escape,
			escapeRanged: cur.escapeRanged ?? null,
			maxAhead: Math.round(cur.maxAhead),
			t2: cs.map(c => c.t2Side ?? "?").join(""),
			t1: cs.map(c => c.t1Side ?? "?").join(""),
			release: rel(cur.release),
			failed: why === "escape" || cur.escape !== null || (cur.escapeRanged ?? null) !== null,
			orders: cur.orders.length,
			maxGap: +(cur.maxGap ?? 0).toFixed(3),
			slowFrames: cur.slowFrames ?? 0,
			minimized: cur.minimized === true
		}
		bt.results.push(r)
		addScore(r, o)
		bt.last = cur
		const meta = {
			lane: o.lane,
			hero: o.hero,
			heroSpeed: Math.round(LocalPlayer?.Hero?.MoveSpeed ?? 0),
			tune: o.tune ?? {},
			convars: o.convars ?? {},
			geo: { t2: geo.t2 && { s: Math.round(geo.t2.s), lat: Math.round(geo.t2.lat) }, t1: geo.t1 && { s: Math.round(geo.t1.s), lat: Math.round(geo.t1.lat) }, river: Math.round(geo.river) },
			creeps: cs.map(c => ({ idx: c.idx, ranged: c.ranged }))
		}
		bt.runs.push({ r, meta, samples: cur.samples, orders: cur.orders })
		if (bt.runs.length > 30) bt.runs.shift()
		bt.cur = null
		bt.queue--
		bt.next = bt.queue > 0 ? GameState.RawGameTime + (o.pause ?? 2) : undefined
	}

	function onTick() {
		const now = GameState.RawGameTime
		if (bt.placing !== undefined) {
			const hero = LocalPlayer?.Hero
			const p = bt.placing
			if (hero !== undefined && !p.moved && now - p.since > 0.6) {
				hero.MoveTo(new Vector3(p.x, p.y, hero.Position.z))
				p.moved = true
				p.since = now
			}
			if (hero !== undefined && p.moved && (Math.hypot(hero.Position.x - p.x, hero.Position.y - p.y) < 30 || now - p.since > 20)) {
				SendToConsole(`creep_block_start_here`)
				bt.placing = undefined
				bt.placed = [Math.round(hero.Position.x), Math.round(hero.Position.y)]
			}
			return
		}
		if (bt.cur === null) {
			if (bt.opts?.mode === "manual" && bt.next !== undefined && now >= bt.next && !bt.armed) {
				return
			}
			if (bt.next !== undefined && now >= bt.next) {
				// a minimized game draws nothing and updates ~10 times a second: wait until it is back
				if (minimized()) {
					bt.waiting = "game window minimized"
					return
				}
				bt.waiting = null
				bt.armed = false
				bt.next = undefined
				startAttempt()
			}
			return
		}
		const cur = bt.cur
		const o = bt.opts
		const creeps = laneCreeps()
		const hero = LocalPlayer?.Hero
		if (hero === undefined) return
		if (cur.phase === "wait") {
			const fresh = creeps.filter(c => bt.spawner !== null && Math.hypot(c.Position.x - bt.spawner[0], c.Position.y - bt.spawner[1]) < 500)
			if (fresh.length >= o.melee + o.ranged) {
				cur.phase = "run"
				cur.spawn = now
				for (const c of fresh) cur.creeps.set(c.Index, { idx: c.Index, ranged: c.IsRangeAttacker })
				if (o.mode === "block") {
					if (!(o.armDistance > 0)) setKey(true)
				} else if (o.mode === "free") {
					const hp0 = project(hero.Position.x, hero.Position.y)
					const g = segs.find(sg => hp0.s >= sg.s0 && hp0.s <= sg.s0 + sg.len) ?? segs[0]
					hero.MoveTo(new Vector3(hero.Position.x - g.dy * 700, hero.Position.y + g.dx * 700, hero.Position.z))
				}
			} else if (now - cur.sent > 8) {
				finishAttempt("nospawn")
			}
			return
		}
		if (o.mode === "block" && o.armDistance > 0 && !bt.keyHeld && cur.release === undefined && !cur.armed) {
			if (creeps.some(c => cur.creeps.has(c.Index) && c.Distance2D(hero) < o.armDistance)) {
				cur.armed = true
				setKey(true)
			}
		}
		const hp = project(hero.Position.x, hero.Position.y)
		const sample = { t: +(now - cur.spawn).toFixed(3), h: [Math.round(hero.Position.x), Math.round(hero.Position.y), Math.round(hp.s), Math.round(hp.lat)], c: [] }
		let lead = -1e9
		let alive = 0
		const melee = []
		for (const c of creeps) {
			const rec = cur.creeps.get(c.Index)
			if (rec === undefined) continue
			alive++
			const p = project(c.Position.x, c.Position.y)
			sample.c.push([c.Index, Math.round(c.Position.x), Math.round(c.Position.y), Math.round(p.s), Math.round(p.lat), c.IsMoving ? 1 : 0])
			lead = Math.max(lead, p.s)
			if (rec.tT1 === undefined && p.s >= geo.t1.s) rec.tT1 = now
			if (rec.tFin === undefined && p.s >= geo.finish) rec.tFin = now
			if (rec.t2Side === undefined && p.s >= geo.t2.s) rec.t2Side = p.lat > geo.t2.lat ? "L" : "R"
			if (rec.t1Side === undefined && p.s >= geo.t1.s) rec.t1Side = p.lat > geo.t1.lat ? "L" : "R"
			if (!rec.ranged) melee.push(p.s)
			if (bt.keyHeld || (o.mode === "manual" && cur.release === undefined)) {
				const ahead = p.s - hp.s
				if (!rec.ranged) cur.maxAhead = Math.max(cur.maxAhead, ahead)
				const key = rec.ranged ? "escapeRanged" : "escape"
				if ((cur[key] ?? null) === null && ahead > o.escapeAhead) {
					cur[key] = { t: +(now - cur.spawn).toFixed(2), s: Math.round(p.s), lat: Math.round(p.lat), heroS: Math.round(hp.s), heroLat: Math.round(hp.lat) }
				}
			}
		}
		cur.lead = lead - hp.s
		const plan = bt.keyHeld ? globalThis.__ubPlans?.get(hero) : undefined
		if (plan !== undefined) {
			sample.a = plan.Action
			sample.m = plan.Mode
			sample.k = plan.Key?.Creep.Index ?? -1
			sample.tg = plan.Target ? [Math.round(plan.Target.x), Math.round(plan.Target.y)] : null
			sample.n = plan.Note
			sample.lat = Math.round(plan.Latency * 1000)
			sample.q = ExecuteOrder.orderQueue.length
			// planner's reasons: front / window creeps, lead share and its sources, target clamps, gap to a creep going round a tower
			const tr = plan.Trace
			if (tr !== undefined) {
				const r2 = v => Math.round(v * 100) / 100
				sample.w = {
					f: tr.Front?.Creep.Index ?? -1,
					lo: tr.Low?.Creep.Index ?? -1,
					hi: tr.High?.Creep.Index ?? -1,
					th: tr.Threat?.Creep.Index ?? -1,
					sf: Math.round(tr.Shift ?? 0),
					sh: r2(tr.Share),
					ss: r2(tr.SideShare),
					sp: r2(tr.SpeedShare),
					cl: tr.Clamp,
					dg: Math.round(tr.DetourGap ?? 0)
				}
			}
			const roles = new Map(plan.Creeps.map(v => [v.Creep.Index, v.Role]))
			for (const c of sample.c) c.push(roles.get(c[0]) ?? -1)
		}
		// frame stalls while the key is held: the planner and its orders run per frame, a gap longer
		// than two ticks is the game starved in the background, not the planner
		const prev = cur.samples[cur.samples.length - 1]
		if (bt.keyHeld && minimized()) cur.minimized = true
		if (bt.keyHeld && prev !== undefined) {
			const gap = sample.t - prev.t
			if (gap > 0.08) cur.slowFrames = (cur.slowFrames ?? 0) + 1
			cur.maxGap = Math.max(cur.maxGap ?? 0, gap)
		}
		cur.samples.push(sample)
		melee.sort((a, b) => a - b)
		const median = melee.length ? melee[melee.length >> 1] : lead
		if (o.mode === "block" && bt.keyHeld && o.abortAhead > 0) {
			const runaway = sample.c.find(c => c[3] - hp.s > o.abortAhead)
			if (runaway !== undefined) {
				SendToConsole("creep_block_reset")
				finishAttempt("escape")
				return
			}
		}
		// releaseAt "river": hold the key until the wave reaches the finish line instead of T1
		const toRiver = o.releaseAt === "river",
			releaseS = toRiver ? geo.finish : geo.t1.s + o.releaseAfterT1,
			heroReleaseS = toRiver ? geo.finish : geo.t1.s + 250
		if (o.mode === "manual" && cur.release === undefined && (median >= releaseS || hp.s >= heroReleaseS)) {
			cur.release = now
		}
		if (bt.keyHeld && (median >= releaseS || hp.s >= heroReleaseS || now - cur.spawn > o.holdMax)) {
			setKey(false)
			cur.release = now
		}
		const allPastT1 = [...cur.creeps.values()].every(rec => (toRiver ? rec.tFin : rec.tT1) !== undefined)
		if ((o.quick || o.mode === "manual") && !bt.keyHeld && cur.release !== undefined && (allPastT1 || now - cur.release > 3)) {
			SendToConsole("creep_block_reset")
			finishAttempt("t1")
		} else if (alive === 0 && now - cur.spawn > 1) {
			finishAttempt("done")
		} else if (now - cur.spawn > 60) {
			finishAttempt("timeout")
		}
	}

	bt.run = (opts = {}) => {
		bt.opts = {
			tag: "run",
			mode: "block",
			hero: "pudge",
			melee: 3,
			ranged: 1,
			n: 5,
			lane: "mid",
			quick: true,
			abortAhead: 150,
			releaseAfterT1: 100,
			escapeAhead: 150,
			holdMax: 40,
			...opts
		}
		ExecuteOrder.DisableHumanizer = false
		uncapFps()
		setupLane(bt.opts.lane)
		const tuning = globalThis.__ubTuning
		if (tuning !== undefined) {
			globalThis.__ubTuningDefaults ??= { ...tuning }
			Object.assign(tuning, globalThis.__ubTuningDefaults, bt.opts.tune ?? {})
		}
		applyConvars(bt.opts.convars ?? {})
		const m = findKey()
		if (m?.state !== undefined && !m.state.value) {
			m.state.value = true
		}
		if (m?.best !== undefined && m.best.value !== (bt.opts.goBest !== false)) {
			m.best.value = bt.opts.goBest !== false
		}
		// per-run hero start [s, lat]: placed only when it differs from the last one placed, so in an
		// A/B either every config names its start or none does
		if (Array.isArray(bt.opts.start)) {
			const key = `${bt.opts.lane}:${bt.opts.start.join(",")}`
			if (bt.startKey !== key) {
				bt.placeStart(bt.opts.lane, ...bt.opts.start)
				bt.startKey = key
			}
		}
		bt.queue = bt.opts.n
		bt.armed = false
		bt.next = GameState.RawGameTime
		return bt.opts
	}

	// Full frame rate with the game in the background: unfocused, the engine sleeps
	// engine_no_focus_sleep ms (5 by default) every frame, the planner and the samples run per frame.
	// Applied on injection and before every run, since a new game resets it.
	function uncapFps() {
		SendToConsole2("engine_no_focus_sleep 0")
		SendToConsole2("fps_max 0")
	}
	uncapFps()

	// Server convars of a run ({ name: value }): cheat-flagged ones need sv_cheats, which ConVars.Set
	// does not get past, so they go through the console. Every convar a run has set returns to its
	// default (read before the first change) on runs that do not name it; sv_cheats goes back off once
	// all of them are at their defaults.
	function applyConvars(convars) {
		const defaults = (globalThis.__btConvarDefaults ??= {})
		for (const name of Object.keys(convars)) {
			if (!(name in defaults)) defaults[name] = ConVars.Get(name)
		}
		const names = Object.keys(defaults)
		if (names.length === 0) return
		const cheats = names.some(name => name in convars)
		if (cheats) SendToConsole2("sv_cheats 1")
		for (const name of names) {
			const value = name in convars ? convars[name] : defaults[name]
			SendToConsole2(`${name} ${typeof value === "boolean" ? Number(value) : value}`)
		}
		if (!cheats) {
			SendToConsole2("sv_cheats 0")
			delete globalThis.__btConvarDefaults
		}
	}
	bt.restoreConvars = () => applyConvars({})

	// Walks the hero to lane point (s, lat) and saves it as the trainer's hero start for that lane.
	bt.placeStart = (lane, s, lat = 0) => {
		ExecuteOrder.DisableHumanizer = false
		setupLane(lane)
		let best = null
		for (const g of segs) {
			if (s >= g.s0 && s <= g.s0 + g.len) best = g
		}
		best ??= segs[segs.length - 1]
		const t = s - best.s0
		const x = best.ax + best.dx * t - best.dy * lat,
			y = best.ay + best.dy * t + best.dx * lat
		SendToConsole("creep_block_reset")
		SendToConsole(`creep_block_start ${lane} 1 0 river pudge`)
		SendToConsole("creep_block_reset")
		bt.placing = { lane, x, y, since: GameState.RawGameTime, moved: false }
		return [Math.round(x), Math.round(y)]
	}

	bt.stop = () => {
		bt.queue = 0
		bt.next = undefined
		setKey(false)
		bt.cur = null
	}

	bt.status = () => ({
		queue: bt.queue,
		phase: bt.cur?.phase ?? null,
		t: bt.cur?.spawn ? +(GameState.RawGameTime - bt.cur.spawn).toFixed(1) : null,
		results: bt.results.length,
		waiting: bt.waiting ?? null
	})

	function onOrder(order) {
		const cur = bt.cur
		if (cur === null && bt.opts?.mode === "manual" && bt.next !== undefined && !bt.armed) {
			bt.armed = true
			bt.next = Math.max(bt.next, GameState.RawGameTime + 1.5)
		}
		if (cur?.spawn === undefined || cur.phase !== "run") return true
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !order.Issuers?.includes(hero)) return true
		const pos = order.Position
		cur.orders.push({
			t: +(GameState.RawGameTime - cur.spawn).toFixed(3),
			type: order.OrderType,
			x: Math.round(pos?.x ?? 0),
			y: Math.round(pos?.y ?? 0),
			hx: Math.round(hero.Position.x),
			hy: Math.round(hero.Position.y),
			player: order.IsPlayerInput === true
		})
		return true
	}

	bt.dispose = () => {
		bt.stop()
		EventsSDK.removeListener("PostDataUpdate", onTick)
		EventsSDK.removeListener("PrepareUnitOrders", onOrder)
		EventsSDK.removeListener("Draw", onDraw)
	}

	EventsSDK.on("PostDataUpdate", onTick)
	EventsSDK.on("PrepareUnitOrders", onOrder, -1000)
	EventsSDK.on("Draw", onDraw)
	globalThis.__bt = bt
	return setupLane("mid")
})()
