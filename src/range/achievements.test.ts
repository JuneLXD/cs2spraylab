import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {AchievementPanel} from './AchievementPanel';
import {AchievementNotification} from './ProgressionPanel';
import {ACHIEVEMENTS, achievementProgress, sanitizeAchievements, unlockAchievements} from './achievements';
import {createProgressionController, PROGRESSION_KEY, sanitizeProgression,
  type DrillMode, type DuelAttemptResult, type DuelAttemptSetup, type ProgressionStorage} from './progression';

const setup = (patch: Partial<DuelAttemptSetup> = {}): DuelAttemptSetup => ({playerHealth: 100, playerArmor: true,
  bots: [{id: '1', skill: 5, health: 100, armor: true, accuracy: 1, weapon: 'ak47'}], ...patch});
const win = (config = setup()): DuelAttemptResult => ({completion: 'completed', outcome: 'won', activeSeconds: 20,
  review: {score: 92, shots: 10, hits: 8, heads: 4, kills: config.bots.length, damage: config.bots.reduce((sum, bot) => sum + bot.health, 0),
    taken: 0, settled: 100, movingShots: 0, airShots: 0},
  opponents: config.bots.map(bot => ({id: bot.id, healthDamage: bot.health, killed: true})),
});
const award = (controller: ReturnType<typeof createProgressionController>, config = setup(), result = win(config)) =>
  controller.completeDuel(controller.beginDuel(config, '0')!, result, config, '0');
const earned = (controller: ReturnType<typeof createProgressionController>, id: string) =>
  Object.prototype.hasOwnProperty.call(controller.getSnapshot().profile.achievements.unlocked, id);
const memory = (profile?: unknown) => {
  const data = new Map<string, string>(profile === undefined ? [] : [[PROGRESSION_KEY, JSON.stringify(profile)]]);
  const storage: ProgressionStorage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => {data.set(key, value);}};
  return {storage, data};
};

describe('achievement catalog and persistent state', () => {
  it('contains 33 unique, bounded, actionable goals across three categories', () => {
    expect(ACHIEVEMENTS).toHaveLength(33);
    expect(new Set(ACHIEVEMENTS.map(item => item.id)).size).toBe(33);
    expect(new Set(ACHIEVEMENTS.map(item => item.category))).toEqual(new Set(['combat', 'technique', 'training']));
    for (const item of ACHIEVEMENTS) {
      expect(item.title.length).toBeGreaterThan(3); expect(item.description.length).toBeGreaterThan(10);
      expect(Number.isSafeInteger(item.target) && item.target > 0).toBe(true);
      expect(Object.isFrozen(item)).toBe(true);
    }
  });
  it.each([undefined, null, [], 'bad', {stats: [], unlocked: ['first-blood']},
    {stats: {duelWins: -1, duelKills: NaN, duelHeadshots: Infinity, drills: {guided: 1.5}}, unlocked: {'first-blood': 'today', unknown: 5}}])
  ('sanitizes malformed achievement state: %j', raw => {
    const state = sanitizeAchievements(raw);
    expect(state.stats.duelWins).toBe(0); expect(state.stats.duelKills).toBe(0);
    expect(state.stats.duelHeadshots).toBe(0); expect(state.stats.drills.guided).toBe(0);
    expect(state.unlocked).toEqual({});
    expect(Object.isFrozen(state.stats.drills)).toBe(true); expect(Object.isFrozen(state.unlocked)).toBe(true);
  });
  it('bounds streaks by wins and rejects unknown or impossible dates', () => {
    const state = sanitizeAchievements({stats: {duelWins: 3, currentWinStreak: 100, bestWinStreak: 500},
      unlocked: {'first-blood': 0, 'wins-1': -1, 'wins-10': Infinity, 'wins-100': 8_640_000_000_000_001, '__proto__': 5}});
    expect(state.stats).toMatchObject({duelWins: 3, currentWinStreak: 3, bestWinStreak: 3});
    expect(state.unlocked).toEqual({'first-blood': 0});
  });
  it('migrates a v2 save: keeps equipment, drills and earned badges, drops XP, credits and ownership', () => {
    const {storage, data} = memory({version: 2, xp: 50_000, balance: 123, creditsSpent: 50, completedDuels: 1000,
      completedDrills: 1000, owned: ['finish-gloves'], equipped: {gloves: 'finish-gloves'},
      achievements: {unlocked: {'career-10': 0, 'collection-1': 5, 'wins-1': 7}, stats: {duelWins: 1}}});
    const controller = createProgressionController({storage});
    expect(controller.getSnapshot().profile).toEqual({version: 3, completedDrills: 1000, equipped: {knife: 'knife-standard', gloves: 'finish-gloves'},
      achievements: sanitizeAchievements({unlocked: {'wins-1': 7, 'drills-1000': 0}, stats: {duelWins: 1}})});
    expect(earned(controller, 'drill-guided-1')).toBe(false);
    expect(controller.getSnapshot().notification).toBeNull();
    const saved = JSON.parse(data.get(PROGRESSION_KEY)!);
    expect(saved.version).toBe(3);
    for (const field of ['xp', 'balance', 'creditsSpent', 'owned', 'milestones', 'completedDuels']) expect(saved).not.toHaveProperty(field);
    expect(createProgressionController({storage}).getSnapshot().profile).toEqual(controller.getSnapshot().profile);
  });
  it('does not fabricate skill, headshot or drill history from v1 XP', () => {
    const controller = createProgressionController({storage: memory({version: 1, xp: 1_000_000}).storage});
    expect(controller.getSnapshot().profile.achievements.unlocked).toEqual({});
    expect(controller.getSnapshot().profile.achievements.stats.duelWins).toBe(0);
  });
  it.each(ACHIEVEMENTS)('has bounded progress for $id', item => {
    const profile = sanitizeProgression(undefined);
    const progress = achievementProgress(item, profile);
    expect(progress.earned).toBe(false); expect(progress.earnedAt).toBeNull();
    expect(progress.fraction).toBeGreaterThanOrEqual(0); expect(progress.fraction).toBeLessThanOrEqual(1);
  });
});

describe('validated duel and drill achievement events', () => {
  it('settles multiple achievements atomically and only once', () => {
    const {storage} = memory(), controller = createProgressionController({storage});
    const id = controller.beginDuel(setup(), '0')!, result = win();
    expect(controller.completeDuel(id, result, setup(), '0')).toEqual({recorded: true, reason: 'qualified'});
    expect(controller.getSnapshot().notification?.achievementIds).toEqual(['first-blood', 'wins-1', 'level5-win', 'flawless-win', 'controlled-fire', 'accurate-fire', 'excellent-win']);
    expect(controller.getSnapshot().profile.achievements.stats).toMatchObject({duelWins: 1, duelKills: 1, duelHeadshots: 4, currentWinStreak: 1});
    const saved = controller.getSnapshot().profile;
    expect(controller.completeDuel(id, result, setup(), '0')).toEqual({recorded: false, reason: 'unknown-attempt'});
    expect(controller.getSnapshot().profile).toBe(saved);
    const reloaded = createProgressionController({storage});
    expect(reloaded.getSnapshot().profile).toEqual(saved); expect(reloaded.getSnapshot().notification).toBeNull();
    controller.dismissNotification();
    award(controller);
    expect(controller.getSnapshot().notification).toBeNull();
  });
  it.each(['reset', 'abandoned', 'settings-changed'] as const)('ignores %s rounds', completion => {
    const controller = createProgressionController({storage: null});
    award(controller, setup(), {...win(), completion});
    expect(controller.getSnapshot().profile.achievements).toEqual(sanitizeAchievements(undefined));
  });
  it('rejects invalid, canceled, reconfigured and no-engagement rounds', () => {
    const controller = createProgressionController({storage: null});
    award(controller, setup(), {...win(), review: {...win().review, hits: 11}});
    const canceled = controller.beginDuel(setup(), '0')!; controller.cancelAttempt(canceled);
    controller.completeDuel(canceled, win(), setup(), '0');
    const changed = controller.beginDuel(setup(), '0')!; controller.completeDuel(changed, win(), setup(), '1');
    award(controller, setup(), {...win(), outcome: 'lost', review: {...win().review, kills: 0, damage: 0}, opponents: [{id: '1', healthDamage: 0, killed: false}]});
    expect(controller.getSnapshot().profile.achievements).toEqual(sanitizeAchievements(undefined));
  });
  it('counts qualifying losses, breaks winning streaks, and preserves earned badges', () => {
    const controller = createProgressionController({storage: null});
    for (let n = 0; n < 3; n++) award(controller);
    expect(earned(controller, 'streak-3')).toBe(true);
    const loss: DuelAttemptResult = {...win(), outcome: 'lost', review: {...win().review, score: 60, damage: 50, kills: 0}, opponents: [{id: '1', healthDamage: 50, killed: false}]};
    award(controller, setup(), loss);
    expect(controller.getSnapshot().profile.achievements.stats).toMatchObject({duelWins: 3, currentWinStreak: 0, bestWinStreak: 3, duelHeadshots: 16});
    expect(earned(controller, 'streak-3')).toBe(true);
  });
  it.each(['heads', 'taken', 'settled', 'movingShots', 'airShots'] as const)('does not infer missing %s metrics', field => {
    const controller = createProgressionController({storage: null});
    const result = win(), review = {...result.review}; delete review[field];
    award(controller, setup(), {...result, review});
    if (field === 'heads') expect(controller.getSnapshot().profile.achievements.stats.duelHeadshots).toBe(0);
    else if (field === 'taken') expect(earned(controller, 'flawless-win')).toBe(false);
    else expect(earned(controller, 'controlled-fire')).toBe(false);
  });
  it.each([NaN, Infinity, -1, 1.5, 9])('ignores malformed headshot totals %s', heads => {
    const controller = createProgressionController({storage: null});
    award(controller, setup(), {...win(), review: {...win().review, heads}});
    expect(controller.getSnapshot().profile.achievements.stats.duelHeadshots).toBe(0);
  });
  it('requires ten shots for accuracy and verifies settled-shot consistency', () => {
    const controller = createProgressionController({storage: null});
    award(controller, setup(), {...win(), review: {...win().review, shots: 8}});
    expect(earned(controller, 'accurate-fire')).toBe(false); expect(earned(controller, 'controlled-fire')).toBe(false);
    award(controller, setup(), {...win(), review: {...win().review, movingShots: 3}});
    expect(earned(controller, 'controlled-fire')).toBe(false);
    award(controller, setup(), {...win(), review: {...win().review, settled: 90, movingShots: 1}});
    expect(earned(controller, 'controlled-fire')).toBe(true);
  });
  it.each(['health', 'armor', 'accuracy', 'playerHealth', 'mixedSkill', 'knife'] as const)('does not award top-tier challenges with easier %s', change => {
    const bots = [{...setup().bots[0], skill: 10 as const}], config = setup({bots});
    if (change === 'health') bots[0].health = 1;
    if (change === 'armor') bots[0].armor = false;
    if (change === 'accuracy') bots[0].accuracy = .5;
    if (change === 'knife') bots[0].weapon = 'knife';
    const final = change === 'playerHealth' ? {...config, playerHealth: 500} : change === 'mixedSkill' ? {...config, bots: [...bots, {...bots[0], id: '2', skill: 1 as const}]} : config;
    const controller = createProgressionController({storage: null}); award(controller, final);
    expect(earned(controller, 'level10-win')).toBe(false);
  });
  it('awards a real five-opponent high-skill win', () => {
    const config = setup({bots: Array.from({length: 5}, (_, n) => ({...setup().bots[0], id: String(n + 1), skill: '10+' as const}))});
    const controller = createProgressionController({storage: null}); award(controller, config);
    expect(earned(controller, 'five-bot-win')).toBe(true); expect(earned(controller, 'level10-win')).toBe(true);
    expect(controller.getSnapshot().profile.achievements.stats.duelKills).toBe(5);
  });
  it('still announces achievements after migrating a save that had XP and credits', () => {
    const controller = createProgressionController({storage: memory({version: 2, xp: 100_000_000, balance: 100_000_000}).storage});
    award(controller);
    expect(controller.getSnapshot().notification?.achievementIds).toContain('first-blood');
  });
  it('records all six drills from real successful attempts, including longer-term goals', () => {
    const controller = createProgressionController({storage: null});
    const modes: DrillMode[] = ['guided', 'spray', 'transfer', 'peek', 'precision', 'burst'];
    for (const mode of modes) for (let n = 0; n < 25; n++) {
      const id = controller.beginDrill(mode, '0')!;
      const result = {completion: 'completed' as const, objectiveCompleted: true, score: 90, shots: 10, hits: 8, activeSeconds: 5, movementReps: 1, targetsHit: 2};
      controller.completeDrill(id, result, '0'); controller.completeDrill(id, result, '0');
    }
    expect(earned(controller, 'all-drills')).toBe(true);
    expect(controller.getSnapshot().profile.completedDrills).toBe(150);
    for (const mode of modes) {
      expect(controller.getSnapshot().profile.achievements.stats.drills[mode]).toBe(25);
      expect(earned(controller, `drill-${mode}-25`)).toBe(true);
    }
  });
});

describe('achievement persistence and accessible presentation', () => {
  it('equipping cosmetics never touches achievements', () => {
    const controller = createProgressionController({storage: null, catalog: [{id: 'finish-agent', equipment: 'agent', label: 'Agent'}]});
    award(controller);
    const {achievements} = controller.getSnapshot().profile;
    expect(controller.equip('agent', 'finish-agent')).toBe(true);
    expect(controller.getSnapshot().profile.achievements).toEqual(achievements);
  });
  it('keeps achievements for session-only and unsupported-version saves', () => {
    for (const storage of [null, {getItem() {throw new Error('blocked');}, setItem() {throw new Error('quota');}}]) {
      const controller = createProgressionController({storage}); award(controller);
      expect(earned(controller, 'first-blood')).toBe(true); expect(controller.getSnapshot().storageStatus).toBe('memory-only');
    }
    const {storage, data} = memory({version: 99, achievements: {future: true}}), original = data.get(PROGRESSION_KEY);
    const controller = createProgressionController({storage}); award(controller);
    expect(earned(controller, 'first-blood')).toBe(true); expect(data.get(PROGRESSION_KEY)).toBe(original);
  });
  it('renders progress, filters, requirements, earned dates and a nonblocking notification', () => {
    const controller = createProgressionController({storage: null}); award(controller);
    const profile = controller.getSnapshot().profile;
    const html = renderToStaticMarkup(createElement(AchievementPanel, {profile}));
    expect(html).toContain('7 / 33 earned'); expect(html).toContain('Achievement category'); expect(html).toContain('Achievement status');
    expect(html).toContain('Sort achievements'); expect(html).toContain('data-achievement="first-blood"'); expect(html).toContain('<time dateTime=');
    expect(html).toContain('100%'); expect(html).toContain('aria-label="First blood"');
    const toast = renderToStaticMarkup(createElement(AchievementNotification, {controller, onOpenAchievements: () => {}}));
    expect(toast).toContain('Achievement earned'); expect(toast).toContain('First blood, First victory +5 more');
    expect(toast).toContain('View achievements'); expect(toast).not.toMatch(/XP|credits/);
    expect(toast).toContain('aria-live="polite"'); expect(toast).not.toContain('role="dialog"');
  });
  it('retains earned badges if counter data is absent', () => {
    const profile = sanitizeProgression({version: 2, achievements: {unlocked: {'first-blood': 123}}});
    const item = ACHIEVEMENTS[0], progress = achievementProgress(item, profile);
    expect(progress).toMatchObject({earned: true, current: 1, fraction: 1, earnedAt: 123});
    expect(unlockAchievements(profile, 500).ids).toEqual([]);
  });
  it('keeps unread achievement notices across fast consecutive rounds and deduplicates them', () => {
    const controller = createProgressionController({storage: null}); award(controller);
    const ids = controller.getSnapshot().notification!.achievementIds;
    award(controller);
    expect(controller.getSnapshot().notification!.achievementIds).toEqual(ids);
    controller.dismissNotification(); award(controller);
    expect(controller.getSnapshot().notification!.achievementIds).toEqual(['streak-3']);
  });
  it('makes every goal attainable at its exact threshold and unlocks each only once', () => {
    const stats = {duelWins: 1000, duelKills: 1000, duelHeadshots: 1000, winsLevel5: 1, winsLevel10: 100, fiveBotWins: 1,
      flawlessWins: 1, controlledRounds: 1, accurateRounds: 1, excellentWins: 1, currentWinStreak: 10, bestWinStreak: 10,
      drills: {guided: 25, spray: 25, transfer: 25, peek: 25, precision: 25, burst: 25}};
    const profile = sanitizeProgression({version: 3, completedDrills: 1000, achievements: {stats}});
    const unlocked = unlockAchievements(profile, 12345);
    expect(unlocked.ids).toHaveLength(33);
    const next = {...profile, achievements: unlocked.state};
    for (const item of ACHIEVEMENTS) expect(achievementProgress(item, next)).toMatchObject({earned: true, fraction: 1, current: item.target, earnedAt: 12345});
    expect(unlockAchievements(next, 23456).ids).toEqual([]);
  });
});
