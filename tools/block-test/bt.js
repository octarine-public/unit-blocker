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
			orders: cur.orders.length
		}
		bt.results.push(r)
		bt.last = cur
		const meta = {
			lane: o.lane,
			hero: o.hero,
			heroSpeed: Math.round(LocalPlayer?.Hero?.MoveSpeed ?? 0),
			tune: o.tune ?? {},
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
				if ((cur[key] ?? null) === null && ahead > 100) {
					cur[key] = { t: +(now - cur.spawn).toFixed(2), s: Math.round(p.s), lat: Math.round(p.lat), heroS: Math.round(hp.s), heroLat: Math.round(hp.lat) }
				}
			}
		}
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
			holdMax: 40,
			...opts
		}
		ExecuteOrder.DisableHumanizer = false
		setupLane(bt.opts.lane)
		const tuning = globalThis.__ubTuning
		if (tuning !== undefined) {
			globalThis.__ubTuningDefaults ??= { ...tuning }
			Object.assign(tuning, globalThis.__ubTuningDefaults, bt.opts.tune ?? {})
		}
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
		results: bt.results.length
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
	}

	EventsSDK.on("PostDataUpdate", onTick)
	EventsSDK.on("PrepareUnitOrders", onOrder, -1000)
	globalThis.__bt = bt
	return setupLane("mid")
})()
