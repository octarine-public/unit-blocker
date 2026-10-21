// Passive creep block recorder for real games (a server with ping): no trainer, no key driving.
// Records every tick while the blocker has a plan for the local hero, plus each order's way out:
// queued (PrepareUnitOrders) → sent by the humanizer (gone from the queue) → the hero reacting.
// Inject with: node inject.cjs rec.js   dump with: node rec-dump.cjs
;(() => {
	if (globalThis.__rec?.dispose) globalThis.__rec.dispose()

	const ESCAPE_AHEAD = 150
	/** Seconds without a plan that close a session */
	const SESSION_GAP = 2

	const rec = (globalThis.__recState ??= { sessions: [], cur: null })
	let lastPlanAt = -Infinity
	let prevHero = null
	const pending = []

	const r0 = v => Math.round(v)
	const r3 = v => Math.round(v * 1000) / 1000

	function net() {
		return {
			in: r3(GameState.GetLatency(0)),
			out: r3(GameState.GetLatency(1)),
			il: r3(GameState.InputLag),
			io: r3(GameState.IOLag),
			dd: r3(ExecuteOrder.EstimateDispatchDelay()),
			q: ExecuteOrder.orderQueue.length
		}
	}

	function openSession(now, hero) {
		rec.cur = {
			start: now,
			hero: hero.Name,
			heroSpeed: r0(hero.MoveSpeed),
			tick: r3(GameState.TickInterval),
			dedicated: GameState.IsDedicatedServer,
			net0: net(),
			tune: { ...(globalThis.__ubTuning ?? {}) },
			lane: null,
			samples: [],
			orders: [],
			escapes: [],
			creeps: {}
		}
	}

	// Finished sessions go to the script's own store on disk at once: the runtime reloads the scripts
	// on its own (a new match, a file changed in the script folder) and that wipes globalThis. One
	// value takes a little under 250 KB, so a session is stored in 200 KB parts: `<id>:<i>`, and
	// `<id>:n` written last says how many.
	const STORE = "ubrec"
	const PART = 200000
	let opened = null
	const open = () => (opened ??= localStorageOpen(STORE))

	async function persist(cur) {
		await open()
		const id = `${Date.now()}-${r0(cur.start)}`,
			text = JSON.stringify(cur),
			n = Math.ceil(text.length / PART)
		for (let i = 0; i < n; i++) {
			const r = await localStorageSet(STORE, `${id}:${i}`, JSON.stringify(text.slice(i * PART, (i + 1) * PART)))
			if (r.result !== 0) throw new Error(`rec: storing ${id}:${i}: ${r.error}`)
		}
		await localStorageSet(STORE, `${id}:n`, String(n))
		rec.stored = (rec.stored ?? 0) + 1
	}

	/** Reads every stored session into `globalThis.__recLoaded` (`null` while it runs) and removes them. */
	async function load() {
		globalThis.__recLoaded = null
		await open()
		const keys = (await localStorageKeys(STORE)).keys,
			out = [],
			done = []
		// only whole sessions (`:n` is written last) and only their keys: a session still being
		// stored keeps its parts for the next load
		for (const key of keys.filter(k => k.endsWith(":n"))) {
			const id = key.slice(0, -2),
				n = Number(JSON.parse((await localStorageGet(STORE, key)).value))
			let text = ""
			for (let i = 0; i < n; i++) {
				text += JSON.parse((await localStorageGet(STORE, `${id}:${i}`)).value)
				done.push(`${id}:${i}`)
			}
			out.push(text)
			done.push(key)
		}
		for (const key of done) await localStorageRemove(STORE, key)
		globalThis.__recLoaded = "[" + out.join(",") + "]"
	}

	function closeSession() {
		const cur = rec.cur
		if (cur === null) return
		rec.cur = null
		pending.length = 0
		if (cur.samples.length < 10) return
		persist(cur).catch(e => {
			rec.error = String(e)
			rec.sessions.push(cur)
		})
	}

	function onTick(delta) {
		if (delta === 0) return
		const hero = LocalPlayer?.Hero
		const now = GameState.RawGameTime
		if (hero === undefined || !hero.IsValid) return
		const plan = globalThis.__ubPlans?.get(hero)
		if (plan === undefined) {
			if (rec.cur !== null && now - lastPlanAt > SESSION_GAP) closeSession()
			prevHero = null
			return
		}
		lastPlanAt = now
		if (rec.cur === null) openSession(now, hero)
		const cur = rec.cur
		cur.lane ??= plan.Frame.Lane
		const frame = plan.Frame
		const hp = frame.Project(hero.Position)
		let hv = [0, 0]
		if (prevHero !== null && now - prevHero.t > 1e-3) {
			hv = [r0((hero.Position.x - prevHero.x) / (now - prevHero.t)), r0((hero.Position.y - prevHero.y) / (now - prevHero.t))]
		}
		prevHero = { t: now, x: hero.Position.x, y: hero.Position.y }
		const sample = {
			t: r3(now - cur.start),
			st: GameState.CurrentServerTick,
			h: [r0(hero.Position.x), r0(hero.Position.y), r0(hp.s), r0(hp.lat)],
			hv,
			hm: hero.IsMoving ? 1 : 0,
			net: net(),
			a: plan.Action,
			m: plan.Mode,
			k: plan.Key?.Creep.Index ?? -1,
			tg: plan.Target ? [r0(plan.Target.x), r0(plan.Target.y)] : null,
			n: plan.Note,
			lat: r0(plan.Latency * 1000),
			c: []
		}
		const tr = plan.Trace
		if (tr !== undefined) {
			const r2 = v => Math.round(v * 100) / 100
			sample.w = {
				f: tr.Front?.Creep.Index ?? -1,
				lo: tr.Low?.Creep.Index ?? -1,
				hi: tr.High?.Creep.Index ?? -1,
				th: tr.Threat?.Creep.Index ?? -1,
				sf: r0(tr.Shift ?? 0),
				sh: r2(tr.Share),
				ss: r2(tr.SideShare),
				sp: r2(tr.SpeedShare),
				cl: tr.Clamp,
				dg: r0(tr.DetourGap ?? 0)
			}
		}
		for (const v of plan.Creeps) {
			const c = v.Creep
			cur.creeps[c.Index] ??= { ranged: c.IsRangeAttacker, name: c.Name }
			sample.c.push([
				c.Index,
				r0(v.Position.x),
				r0(v.Position.y),
				r0(v.Lane.s),
				r0(v.Lane.lat),
				c.IsMoving ? 1 : 0,
				v.Role,
				r0(v.Velocity.x),
				r0(v.Velocity.y)
			])
			const ahead = v.Lane.s - hp.s
			const info = cur.creeps[c.Index]
			// only a creep that was behind the hero: an earlier wave fights further up the lane
			if (ahead <= 0) info.behind = true
			if (ahead > ESCAPE_AHEAD && info.behind === true && info.escaped === undefined) {
				info.escaped = sample.t
				cur.escapes.push({ t: sample.t, idx: c.Index, ranged: c.IsRangeAttacker, s: r0(v.Lane.s), lat: r0(v.Lane.lat), heroS: r0(hp.s), heroLat: r0(hp.lat) })
			}
		}
		// orders leaving the humanizer queue: sent now
		const queued = new Set(ExecuteOrder.orderQueue.map(e => e[0]))
		for (let i = pending.length - 1; i >= 0; i--) {
			const p = pending[i]
			if (!queued.has(p.order)) {
				p.rec.sent = r3(now - cur.start)
				pending.splice(i, 1)
			} else if (now - p.at > 3) {
				pending.splice(i, 1)
			}
		}
		cur.samples.push(sample)
	}

	function onOrder(order) {
		const cur = rec.cur
		const hero = LocalPlayer?.Hero
		if (cur === null || hero === undefined || !order.Issuers?.includes(hero)) return true
		const now = GameState.RawGameTime
		const pos = order.Position
		const o = {
			t: r3(now - cur.start),
			type: order.OrderType,
			x: r0(pos?.x ?? 0),
			y: r0(pos?.y ?? 0),
			hx: r0(hero.Position.x),
			hy: r0(hero.Position.y),
			player: order.IsPlayerInput === true,
			dd: r3(ExecuteOrder.EstimateDispatchDelay(pos)),
			sent: null
		}
		cur.orders.push(o)
		pending.push({ order, rec: o, at: now })
		return true
	}

	const api = {
		status: () => ({
			recording: rec.cur !== null,
			samples: rec.cur?.samples.length ?? 0,
			escapes: rec.cur?.escapes.length ?? 0,
			stored: rec.stored ?? 0,
			error: rec.error ?? null,
			unstored: rec.sessions.length
		}),
		/** Sessions that failed to store, kept in memory */
		take: () => JSON.stringify(rec.sessions.splice(0)),
		load: () => {
			load().catch(e => (globalThis.__recLoaded = JSON.stringify({ error: String(e) })))
			return "loading"
		},
		flush: () => closeSession(),
		dispose: () => {
			EventsSDK.removeListener("PostDataUpdate", onTick)
			EventsSDK.removeListener("PrepareUnitOrders", onOrder)
		}
	}

	EventsSDK.on("PostDataUpdate", onTick)
	EventsSDK.on("PrepareUnitOrders", onOrder, -1000)
	globalThis.__rec = api
	return "rec on"
})()
