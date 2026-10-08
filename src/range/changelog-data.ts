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
