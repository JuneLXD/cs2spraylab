export type ChangelogSection = {
  id: string;
  title: string;
  items: readonly string[];
};

export type ChangelogRelease = {
  id: string;
  title: string;
  baselineCommit: string;
  sections: readonly ChangelogSection[];
};

export const latestChanges = {
  id: 'update-2026-10-05',
  title: 'Latest update',
  baselineCommit: '49d8ea6',
  sections: [
    {id: 'combat', title: 'Penetration & collaterals', items: [
      'Material-aware entry/exit rays carry damage through penetrable cover and multiple opponents. Range collaterals preserve physical target-mesh scoring.',
      'Shotgun pellets share discharge-level feedback and scoring; armor is consumed across pellets rather than reused for each hit.',
      'Installed-build recoil tables, shotgun patterns, spread transforms and penetration arithmetic have new offline verification fixtures.',
    ]},
    {id: 'weapons', title: 'Weapons & actions', items: [
      'Nova, XM1014, MAG-7, Sawed-Off and Zeus x27, with extracted cadence, accuracy, recoil, range and reserve data. Zeus is also available on slot 4.',
      'Finite reserves, magazine and interruptible shell reload states, slower silent reloads while holding R, and Zeus recharge.',
      'Knife slash/stab, hit/miss cooldowns and backstabs in Duel. Shotguns have ten native finishes each; Zeus has its seven available native finishes.',
    ]},
    {id: 'movement', title: 'Movement & traversal', items: [
      'Shared player/bot hull contacts, step-up, ramp, ladder, shallow-water and partner-support handling.',
      'Current native landing-factor arithmetic, centered bunnyhop window, jump-spam rejection and crouch/contact regressions.',
      'Experienced bots can quietly climb authored routes and coordinate partner boosts through the same physics as the player.',
    ]},
    {id: 'arenas', title: 'Arenas & team tactics', items: [
      'Fifteen new traversal/environment POIs add stairs, ramps, lofts, ladders, vents, glass, sliding gates and movable cargo to the existing cover catalog.',
      'Doors, breakable panels and displaced props update combat, movement, rendering and acoustics together.',
      'Evidence-led trades, synchronized entries, crossfires, shadow cues and knife-equipped opponents. Hidden enemy positions do not grant firing permission.',
    ]},
    {id: 'bot-behavior', title: 'Duel behavior', items: [
      'Committed weapon/range-aware exchanges and shot-confirmed burst timing replace repeated empty peek loops.',
      'Counterstrafe re-engagements, nearby-cover resets and changing firing lines keep open fights active while preserving deliberate escapes.',
      'Steadier uncertain sound bearings and fresh-audio priority improve contact expectations without revealing hidden targets.',
    ]},
    {id: 'connection', title: 'Responsive combat, radar & armor', items: [
      'Removed simulated network latency, delayed input and hit feedback, prediction replay and shot rewind. Old saved ping settings are ignored.',
      'A compact rotating radar shows visible contacts and expiring last-known positions, with zoom and visibility controls.',
      'Independent Kevlar, helmet and armor-condition controls for both sides and individual opponents.',
    ]},
    {id: 'presentation', title: 'Animation, audio & performance', items: [
      'Lazy native weapon gestures with stable anchors, phase-matched reloads and event-timed native weapon foley.',
      'Cover-aware directional audio, immediate hit-frame skeletal death physics and pooled Zeus electrical wires instead of a firearm flame.',
      'Fewer duplicate skeleton updates, compatible mesh batching, bounded caches, cached terrain routing and radar sizing fixes; shot math is unchanged.',
    ]},
    {id: 'performance', title: 'Frame rate & monitoring', items: [
      'Allocation-light cover rays, contributing-animation scheduling and memoized Duel setup reduce repeated CPU work.',
      'Fixed untracked dropped weapons accumulating across rounds; allocation-light corpse contacts and sleeping-pose reuse reduce post-kill CPU work.',
      'A toolbar FPS toggle and CPU-aware automatic pose sampling make performance easier to monitor and adapt without changing gameplay timing.',
    ]},
    {id: 'tracers', title: 'Shot feedback', items: [
      'Bullet tracers default to every round: a visible beam from the muzzle to where each shot lands, widening with distance and lasting about a third of a second.',
      'Settings > Game > Bullet tracers switches between every shot, CS2\'s per-weapon cadence and off. AI Duel bots keep CS2 cadence.',
    ]},
    {id: 'fullscreen', title: 'Fullscreen', items: [
      'The Fullscreen button works in AI Duel, and fullscreen shows only the game view. The Duel setup and drill coach panels return when fullscreen ends.',
    ]},
    {id: 'display', title: 'Resolution', items: [
      'Settings > Graphics > Resolution mirrors CS2 and defaults to 1920 x 1440, 4:3 stretched: the world and crosshair stretch to fill the view and the scene renders that many rows. The former Display aspect choice carries over.',
    ]},
    {id: 'crosshair', title: 'CS2 crosshair', items: [
      'Import reads your CS2 crosshair in both naming schemes: the pre-22 September cl_crosshairsize/gap/thickness units and the pixel-based cl_crosshair_length/_gap/_thickness, sized for the resolution in cs2_video.txt. Export writes the pixel-based names.',
      'Keys bound to console commands work in game: crosshair and colour cycling aliases, toggle and incrementvar, cl_crosshair_recoil, sensitivity, volume, viewmodel and the Duel radar zoom (cl_radar_scale).',
    ]},
    {id: 'aim-botz', title: 'Aim Botz', items: [
      'A new Aim Botz drill after the aim_botz workshop map: up to 16 bots that never shoot back stand at close, mixed or long range, some on ledges, and respawn at a new spot after each kill.',
      'Bots can stand still, strafe A-D or crouch. Headshot-only damage, respawn delay, timed or endless sessions, Kevlar/helmet and sv_infinite_ammo-style reserves are adjustable.',
      'The HUD tracks kills, accuracy and headshot rate; the Stats tab adds kills per minute, time per kill and headshot streaks, and keeps your recent sessions in this browser.',
    ]},
    {id: 'controls', title: 'Keybinds & CS2 configs', items: [
      'Settings > Keyboard / Mouse mirrors CS2\'s own page, extracted from the installed game: every bind section and option, with click-to-rebind for keys, mouse buttons and the wheel.',
      'Import autoexec.cfg and CS2\'s saved cs2_user_keys/convars files. Aliases, toggle scripts, +/- binds, exec chains, sensitivity, zoom sensitivity, duck/walk toggles and viewmodel FOV/offsets behave as in CS2; Export writes a matching .cfg.',
      'Range, AI Duel and the movement lessons follow your binds, including chorded mouse buttons. HUD hints and fullscreen shortcut protection use your keys; slot 3 cycles knife and Zeus as in CS2.',
    ]},
    {id: 'armory', title: 'Every skin unlocked', items: [
      'XP, levels, credits, milestones and the header donation link are gone. Every weapon finish, knife, glove and bot agent is unlocked.',
      'Loadout lists all finishes for the selected weapon; its Armory button opens knives, gloves, agents and achievements. Equipped items and earned achievements carry over.',
      'Achievements keep the combat, technique and training badges. Collection and level badges were removed with the unlocks.',
    ]},
    {id: 'frame-limit', title: 'Frame limit', items: [
      'Settings > Graphics > Frame limit measures your display and offers caps up to its refresh rate: Display refresh rate runs uncapped, so a 500 Hz monitor allows up to 500 FPS.',
    ]},
    {id: 'auto-reload', title: 'Auto reload', items: [
      'An empty magazine reloads by itself once the last shot\'s cycle ends, in the range, AI Duel and Aim Botz, as in CS2.',
    ]},
    {id: 'weapon-switch', title: 'Smooth weapon switching', items: [
      'Switching weapons no longer freezes: the loadout\'s first-person models are prepared in the background and stay on the GPU, so a switch never re-downloads, re-parses or recompiles a model.',
    ]},
    {id: 'input-latency', title: 'Faster shots', items: [
      'AI Duel and Aim Botz simulate a click on the next frame instead of waiting up to one 128 Hz tick (7.8 ms), and the view stays smooth while that tick runs ahead.',
    ]},
    {id: 'reflex', title: 'Fast Aim / Reflex', items: [
      'A new Fast Aim / Reflex drill after the workshop map: you stand on an island at ground level, and bots wait out of sight behind a ring of walls, then come at you through its gaps, strafing A-D, spamming crouch and edging closer.',
      'Kill each bot before it reaches the line around your island. One that gets there is counted and starts again, as on the map; bots never attack.',
      'Choose the gap distance, all eight gaps or the three in front, whether bots strafe or run straight at you, how they crouch, their weapon and respawn delay. Kills, accuracy and arrivals are tracked per session.',
    ]},
    {id: 'aim-redline', title: 'aim_redline', items: [
      'A new aim_redline drill: Aim Botz on BOT Reed\'s aim_redline workshop map. Bots stand around the warehouse floor, on the crate stacks and up on the catwalk, always in clear view, and respawn after each kill.',
      'The map\'s own collision, spawns and layout come from its workshop file. Until CS2\'s stock textures are imported, its surfaces are drawn in flat colours.',
      'Big maps stay fast: movement, bullets and sight lines only test the collision near them.',
    ]},
    {id: 'botz-movement', title: 'Aim Botz bot movement', items: [
      'Aim Botz and aim_redline bots can strafe A-D and close in, as in Fast Aim / Reflex: mostly sideways with short stops, edging toward you until about 6 m away.',
      'A new crouch option makes about half the bots spam crouch, at a person\'s pace.',
      'Bots on ledges, crates and the aim_redline catwalk move too: at an edge they slide along it or turn back, and never step off.',
    ]},
    {id: 'low-latency', title: 'Low-latency rendering', items: [
      'Settings > Graphics > Low-latency rendering, on by default, asks Chrome and Edge to show each frame without waiting for the page compositor, so the view follows the mouse about a frame sooner. It can tear, like V-Sync off.',
    ]},
    {id: 'defaults', title: 'New defaults', items: [
      'A first visit opens aim_redline with the AWP: three bots at long range strafe A-D and close in from the floor, respawn instantly and wear Kevlar without a helmet, and you never reload.',
      'Graphics start at High render quality with the FPS counter on, and the range\'s Ctrl+W protection starts off. Saved settings stay as they are.',
    ]},
    {id: 'input-timing', title: 'Input timing & handling', items: [
      'Mouse buttons and movement keys use their event time. Short strafes are preserved, clicks no longer advance the world into the future, and weapon cycles keep their fractional timing.',
      'Your movement predicts through the next frame using the same collision rules. Shots follow displayed target positions, with live armor and protection against hitting a previous bot life.',
      'First-person weapon animation follows every rendered frame. Simulation continues between capped draws, and your existing sensitivity, zoom and resolution stay intact.',
    ]},
    {id: 'native-reload', title: 'CS2 reload timing', items: [
      'AK-47, AWP, USP-S and Desert Eagle ammo now loads at the magazine insertion point measured in CS2. Firing still waits for the full reload.',
      'Switching away before insertion keeps the old ammo; switching afterward keeps the new magazine. Magazine weapons consume a whole spare when reloading, including partial reloads.',
    ]},
    {id: 'native-scope', title: 'CS2 scope transitions', items: [
      'Scopes now follow the zoom curve and weapon-specific timings verified in native CS2. Sniper scope-out and automatic bolt-action rescope use their distinct transitions.',
      'Mouse sensitivity follows the changing scope view. Quickscoping no longer waits for the visual zoom to finish, and repeat zoom observes the separate secondary-fire cooldown.',
    ]},
    {id: 'native-recovery', title: 'Consistent recoil recovery', items: [
      'Recoil now follows the native recovery cache and fractional-time rotation curve, so frequent mouse input cannot change the spray or tapping recovery.',
      'Carried recoil matches the recorded CS2 AK tap/spray sequence. Slow-firing weapons settle at the native small-angle cutoff, and spray previews use the same recovery as live shots.',
    ]},
    {id: 'native-hitboxes', title: 'Hits follow animated targets', items: [
      'Player bullets and Zeus in AI Duel, Aim Botz, Reflex and aim_redline now use CS2\'s nineteen bone-bound hit shapes on the pose shown on screen, including turned heads, crouches, hands and feet.',
      'Armor, cover and respawn checks remain current. Native neck hits share chest damage and Kevlar protection; missing skeletons keep the existing fallback.',
    ]},
    {id: 'native-camera-kick', title: 'Native shot camera kick', items: [
      'Each shot now adds CS2’s immediate camera kick, which decays separately from the slower aim recoil in the range, AI Duel and Aim Botz.',
      'Camera kick follows the player across weapon switches and updates every rendered frame. Physical shot direction, sensitivity and recoil-follow guidance remain separate.',
      'Verified against 69 native arithmetic samples and all 14 camera anchors in an offline AK tapping and spray recording.',
    ]},
    {id: 'native-landing-camera', title: 'Landing camera feedback', items: [
      'Normal jumps now produce CS2’s brief downward camera dip on landing, without changing your aim or bullet direction.',
      'The dry-ground pitch threshold and decay are verified against native arithmetic and a recorded jump. Small step-downs stay steady.',
    ]},
    {id: 'native-damage-camera', title: 'Damage camera response', items: [
      'Taking damage now uses the verified native camera scale on pitch, yaw and roll, reducing exaggerated visual flinch while retaining physical aim punch.',
    ]},
    {id:'native-shot-effects',title:'Muzzle flashes & tracers',items:[
      'Native-texture flames, a brief glow and drifting smoke replace the single fixed flash; additive textures now preserve their linear-light brightness.',
      'CS2-style tracers use the installed trail/rope families, weapon cadence and distance-dependent timing. Hits still register immediately.',
      'CS2 effects are the new default. Explicitly saved every-shot practice tracers and Off remain unchanged.',
    ]},
    {id:'viewmodel-handling',title:'Weapon presentation',items:[
      'Stretched resolutions now stretch the weapon and arms with the world. Animated barrels keep their projected tracer alignment.',
      'Native firing clips no longer receive an extra procedural shot kick. AWP and SSG animations use their authored clock alongside bolt sounds; firing cooldowns are unchanged.',
    ]},
    {id:'native-map-materials',title:'Textured aim_redline',items:[
      'Rebuilt aim_redline with the installed CS2 materials: concrete, brick, metal, crates and props now use their textures. Collision and spawns are unchanged.',
    ]},
    {id:'surface-feedback',title:'Impact & action feedback',items:[
      'Surface-aligned concrete, metal, wood and glass bullet marks use decoded native textures and bounded pools.',
      'Long frames retain each shell insertion and reload-completion deadline instead of assigning all events the end-of-frame time.',
      'M4A4 ammo now enters on the native insertion marker, including empty reloads; switching away after insertion keeps the new magazine.',
    ]},
    {id:'strafe-transitions',title:'Opponent movement presentation',items:[
      'Direction changes blend between locomotion clips over a short transition. Crouch amount, movement physics and displayed-skeleton hitboxes stay synchronized.',
    ]},
    {id:'frame-time-diagnostics',title:'Frame-time diagnostics',items:[
      'The FPS monitor shows p95 gameplay frame intervals; its tooltip adds p99, worst interval and CPU work.',
      'Click the monitor after pausing to save recent frame timings for comparison on your own PC. These measurements do not represent physical input latency.',
    ]},
    {id:'native-held-reload',title:'Native reload timing',items:[
      'Holding reload now waits 200 ms and slows only the animation’s marked section. Releasing reload prevents silence from restarting during that reload.',
      'Magazine insertion uses installed weapon markers, including separate empty-pistol reloads; ammo remains available after switching away past insertion.',
      'Reload sounds and opponent gestures follow animation progress through speed changes. Fresh native M4A4 recordings verify tap, hold and release behavior.',
    ]},
    {id: 'native-map-lighting', title: 'aim_redline lighting and materials', items: [
      'Native baked lighting and skylight shadows bring back the warm floor and walls, contact shading and coloured light around the hall.',
      'Restored container logos, glowing lamps and transparent fences; corrected the texture coordinates on shipping crates and the tint on roof beams.',
    ]},
    {id: 'native-floor-decals', title: 'Floor decal repair', items: [
      'Fixed opaque, floating floor-marking rectangles in aim_redline. Native transparency is restored and the markings sit on the floor with matching baked lighting.',
    ]},
    {id: 'ui-foundation', title: 'New interface foundation', items: [
      'Self-hosted Barlow and Rajdhani fonts, charcoal panels, squared controls and consistent keyboard focus styling from the new UI designs.',
      'Shared settings controls preserve saved values, labels and number-field validation. The recovery screen now has its own working styles.',
    ]},
    {id: 'ui-hud', title: 'CS2-style corner HUD', items: [
      'Scores and timers now sit at the top, with health or accuracy at bottom left, ammo at bottom right, and weapon silhouettes along the edge.',
      'HUD values stay visible above the scope. FPS lives at top left; bot counts, rep feedback and touch controls adapt to smaller views.',
      'Inspect and scope controls are reachable in the range. Reload no longer starts the paused range through its HUD button.',
    ]},
    {id: 'ui-settings', title: 'Full-screen settings', items: [
      'Settings now has separate Game, Video, Crosshair, Keyboard / Mouse and Audio & Data tabs, with focused-setting help and a larger crosshair preview.',
      'Saved controls, config imports and exports remain available. Restore defaults keeps the current drill and loadout; menus fit narrow screens.',
      'Dynamic crosshair movement now inherits the engine offset correctly. Weapon audio can be tested from any drill.',
    ]},
  ] satisfies readonly ChangelogSection[],
} as const satisfies ChangelogRelease;

// Append new releases without rewriting the previously published entries.
export const changelogHistory = [
  {
    id: 'update-49d8ea6',
    title: 'Previous update (49d8ea6)',
    baselineCommit: '06774a9',
    sections: [
      {id: 'duels', title: 'AI Duel & arenas', items: [
        'Bots remember recent sightings and nearby re-peeks without tracking you through walls. Hit feedback updates on the damage frame; player and AI share armor-aware aim punch and new constrained death falls.',
        'Authored points of interest create coherent cover, routes and props, with corrected top surfaces. One- and two-bot arenas can be made smaller.',
        'Bots vary holds, hear weapon-specific sound ranges and approach quietly in small duels. Beginner peeks and mid-level difficulty are rebalanced without weakening level 10/10+.',
      ]},
      {id: 'weapons', title: 'Weapons & actions', items: [
        'Expanded firearm data and loadouts, including sidearm-only practice, scopes, burst modes and R8 alternate fire.',
        'Native draw, reload, inspect and supported firing animations; knife choices, weapon-specific bot grips and dropped-weapon pickups.',
        'Native muzzle flames and pooled, instant-hit cosmetic tracers. Suppressed guns leave no tracer.',
      ]},
      {id: 'progression', title: 'XP, credits & achievements', items: [
        'Local XP, levels, a credit wallet and one-time milestones; eligible cosmetics are purchased rather than automatically owned.',
        'Permanent achievements track combat, technique, training, collection and career goals.',
        'Bot difficulty has twice its previous XP weighting. Credits keep paying after level 100.',
      ]},
      {id: 'collection', title: 'Cosmetics & owned collection', items: [
        'All 20 special knife families, both stock knives, 557 knife finishes, native inventory previews, gloves and bot agents.',
        'Owned-only collections are scoped to the selected gun, with a separate Unlocks shop. Selecting a gun with owned finishes keeps Loadout open at its finishes.',
      ]},
      {id: 'performance', title: 'Performance & browser play', items: [
        'Batched impacts and scenery, bounded asset caches, and less work for idle or hidden ranges.',
        'Adaptive and performance quality, frame limits, an optional FPS counter and supported-browser shortcut protection.',
        'Confirmed mouse capture prevents accidental drag-only aiming after switching drills. Animated barrel anchors and bounded effects avoid per-shot GPU allocations.',
      ]},
      {id: 'hearing', title: 'Hearing practice', items: [
        'Locate hidden native footsteps and shots on an overhead board, with direction/distance feedback, replay and session history.',
        'Headphone, stereo and mono profiles, HRTF/equal-power spatialization, surface choices, muffling and level calibration.',
      ]},
    ],
  },
] as const satisfies readonly ChangelogRelease[];

export const changelogReleases: readonly ChangelogRelease[] = [latestChanges, ...changelogHistory];
