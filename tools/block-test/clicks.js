// Logs the player's own orders to the local hero, to measure how often the game repeats a move
// while the right mouse button is held. Inject: node inject.cjs clicks.js; read: __clicks.report()
;(() => {
	if (globalThis.__clicks?.dispose) globalThis.__clicks.dispose()
	const log = (globalThis.__clicksLog ??= [])

	function onOrder(order) {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !order.Issuers?.includes(hero)) return true
		log.push({
			t: GameState.RawGameTime,
			wall: performance.now(),
			tick: GameState.CurrentGameTick,
			type: order.OrderType,
			player: order.IsPlayerInput === true,
			x: Math.round(order.Position?.x ?? 0),
			y: Math.round(order.Position?.y ?? 0)
		})
		if (log.length > 5000) log.shift()
		return true
	}

	const pct = (a, p) => {
		const s = [...a].sort((x, y) => x - y)
		return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN
	}

	globalThis.__clicks = {
		clear: () => (log.length = 0),
		raw: () => JSON.stringify(log),
		/** Intervals between the player's consecutive orders of one type, in ms (wall clock and game time) */
		report: (type = 1) => {
			const own = log.filter(o => o.player && o.type === type)
			const wall = [],
				game = [],
				ticks = []
			for (let i = 1; i < own.length; i++) {
				const dw = own[i].wall - own[i - 1].wall
				if (dw > 1000) continue // a new hold
				wall.push(dw)
				game.push((own[i].t - own[i - 1].t) * 1000)
				ticks.push(own[i].tick - own[i - 1].tick)
			}
			const r = v => Math.round(v * 10) / 10
			return JSON.stringify({
				orders: own.length,
				intervals: wall.length,
				wallMs: { min: r(pct(wall, 0)), p10: r(pct(wall, 0.1)), p50: r(pct(wall, 0.5)), p90: r(pct(wall, 0.9)), max: r(pct(wall, 1)) },
				gameMs: { min: r(pct(game, 0)), p50: r(pct(game, 0.5)), p90: r(pct(game, 0.9)) },
				ticks: { min: pct(ticks, 0), p50: pct(ticks, 0.5), p90: pct(ticks, 0.9) },
				perSecond: wall.length ? r(1000 / pct(wall, 0.5)) : 0,
				types: log.reduce((m, o) => ((m[o.type + (o.player ? "p" : "")] = (m[o.type + (o.player ? "p" : "")] ?? 0) + 1), m), {})
			})
		},
		dispose: () => EventsSDK.removeListener("PrepareUnitOrders", onOrder)
	}
	EventsSDK.on("PrepareUnitOrders", onOrder, -1000)
	return "clicks on"
})()
