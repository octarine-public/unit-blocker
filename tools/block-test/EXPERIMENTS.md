# Creep block experiments log

Read this before changing `modules/CreepBlock/Planner.ts`. Every entry: what changed, the numbers, the
verdict and why. Append new series at the bottom of "Series"; keep "Current best" and "Lessons" true.

## Rules (how we improve the blocker)

1. **One lost creep is a bug.** A creep that walked round the hero (more than 150 ahead while the
   key is held) means the logic is wrong. Stop that config, find why the creep got by, change the
   logic, then test the change. A config is never run again unchanged after a loss.
2. **An attempt under +5 s is a failure too.** Every attempt has to gain at least +5 s at own T1
   on mid; one that keeps every creep but gains less rejects the config the same way, and the
   question is again what to change (`ab.cjs` `"minAttemptGain": 5`, shown as LOW). A compact wave
   is held; walking on ahead is only for a wave spread wide.
3. Every change sits behind a `Tuning` switch until an A/B (`ab.cjs`, interleaved, `maxFail 1`,
   `minAttemptGain 5`) shows it is no worse; then it becomes the default. Log every run here, rejected ones too.

Where to look after a loss:

| What | Where |
|---|---|
| Score, live | the panel on the game screen (top right); `node live.cjs <tag>` in a terminal |
| Which attempt failed, gain per phase, the autopsy | `node report.cjs <tag> --detail`; `out/results2.jsonl` |
| What the planner did, frame by frame (front creep, action, note) | `node plan-trace.cjs <run file>` (`out/runs/<tag>-*.json`) |
| The moment of the escape over many runs | `node escapes.cjs <tag>`, `node losses.cjs <tag>` |
| Why a creep stopped or walked round (hard contact / look-ahead, side) | `node stops.cjs <tag> --key --list` |
| Server movement rules | `dota2-ida/notes/creep/REPORT.md`; "Lessons" 24–25 below |
| How the planner decides, what a run records | `README.md` |
| The creeps' forecast against recordings | `node forecast.cjs <tag> --horizon 1` |
| What was tried and rejected | "Rejected ideas" and "Series" below |

## Setup

- Bench: `fps_benchmark` custom game, trainer `creep_block_start mid 3 1 river <hero>`, Radiant mid,
  3 melee + 1 ranged, hero start (-3967,-3459) ≈ route s 1465. See `README.md` for the tools.
- Side lanes: until ab12 the hero started at s ≈ 1500 (a hard, long block); from ab13 it starts at
  the script's own best position, where a user waits (bot (-811,-6400) ≈ s 3251, top
  (-6517,-1480) ≈ s 2759). Re-place with `__bt.placeStart(lane, s, lat)`.
- Removed after rejection: `speedLeadTime` (s15/s25), `rangedFrontLag` (rf40), `dispatchCap` (ab20),
  `followGuard`/`followZone` (ab23, cb, z), `advanceLead` (z), `passageFollow` (pf), `pressDepth` (ab21),
  `splitGuard` (sg).
- Hero starts are kept in the trainer's memory per lane; `creep_block_start_here reset` drops to the
  default at s ≈ 250 (by the spawner). The mid bench start is s ≈ 1470, lat 30:
  `__bt.placeStart('mid', 1470, 30)`.
- A hero standing still in the T2 passage (s 2300 or 2460, armDistance 70) does not provoke far-side
  detours (0/16); they come from dynamic blocking only (r1 ≈ 13 %, r6 ≈ 3 %), so detour handling is
  measured on long r1-based A/Bs.
- The trainer (`dota2-bench/game/scripts/vscripts/benchmark/creep_block.lua`) spawns Radiant creeps
  like the stock spawner (at the spawner, goal = first path corner), so splits and corner cutting
  are the real game's. Dire is not covered by the trainer.
- Octarine *Humanizer* must be on, otherwise script orders are dropped (the harness turns it on at
  runtime). Camera is centred on the hero while the key is held (`+dota_camera_center_on_hero`):
  without it off-screen orders wait for the humanizer and latency jumps to ~450 ms.
- Metric: seconds gained at own T1 over the free wave (free: first creep at T1 14.32 s, mean 14.93 s).
  "clean" = no creep got >150 units ahead of the hero while blocking (early abort, attempt failed).
- Noise: 10 attempts give ±1–2 failures; trust 20-attempt runs for final calls. Compare configs with
  `ab.cjs` (interleaved attempts) rather than series run at different times.
- Read results with `report.cjs <tag>`: gain per phase (contact / settle / T2 pass / between / T1
  pass, against the free wave of `out/free-curve.json`) and the autopsy of every failure;
  `--events n` for the event log of one attempt. See README "What a run records".
- The bench's planner defaults come from the live menu (Sensitivity): every series here is at 16.
  A session whose menu was at 35 (lookAhead 0.245, gap 13.1) ran r11 at +3.55 with the hero
  walking ~550 ahead before contact; pin the defaults (README) after every reload.
- Acceptance from `nz` on (the user's bar): no lost creep at all, a creep more than 150 ahead of
  the hero along the lane while the key is held (`escapeAhead`), and a block worth about +5 s on
  mid. `ab.cjs` drops a config at its first loss (`maxFail 1`) and when its clean attempts average
  below `minGain` (4.5) once it has `minGainAfter` (6) of them. Walking on ahead is for a wave
  spread wide; a compact wave is to be stopped.
- Server convars for causal tests go in the run's `convars` (README); the session's convars must be
  back at their defaults (`__bt.restoreConvars()`) before a `reload.cjs`, which forgets them.

## Current best

**Defaults now: pp90** (nz30, nz31) = r11 + `followGuard 90, followChain 1, followClear 60,
followClearPassage 2, passageExit 1, followInline 25, followPredict 2, splitWalk 200, splitClose
140, splitLeadTime 1.5` and Sensitivity 16 → lookAhead 0.13, gap −4.5, pressSpread 80. One lost
creep in 53 attempts: mid Pudge 30/30 +5.29 then 2/3 (nz32), top Pudge 20/20 +5.87. What makes it reliable: in a
tower passage a creep walking in line behind the front one counts as a jam before the front
stops (lessons 25, 26), and then the hero keeps out of the front creep's reach; past the tower it
does not hug it. Not yet measured: other heroes, bot, the arriving two-group split (pp50's loss).

Since nz46 the default moves at most every 4 ticks (`moveIntervalTicks 4`, the game's right-button
repeat, the user's requirement); pp90's numbers above were measured at 1 tick, and in nz46 the cap
cost reliability (4/5 clean against 9/9). Since nz47 `stopGuard 1` (a stop, which is no click,
ends a walk the cap keeps from turning): 8/10 clean at +5.91 under the cap. Since nz50
`moveReserve 60` (a correction under 60 waits two intervals, so the window is open for a jump
across the lane): 16/17 without a lost creep, but 4 of them under +5 s.

r11 = r10 + turnBackReach 0 (Advance lasts until the creep that went round T2
has really come back, lesson 23): with 6 melee + 1 ranged, where a third of the attempts have a
far-side detour, 27/30 vs 24/30 (tb); on normal waves it only changes the ~4 % detour attempts.

r10 = r9 + passageAfter 250 (a squeezing tower the hero is already past is not
its passage: no more walking forward before contact on mid; lesson 22). Mid Pudge 29/30 +5.44 vs r9
27/30 +4.89 in the same A/B; Juggernaut 18/20 +6.48, Invoker 18/20 +5.10 (pa, h10). Side lanes
never had the problem (their own T3 is out of the search range when the wave passes it): bot 9/10
+9.99, top 10/10 +5.42 (v10).

r9 = r7 with passageBefore 300 (r8 had 400). r7 = r1 + threatBias 0.5 + shadowGuard 300 + cornerCut 320 (turns > 20° only) +
funnel (spread 320, judged within 500 of the hero, confirmed 0.25 s) + passageGap 80 + Advance on a
far-side detour (walk on ahead without holding until the creep that went round is back near the
hero's line or about to draw level; ends at once if it reaches the tower on the lane side).

| Lane (start) | Hero | Clean | T1 mean | Source |
|---|---|---|---|---|
| **mid (s 1470), r10** | Pudge | **214/237 (90 %)**: 151/162 before, 63/75 in the weaker or3…or5 stretch | +4.9…+5.4 | pa-250, st1470, rv-mid, rw-r10, fv10, cw-r10, gd-r10, or3…or5 |
| top, r10 | Pudge | 132/145 (91 %) | +4.9…+5.4 | v10, fv10, tt, or…or5 |
| r9 vs r10 in the same A/Bs | Pudge mid, Jugg mid, Invoker mid, Pudge top | r9 84/90, r10 84/90 | r10 +0.55 / +0.35 / 0 / +0.06 | pa, h10, tt |
| mid, r10 | Juggernaut / Invoker / SF / Axe | 28/30, 27/30, 10/10, 9/10 | +6.5…6.9 / +5.1 / +6.37 / +6.52 | h10, fv10 |
| **bot / top (best positions), r10** | Pudge | 19/20 ; 37/40 | +9.7…10.0 ; +4.9…5.4 | v10, fv10, tt |
| mid to the river, r10 | Pudge | 11/12 | river +7.88 (T1 +5.11) | rv |
| mid (s 1470), r9 | Pudge | 138/144 (96 %) | +4.6…+5.0 | pb-300, mt-b300, b3-300, f9mid, sg-r9 |
| mid, r9 | Juggernaut / Invoker | 8/8, 8/8 | +6.35 / +4.49 | f9jugg, f9inv |
| mid, r8 (passageBefore 400) | SF / Axe | 7/8, 8/8 | +6.06 / +5.92 | h8 |
| **bot (best position, s 3251), r9** | Pudge | 10/10 | +9.56 | v9 |
| **top (best position, s 2759), r9** | Pudge | 10/10 | +4.74 | v9 |
| bot / top, r6 | Juggernaut, Invoker | 6/6, 5/6 ; 6/6, 4/6 | +13.5 / +6.8 ; +9.9 / +5.2 | ab22 (r6) |
| T2 far-side detours with Advance | mostly Pudge | 35 of 42 clean over every config with it (r9: 8 of 8) | | ad2…dv (0/47 without Advance) |
| Sensitivity 12 / 16 / 20, r9 mid | Pudge | 15/20, 20/20, 20/20 | +7.07 / +4.41 / +4.28 | sens |
| human reference, mid | Pudge (user) | 2/2 | +4.07 | out/human.json |
| r1 (start of the day), mid | Pudge | ~70 % | +5.3 | ab3 |

History:

| Config | Hero | Clean | T1 first | T1 mean |
|---|---|---|---|---|
| human (user, manual) | Pudge | 2/2 | +4.18 | +4.07 |
| original algorithm, camera on | Pudge | 4/6 | +2.72 | +2.83 |
| k1 (planner defaults before speed-share) | Pudge | 18/20 | +5.01 | +4.93 |
| r1 (lead share from hero speed) | Juggernaut | 7/8 | +6.23 | +6.19 |
| r1 | Shadow Fiend | 8/8 | +5.67 | +5.66 |
| r1 | Pudge | 9/12 | +5.35 | +5.26 |
| r1 | Axe | 7/8 | +6.12 | +6.05 |
| r1 | Invoker | 6/8 | +5.31 | +5.25 |
| r1, bot lane (start s 1500) | Pudge | 2/6 | +11.90 | +11.63 |
| r1, top lane (start s 1500) | Pudge | 0/8 | – | – |
| p1 (stop when aligned, any speed) | Pudge | 4/9 | +8.51 | +8.21 (clean runs only: the ceiling) |
| r1, same session as r2 (ab3) | Pudge | 21/30 | – | +5.43 |
| **r2** = r1 + threatBias 0.5 (ab3) | Pudge | **27/30** | – | +5.14 |
| r2, same session as r3 (ab4) | Pudge | 20/30 | – | +4.90 |
| **r3** = r2 + shadowGuard 300 (ab4) | Pudge | **26/30** | – | +4.57 |
| **r3** (ab5) | Pudge | **29/30** | – | +4.60 |
| r1 + shadowGuard (ab5, same session) | Pudge | 22/30 | – | +4.84 |
| r3 (ab6) | Juggernaut / SF / Axe / Invoker | 8/8, 7/8, 8/8, 8/8 | – | +5.50 / +4.98 / +5.36 / +4.37 |
| r3 + cornerCut (ab12) | Pudge mid | 10/10 | – | +4.23 |
| r4 = r3 + cornerCut + funnel (ab10, ab12) | Pudge top | 9/10, 7/10 | – | +3.88, +4.47 (was 0/8) |
| **r5** = r4 + passageGap 80, from best positions (ab14) | Pudge bot / top | **9/10, 10/10** | – | +10.05 / +4.78 |

## Lessons (hold until disproved)

1. Lane frame must follow the creeps' *natural route*: corner polyline wrapped round towers by
   tangents + arcs (T1 mid stands on the corner line, creeps drift round it from far away).
2. The cover window (lateral run of creeps one hero can stand in front of) must always contain the
   front-most creep (by predicted s). Choosing the "heaviest" group let flank creeps slide past
   (24/24 escapes had key != escaping creep). Fixing it: 9/10 clean.
3. Never step backwards along the route / turn round to face creeps (user report, humans never do
   it). Removing back-steps also removed the T2 failures (back% 1.1–1.8 → 0).
4. Stops are the block: never stopping (`holdStep`) gave +0.1 s.
5. Orders: gate them (min shift 30, share 0.35, refresh 1 s) → 11/s instead of 15/s, 11/12 clean.
6. Tower passage: from 550 before the tower hug the lane side and close the gap smaller than the
   smallest creep's diameter; ramp the lateral follow from the window centre to the route line.
7. Far-side tower detour: race to the merge point only when the creep's path round the tower
   (arc + stretch) is not longer than the hero's straight run + 0.35 s; then *wait there* until the
   creep is back on the route. Racing early or holding a merge point far on the tower side lets the
   near-side creeps walk past.
8. Hero speed matters (r1 fixes it with lead share = max(lateral misalignment, (creep speed − hero speed) / 45)): a hero almost as fast as creeps (Juggernaut 317 vs 325) that keeps leading
   the creep's predicted position just escorts the wave (+0.3 s). It must stop and take the bump.
9. Phases (report.cjs on old runs): almost all the gain is made between the towers (r1 Pudge
   +3.2 of +5.3, wave at ~200 u/s) and in the T2 passage (+0.9–1.0). p1 (stop when aligned) gains
   more in *every* phase (+8.35: settle +0.78, T2 +1.48, between +4.66, T1 +1.20) but all 5 of its
   failures are at first contact / settle, while r1's are between the towers.
10. A creep that passes T2 on the far side is a lost attempt: 20 of 22 such attempts failed (all mid
   history). It follows a hero *Hold* in the passage while a trailing creep stands in the tower's
   shadow (in front of the tower, within its lateral span) and the lane side is jammed; simple
   features (standing time, lateral offset) do not predict it (5 % of passages with a hold and a
   creep in the shadow, 1.8 % without the hold).
11. Order latency is the humanizer's cursor: ~0.1 s with an empty queue, ~0.24 s for any short
   glide after an idle pause (reaction 90 ms + linger 86 ms), up to ~0.45 s on a large lateral
   jump of the target. Stop/Hold orders execute at once. Since the blocker holds
   `ExecuteOrder.HoldOrders`, the cursor stays at the last order instead of the real mouse.
12. Every failure is preceded by a wave split (lateral spread > 170) 2–3.3 s before the loss, and
   holds cause splits: the hero holds 44 % of the 0.6 s before a split vs 20 % overall. In 354 split
   episodes (old runs) the 20 where the hero stood on the far side of the main group from the
   outlier lost nothing; standing towards the outlier (the planner's usual 70–87 %) lost 12 %.

13. Shift inside the cover window *towards* the most advanced creep outside it (threatBias): it
   trades a little gain between the towers for much more reliability. Toward 0.5 (r2) 27/30 vs r1
   21/30 in the same A/B; all toward variants 62/70 vs r1 29/40 (p ≈ 0.03). Away (−1) gains more
   (+5.59) but loses more (6/10).
14. Not holding in a tower passage while a trailing creep stands in the tower's shadow
   (shadowGuard 300) removes far-side T2 detours (0/30 vs 4/30) at −0.17 s in the T2 phase.

15. The free wave's lateral spread depends on the lane: mid 346 at s 500 → 135 at 1700 → 23 at T2;
   top 300–400 from s 800 to 2600 (two columns from the spawn) → < 100 after T2 (s 3500); bot < 100
   until 2000, 216 before T2, < 50 after it. Creeps' shortest paths close up where the route passes
   a tower, so a split wave is best met there (funnel mode).
16. Creeps cut corners: they head for the next corner once within ~300 of the current one (top lane
   32° turn at s 4635: free creeps pass 130–145 inside it). The planner's route went through the
   corner itself; on top every funnel failure was at s 4570–4735. Cut only turns sharper than 20°:
   cutting mid's 8° first corner (189 from the spawner) flipped the side the route wraps T3 and
   moved T2 by 100 along the route, and mid fell to 17/20 vs 19/20 with lower gains (ab15).

17. Only towers the route squeezes past are passages: the wrapped ones sit 39–40 from the route,
   but bot T1 is 228 away and top T2 162. Hugging those pinned the hero to the tower while creeps
   walked past on the open side (ab13: all 3 bot failures at T1, 3 of 4 top failures at T2).

18. Pressing a compact wave (no speed lead while the window group is narrower than `pressSpread`)
   is the lever towards the p1 ceiling: mid +5.7…+6.0 s at 75 % clean vs r6 +4.4 s at 82 %; bot
   +13.6 at 7/10, top +6.0 at 6/10 (r6: 10/10 both). It is on the Sensitivity slider:
   pressSpread = clamp((16 − value) × 20, 0, 200), so the default 16 is the reliable r6 and 12
   gives press80.

19. A creep that goes round T2's far side does not merge right behind the tower: it comes out
   ~370 to the side of the wave and closes in slowly (311 apart 300 past T2, 255 at 600, 174 at
   1200; 61 attempts). The old race to a "merge point" never fired (0 of 42 detours: it waited
   until racing was needed, but the creep stops counting as detouring once past the tower) and
   all 42 failed. Holding the near-side creeps lets the far one run free: the hero's lead over
   it falls 249 → 174 → 92 → −6 over its first 600 past T2. Walking on ahead at full speed
   instead keeps a lead until the columns have closed up (the user's idea: go forward and meet
   it) — Advance mode.
20. Detour detection (role Detouring) catches 40 of 42 T2 detours ~1.1 s before the creep passes
   the tower (0.6 s at worst), but also fires 61 times at T2 (and 144 at T1) on creeps that end
   up passing on the near side: Advance must end as soon as the creep turns back.

21. Towers block at hull 144 exactly: melee creeps get no closer than 179 to the centre, ranged 161,
   the hero 170 (all r7-era mid runs). A "gap between hero and tower" loss is the hero not yet in
   place, not a wrong radius.

22. Before contact the hero must stand still along the lane (it may line up sideways). Up to r9
   the passage was chosen by the *front creep's* position, so while the mid wave walked past its
   own T3 (~900 behind the hero) the planner was in passage mode for that tower and the shadow
   guard stepped the hero forward every frame: 154 on average (up to 487) before contact, every
   attempt. Not judging a tower the hero is already past (passageAfter 250) gave +0.55 s at no
   reliability cost. Side lanes did not have it (bot walks 3 before contact; top walks ~300 only
   through the funnel, on purpose). The funnel fires before contact on mid in 6 % of attempts
   (the wave still converging from the spawn): ~0.04 s on average, not worth touching (judging the
   spread on arrival from lateral velocities removes most of those but barely holds on top).

23. Advance must last until the creep that went round has actually come back. Its "turned back"
   check (the creep reached the tower on the lane side after all, i.e. a false alarm) compared the
   creep with the tower's centre line at any distance past the tower; a real detour creep closing
   in slowly crosses that line ~3 s later while still ~250 out, so Advance ended early in 69 of 74
   recorded detours and the hero went back to holding a wave split 250 wide. Checking only beside
   the tower (turnBackReach 0) keeps Advance on for 5–9 s, to the merge or the 8 s timeout.

24. Creeps collide with the hero at the sum of the hulls, without padding: melee 40, ranged 32 from
   Pudge (server.dll pads only creep↔creep 72 / 54 / 36 and building pairs, lesson 21). A creep
   whose next step would come that close stands 0.10–0.20 s (3–6 ticks) and paths round the far
   side of the hero's centre; its paths already go round a standing hero at that distance, so a
   hero that only stands is walked round (+0.06 s, `still`). What holds a creep is its
   look-ahead: the hero inside its ±45° cone, within 72 of its next position (ranged 64) and
   walking away from it makes it wait 0.35–0.45 s (11–14 ticks). That is ~58 % of r11's gain
   (`la`), and r11's empirical numbers sit right on it: the hold point 63 + 6 = 69 is just inside
   the 72 reach, so every step the hero takes on from there freezes the creep (`hull`, `long2`).

25. The wave splits on the held front creep, not on the hero. Right after the T2 passage the mid
   wave is compact (spread 31–47); the hero holds the front creep, the two behind it run into it
   (creep↔creep contact is padded, 72) and each walks round it on the side away from its centre:
   one 72 to the left, one to the right, and the wave stays 130 wide until one side gets past (all
   15 mid losses of r11 / server geometry: the lost creep 40–160 to the side for its last 3 s,
   another creep on the hero's other side). Not holding while a follower is about to run into the
   front creep (`followGuard 90`) is what removes it (`nz`; ab23 / cb had it too, 33/33, then
   rejected for its −1.1 s). Putting the hero beyond the window's edge (`sd`) or stepping on to
   catch look-ahead waits (`lp`) does not.
26. Whether a creep behind a stopped one walks round it depends on how far it is off the stopped
   creep's line, not on the stop's length (`nz` runs, 3 400 stops of a creep by the hero with
   another within 150 behind): in line (lateral offset < 25) it walks round in 90–95 % of the
   stops, after a 1–7 tick stop as after a 11–14 tick one (84 % / 90 %); already beside it (25+)
   it stops with it and walks round in 10 %. Walking on to keep a front creep out of its
   look-ahead reach does not work for a unit slower than the creeps (Pudge 280 against 325): the
   creep closes in at ~45 a second and is frozen anyway, at the moment the column is tightest.
27. The side a creep in line behind a stopped one walks round it cannot be known in advance when
   it is right behind it (nz30–nz36 runs, 393 walk-rounds after a stop by the hero, `fcside`):
   with the follower 12–25 off the stopped creep's line the server's rule (it goes to the side it
   is offset to) is right 79 % of the time, 5–12 off 64 %, 0–5 off 29 % (Predict.ts: 70 / 54 /
   57 %). A unit covers ±40 by contact and ~51 by look-ahead, the creep comes out 54–72 to the
   side: a freeze of the front creep with a creep in line close behind it is a coin flip for a
   lane the unit cannot hold. The ways out are not freezing then (the predictive in-line guard,
   `followPredict`: reliable, costs time where the wave comes single file) or getting the follower
   25+ off the front's line before the freeze (a pair, lesson 26).
28. How far the forecast (`Predict.ts`) can go, checked against nz30–nz37 recordings:
   - One tick at a time with the recorded positions, the server's stop rules (hard contact, look-
     ahead) find 70–78 % of the real stops and 60–75 % of the predicted ones are real. The rest sit
     within ±3 units of the boundary: which of two units moves first within a tick decides it. The
     best fit is the one walking behind seeing the one ahead where it has stepped to (leaders first;
     now so in `Predict.ts`), the hero half a tick on.
   - Over 1 s the positions are off by 69 on average (median 54; the straight-line guess 125). Near
     the hero the forecast keeps the creeps walking too much: they stand 0.50 s of the second, the
     forecast 0.34; only a third of the real stops of creeps near the hero come out within ±3 ticks
     — once a creep is 30 off its real place, its stops are someone else's.
   - Whether the front group fans out past 130 within 1 s: AUC 0.70 for the forecast, 0.74 for its
     spread now; from narrow (< 100) to wide, 0.65. An ensemble (waits drawn ±0.05 s, the side
     random within 8 of a blocker's centre) does not do better (0.61).
   - Free creeps do not converge on the corner line (`conv`): their paths follow the grid round the
     terrain, tens of units off it; heading along their own velocity improves the median, not the
     tail.
   The interactions that split the wave are decided within a few units and a tick, which a forecast
   from what the client sees cannot resolve a second ahead (lesson 27 is one case of it).

## Open problems

- Reached at nz30/nz31 (pp90: 50/50 at +5.3…+5.9 on mid and top); before it, no lost creep at +5 s on mid was not reached (`nz` … `nz29`). The losses that
  remain at +5.5…+6 (about one attempt in ten) are the wave splitting into three or four lanes:
  in a single file ~90 apart any stop of the front creep (a freeze or a hold) makes the next one
  run into it and walk round it on the side away from its centre (lesson 25), and one unit holds
  two lanes up to ~110 apart, not more; plus the wave arriving split 200–300 wide at the meeting,
  where whichever side the unit takes the other walks by. The best configs (tuning overrides,
  defaults unchanged): w200 = `followGuard 90, followChain 1, pressSpread 80, lookAhead 0.13,
  gap −4.5, splitWalk 200, splitClose 140` (37/41, +6.0); pc60exit = w200 + `followClear 60,
  followClearPassage 2, passageExit 1` (19/21, +5.5). The forecast (`Predict.ts`, `mpc`) is the
  tool for planning round the creeps' reactions, but its model is still ~70 off a second ahead
  (`forecast.cjs`).

- Mid, r9: ~5 % of attempts still lose a creep, nearly all two-sided splits between the towers.
  Earlier analysis (r6, 21 of 222): 11 of the 21 splits start at hero
  s 2600–3000, right after the T2 passage: the hero holds the front creep and the two creeps
  right behind it go round it on opposite sides. Follower alignment, hold length and wave spread
  at the hold do not predict it (4000+ holds, lessons 12, 18); pressing harder (press) or softer
  (toward 1) only moves along the same gain/reliability frontier. Needs a different technique
  (e.g. shaping the column before the hold), not another parameter.
- 3 of those 21 are the ranged creep slipping through the hug gap inside the T2 passage.
- Open-side losses in a passage (r10: top T1 4 of 40 attempts, mid T2 ~1 in 50). In the passage the
  hero hugs the tower and may leave the hug line by only `open` (≈ 40, so the tower gap stays
  narrower than a creep); a creep that drifts 85+ to the open side walks past. Top T1 in the
  harness frame: tower lat −272, free creeps pass at −60, blocked ones −92…+10 (median −42), the
  hero 150 before the tower stands at −116. Following the window out to the open side whenever no
  creep would be left on the tower side of the hero's new spot (or…or5, 150 attempts per side) did
  not lose fewer creeps and cost 0.3–0.4 s on mid: the ramp to the route line in a passage also
  does work there, the hero at the hug line slows the whole column.
- Dire is untested: the trainer spawns Radiant waves only and `runner.lua` assigns the player to
  Radiant before the pick, so a Dire test needs a change to the custom game itself. The Dire lane
  frames build like Radiant's (squeezing towers 39–40 from the route). Planner routes (cornerCut
  320) with the script's best positions and the own towers (s along the route, gap = distance from
  the route to the hull; ≤ 80 is a passage):

  | Lane | Best position s / lat | Towers s (gap) |
  |---|---|---|
  | Radiant top | 2776 / 283 | T3 807 (40), T2 3354 (162), T1 6204 (40) |
  | Radiant mid | 1577 / 82 | T3 553 (39), T2 2486 (39), T1 4718 (39) |
  | Radiant bot | 3254 / −8 | T2 3669 (40), T1 8828 (179) |
  | Dire top | 2932 / 349 | T2 3849 (40), T1 8988 (197) |
  | Dire mid | 1544 / −182 | T3 326 (39), T2 2764 (143), T1 5271 (40) |
  | Dire bot | 3003 / 246 | T3 804 (39), T2 3556 (174), T1 6241 (121) |

  Every Dire case has a tested Radiant twin: Dire top ≈ Radiant bot (passage T2 just past the
  start, then a long open stretch); Dire mid has no T2 passage (like Radiant top's T2) and a long
  straight run to a squeezing T1; Dire bot has no passage at all after the start. Best positions
  180–350 off the route line also occur on Radiant top (10/10).

  For a Dire option in the trainer (read from the running game through `CreepPathCorner.TargetPath`;
  the server cannot follow that chain, which is why `creep_block_config.lua` hard-codes Radiant's
  `corner_order`):

  | Lane | Dire spawner | Dire corner order (`lane_<lane>_pathcorner_badguys_<n>`) | Radiant order in the game |
  |---|---|---|---|
  | top | 3168, 5792 | 1,5,6,2,2b,2b1,3,4 | 1,5,6,7,2,2b,2b2,2b3,2b4,2b5,2b1,3,4 |
  | mid | 4096, 3584 | 1,8,2,3,4,5,6,7 | 1,9,2,3,4,5,8,6,7 (config has 1…7) |
  | bot | 6272, 3648 | 1,2,7,8,12,10,11,5,6,3,4 | 1,6,8,9,10,2,11,5,12,7,3,4 |

  Dire towers: tower1_top −5275,6036; tower2_top −128,6016; tower3_top 3552,5776; tower1_mid
  524,652; tower2_mid 2496,2112; tower3_mid 4272,3759; tower1_bot 6269,−2240; tower2_bot 6400,384;
  tower3_bot 6336,3032. Changes needed: `team` option in Validate/ParseArgs; per-team corner names,
  `corner_order`, `own_t1`/`enemy_t1` (swap goodguys/badguys) and unit names
  (`npc_dota_creep_badguys_*`, `DOTA_TEAM_BADGUYS`); `Spawner` matching "bad"/"dire"; the player on
  Dire (`runner.lua` assigns Radiant before the pick — either a launch option read in `Init` or
  `PlayerResource:SetCustomTeamAssignment` + `hero:SetTeam` at runtime, untested); `bt.js` TEAM
  from `opts.team` and `pathcorner_badguys`. Testing needs a reinstall (`Install-Addon.ps1`) and a
  restart, since `script_reload_code` does not work outside Tools.
- Advance (lesson 19): 35 of 42 far-side T2 detours clean over every config with it (r9: 8 of 8;
  2 of the 7 lost were the first version, which ended Advance too early); every r9 attempt where it
  fired was clean (56/56).
- Side lanes were measured from the script's best positions; from s ≈ 1500 bot loses creeps in
  the long stretch before T2 where the free wave itself fans out (lesson 15).

## Rejected ideas

- Shorter prediction (lookAhead 0.12 / 0.10) as default: +0.9…1.5 s but 70 % / 60 % clean (lk).

- Speed lead only for the first seconds after contact, then stop when aligned (s15, s25).
- Ranged creep counts as front only when 40 ahead of the melee (rf40).
- Shift away from the most advanced uncovered creep (threatBias −1): more gain, fewer clean.
- Wider room for the threat shift (windowRoom 0.7), gap 2, shadowStep 30, leadSpeedGap 60/90.
- Capping the humanizer's dispatch delay in the prediction (ab20): no effect.
- Walking back to meet the wave head-on (v2): two creep columns flow round both sides.
- Tower bias (stand on the tower side of the creep): lets creeps slide along the open side.
- Lead proportional to lateral misalignment (`leadPerLateral`): parallel escort, escapes.
- Extra lead when the wave is wide (`spreadLead` 0.5/1.0): same reliability, less delay.
- Front creep by "urgency" (time to draw level minus lateral reach): 8/9 failed, abandons pressed creeps.
- Longitudinal target from the creep's current position always (o1): 20/20 failed at first contact.
- Stop only when the wave is compact (q1): Pudge 4/9, Juggernaut +2.9.
- Never holding inside the tower passage (f1): no better than holding.
- Leaving a passage's hug line for the window on the open side when no creep can use the tower gap
  (passageRelease, or…or5): 135/150 vs 131/150, −0.35 s on mid.
- Walking on at full speed while the wave behind the held creep is split (sx, −1.3…−1.7 s), stepping
  instead of holding in the same case (sg) or before a follower bump (followGuard, −1.1 s). Advance
  pays off at T2 because the creep that went round stays far out to the side for seconds; an
  ordinary split closes up within about a second and walking on just gives the block away.

## Failure classes (report.cjs autopsy)

- two-sided split: two creeps press on opposite sides of the hero, it covers one (often the front
  ranged creep, whose window is narrower) and the other slides past;
- far-side tower detour (lesson 10);
- key creep lost the lateral race: the creep came from 100–350 units to the side while the window
  held another creep, by the time it became the key it was level with the hero.

## Series

| Tag | Change | Result | Verdict |
|---|---|---|---|
| v2–v7 | first planner versions | escapes at T2 and between towers | see lessons 1, 6 |
| v8 | window contains front creep | 9/10 clean, +3.43 | kept |
| v8-pl40 | passageLead 40 | 10/10, +4.19 | kept |
| v8-look10 | lookAhead 0.1 | peaks +7, 4/10 failed | too aggressive |
| c2 / d3 | lookAhead 0.15, gap 6, passageBefore 400/550 | 8/10, +5.16 / +5.44 | kept (d3) |
| e1/e2 | passage lateral ramp | 7/10, 6/10 | noise, ramp kept |
| h1/h2 | no back-steps, forwardShare 0.4/0.25 | 10/12, +4.49/+4.72 | kept (no back-steps) |
| i2 | order gate 30 / 0.35 / 1 s | 11/12, +4.99 | kept |
| k1 | race only when needed, wait at merge | 18/20, +5.01 | kept |
| n1 | forwardShare 0 (lateral steps allowed) | Pudge 10/12 +5.23, Jugg +0.3 | jugg broken, see lesson 8 |
| p1 | lead only while the creep is not aligned | Jugg 7/8 +6.04, Pudge 4/9 (+8.5 clean) | speed dependent |
| r1 | lead share from hero speed (gap 45) + alignment | Jugg 7/8 +6.23, SF 8/8 +5.67, Pudge 9/12 +5.35, Axe 7/8 +6.12, Invoker 6/8 +5.31 | kept: best on every hero |
| r1-top / r1-bot | side lanes, Pudge | top 0/8, bot 2/6 (+11.6 clean) | see open problems |
| tools | phases / events / autopsy (report.cjs), planner trace in samples, ab.cjs | – | see README |
| r1b | r1 again, Pudge, 10 | 6/10, +5.17; 3 failures from a T2 far-side detour (LRLL) | noise vs r1 9/12, see lesson 10 |
| s15 | speed lead only for 1.5 s after first contact, then p1 | 0/5 (2 at contact, 3 between: two-sided / window) | rejected |
| ab1 | A/B Pudge: r1 / speed lead 2.5 s then p1 (s25) / ranged front lag 40 (rf40), stopped at round 5 | r1 4/6 +5.48, s25 1/5 (+7.62 clean), rf40 2/5 +5.14 | s25 rejected (p1 after settle loses creeps to two-sided splits, like s15) |
| ab2 | A/B Pudge 10 rounds: r1 / rf40 / threatBias −1 (away: shift inside the window away from the most advanced uncovered creep) / +1 (toward) | r1 8/10 +5.03, rf40 7/10 +5.36, away 6/10 +5.59, toward 9/10 +4.58 (between phase +2.52 vs +3.17) | same reliability/gain frontier; rf40 rejected (4/10 + 7/10) |
| ab3 | A/B Pudge 30 rounds: r1 / toward 1 / toward 0.5 / shadowGuard 300 | r1 21/30 +5.43, tw1 26/30 +4.61, **tw05 27/30 +5.14**, sg 23/30 +5.10 (0 far-side T2 detours vs r1 4) | threatBias 0.5 becomes the default (r2) |
| ab4 | A/B Pudge 30 rounds: r2 / r2 + shadowGuard 300 / r2 + windowRoom 0.7 | r2 20/30 +4.90, **sg 26/30 +4.57**, room7 25/30 +4.83 | shadowGuard 300 becomes the default (r3). r2 dropped from 27/30 (ab3) to 20/30: session drift is large, only same-A/B comparisons count |
| ab5 | A/B Pudge 30 rounds: r3 / r3 + windowRoom 0.7 / r3 without threatBias | **r3 29/30 +4.60**, room7 24/30 +4.50, nobias 22/30 +4.84 | r3 confirmed: both parts (threatBias 0.5, shadowGuard 300) hold up in two A/Bs each |
| ab6 | A/B r1 vs r3, 8 rounds per hero | Jugg 7/8 +6.03 → **8/8 +5.50**; SF 5/8 +5.79 → **7/8 +4.98**; Axe 7/8 +5.97 → **8/8 +5.36**; Invoker 4/8 +4.77 → **8/8 +4.37** | r3 more reliable on every hero (31/32 vs 23/32), ~0.5 s less gain |
| ab7 | A/B Pudge 20 rounds: r3 / leadSpeedGap 90 / gap 2 / shadowStep 30 | **r3 18/20 +4.51**, lsg90 11/19 +5.56 (7 lost between), gap2 16/20 +4.58, step30 14/20 +4.59 | r3 stays; more press still costs reliability |
| ab8 | side lanes r1 vs r3, Pudge, 8 rounds | bot r1 4/8 +11.70, r3 5/8 +10.79 (all failures in the long settle stretch before T2); top 0/8 both (the far column of a split wave) | see lessons 15, 16 |
| ab9 | top: r3 / funnelSpread 220 / 160 | r3 0/8, **f220 4/8 +4.63**, f160 3/8 +4.31; all funnel failures at the s 4635 corner | funnel works on top |
| ab10 | top: funnel 220 / funnel 220 + cornerCut 320 | f220 6/10 +4.71 (3 of 4 failures at the corners), **f220 + cut 9/10 +3.88** (T1 pass +0.23 vs +0.64) | corner cut fixes the corner losses |
| ab11 | mid & bot: r3 / r4 = r3 + funnel 220 + cornerCut 320, 12 rounds | mid r3 11/12 +4.45, r4 11/12 +3.72 (funnel fired on the wave still converging from the spawn, hero left for T2); bot r3 7/12 +11.06, r4 6/12 +11.59 (bot losses are in the long settle stretch, spread 150–260, funnel never fires) | funnel must judge the wave only when it reaches the hero |
| ab12 | cornerCut 320 everywhere; funnel 320 judged only when the front creep is within 500 of the hero | mid cut 10/10 +4.23, mid cut+funnel 7/10 +4.39 (funnel flickered 9 frames in 3 attempts), top cut+funnel 7/10 +4.47 (funnel in every attempt) | defaults now cornerCut 320, funnelSpread 320 + 0.25 s confirmation (r4) |
| ab13 | r4 from the best positions (bot s 3251, top s 2759, mid as before), 10 rounds | bot 7/10 +9.70 (3 lost at T1), top 6/10 +4.96 (3 lost at T2), mid 8/10 +4.64 | see lesson 17 |
| ab14 | side lanes from best positions: passageGap 80 (r5) vs no limit, 10 rounds | **bot 9/10 +10.05** vs 7/10 +8.81 (T1 pass +0.67 vs +0.26); **top 10/10 +4.78** vs 8/10 +4.88 | passageGap 80 kept (r5) |
| ab15 | mid 20 rounds: r5 vs r3 | r5 17/20 +4.33 (T2 +0.63, between +2.72), r3 19/20 +4.66 (T2 +0.80, between +3.01); funnel never fired on mid | corner cut changed mid's route (lesson 16): now only turns > 20° are cut (r6), mid's route is r3's again |
| ab16 | r6 side lanes from best positions, 10 rounds | **bot 10/10 +10.14, top 10/10 +5.05** | r6 confirmed |
| ab17 | mid 20 rounds: r6 / leadSpeedGap 60 / pressSpread 60 (no speed lead while the window group is narrower than 60, full at 120) | r6 16/20 +4.42, lsg60 12/20 +5.24, **press60 15/20 +5.77** (T2 +1.15, between +3.30, T1 +0.92) | press looks like the way to the p1 ceiling, confirm |
| ab18 | mid 20 rounds: r6 / pressSpread 40 / 60 / 80 | r6 17/20 +4.41, p40 15/20 +5.16, p60 15/20 +5.72, **p80 15/20 +5.96** (T2 +1.20, between +3.51) | press: +1.3–1.5 s for ~7 points of clean rate (p60 30/40 vs r6 33/40 over ab17+ab18) |
| ab19 | press80 on side lanes and Invoker, 10 rounds | bot 7/10 +13.59, top 6/10 +6.04, Invoker r6 8/10 +4.30 vs p80 8/10 +5.26 | press off by default, on the Sensitivity slider below 16 |
| ab20 | mid 20 rounds: r6 / dispatch delay in the prediction capped at 0.1 s / at 0 | all 18/20, +4.24 / +4.29 / +4.46 | rejected (removed): latency spikes before losses are a symptom of big target jumps, not a cause |
| ab21 | mid 20 rounds: r6 / press80 / press80 judged over 300 behind the front | r6 19/20 +4.30, p80 14/20 +5.96, p80 depth 300 16/20 +5.38 | same frontier; press stays on the slider. r6 on mid: 54/60 over ab18, ab20, ab21 |
| ab22 | r6 side lanes, other heroes, 6 rounds | bot Jugg 6/6 +13.52, Invoker 6/6 +9.89; top Jugg 5/6 +6.83, Invoker 4/6 +5.15 | r6 holds on side lanes for other heroes |
| ab23 | mid: followGuard 90 / 120 (step instead of hold while a creep is about to run into the front creep), stopped at round 13 by a game restart | r6 9/13 +4.44, fg90 13/13 +3.35, fg120 10/12 +2.90 | same frontier (reliable but −1.1 s); kept off |
| ad2 | Advance on detour (first version), r1 base, 30 rounds | adv0 26/30 +4.79 (no far-side detours), adv1 24/30 +4.46: 2 far-side detours, 1 clean (the first clean detour on record: advanced 4.1 s, T1 +2.6); the other ended Advance after 1 s because the route frame mis-projected the creep 370 off the route | end conditions moved to world geometry |
| ad3 | Advance (world-geometry end conditions), r1 base, 40 rounds | adv0 30/40 +4.54: 2 far-side detours, both lost; **adv1 31/40 +4.26: 1 far-side detour, clean; Advance fired in 7 attempts, 7 clean** | detours with Advance 2/3 clean (ad2+ad3) vs 0/44 without; cost ≈ 0.3 s on r1; kept on |
| ad4 | Advance on the r6 base, 30 rounds | adv0 26/30 +4.24 (3 of the 4 failures were far-side detours, all lost), **adv1 28/29 +4.21** (1 detour, clean; Advance in 5 attempts, 5 clean) | Advance kept: r7 = r6 + advance. Detours: 3/4 clean with it, 0/47 without |
| cb | mid 20 rounds on r7: followGuard 90 / fg90 + press80 / press80 | r7 19/20 +4.29, fg90 20/20 +2.72 (±1.46), fg90+p80 18/20 +4.63, **p80 18/20 +5.54** | followGuard too costly; press with Advance looks safer than without (15/20, 14/20 in ab18/ab21), confirm |
| pv | mid 30 rounds: r7 / r7 + press80 | **r7 27/30 +4.24**, p80 22/30 +5.84; detours with Advance: r7 1/2, p80 2/3 clean | press stays on the slider; r7 on mid 74/79 (ad4, cb, pv) |
| v7 | r7 checks, 10 rounds | bot 9/10 +8.98, top 10/10 +4.28, Jugg mid 10/10 +5.23, Invoker mid 10/10 +4.35 (Advance fired 1× on bot, 0× top; Jugg's 2 Advance attempts ~1.5 s lower) | r7 holds everywhere |
| z | mid 25 rounds: r7 / advanceLead 300 (keep blocking while the far creep is > 300 behind) / followGuard 90 only within 600 past a squeezing tower | r7 23/25 +4.27, lead300 22/25 +4.56 (1 of 4 Advance attempts lost), fz600 22/25 +3.93 | neither kept |
| pf | mid 30 rounds: r7 / passageFollow (no lateral ramp to the route when the window is on the tower side) | **r7 30/30 +4.44**, follow 28/30 +4.57 (T1 pass +0.76 vs +0.66) | not kept. r7 on mid: 127/134 over ad4, cb, pv, z, pf; 5 of the 7 losses are on the approach to T1 in passage mode, on the tower side |
| pp | mid 30 rounds: r7 / passageLead 20 / passageBefore 400 | r7 28/30 +4.42, lead20 26/30 +4.57, **before400 30/30 +4.61** (between +2.88 vs +2.73) | confirm passageBefore 400 |
| pb | mid 30 rounds: r7 / passageBefore 400 / 300 | r7 29/30 +4.10, 400 27/30 +4.66, 300 28/30 +4.82; with pp: r7 57/60 +4.26, **400 57/60 +4.63** | passageBefore 400 becomes the default (r8): +0.4 s for free |
| v8 / tp | r8 vs r7 on side lanes | bot 10/10 +9.19 vs 10/10 +9.68; top 8/10 +5.06 vs 10/10 +4.47, then top 20 rounds: **r8 20/20 +4.89** vs r7 20/20 +4.70 | r8 kept on side lanes |
| mt | mid 25 rounds around r8: passageBefore 300 / threatBias 0.7 / lookAhead 0.12 | r8 23/25 +4.76, b300 23/25 +5.04, tb07 24/25 +4.43, **look12 23/25 +5.38** | confirm lookAhead 0.12 |
| lk | mid 30 rounds: r8 / lookAhead 0.12 / 0.10 / 0.12 + passageBefore 300 | **r8 26/30 +4.42**, 0.12 21/30 +5.35, 0.10 18/30 +5.90, 0.12+b300 17/30 +5.31 | shorter lookAhead is the same delay/reliability trade (mt's 23/25 was luck); stays on the Sensitivity slider |
| h8 | r8 other heroes on mid, 8 rounds | Jugg 7/8 +6.39, SF 7/8 +6.06, Axe 8/8 +5.92, Invoker 8/8 +4.85 (r3: +5.50 / +4.98 / +5.36 / +4.37) | r8 holds and gains more on every hero |
| b3 | mid 30 rounds: r8 (passageBefore 400) / 300 | 400 25/30 +4.72, **300 29/30 +5.01**; side by side over pb, mt, b3: 300 80/85 (94 %) +4.95 vs 400 75/85 (88 %) +4.6 | passageBefore 300 becomes the default (r9) |
| v9 | r9 side lanes from best positions, 10 rounds | bot 10/10 +9.56, top 10/10 +4.74 | r9 holds on side lanes |
| f9 | final r9 checks | mid Pudge 28/29 +4.62; Juggernaut 8/8 +6.35; Invoker 8/8 +4.49 | r9 is the default |
| sens | Sensitivity slider calibration on r9, mid Pudge, 20 rounds (12 = lookAhead 0.13, gap 4.5, press 80; 20 = 0.17, 7.5, no press) | **12: 15/20 +7.07**, **16: 20/20 +4.41**, **20: 20/20 +4.28** | the slider is a real delay/reliability dial |
| r9-detours | far-side T2 detours in all r9 mid runs (pb-300, mt-b300, b3-300, f9mid, sens) | 6 detours, **6 clean**; Advance fired in 42 attempts, 42 clean | e.g. f9mid #3: M1 round the far side (331 to the side), Advance 3 s, all four creeps behind the hero at T1, +3.3 s |
| dv | detour-prone base (r9 without shadowGuard and threatBias), Advance off / on, 59 rounds | off 47/59, **on 52/59**; on: 2 far-side detours, 2 clean; Advance in 14 attempts, 14 clean | Advance also prevents detours: walking on releases the jam at the tower |
| ovl | overlay draw probe (MenuSDK.Canvas methods wrapped), 8 attempts | 30 475 frames drawn without an error; every Advance frame (155) showed "CREEP GOING ROUND TOWER: walking on ahead" on the tower and "Creep goes round the tower: walking on ahead of it / Block +X s"; block / passage / funnel notes, KEY labels, lead share, window, threat, rings and arrows all present | overlay verified by what it draws (the game window itself cannot be captured) |
| sg | mid 30 rounds: r9 / splitGuard 160 / 110 (step instead of a hold while two creeps close behind the front one walk at it from opposite sides) | **r9 30/30 +4.80**, sg160 28/30 +4.56, sg110 29/30 +4.44 | rejected (removed); r9 on mid now 138/144 (95.8 %) |
| screen | the game window captured during attempts (Dota brought forward for a moment, its window rect copied from the screen) | overlay seen in game: status "Tower passage: closing the gap / Lead 100% (speed) / Block +X s", KEY / THREAT labels, creep rings and arrows, tower circle with its note. Labels sat on Dota's health bars → moved below the units, tower notes above the circle | the custom game's camera does not follow the hero, it ends up near the screen edge (bench only) |
| sw | "split walk": walk on ahead without holding while the wave behind the front creep is wider than 220 / 280 (Advance's idea applied to splits) | the game closed after 7 attempts: r9 3/3 +4.95, 220 2/2 +3.92, 280 2/2 +3.01 | inconclusive, lower gain; code removed — worth a proper 30-round A/B |
| sx | split walk again, mid, stopped after 10 rounds (the cost is plain). A first try (sw30, 2 rounds) fired right after the spawn on the wave still converging and walked ~1000 ahead without blocking; sx starts the walk only in block mode with the front creep within 40 of contact, wave behind it wider than 160 / 200, until it closes to 130 or the front creep drops 200 behind | r9 9/10 +4.96 (between +2.89), **160 9/9 +3.24** (between +2.06, settle −0.01), **200 9/9 +3.63** (between +2.19); both much steadier (±0.35 vs ±0.91) | rejected (removed): −1.3…−1.7 s against a ~4 % failure rate; Sensitivity 20 already gives 20/20 at +4.28 |
| arm | mid 10 rounds: key held from the spawn (r9) / pressed when a creep is 400 / 250 from the hero | r9 10/10 +4.91 (contact from s 1566), arm400 9/10 +5.49, **arm250 10/10 +5.64** (contact from s 1486) | the hero gives distance away before contact: see lesson 22 |
| pa | mid 30 rounds: r9 / passageAfter 250 (a squeezing tower the hero is more than 250 past is not its passage) / r9 with the key pressed at 250 | r9 27/30 +4.89 (settle +0.20), **pa250 29/30 +5.44** (contact from s 1475, settle +0.49), arm250 23/30 +5.33 (6 of 7 losses: key creep lost the lateral race) | passageAfter 250 becomes the default (**r10**); the late key is not the answer: lining up sideways before contact is what keeps the lateral race |
| h10 | r9 / r10 on mid, Juggernaut and Invoker, 8 + 12 rounds | Jugg r9 19/20 ≈ +6.13, **r10 18/20 ≈ +6.48** (contact from s 1290 vs 1506); Invoker r9 19/20 ≈ +5.09, r10 18/20 ≈ +5.10 | with pa: r9 65/70, r10 65/70; r10 kept |
| st | r10 mid start sweep, 20 rounds (`start` option, goBest off): s 1300 / 1470 (the script's best position) / 1650, lat 30 | 1300 16/20 +5.14 (settle +0.51), **1470 19/20 +5.10**, 1650 16/20 +4.86 (settle +0.09); every loss between the towers | the best position stays; the start barely moves the gain (the wave gets blocked to the same pace by T2) |
| rv | r10 mid with the key held to the river (`releaseAt: "river"`) instead of T1, 12 rounds | 11/12, T1 +5.11, **river +7.88** (6.60…9.03; free wave reaches the finish at 18.17 s); the 1 loss in the T2 passage (ranged), none after T1; after T1 the planner just blocks and holds | blocking on past T1 keeps paying (~2.8 s more by the river) |
| rw | mid 30 rounds: r10 / rangedWeight 1.0 / 0.3 (how much the ranged creep counts when choosing the cover window; 6 of the 16 r10 losses so far were the ranged creep) | r10 26/30 +4.90, rw1.0 26/30 +4.99, rw0.3 25/30 +5.12 | no effect, 0.6 stays. r10 26/30 here vs 29/30 in pa: session drift again |
| fv10 | r10 final check in one session, 10 rounds each | mid Pudge 9/10 +4.90, Juggernaut 10/10 +6.92, Invoker 9/10 +5.05, SF 10/10 +6.37, Axe 9/10 +6.52; bot 10/10 +9.72; top 8/10 +4.93 (both losses at T1: the hero hugs the tower side in passage mode, the creep walks by ~85 to the open side) | 65/70 |
| tt | top 20 rounds: r9 / r10 (were fv10's two T1 losses r10's?) | r9 19/20 +5.08, r10 19/20 +5.14; the one loss of each is at T1 too | not r10: top T1 is a weak spot of both (4 of the last 40 top attempts, all at T1) |
| cw | mid 30 rounds: r10 / coverWidth 1.3 / 0.8 (lateral span of the cover window, in contact distances) | **r10 30/30 +5.12**, 1.3 26/30 +4.89 (4 ranged slips), 0.8 25/30 +5.28 | coverWidth 1 confirmed both ways |
| gd | mid 30 rounds: r10 / groupDepth 200 / 90 (how far behind the front creep a creep still counts for the window) | **r10 27/30 +5.08**, 200 24/30 +5.15, 90 24/30 +5.27 | groupDepth 140 confirmed both ways; with rw, cw: the window parameters sit at a local optimum |
| or | top 30 rounds: r10 / passageRelease 300 (in a passage, follow the window out to the open side, un-ramped and without the `open` limit, while no creep within 300 behind the hero would be more than 0.5 contact on the tower side of the new spot) | r10 27/30 +5.11 (2 lost at T1), release 25/30 +5.09 (2 at T1; its 3 losses between the towers came from attempts where it never fired); fired in 14 of 30 | the 0.5-contact rule is too strict: in the T1 cases one creep at +48 (still covered from the hug line) blocked it while the others walked by at +80…+155 |
| or2 | top 30 rounds: r10 / release with the full contact (passageReleaseCover 1) | r10 25/30 +4.87 (3 lost at T1, 2 just before it), **release 28/30 +5.18** (2 at T1); fired in 21 of 30 | promising, check mid and repeat (or3) |
| or3 | mid + top 20 rounds: r10 / release (cover 1) | mid r10 14/20 +5.06, **release 18/20 +4.76**; top 19/20 +5.21 vs 19/20 +5.06; on mid it fires in every attempt (T2 and T1 passages), top 17 of 20 | the one release-side loss with a creep through the tower gap had been lost 2 s before the release fired (it fires once that creep counts as passed) |
| or4 | mid 30 rounds: r10 / release | r10 25/30 +5.19 (T2 pass +0.81), release 25/30 +4.91 (T2 pass +0.71) | so far release 90/100 vs r10 83/100 (mid 43/50 vs 39/50, −0.3 s; top 47/50 vs 44/50); r10 on mid is clearly weaker in this game session (39/50) than in earlier ones |
| or5 | mid + top 25 rounds: r10 / release | mid r10 24/25 +5.20, release 23/25 +4.78; top r10 24/25 +5.22, release 22/25 +5.21 | **rejected (removed)**: over or2…or5 release 135/150 vs r10 131/150 (noise) and −0.3…−0.4 s on mid every time; the open-side loss at top T1 stays (open problems) |
| sv | r10 mid 30 rounds: Sensitivity 16 (default) / 20 (lookAhead 0.17, gap 7.5) / 24 (0.19, 9) | **16 27/30 +5.22**, 20 28/30 +4.26, 24 27/30 +4.08 | above 16 the slider only shortens the block (−1 s), it does not lose fewer creeps; default stays, tooltip now says "higher blocks shorter" |
| td | r10 mid 30 rounds: threatDepth 300 / 450 / 200 | 26/30 +4.98, 26/30 +5.08, 26/30 +5.15 | no effect, stays |
| adv-exit | where Advance ended on every recorded far-side T2 detour (all versions with Advance, 74) | it ends after ~3 s with the detour creep still 220–310 to the side and 150–350 behind (69 of 74); 56/69 of those clean, the losses 2–5 s later (two-sided while the creep closes in). Cause: `TurnedBack` ("reached the tower on the lane side after all") held at any distance past the tower, so the creep converging back across the tower's centre line ended Advance | see lesson 23 |
| tb | mid with 6 melee + 1 ranged (a far-side detour in a third of the attempts), 30 rounds: old Advance end / TurnedBack only beside the tower (turnBackReach 0) | old 24/30 +19.42 abs (detours 7/8, 6 losses "lost the lateral race"), **fix 27/30 +19.21** (detours 9/10, Advance now 5–9 s and ends with the creep merged or on timeout) | turnBackReach 0 becomes the default (**r11**) |
| r11 | mid 3+1, 30 rounds: old Advance end / r11 | old 30/30 +4.96, r11 27/30 +4.96; r11's 3 losses all in attempts where Advance never fired (the code path is then identical), false-alarm Advances 0.1–2.6 s as before | r11 kept; also a measure of the noise: identical behaviour, 30/30 vs 27/30 |
| ap | 6 melee + 1 ranged, 30 rounds: r11 / advancePace 300 / 200 (block the rest normally while the creep that went round is more than that far behind, walk on once it closes in) | **r11 24/30 19.14 abs (detours 7/7)**, pace300 22/30 19.04 (12/12), pace200 19/30 19.29 (6/11: Advance off after 1.5 s, the far creep runs free) | rejected (removed): holding while the far creep is behind lets it catch up, as lesson 19 says. r11 detours on 6+1: 16/17 |
| am | 6 melee + 1 ranged, 30 rounds: advanceMerge 110 (r11) / 70 / 160 (how close the creep that went round must be to the hero's line to end Advance) | 110 21/30 (detours 7/7), 70 22/30 (7/8), 160 23/30 (7/10: ends too early again) | 110 stays; r11 detours on 6+1 over tb, ap, am: 23/24 |
| hx | r11 on 6 melee + 1 ranged with other heroes, 15 rounds | Juggernaut 15/15 (detours 5/5), Invoker 12/15 (detours 4/5; the other 2 losses two-sided between the towers) | Advance holds for other heroes: r11 detours on 6+1 32/34 over Pudge, Juggernaut, Invoker |
| flip | is window / key flip-flopping a precursor of losses? (r10/r11 mid, between the towers, 2846 s of clean blocking vs 63 s right before losses) | key switches 2.55/s clean vs 2.05/s before a loss; key jumps > 60 sideways 1.68/s vs 1.71/s | no: window hysteresis not worth an A/B. Like lesson 12/18, the losses are not foreshadowed by any local feature found so far |
| prof | technique profile (compare.cjs) and back-steps measured against the creeps' own walking direction | human: fwd 224 u/s, still 5 %, contact 26 %, 0.2 stops/s; r10: 208 u/s, 10 %, 15 %, 0.8/s. Moving against the creeps faster than 60 u/s: r10 0.9 % of the time, human 4.2 %, both almost all at s ≈ 1500 (lining up sideways while the wave still converges diagonally); during the block (s > 1750) r10 ~0.01 s per attempt, none from creep pushes | no back-steps to fix; compare.cjs "back" (harness polyline frame) also counts moves along the planner's wrapped route at T2 |
| v10 | r10 side lanes from best positions, 10 rounds | bot 9/10 +9.99 (1 two-sided between T2 and T1), top 10/10 +5.42 (r9 v9: 10/10 +9.56, 10/10 +4.74) | r10 holds on side lanes |
| m11 | r11 mid, 15 attempts, new game session, Sensitivity pinned to 16 (4 earlier attempts at the menu's 35 discarded) | 12/15 +5.43 (between +3.40, T2 +0.78) | the reference for the measurements below |
| hull | r11 runs (m11 + la-on, 27 attempts) against server.dll's movement (`dota2-ida/notes/creep/REPORT.md`) with `stops.cjs`: closest centres, every creep stop (position unchanged between ticks) with its length, the unit in its way and the rule | closest hero–melee 39.4, hero–ranged 32.2: the hull sums (24 + 16, 24 + 8), the planner's padded 63 / 45 are crossed in every attempt (median per creep 72 / 70). 2108 stops: creep↔creep hard contact (padded, melee–melee 72) 1454, 1301 of them 4–6 ticks (0.10–0.20 s); look-ahead waits on the hero 553, 507 of them 11–14 ticks (0.35–0.45 s + a tick for the new path), every one with the hero walking away from the creep inside its cone, none short; hard stops on the hero 19 only, at 41–48 (melee) / 35–41 (ranged) from it. Stopped ticks: look-ahead on the hero 7123, hard on the hero 264, creep↔creep 8285 (the column jamming behind its front creep). Creep↔creep walk-off: far side of the blocker 288, near 138, straight 381 | lesson 24 |
| still | the hero standing still (`armDistance` 1, goBest off) at the mid start (s 1470, lat 30) and in the T2 passage (s 2250, lat 30), 8 attempts each, collision radii and paths drawn (`dota_unit_show_collision_radius 1`, `dota_unit_draw_paths 1`) | the wave loses +0.06 s; in the passage creeps slide round the hero at exactly the hull sums (closest 39.6 / 31.8, ranged median 32.2) and stop on it once in 16 attempts: their paths go round it before they touch. Every creep passing it (62) passed on the side it was already offset to, i.e. far from the hero's centre, 6 of them from within 50 of its line. In the picture the hull discs of the creeps pressed on Pudge touch his, no padding gap | hard contact at the hull sum and the far-side path round the hero: confirmed. A standing hero is walked round, it hardly blocks |
| long2 | r11 with `dota_unit_blocked_wait_time_long 2.0`, 6 attempts | every look-ahead stop on the walking-away hero 59–62 ticks (76 of 76, none left at 11–14), hard stops still 4–6; 5/6 +9.57 (T2 +1.23, between +5.90) | the 0.35–0.45 s waits are the look-ahead's, set by that convar: causal |
| la | r11 / r11 with the look-ahead off (`dota_unit_blocked_look_ahead_angle_threshold 1.1`), 12 rounds | on 10/12 +5.52, **off 10/12 +2.31** (contact +0.01 vs +0.26, T2 +0.39 vs +0.96, between +1.38 vs +3.31); off: no 11–14 tick stops at all, the hero's stops become hard ones at 41–50 | ~58 % of r11's gain is look-ahead waits on the hero (creep↔creep look-ahead hardly exists: melee–melee hard contact 72 is wider than its reach 64). Convars back to defaults |
| sg | mid 30 rounds: r11 (by overrides: `hullContact 0`, cornerCut 320, routeClearance 40, gap 6, coverWidth 0.5, windowRoom 0.5, alignedShare 0.3, alignedRange 0.5, passageLead 40) / **server geometry** (`hullContact 1`: contact = hull sum 40 / 32, look-ahead reach 72 / 64 from the creep's next position with the hold point at reach + gap −3 = 69 / 61, passage lead reach + 31, Passed / Flanking from the hull contact, Pressing = inside the reach and cone, cover window and threat room 0.8 of ±contact, aligned share 0.47 / 0.79 of contact; tower passage: the hero no farther from the tower's centre than the smallest active creep's tower contact + hero contact − gapMargin = 188 ranged / 214 melee instead of 201 / 237; cornerCut 300, routeClearance 36) | r11 23/30 +5.44 (between +3.30; 2 ranged slips), **hull 27/30 +4.88** (between +2.82 ±1.02; no ranged slip). The lost time is Advance: far-side T2 detours 4/30 vs 1/30 (2 of them the ranged creep, which no longer fits through the passage) and false-alarm Advances 6 vs 3, each ~1 s (Advance attempts +4.23, the others +5.26 vs r11's +5.62). All 15 mid losses of this session (m11, la-on, sg) are the same: the lost creep 40–160 to the side of the hero in its last 3 s (within 40 of the hero's line 4–34 % of that time), another creep on the hero's other side on 53–99 % of the ticks, the key flipping between them | more reliable, −0.56 s; see `sgt` and lesson 25 |
| sgt | top 30 rounds: r11 / server geometry / server geometry with r11's tower gap (`gapMargin −7`: 201 for the ranged creep) | r11 25/30 +5.42 (3 lost at T1 on the open side, 2 two-sided between the towers), **hull 27/30 +5.29** (2 two-sided, 1 ranged slipping by the standing hero at T2), gap 28/30 +5.13 (1 at T1, 1 two-sided) | server geometry kept as the base: more reliable on both lanes, the top T1 open-side loss nearly gone (melee gap 214 instead of 237) |
| sd | mid: server geometry / `sideBias` (the hero beyond the window's edge away from the route line, so every window creep is on one side of its centre and they all walk round the same way), margin 10 / 20, stopped after 7 rounds | hull 7/7, side10 6/7, **side20 2/6 (dropped)**: two-sided splits and lateral races as before, plus contact losses (the far window creep uncovered) | rejected (switch left at 0) |
| lp | mid: server geometry / `laPulse` (step on from a hold when a creep behind will be inside the look-ahead reach once the order lands, or has stood ≥ 0.33 s minus the latency, i.e. is about to resume), margin 15 / 30; stopped at round 5 by the game leaving the custom game | hull 4/5, step15 2/4, step30 2/4; every loss two-sided | rejected (switch left at 0): the losses are lateral, the step does nothing for them |
| nz | **loss threshold now 150** (`escapeAhead`; it was 100 while the log's "clean" already said 150). Mid, each config dropped at its first loss, 20 rounds: server geometry / `followGuard` 90 / 120 (no hold while a creep behind the key creep is within that of their padded contact, 72 melee–melee, and closing in: step on 60 instead) | hull lost one at round 10 (9/10 +5.15), fg120 at round 8 (7/8 +4.01), **fg90 20/20 +3.88** (between +2.07 vs +3.05) | the splits start where followers run into the held front creep (lesson 25); fg90 confirmation in `nz2` |
| nz2 | fg90 alone, mid, stop at the first loss | **lost one at round 12** (11/12 +3.96): the wave split 150–177 wide at s 3900 (M2 went round the jam on the left, M1 stayed right); the front flipped R1 → M2 (105 to the left) → R1 within 0.3 s, the hero ran to M2 and back; then, 300 before T1, the passage ramp to the route line cut its lateral move towards the key creep R1 from −99 to −10 and R1 walked by 33–40 on its tower side | logic error: the ramp may not uncover the key creep → `passageCover` (in a passage the lateral target stays within contact × coverWidth of the key creep, then the tower hug), `nz3` |
| nz3 | fg90 + passageCover, mid, stop at the first loss | **lost one at round 5** (4/5): not the planner. From t 11.2 the samples came every 0.100 s instead of 0.033 (the client at ~10 FPS), and from 11.5 the hero stood still for 1.0 s while the planner ordered Move every frame, one order stuck in the humanizer queue; R1 and M2 walked by. The top T2 loss of `sgt` had the same 0.1 s gaps and a 0.5 s stand under Move. Over all runs of this session frame gaps are rare (most attempts 0 % slow frames) | the game starving in the background (the user's alt-tab; `engine_no_focus_sleep` was 5) → the harness now sets `engine_no_focus_sleep 0` / `fps_max 0` on every run, records `maxGap` / `slowFrames` per attempt and marks a loss during a stall; retried as `nz4` |
| nz4 | fg90 + passageCover, mid then top, stop at the first loss (frame rate uncapped) | mid **lost one at round 11** (10/11 +4.21), no frame stall (0 % slow frames): compact after T2 (spread 27), then the last creep ran into the one ahead of it and went round it to the left (+68 in 0.3 s) while that one ran into the key creep and went round it to the right; the wave stayed 170–210 wide and both sides got by. Top 4/4 when stopped | the guard watched only creeps closing on the key creep and only replaced holds, but a hero walking on inside the key creep's reach freezes it just the same (look-ahead) and the jam runs back down the column → `followChain` (any creep closing on the one ahead of it) and `followClear` (while the column jams, stay out of the front creep's reach + that), `nz5` |
| nz5 | mid, stop at the first loss: fg90 + `followChain` / + `followClear 30` / + `followClear 60` | before the game window was minimized (rounds 1–15): **chain 15/15 ≈ +3.9**, clear30 15/15 ≈ +3.5, clear60 15/15 ≈ +3.3. From round 16 the game ran minimized: no Draw at all, ticks at ~10 Hz (every frame 0.1 s), and clear60 lost one at round 18 there (T2 passage) | the minimized rounds do not count; a minimized Source 2 window does not render and no convar changes that, so the harness now holds attempts while the window is minimized and `ab.cjs` voids and repeats attempts that ran minimized or starved (`void-<tag>` files); clean rerun `nz6` |
| nz6 | mid, stop at the first loss: fg90 + chain / + chain + clear30 (the window no longer minimized; 1 void attempt repeated) | **chain lost one at round 5** (4/5): the wave arrived split 200 wide (M1 alone on the left, R1, M2, M3 on the right); the planner held the lone M1 as the front (front hysteresis, though R1 was 17 further on) for 2 s, then R1 became the front 165 to the side and 40 behind, too far to cross. **clear30 lost one at round 7** (6/7): M1 came up in line with T2's centre and went round its far side 320 out; Advance walked on and ended at 9.4 s on "about to draw level" with M1 still 280 out; keeping out of reach in the passage also kept the hero from closing it | clear30 rejected. The arrival split is the funnel's case (meet the wave where it closes up, T2 on mid: the free wave narrows 135 → 23) but `funnelSpread` 320 is wider than these splits → chain + funnelSpread 200 / 160, `nz7` |
| nz7 | mid, stop at the first loss: chain + funnelSpread 200 / 160 | fun200 lost one at round 3; **fun160 29/29 but +3.1** (1.74…4.09): on mid the arriving wave is 135–200 wide anyway, so the hero walks to T2 nearly every attempt and gives the creeps the whole stretch before it | rejected by the user: it runs to the tower instead of stopping a wave that is together; the bar is no loss *and* about +5 s (Setup) |
| nz8 | mid, loss or mean < +4.5 after 6 drops a config: server geometry / chain + followStep 30 / chain + followGuard 60 + step 30 / chain + compact press (pressSpread 80, lookAhead 0.13, gap −4.5: Sensitivity 12) | hull lost one at round 1; fg60 at round 4 (lateral race between the towers); step30 blocked too little (+4.19 over 6); **press +5.9…+6.9 over 7 clean**, then lost the ranged creep at the meeting: the wave arrived split 250–300 (M2 alone on the left, M1, M3, R1 on the right), the planner held the lone M2 as the front by hysteresis for 2 s although R1 was ~10 further on all along | the press gains what the user wants; its loss is a front-choice error → `frontWeight` (among creeps within `frontHysteresis` of the most advanced, the front is the one whose cover window holds the most creeps), `nz9`. Mid waves arrive 250–350 wide nearly always (the front within 500), so spread alone does not mark a real split: the funnel stays at 320 |
| nz9 | mid, same drop rules, all with `frontWeight`: press + chain / press + `followSplit` (guard only when followers would go round a creep on both sides) / press alone / followSplit without press | press + chain, press + split and press alone each **lost one in round 1** (at the meeting, after T2, between the towers; no frame stalls); split 4/5 (+4.1…+5.2) then lost the ranged creep between the towers | `frontWeight` rejected: 3 losses in 3 first attempts where press without it ran 7 clean (nz8); it flips the front between groups. followSplit not enough on its own |
| nz10 | mid, same drop rules: press + chain + `splitWalk` (while the creeps within `splitDepth` 200 of the front are wider than this, walk on just out of the front creep's reach holding nobody, until narrower than `splitClose`): 160/120, 200/140, 250/160 | w160 lost one at round 3, w250 at round 3; **w200 10/11, +5.98 ±1.13** (+4.5…+8.4; T2 pass +1.05, between +3.45), then lost M1 between the towers: the hero, walking on, froze M3 while M1 closed on it from behind → M1 round its left to lat +160…+187, a three-lane wave 190 wide that does not close up between the towers (creeps walk parallel to the route there); in the walk the hero followed the window centre flipping between M3 and R1 and M1 drew level 50–150 to its side | the first config at the user's gain. → in the walk the hero lines up with the front creep (the first to catch up), and `followClear` only off the passages, `nz11` |
| nz11 | mid, same drop rules: press + chain + walk 200/140 lined up with the front creep / + followClear 30 / + followClear 60 (Block mode only) | walk 3/4 (+5.2…+6.6), wc30 4/5 (+4.9…+6.8), wc60 8/9 (+4.6…+7.1); the losses: two-sided between the towers (walk, wc30) and the ranged creep at the meeting coming 80–110 from the side (wc60) | same frontier as everything since `nz`: at +5 s and more one creep in 5–10 attempts gets by (two-sided splits between the towers, the ranged creep at the meeting); with no loss in 29 (fun160) the block is +3.1 |
| nz11 autopsy | the walk loss frame by frame; the wc60 loss | after T2 single file ~90 apart: the guard saw M1 closing on M2 and stepped on, which froze M2 all the same (look-ahead), M1 went round it 72–76 to the left, then M3 round M1, R1 round M2: four lanes 190 wide. A tight column bumps on any stop, but one bump leaves a pair 72 apart that one unit covers from between (36 each, inside the 40 contact) — the window took only 0.8 × 2 × 40 = 64, so the pair never fitted and one of it walked on. wc60: arriving split (M1 + R1 right, M2 + M3 left), the front flipped from R1 to M2 130 to the side with 0.3 s to go; the hero ran there, too late for M2, and R1 walked by | → `coverPair` (window width = sum of the edge creeps' contacts × share, the unit where both keep the same share), `frontReach` (no switch to a front the unit cannot get in front of before it draws level), `herdOffset` (the user's idea: while split wide, stand on the outer side of the front creep so it goes round inwards, towards the wave), `nz12` |
| nz12 | mid, same drop rules, press + chain + walk 200/140 with coverPair 1 + frontReach / coverPair 0.9 + frontReach / herdOffset 20 + coverPair 1 + frontReach | **all three lost one in round 1** (T2 approach, at the meeting, between the towers), each "outside the cover window". The meeting loss: the wave arrived split (M2 alone on the left, M1 + M3 + R1 on the right, M3 ~11 ahead of M2), the hero took M2 by hysteresis and M3 walked by on the right; holding the group instead would have let M2 by on the left. The walk had ended at a spread of ~150 (splitClose 140), two sides one unit cannot cover (±36) | an arriving split is lost whichever side the unit takes, unless it is not met until it has closed to one unit's width (~80) → walk 120/80 and 160/90, `nz13` |
| nz13 | mid, same drop rules: press + chain + walk 120/80 + coverPair + frontReach / walk 160/90 + coverPair + frontReach / walk 120/80 alone | **all three lost one in round 1** (between the towers, T2 approach ×2) | six configs in a row lost their first attempt → control `nz14` |
| nz14 | control: the nz10/nz11 w200 config again (press + chain + walk 200/140), 6 rounds, the game 86 minutes in | **6/6 +6.04** (+4.0…+7.2) | the stand is fine; coverPair / frontReach / walking until ~80 made it worse. w200 so far 19/21 at ≈ +6.0 (nz10, nz11-walk, nz14). With maxFail 1 a variant of a ~10 % base dies early by chance: compare with counted losses instead, `nz15` |
| nz15 | mid 20 rounds, every loss counted: w200 / w200 + coverPair 1 / w200 + frontReach | **w200 18/20 +5.89**, pair 18/20 +5.55, reach **3/20** +4.06 | frontReach removed: a creep coming level counts as unreachable at once and the planner held on to an old front. w200's two losses are the same split between the towers: after T2 the moving hero froze M3 while M1 was 5 off its contact, M1 went round its right, R1 round its left; three lanes 180 wide, the key then flipped lanes about every second (targets 230 apart) and each crossing (0.6 s at 280) let the other lane walk on. A zigzag holds two lanes up to ~110 apart (0.4 s freeze against the crossing), the pair one bump leaves (72) but not three. The user: a config that lost once is not run on; look at the loss and change the logic → `frontLateral` (a front far to the side has to be clearly further on: hysteresis + share × lateral distance) with coverPair, `nz16` |
| nz16 | mid, stop at the first loss: w200 + coverPair 1 + frontLateral 0.3 / 0.5 | lat3 4/5 (+5.0…+6.1), lat5 1/2; both lost the ranged creep between the towers. lat3's split began in the T2 passage: the hero held ("gap closed, holding"), the column jammed behind M2 and the last creep went round the whole jam to the left (+92 in 0.4 s), then M3 left and R1 right: four lanes. The guard had not fired: it waits for a follower closing in on a front creep already slowed, and the hold is what stops it | → `followPredict` (a follower walking at a front creep within the guard counts as a jam before the stop, as if the front were stopped already), `nz17` |
| nz17 | mid, stop at the first loss: w200 + coverPair + followPredict / + frontLateral 0.3 | pred dropped for blocking too little (+3.43 over 6: four attempts at −0.1…+0.3, the guard on nearly all the time, the hero walking on); predlat lost one at round 6 | rejected: predicting the jam from any follower walking at a front creep fires all the time. The heuristic guards all sit on one frontier → the user's idea, plan how the creeps will go round the unit: `Predict.ts` |
| forecast | `Predict.ts`: the creeps one second ahead by the server rules (hard contact 0.17 s and a walk round the far side, look-ahead 0.42 s, padded creep↔creep contacts, towers), checked against w200 recordings with `forecast.cjs` (4064 cases, the hero on its recorded path) | position error 1 s ahead 93 → 75 with the hero's real path, vs 134 for a straight line; 0.5 s ahead 50 vs 63. The forecast runs on 44–72 too far: the creep in front of the hero really stands 0.51 s per second, the model 0.32 (followers 0.34 / 0.24, far 0.14 / 0.09). A look-ahead that keeps the hero's last velocity after a stop changes nothing; creeps heading for the lane line 1000 ahead (their next corner) instead of along the lane: 71 (median 56). Paths are built with a standing unit in them: creeps go round it without stopping (the `still` test), so a standing hero does not stop them in the model either | a rough forecast; for ranking candidate spots only the differences count |
| nz18 | mid, stop at the first loss: w200 + `mpc` (every frame 11 candidates — stand, or walk to the planned spot ±30/±60 across, 0/+50 along — each played 1.2 s forward; least creep advance wins, a creep getting by +300, spread over 80 × 1.5) / with ±40/±80 and +80 | **both lost one in round 1** (right after T2): the forecast chose to stand 27 times and the ranged creep slid by the standing hero 37 to its side — the model then let a standing unit stop creeps | → paths round the standing spot from the start, creeps heading for the lane line, horizon 0.8 s, `nz19` |
| nz19 | mid, stop at the first loss: w200 + mpc (horizon 0.8 / 0.6) | **both lost one in round 1**, between the towers | the forecast decided everything in Block mode and returned before the guards and the split walk, which are what make w200 reliable; 0.6–0.8 s does not see a lateral race playing out over 2–3 s |
| nz20 | mid, stop at the first loss: w200 + mpc as a shift of the planned spot only (the guards and the walk decide as before), no standing candidate, plus a race cost (per creep, seconds short of getting across to its line before it draws level) × 300 / × 600 | race300 1/2 (+6.44), race600 2/3 (+5.37, +5.67); both losses between the towers | no better than w200 yet; the model's error (~70 a second) limits it. Kept as a switch (`mpc`, off) |
| nz21 | mid, stop at the first loss: w200 + `jamHerd` 15 / 25 (while creeps close in on the key creep, stand that far off its line on their side: the key creep goes round the unit away from them, they walk into the unit) | herd15 1/2 (+5.17), herd25 1/2 (+6.10); herding fired 4 times in herd15's loss, whose split had begun inside the T2 passage (spread 185 by s 2477, the hero stepping on "keeping the jam moving") | rejected. In w200's losses the splits start in or just after the T2 passage (nz15 r5 at s 2750, nz16 at a hold in the passage, nz21 in the passage) → `followClearPassage` (in a passage, while the column jams, stay out of the front creep's reach and keep the tower hug), `nz22` |
| nz22 | mid, stop at the first loss: w200 + followClear 40 / 60 in passages only (`followClearPassage 2`) | pclear40 2/3 (lost in the T2 passage), **pclear60 9/10 +5.6** (+5.1…+6.3), lost one between the towers. Its passage went well (spread 66–108), but at 9.1 s, just past T2, the hero swung right to lat −84 while the wave came out of the passage on the open side (+26…+120); M2 and M3 went into a lane on the left, three lanes | planner bug: the tower hug clamp still holds behind the tower's centre, where the hug circle drags the target to the tower's back → `passageExit` (no hug past the tower's centre), `nz23` |
| nz23 | mid, stop at the first loss: pclear60 + passageExit / w200 + passageExit | **pc60exit 15/16 +5.45** (+4.35…+7.15; T2 pass +0.92, between +3.31), w200exit 9/10 +5.5 (lost in the T2 passage). pc60exit's loss was the arriving split under the walk: 238 wide, M2 alone on the left, M1 M3 R1 on the right; the hero walked in front of R1, R1 froze (look-ahead), and because the front is chosen by predicted position (a frozen creep's does not move) the front became the walking M2 on the far left; the hero ran there and R1 went on 0.4 s later and walked by | the longest clean run so far at the user's gain. → `walkFirst`: in the walk, line up with the creep that reaches the unit first (its way at its speed plus the rest of a freeze), kept unless another comes `walkFirstHold` sooner, `nz24` |
| nz24 | mid, stop at the first loss: pc60exit + walkFirst (hold 0.25 / 0.4) | first40 lost one at round 1, first25 4/5 (+2.6…+6.3); both losses between the towers / at the T1 approach | rejected (switch left at 0): worse than pc60exit and blocks less. → the lateral front hysteresis (`frontLateral`) again, now on pc60exit, `nz25` |
| nz25 | mid, stop at the first loss: pc60exit + frontLateral 0.3 / 0.5 | flat3 2/3, flat5 1/2; both lost between the towers | rejected. pc60exit itself had no loss between the towers in 16: the passage changes (out of reach in a passage while the column jams, no hug behind the tower's centre) look to have removed the splits that began there; its one loss was the arriving split → in the walk the front by current position (`walkFirst 2`), plus pc60exit again as a control, `nz26` |
| nz26 | mid, stop at the first loss: pc60exit (control) / pc60exit + walk by current position | **pc60exit 4/5** (+5.3…+6.9), lost one between the towers; walknow 1/2 | pc60exit over nz23 + nz26: 19/21 ≈ 90 % at ≈ +5.5, the same as w200 (37/41 at ≈ +6.0): its 15 in a row was luck. Every change since `nz` lands on one frontier: ≈ 90 % clean at +5.5…+6, or 97–100 % at +3…+4 (fg90 31/32 +3.9, fun160 29/29 +3.1) |
| nz27 | analysis of nz26's loss, then mid, stop at the first loss: pc60exit / w200, each + `followInline 25` (the follower guard counts only a creep in line behind the one it closes in on, lateral offset under 25: lesson 26) | pcin25 2/3 (+5.47, +6.57), w200in25 **7/8** (+5.30…+6.78, mean +6.07). nz26's loss: in the T2 passage the planner walked on to keep the ranged front creep out of reach ("the column is jamming"), the creep caught up at 74 and froze 0.47 s; M2 (27 off its line) ran into it, M1 in line behind M2 (4 off) went round M2 to +113, later M3 to −25: four lanes 145 wide. pcin25's loss: the wave arrived in two groups (+175 / −165, still 185 apart at the meeting); in the split walk the hero lined up with the left group, walking on inside M1's reach froze it (look-ahead), the right group walked level, became the front, the hero ran 196 across and M1 went by on the left. w200in25's loss: past T2 the hero held M1 (left, lat 110) with R1, M2 jammed behind it diagonally (70, 13), M3 in line behind M2 went round it to the right (−59); the split walk froze M1 again (walking on inside its reach), flipped to M3 and lost M1 | followInline did not cause either loss (both are the split walk); kept as a switch for the gain. All three losses have one cause: a unit slower than the creeps (Pudge 280, creeps 325) walking on inside a creep's reach freezes it — the guard's "keep out of reach", "step on" and the split walk's "hold nobody" all do it → `splitLeadTime` (in the walk, lead by the speed difference × that many seconds), `nz28` |
| nz28 | mid, stop at the first loss: pcin25 / w200in25, each + `splitLeadTime 1.5` | **pcsl 5/6** (+4.5…+8.4, mean +5.84), w200sl 1/2 (+4.52). Both lost at the T2 exit, the same way: walking on inside the front creep's reach ("Tower passage: closing the gap") the hero froze it with the next creep 7–18 behind in line; that one went round it (+93…+140), the third round that one: 150–180 wide, then the split walk. pcsl's guard did not fire: front and follower walk at the same speed, so the follower is not closing in until the front stops | the split walk's lead removed nothing visible yet; w200 (no passage clearing) loses at the T2 exit again → the guard has to see the jam before the freeze: `followPredict` again, now with `followInline` (nz17 fired on every follower), `nz29` |
| nz29 | mid: pcsl + `followPredict 1` (a follower walking at a front creep within the guard counts as a jam before the stop), guard 90 / 50 (`minGain` was left out of the spec, stopped by hand) | **pred90 7/7 but +3.16**, **pred50 6/6 but +4.29**: no loss in 13, below the +5 bar. pred90's weakest attempt (+0.02) spent 91 % of the key on "stepping on"; the cost is at the meeting (contact +0.0/+0.2 vs +0.16…+0.27, settle +0.04/+0.10 vs +0.36): the wave arrives single file too and the guard keeps the unit walking from the meeting on | the predictive in-line guard is what makes it reliable, but it is needed only where the freezes split the wave (the T2 exit) → `followPredict 2`: predictive in a passage only, `nz30` |
| nz30 | mid 30 rounds, stop at the first loss, `minGain 4.5`: pcsl + `followPredict 2` (the predictive in-line guard in a tower passage only), guard 90 / 50 | **pp90 30/30, T1 +5.29 ±0.75** (+3.20…+6.56; contact +0.27, settle +0.36, T2 pass +0.87, between +3.10, T1 pass +0.85); pp50 7/8 (+4.4…+6.7), lost at round 8: the wave arrived in two groups 210 apart, the split walk went 150 across to the left group (so too slow forward to keep out of reach: froze it), the right group's M2 came level 41 to the side of the hero walking on in the passage (contact 40) and went by | **the first config with no loss over 30 at the user's bar.** pp90 = `followGuard 90, followChain 1, pressSpread 80, lookAhead 0.13, gap −4.5, splitWalk 200, splitClose 140, followClear 60, followClearPassage 2, passageExit 1, followInline 25, splitLeadTime 1.5, followPredict 2`. pp50's loss (the arriving two-group split) is still open: a smaller guard leaves it to the walk |
| nz31 | top 20 rounds (start s 2735, lat 232), stop at the first loss: pp90 / r11 defaults | **pp90 20/20, T1 +5.87 ±0.79** (+4.13…+7.48; between +5.11); r11 lost the ranged creep at round 1 (between the towers, walked by on the left 85 to the side) | **pp90 made the defaults** (Planner `Tuning`; the Sensitivity mapping in Block.ts shifted so that the default 16 gives lookAhead 0.13, gap −4.5, pressSpread 80) |
| nz32 | mid, the new defaults with no overrides (= pp90), stop at the first loss | **lost one at round 3** (2/3, +3.86, +6.54): pp90 now 50/51. Past T2 the hero froze the ranged front R1 (lat 5); M1 ran into it and went round it to +55; the planner took the walking M1 as the front (a frozen creep's predicted position does not move) and the cover window (2 × min contact × 0.8 = 51 for a ranged + melee pair) could not hold both, so the hero went to M1's line (62) and R1, 57 to the side, walked by when its freeze ended. The same "frozen creep left behind" as nz23 and nz27's pcin25 | a ranged + melee pair 55 apart is coverable (27 to the ranged creep's 32, 28 to the melee one's 40): the window's width should add the two contacts → `coverPair` (neutral in nz15 on w200), `nz33` |
| nz33 | mid, stop at the first loss: defaults + `coverPair 0.8` / `0.7` (the window may span the two edge creeps' contacts added, × share) | **pair8 13/14** (+3.99…+6.85, ≈ +5.3), pair7 4/5. pair7's loss: the wave arrived in two groups (M1 alone at +92, three at −60…−90): the split walk lined up with M1, crossed 150 sideways, too slow forward to keep out of reach, froze M1, the right group became the front and its M2 came level 45 to the side of the hero (walking on in the passage) and went by — pp50's loss again. pair8's loss: at the T2 exit "the column is jamming" — walking on cannot keep a slower hero out of the ranged front's reach, it froze at s 2454, M2 (in line) went round it to +75, the wave 130 wide, and R1 walked by on the right while the hero covered the left | the window case of nz32 did not come back in 14. Two classes stay: the arriving two-group split under the split walk (pcin25, pp50, pair7) and the jam at the T2 exit that keeping out of reach only postpones (pcsl, pair8) → `walkFirst 3` (in the walk, the middle of the wave: no crossings), and followClear 100, `nz34` |
| nz34 | mid, stop at the first loss: pair8 + `walkFirst 3` (the split walk keeps the middle of the wave) / + followClear 100 | w3 4/5 (+4.0…+6.9), lost between the towers (the wave split 3.1 s before, the ranged creep walked by 83 to the right); w3c100 lost at round 1 (split from the T2 passage on, 7 s before the loss) | both rejected (switches left at their defaults: walkFirst 0, followClear 60). A bigger clearing lead only moves the freeze further past the tower |
| nz35 | analysis, then mid, stop at the first loss: pair8 + `frozenFront 30` / `60` (a creep standing ≤ 0.52 s within its look-ahead reach + that of the unit is the front) | **fz30 and fz60 both lost at round 1**: fz60 held the frozen M3 of the left group at the meeting while M1 of the right group, 190 to the side, walked by; fz30 held the frozen R1 between the towers while M3 went by 82 to the right. Analysis over `nz`/`sg` runs: which side of the stopped creep the hero stands on does not decide whether the wave fans out after a creep in line walks round it (73–84 % fan out wider than 130 within 2.5 s either way, the T2 exit no different). Common to nz23, nz27 pcin25, nz32 and nz33 pair8 instead: a creep the hero holds frozen next to it stops being the front (its predicted position does not move), the window leaves it for a creep walking round on the far side, and it walks by when the freeze ends | rejected (switch left at 0): when the frozen creep and the walking one are further apart than one unit covers, keeping either loses the other; the fix has to stop the fan, not choose a side. The T2-exit losses (pcsl, pair8, w3) all come just past the tower, where `followPredict 2` stops → `followPredict 3` (also `predictAfter` past a squeezing tower), `nz36` |
| nz36 | mid, stop at the first loss: pair8 + `followPredict 3` (the predictive guard also `predictAfter` past a squeezing tower), 400 / 250 | pa400 11/12 (≈ +4.6), lost between the towers: the wave had come through the passage 140 wide already (+82 … −59) and fanned at the exit; **pa250 19/20, +4.87** (+2.9…+6.8; between +2.78 vs pp90's +3.10), lost at round 20, between the towers (two-sided, the hero lost the lateral race) | rejected (switch left at 2): about as reliable as pp90 / pair8 (~95 %) for 0.4 s less. Since nz30 every variant lands on ≈ 95–97 % at +4.9…+5.4 |
| nz37 | analysis, then mid, stop at the first loss: pair8 + `shapeHold` 30 / 80 (a creep in line closes in on the key creep, still that much beyond its look-ahead reach: the unit stands instead of walking on) | sh30 lost at round 1: an arriving two-group split, the hold fired while the hero stood 105 off the key creep's line and cost it the race across (fixed after: only when the unit is within the key creep's contact of its line and has no lateral target). **sh80 26/27, +5.26** (+4.0…+7.5), lost at round 27 between the towers: in the T2 passage the creeps jammed on each other with no hero within 140 (M3 stopped against R1 and M1, M1 went round to +128), then fanned. sh80's hold was on 2.7 % of the key time, so it is pair8 with little change. Analysis (`deflect`, `nz`/`sg` runs): when a creep turns > 20° without stopping, the one in line behind it (< 12 off) is 25+ off it 0.6 s later in 63–71 % of turns away from the hero, 77 % near it (75–150) while it moves, 82 % while it stands: the one behind mostly keeps its way, so a turn round a standing unit makes a pair before the freeze | not adopted (switch left at 0). Geometry is against it: a creep right behind the key one paths round the same standing unit and comes out on the same side unless the unit is outside its own contact (40) while inside the key creep's, which needs the two 10+ apart already; the 82 % above are turns with nothing in the follower's own way. Shaping with the unit itself does not split an exact line |
| nz38 | the forecast reworked (leaders first, look-ahead between creeps, `onTick` / `rng` hooks for checking; lesson 28), then mid, stop at the first loss: pair8 + `mpc 1` (the planned spot shifted by forecast) / with `forecastHorizon 1.2` | mpc 4/5 (+4.55…+6.60), mpc12 lost at round 1; both lost the ranged creep between the towers 1.4–2.3 s after the wave split | rejected (mpc left at 0). As lesson 28 says, the forecast does not see the fan coming better than the spread now, so choosing by it adds nothing the guards do not; the model and its checks (`forecast.cjs`, scratch `fcstops`, `fcspread`, `tickrules`) stay for later work |
| nz39 | safe mode for high Sensitivity: the predictive in-line guard everywhere (`followPredict 1`, guard 50), A: lookAhead 0.13 / gap −4.5 / pressSpread 80, B: 0.15 / −3 / 0 (a first try ran with nz38's `mpc 1` left in the pinned defaults and was voided) | A 3/3 clean (+3.92, +4.10, +2.35), B 3/3 clean (+3.81, +3.31, +4.01); stopped there: the user's new rule, every attempt at least +5 s | rejected under the +5 rule: reliable, but never reaches +5. **New rule** (Rules 2): an attempt under +5 s counts as a failure (`minAttemptGain 5`) |
| nz40 | analysis of the pp90-logic attempts (nz30, nz32, nz33 pair8, nz37 sh80: 71 clean) under the +5 rule: only 45 (63 %) reach +5; the 26 below (mean +4.50) lose it between the towers (2.68 s vs 3.42) and in settle (0.21 vs 0.36), walking the split instead of blocking (between the towers 33 % of the key time vs 16 %; the wave ~175 wide while walking): the T2-exit fan costs time as well as creeps. Then mid, `maxFail 1`, `minAttemptGain 5`: pair8 + `followPredict 4` (the predictive guard only `predictAfter` past the tower, not in the passage) + followClear 0 (no keeping out of reach), 400 / 250 | fp4b LOW at round 1 (+4.85); fp4 +5.45, then lost one at round 2 between the towers. In the passage it went as meant: the front M3 froze, M1 ran into it and went round on the open side (a pair 70 wide); then R1 went round the tower's far side, Advance walked the hero on ahead holding nobody and the wave spread to ~170 (M1 +128 … R1 −38); it closed up again, and the next freeze, at s 2806 with the column tight, came just past the guard's 400 and fanned (R1 right, M1 left) | the idea: inside the passage the tower closes one side, a creep going round a frozen one comes out on the open side as a pair the unit covers; keeping out of reach there only moves the freeze to just past the tower, where both sides are open. Rejected (switch value 4 kept, default 2): the freeze is only moved again; any freeze with a creep in line close behind fans wherever the guard is off |
| nz41 | the user: near the tower the hero walks on instead of stopping the creeps, and at the start it runs ahead instead of stopping them at once. By zone over the pp90-logic clean attempts (`zones`): s 1700–2000 the split walk 37 % of the key time (hero 262/s, front 299/s: not slowed), T2 entry 2000–2300 "the column is jamming: keeping out of reach" 50 % (hero 244/s, front 242/s) and passage 48 % (223 / 233), T2 2300–2600 passage 55 % (front 211/s): through the passage the hero walks along with the wave. The start walks (`startwalk`): two sides 169 apart (median; spread 195), level (the lagging side 40 behind), mostly 2 + 1 creeps. Then mid, `maxFail 1`, `minAttemptGain 5`: pair8 + splitWalk 260 / splitClose 180 (walk only for a wider split) / pair8 + followClear 0 (no keeping out of reach in the passage) / both | st260 LOW at its first attempt (+3.13: between the towers only +0.73, the walk lasted longer); twr +5.06 then LOW +4.29 (T2 pass +0.91 vs pp90's +0.87: the passage gain did not move); both lost one at round 1 between the towers | rejected. Walking the start less does not pay: the two sides converge only towards the T2 passage (`conv`: about 570 along the lane for a 170 gap), and holding one side lets the other get 150 ahead in ~1 s. Through the passage the hero walks with the wave because the passage target leads the front creep by its reach + 31 (`passageLead`), not because of the keep-out alone. Under the +5-per-attempt rule an A/B needs a mean near +7 (attempts spread ±0.75) to survive 30 rounds |
| nz42 | mid, `maxFail 1`, `minAttemptGain 5`: pair8 + `passageLead` 0 / −20 (in a passage the unit leads the front creep by its reach + that, 31 by default: closer, it holds instead of walking with the wave) | pl0 +5.06, then LOW +4.17; plm20 +6.65, then LOW +4.75 | not enough alone; −20 kept in the next try |
| nz43 | the user: when a creep goes round the tower, the hero walks on ahead at once and leaves the pack (seen on screen, "Creep goes round the tower: walking on ahead of it" with three creeps right behind it); it should look where the creep will be and keep blocking the pack until it has to go. `advanceTiming` (seconds of margin; 0 = as before): the detouring creep's time back to the lane (the straight line to the point past the tower × 1.25, plus what is left of a stand) against the unit's walk to in front of that point; while the creep is more than the margin further, the pack is blocked as usual, the unit walks on ahead only after. Mid, both rules: pair8 + advanceTiming 0.3 / 0.6 / 0.3 + passageLead −20 | **at3 5 in a row at +5.30…+6.32**, then LOW +4.68; at6 +5.21, LOW +4.55; at3pl +6.02, +7.97, then LOW +4.97 | no creep went round the tower in at3's six (Advance 0 % of the key time): its run is pair8 with good waves, the timing never acted. Its LOW attempt, like the weak ones before, walked the arriving split for a third of the key time and had no contact/settle gain: the start decides the floor. The timing itself needs waves with far-side detours → 6 + 1 waves, `nz44` (the earlier `advancePace`, a distance threshold, lost the far creep, `ap`) |
| nz44 | mid, 6 melee + 1 ranged (a far-side detour in about a third of the waves), 20 rounds, `maxFail 3`, absolute T1 (no free baseline for 6 + 1): pair8 / + advanceTiming 0.3 / 0.6 | 5 rounds, then stopped: pair8 4/5 (18.8…19.7 s abs, lost one at s 2823), at3 4/5 and at6 4/5, both lost the far-side creep at round 5 (M2 234 / M3 181 to the side at s 3100, 700 past T2) | rejected (switch left at 0). The creep that went round the tower's far side does not come back right past it: it keeps to that side for hundreds of units on the way to its next corner, so the 'back' point the timing aimed at is wrong. And the loss counts along the lane: once it is ahead of the hero (280 against 325) the hero never gets back in front. Holding the pack is only possible on the hero's spare lead over it; `ap` held 12/12 detours with 300 of it but gained nothing (19.04 vs 19.14 s) |
| nz45 | the user, from a server with 60 ms ping (passive recorder `rec.js`, 7 waves, Enigma 280): every loss is a creep walking level beside the hero (40–100 off, 325 against 280) while the target lies 150–190 ahead along the lane, a crossing at 11–17°; in the T2 passage the front flipped 4/s between a creep frozen in front of the hero (its predicted position stands) and one walking round it. Two switches: `raceAngle` (a key creep off the hero's line, faster and not past it: the target comes no further along than the angle acos(unit / creep speed), 30° here, at which a crossing costs the least lead) and `passageKeyHold` (in a tower passage the front is kept that many seconds before another takes it; not `frontLateral` or `frozenFront`). Mid, `maxFail 1`, `minAttemptGain 5`, tags `nz40*`; the base already had the 4-tick move cap (`nz46`) | base LOW +4.79 at round 1 (and lost one in a probe attempt before); race lost one at round 1; hold +6.55, +6.36, then lost the ranged creep; both +7.65, then lost one. raceAngle acted in a third of the last 3 s before both of its losses, two-sided splits (another creep pressing on the other side); passageKeyHold did not act before hold's loss | not judged: the base itself fell from pp90's level, which `nz46` puts on the move cap. Both switches left at 0, to be run again on a base that holds |
| nz46 | the user: no more clicks than the game makes with the right button held (measured with `clicks.js`: a move every 133 ms, 4 ticks, on 87 of 87 repeats; stops are no clicks). `MoveUnit` sleeps 4 ticks (it slept 1; earlier the input lag, 3 ticks at 60 ms ping), and a move held back by it is no longer taken as the last order. Also the order arrival as aio's orbwalk counts it: `EstimateDispatchDelay(last order's point) + InputLag`, the tick and `extraLatency` moved into the lead so the total stays as measured. Mid, 12 rounds, `maxFail 3` (a diagnostic of the cap), `minAttemptGain 5`, tags `nz41tick*`: `moveIntervalTicks` 4 / 1 | **tick4 4/5 clean, +5.25 ±0.96** (2 LOW, lost one at round 5: two-sided split, lateral race); **tick1 9/9 clean, +5.60 ±0.88** (3 LOW) | the cap costs reliability: the planner corrects its target per tick and its tuning was measured so. The cap is the user's requirement (default 4, switch `moveIntervalTicks`): the logic has to hold a wave on 7.5 moves a second |
| nz47 | the user: keep the 4-tick move cap and improve the blocker under it; stops are no clicks and go out at any time. `stopGuard`: while the cap holds a new move back, the unit walking on to its old point is stopped (a stop at once) when that walk no longer brings it to the new target (closing on it slower than `stopProgress` 0.5 of its speed: heading off by more than 60°) or when the new target is nearer than the old one and within the order latency's walk (it would overshoot); the move follows when the cap allows. The blocking units' own motion is tracked always now (it was only for `mpc`). Mid, 12 rounds, `maxFail 3`, `minAttemptGain 5`: tick4 / tick4 + stopGuard | tick4 4/6 clean, +5.17 ±0.64 (lost two: lateral race between the towers); **stop 8/10 clean, +5.91 ±0.90** (lost two: two-sided splits, the lost creep outside the cover window); stops per attempt 14–20 → 20–30, moves 110–119 either way, none closer than 133 ms | `stopGuard 1` becomes the default: under the cap it gains more than tick1 did (+5.60) at about its reliability |
| nz48 | mid, 12 rounds, `maxFail 3`, `minAttemptGain 5`, on the stopGuard base: base / `moveLead 0.5` (the creeps' lead grows by half the ticks a move waits beyond one, +50 ms) / `raceAngle 1` / `passageKeyHold 0.35` (nz45's switches again, now on a base that holds) | base 4/6 clean, +6.21 ±1.64 (lost the ranged creep twice between the towers: lateral race, two-sided); lead 1/4 (three losses, one at s 2114); **race 0/3** (three losses between the towers); hold 4/6, +5.24 ±1.15 (a loss, a LOW +3.41) | all three rejected (switches left at 0): more lead loses creeps; the race angle cuts the lead along the lane, and with the creep beside the hero that is what it walks by on; the passage hold changes nothing but the gain. Over nz47 + nz48 the stop base is 12/16 clean at +6.0 against tick4's 8/11 at +5.2: the stops gain time, the reliability is the cap's (tick1 9/9). Under the cap 65–71 % of the moves are corrections under 60, and a target jump across the lane waits for the next window: 34 ms median, 100 ms p90 (tick1: one tick) → `moveReserve`, `nz49` |
| nz49 | mid, 12 rounds, `maxFail 3`, `minAttemptGain 5`, stopGuard base: base / `moveReserve` 40 / 60 (a move that shifts the target less than that waits two click intervals, 8 ticks, while the unit walks: the window stays open for a jump across the lane) | base 3/5 clean, +5.60 ±0.95 (lost one at s 1916, one at s 4341); res40 2/4, +5.62; **res60 9/10 clean, +6.02 ±1.14** (lost one at s 2458, then LOW +4.32) | res60 the best under the cap so far, res40 no better than the base: confirm before it becomes the default, `nz50` |
| nz50 | mid, 12 rounds, `maxFail 3`, `minAttemptGain 5`, stopGuard base: base / `moveReserve` 60 / 80 | base 6/8 clean, +5.67 ±0.53 (lost two between the towers, a LOW); **res60 7/7 clean, +5.60 ±1.38** (no loss; dropped on three LOW +4.01, +4.75, +4.33); res80 2/5 (three losses) | `moveReserve 60` becomes the default. Over nz49 + nz50: res60 16/17 without a lost creep, 5/17 failures with the LOWs; the stop base (nz47–nz50) 21/29, 11/29 failures. 40 and 80 both did worse than 60 in few attempts: the optimum is not well placed, and res60 trades losses for weak attempts |
- Dire: `script_reload_code` does nothing in this session (not a Tools launch), so a Dire option in the trainer needs a reinstall of the addon (the installed copy is older than the repo) and a relaunch.
