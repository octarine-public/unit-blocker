# Creep block test bench

Drives the `fps_benchmark` custom game's creep block trainer (`dota2-bench`, `creep_block_*` console
commands) from the Octarine V8 runtime and measures how much the unit blocker delays a wave.
Everything talks to the game through the cdp-mcp console hub on `127.0.0.1:9223`, so the cdp-mcp
server (or `console.bat`) has to be running.

| File | Role |
|------|------|
| `bt.js` | In-game harness, injected into V8 as `globalThis.__bt`: starts waves, holds the blocker key, records hero/creep tracks, the planner's decisions and the player's orders |
| `inject.cjs` | `node inject.cjs file.js` or `node inject.cjs -e "expr"` evaluates in the game |
| `reload.cjs` | Reloads the scripts runtime after a rebuild and re-injects `bt.js` |
| `series.cjs` | Runs a series and waits for it, prints every attempt, a summary and the series report, saves each run to `out/runs/` |
| `ab.cjs` | Interleaved comparison of several configs (one attempt of each per round), report per config |
| `report.cjs` | Series report from saved runs: time gained per phase, failure autopsies (`--detail`), event log of an attempt (`--events n`), free-wave curve (`--free`) |
| `analyze.cjs` | The analysis behind `report.cjs` (free curve, phases, events, autopsy) |
| `plan-trace.cjs` | Frame-by-frame timeline of a saved run: hero, creeps relative to the hero, planner action and note |
| `escapes.cjs` | The situation right before every escape across runs |
| `contact.cjs` | Statistics of hero–creep contact episodes |
| `stops.cjs` | Creeps' stops against the server's collision rules (`dota2-ida/notes/creep/REPORT.md`): closest hero–creep distance, every stop's length in ticks with the unit in the way and the rule (hard contact / look-ahead), the side creeps walk off to; `--key` only while the key is held, `--still` for a hero standing still (no key), `--list` every stop |
| `compare.cjs` | Technique profile of clean runs: hero forward speed, standing time, orders, gap to the front creep |
| `rec.js` | Passive recorder for real games (a server with ping, no trainer): every tick while the blocker has a plan for the local hero, the network (latency, `InputLag`, dispatch estimate, humanizer queue) and each order's way out (queued → sent → the hero reacting); `node inject.cjs rec.js`, `__rec.status()` |
| `rec-dump.cjs` | Saves the recorder's finished sessions to `out/rec/` (`--flush` closes the one in progress). The recorder stores each finished session in the script store (`ubrec`) at once, since the runtime reloads the scripts on its own (a new match, a file changed in the script folder) and that wipes everything injected |
| `rec-watch.cjs` | Keeps the recorder in the game: injects it again within 2 s of a script reload; run it in the background while playing |
| `clicks.js` | Logs the player's own orders, to measure the game's right-button repeat (`__clicks.report()`): 133 ms, 4 ticks, the cap `MoveUnit` keeps |
| `rec-report.cjs` | Report on `out/rec/`: latency the planner assumes against the measured order → reaction time, order rate, plan flips, the last seconds before every escape (`--before n`) |

## What a run records

Each saved run (`out/runs/<tag>-<time>-<id>.json`) holds `r` (the result line), `meta` (lane, hero
and its speed, tuning overrides, tower positions in the harness frame, the wave's creeps with their
ranged flag), `orders` (every order of the hero) and `samples`, one per game tick:

- `h`: hero `[x, y, s, lat]`; `c`: creeps `[index, x, y, s, lat, moving, role]` — `s`/`lat` are
  along / across the harness lane line (corner polyline, lat > 0 = left), role is the planner's
  (0 approach, 1 press, 2 flank, 3 detour, 4 passed, 5 ignored);
- planner, while the key is held: `a` action (0 Wait, 1 Hold, 2 Move, 3 Advance), `m` mode (0 Idle,
  1 Block, 2 Passage, 3 Advance, 4 Funnel), `k` key creep, `tg` target, `n` note, `lat` order latency (ms),
  `q` humanizer queue, `w` the reasons: front / window creeps (`f`, `lo`, `hi`), the creep outside the window the hero
  leans towards and the lateral shift (`th`, `sf`), lead share
  `sh` and its sources (`ss` lateral, `sp` speed), `cl` clamps (1 no back-step, 2 tower hug,
  4 pushed out of a tower, 8 shadow guard step), `dg` lateral gap to a creep going round a tower while advancing.

`report.cjs` turns that into what is worth reading:

- **phases**: the wave's lag behind the free wave (`out/free-curve.json`, built from `free-<lane>`
  runs) at lane checkpoints — contact, settle (+250), T2 pass (T2 −450..+150), between, T1 pass
  (T1 −450..T1) — so every phase shows the seconds it added and how long the wave took for it;
- **events**: mode / key changes, role changes, sidesteps, a creep drawing level with the hero,
  stops, tower passes and their side, wave splits, latency spikes, escapes — with the wave's lag;
- **autopsy** of a failed attempt: the escaping creep, the moment the block was lost (it stopped
  being in front of the hero for good), the phase, tags (two-sided split, far-side detour, gap
  between hero and tower, outside the cover window, key creep lost the lateral race, latency) and
  the planner's reasons frame by frame before it.

The dev hook (`modules/CreepBlock/DevHook.ts`) exposes `__ubTuning` (the planner parameters),
`__ubPlans` (the last plan per unit) and `__ubLaneFrame(team, lane)` (the planner route: `Points`,
`Obstacles`, `Project`, `PointAt`) to the game V8.

## How the planner decides (modules/CreepBlock/Planner.ts)

Every tick, per blocking unit, on the lane route of `Lane.ts` (corners as creeps walk them — sharp
turns cut — wrapped round towers):

1. **Roles**: each creep is approaching, pressing, flanking, detouring (heading round a tower's far
   side), passed or ignored.
2. **Advance**: a confirmed far-side detour makes the unit walk on ahead without holding until the
   creep that went round is back near its line (or about to draw level), or `advanceTimeout`; it
   ends at once if the creep reaches the tower on the lane side after all (judged only beside the
   tower: a creep closing in past it crosses the tower's centre line long before it is back).
3. **Funnel**: a wave reaching the unit split wider than `funnelSpread` is met where the route
   passes the next squeezing tower, where it closes up.
4. **Block**: the front creep (by predicted position) and the cover window (the run of creeps one
   unit can stand in front of, always holding the front one); the unit leans towards the most
   advanced creep outside the window (`threatBias`) and stays ahead of the key creep by its
   predicted advance (lateral misalignment, or speed for units slower than creeps; less of it on a
   compact wave when `pressSpread` > 0).
5. **Passage**: from `passageBefore` ahead of a tower the route squeezes by (`passageGap`), the
   unit hugs its lane side and keeps the gap narrower than the smallest creep; it does not hold
   while a trailing creep stands in the tower's shadow (`shadowGuard`), a stationary jam sends it
   round the far side. A tower the unit is already more than `passageAfter` past is not its passage
   (mid's own T3 while the wave walks by it: the unit used to step forward ~150 before contact).
6. **Orders**: never a step back along the route; holds are Stop orders, moves are gated
   (`orderMinShift`, `orderShiftShare`, `orderRefresh`).

The menu's Sensitivity sets `lookAhead` and `gap`, and below its default 16 turns on the compact
press: `pressSpread = clamp((16 − value) × 20, 0, 200)` — more delay, more creeps lost. Measured on r9,
mid, Pudge: 12 → 15/20 clean, +7.07 s; 16 → 20/20, +4.41 s; 20 → 20/20, +4.28 s. On r10 (30 rounds):
16 → 27/30, +5.22 s; 20 → 28/30, +4.26 s; 24 → 27/30, +4.08 s — above the default the slider only
shortens the block.

The key should be held from before the wave arrives: the unit lines up sideways with the wave on its
way in. Pressed only when the creeps are 250 away it loses more creeps to the lateral race (23/30 vs
29/30, `pa` in EXPERIMENTS.md).

## Running

```bash
node reload.cjs
node series.cjs '{"tag":"free","mode":"free","n":3}'
node series.cjs '{"tag":"try1","n":10,"tune":{"lookAhead":0.15}}'
node series.cjs '{"tag":"human","mode":"manual","n":6}'
node ab.cjs '{"rounds":12,"maxFail":7,"base":{"hero":"pudge"},"configs":{"a":{},"b":{"tune":{"gap":4}}}}'
node report.cjs a-pudge b-pudge --detail
node report.cjs a-pudge --events 3
```

Run options (`__bt.run`, series and ab.cjs configs): `lane`, `hero`, `melee`, `ranged`, `tune` (planner
`Tuning` overrides), `convars` (server convars for the run, e.g.
`{"dota_unit_blocked_wait_time_long": 2}`: set through the console with `sv_cheats 1`, since
`ConVars.Set` does not get past the cheat flag; a run that does not name a convar an earlier run set
puts it back to its default and `sv_cheats` back to 0, `__bt.restoreConvars()` does it by hand),
`mode` (`block` / `free` / `manual`), `armDistance` (hold the key only once a
creep is that close; 1 = never, the hero just stands at its start), `goBest: false` (the script does not walk the hero to its best position),
`start: [s, lat]` (walk the hero there and save it as the trainer's start before the run; placed only
when it changes, so in an A/B give every config a start or none).

The order humanizer's latency depends on how far its cursor glides between two orders (~0.1 s
when the queue is empty, up to ~0.45 s on a big lateral jump of the target); while the blocker is
active the cursor stays at the last order instead of returning to the real mouse.

Options: `mode` `block` | `free` | `manual`, `hero` (`pudge`, `axe`, `sven`, `juggernaut`, `nevermore`,
`invoker`), `lane`, `melee`, `ranged`, `n`, `pause` (seconds between attempts), `tune` (overrides for
the planner's `Tuning`, through the dev hook), `escapeAhead` (a creep this far ahead of the hero
along the lane while the key is held is a lost creep and the attempt failed, 150 by default; it was
100 until the `nz` series), `abortAhead` (a creep this far ahead ends the attempt there, 150 by
default), `maxFail` (failed attempts that reject the config, 3),
`humanMargin` (seconds a config may trail the human reference before it is rejected, 0.5).
`ab.cjs` also takes `minGain` / `minGainAfter` (drop a config whose clean attempts average below
that once it has that many) and `minAttemptGain` (an attempt that keeps every creep but gains less
than that at T1 counts as a failure, printed LOW; the bar is 5).

- `free` moves the hero out of the way and records the unblocked baseline into `out/baseline.json`;
  every delay printed is relative to it.
- `manual` leaves the hero to the player and records their orders. Each wave waits until the player
  orders the hero to stop (S). The clean attempts become the human reference in `out/human.json`,
  and block configs that trail it are rejected early.

Results: `T1` is when the first creep passes the own tier-one tower, `mean` the mean over the wave,
both as seconds gained over the free wave. `t2`/`t1` list the side each creep passed the tower on
(`L`/`R` relative to the travel direction). `ESC`/`rng` mark a melee/ranged creep that got more than
`escapeAhead` (150) units ahead of the hero while the blocker was held.

The game must have Octarine's *Humanizer* setting on: without it scripts' orders are dropped. The
harness switches it on at runtime for the session only.

The planner's defaults the harness resets to before every run (`__ubTuningDefaults`) are copied from
the live `Tuning` on the first run, so they carry the menu's *Sensitivity* (`lookAhead`, `gap`,
`pressSpread`). Every logged series is at Sensitivity 16: until nz31 that was lookAhead 0.15, gap −3
(6 before r12), pressSpread 0; from nz32 the mapping is shifted so that 16 gives the nz30 tuning,
lookAhead 0.13, gap −4.5, pressSpread 80. Check `__ubTuning` and pin them when the menu is set
otherwise, e.g.
`node inject.cjs -e "Object.assign(__ubTuning, {lookAhead: 0.13, gap: -4.5, pressSpread: 80}); globalThis.__ubTuningDefaults = {...__ubTuning}; 1"`
(again after every `reload.cjs`). Pin only right after `reload.cjs`: the live `Tuning` keeps the
overrides of the last run (`tune`), and pinning then makes them every later run's defaults (an
`mpc 1` left over this way spoiled a first nz39).

The frame rate must not drop while Dota is in the background (alt-tab): the planner, its orders and
the samples run per frame, and unfocused the engine sleeps `engine_no_focus_sleep` ms (5 by default)
every frame. `bt.js` sets `engine_no_focus_sleep 0` and `fps_max 0` (no cap) through the console on
injection and before every run, `reload.cjs` too; a new game resets them, the next run puts them
back. Check with `node inject.cjs -e "ConVars.Get('engine_no_focus_sleep')"`.

While attempts run, `bt.js` draws a scoreboard on the game screen (top right): per tag the attempts,
clean ones, FAIL (a creep more than `escapeAhead` past the hero), the mean gain of the clean ones and
the last attempts (green o clean, red X lost), the attempt in progress with the front creep's lead
over the hero, and the last loss. The counts live on `globalThis` (a re-injection keeps them, a
`reload.cjs` clears them); `__bt.resetScore()` clears them, `__bt.showScore = false` hides it.
`node live.cjs nz` prints the same from `out/results2.jsonl` in a terminal.

From Dota's main menu `SendToConsole` does nothing; `SendToConsole2` runs the command through the
game's own console, so the custom game can be started with
`node inject.cjs -e "SendToConsole2('dota_launch_custom_game fps_benchmark dota')"`. A new game
forgets the trainer's hero starts: place them again (`__bt.placeStart` or the `start` option).
