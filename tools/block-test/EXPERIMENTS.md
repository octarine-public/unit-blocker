# Creep block experiments log

Read this before changing `modules/CreepBlock/Planner.ts`. Every entry: what changed, the numbers, the
verdict and why. Append new series at the bottom of "Series"; keep "Current best" and "Lessons" true.

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

## Current best

**Defaults now: r11** = r10 + turnBackReach 0 (Advance lasts until the creep that went round T2
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

## Open problems

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
- Dire: `script_reload_code` does nothing in this session (not a Tools launch), so a Dire option in the trainer needs a reinstall of the addon (the installed copy is older than the repo) and a relaunch.
