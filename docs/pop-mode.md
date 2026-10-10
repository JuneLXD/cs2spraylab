# Pop

Added 2026-10-09 at the user's request, after Refrag's Pop mode: bright balls float on a dark wall ahead
of you; a shot pops the first ball it crosses and a new one appears elsewhere. It is a range-engine drill
(`mode: 'pop'`, category Aim warm-up), so the weapon, recoil, spread, reload and crosshair code are the
ones every other range drill uses.

- Settings: `popSize` (ball diameter, 8-80 cm), `popCount` (balls at once, 1-12), `popSpacing` (minimum
  centre-to-centre space, 0.2-5 m), `popDistance` (from you to the wall, 3-40 m), `popColor` (hex;
  presets in `pop.ts`). Restore defaults covers them; the summary chip shows them.
- `src/range/pop.ts`: `PopField` owns the balls, the tally and the wall region (`popRegion`: centred at
  eye height, wide enough for the count at the requested spacing, capped at 55% of the half view width
  and 1.4 m half height). A new ball tries 64 random spots for one at least `spacing + diameter` from
  every other ball and otherwise takes the clearest. `hit()` is an analytic ray-sphere test that pops the
  nearest ball and spawns a replacement.
- `Simulation`: you stand at `POP_SPAWN` (z = 2, the near end of the range, so 40 m fit). `fire()`
  counts pop shots; `finish()` does not publish per-burst results in Pop; `publishPopResult()` (called
  by the engine's pause) records the running session once per new shots; New session resets it.
- `RangeEngine`: `popShot()` handles every ray (pellets included) with `PopField.hit`, draws tracers to
  the ball or the wall, marks misses on the wall, sets the POP / n POPS / MISS caption and plays
  `RangeAudio.playPop` (a synthesized sine bloop plus a band-passed click). `syncPop()` mirrors the balls
  as emissive spheres (`popMaterial`, colour from the setting), animates popped balls out over 180 ms and
  keeps a dark backdrop plane behind the balls; `setPopAtmosphere()` turns the sky black, pulls the fog in
  to `distance + 8` m and dims the lights, and restores the range look on leaving.
- HUD: POPS, HIT RATE, MISS and POPS / MIN replace the head/body cells. Tests: `pop.test.ts`,
  `tests/pop.spec.ts`.
- Ammo and hit sound (same day): `popAmmo` ('magazine' by default: the magazine is refilled after every
  shot and a held trigger keeps firing, as sv_infinite_ammo 1; 'reserve' refills the reserve and still
  reloads; 'off' is normal) is applied in `Simulation.fire()` and `burstSize` ignores the Burst length
  setting in Pop. `popSound` picks `RangeAudio.playHitmarker` (default; a synthesized Battlefield-style
  tick: 3.2 kHz, 4.85 kHz and 1.6 kHz sine partials decaying within 70 ms plus a 12 ms band-passed click)
  or `playPop`.
- Pop-only switches (same day): `popMuteGun` skips the shot's audio and fire foley in `popShot` (knife and the
  hit sound stay), `popHideImpacts` skips the miss marks (and clears existing ones when turned on),
  `popHideHud` adds `sl-hud-hidden` to the stage so the topline, target label, weapon slots, action
  tools, score and ammo bar, spread warning, rep feedback, ESC hint and FPS meter are hidden; the
  crosshair and hit flash remain.
- Hit sound file: `popSound` 'hitmarker' (default) plays `public/revamp/sounds/pop-hitmarker.mp3`, the file the
  user supplied (decoded at audio unlock; the synthesized tick stands in until then), 'synth' the synthesized
  tick, 'pop' the bloop. The master volume (top bar and Settings > Audio) is `settings.volume`, applied to
  every sound.
- Spray, peeking and looks (2026-10-10): `popHits` (1-10, default 1) is how many bullets a ball takes before it
  pops; `PopField.hit()` counts every bullet that crosses a ball as a hit (`hits`), pops the ball on its last one
  (`pops`), and a hit ball dims in three steps (`popDamagedMaterial`). HIT RATE and MISS count hits; POPS counts
  bursts; the hit caption says HIT for a hit that did not pop. A held spray always popped whatever each bullet
  crossed; what made spraying useless was the AK's recoil carrying the burst above the 2.8 m field within five
  rounds and the spread scattering the rest wider than a 30 cm ball, so one-hit balls vanished on the first round.
  `popWall` ('off', 'left', 'right') raises a peek wall (`popWall()`: 3 m wide, 2.8 m tall, 0.4 m thick, 1.5 m
  ahead, its edge 0.35 m past your shoulder on the chosen side, a yellow strip on that edge) that stops bullets
  (`wallHit`, `rayBoxDistance`) and movement (it joins `Simulation.environment.solids`); the ball field is centred
  1 m to the peek side, and changing the wall puts you back at `POP_SPAWN`. `popBackground` colours the backdrop
  plane, which is now unlit (`MeshBasicMaterial`) so the picked colour shows as picked; presets in `popBackgrounds`.
  The entrance benches live in `RangeEngine.benches`, outside the static batches, and are hidden in Pop.
- Ball respawn delay (2026-10-10): `popRespawn` (0-5 s, step 0.1, default 0) is how long a popped ball's
  replacement waits. `PopField` queues each due time in `pending`; `advance(time)`, called from every
  `Simulation.step()`, spawns the replacements whose time has come, and `hit()` takes the shot's `at` time
  (the engine passes `shot.at`). 0 spawns at once as before; `reset()` drops the queue.
- Moving balls (2026-10-10): per axis `popMoveX`/`popMoveY` (speed, m/s), `popRangeX`/`popRangeY` (how far a ball
  travels each way from where it appeared, m; clipped to the field) and `popFlipX`/`popFlipY` (sudden reversals per
  second, each due about 1/flips seconds after the last, jittered by half). `PopField.spawn()` gives a moving ball a
  random direction and a travel window; `advance(time)` (every simulation step) moves it, turns it back at the window's
  ends, reverses it when a flip is due and parts balls that overlap, bouncing them along the axis they met on. A still
  axis (speed or range 0) draws no extra random numbers, so seeded layouts are unchanged. Shots test the positions of
  the current tick; the renderer reads them every frame.
- Two-sided cover (same day): `popWall: 'both'` is a 1.6 m wide pillar (`POP_WALL.pillar`) centred on you, 1.5 m
  ahead, with an edge strip on each side; `PopWall.edges` lists every edge you can step past (`side` 0) and the ball
  field stays centred. Single-sided walls keep their 3 m width and one edge.
- Respawn pad (same day): `popRespawnMode` 'pad' queues each popped ball with an Infinity due time; `advance(time,
  player)` (the simulation passes its position) spawns every waiting ball the moment the player steps onto the pad
  (`POP_PAD.radius` 0.45 m around `POP_SPAWN`), edge-triggered so standing on it does nothing and a session never
  starts by triggering it. The engine draws it as a flat ring (`pop-pad`) that turns yellow while balls are waiting.
- Wall width and the pad (same day): `popWallWidth` (0.6-8 m, default 3) is the wall's x extent: a one-sided wall keeps
  its edge 0.35 m past the shoulder of `POP_SPAWN` and runs that wide the other way; the pillar is that wide and centred
  on `POP_SPAWN` (its 1.6 m fixed width is gone). `popPad()` and `popSpawn()` put the pad and your start position at the
  wall's centre x (`POP_SPAWN.x` with no wall), so you begin behind cover and step out past the edge; changing the wall
  or its width re-places you there. The ball field still hangs off the edge (peek line), not the spawn.
