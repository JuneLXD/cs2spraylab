import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {AchievementNotification, ProgressionPanel} from './ProgressionPanel';
import {sanitizeAchievements} from './achievements';
import {
  MAX_COMPLETIONS, PROGRESSION_KEY, PROGRESSION_VERSION, STANDARD_KNIFE_ID,
  cosmeticCategory, cosmeticsForEquipment, createProgressionController, equippedCosmetic, prepareCosmeticCatalog, qualifyDrill, qualifyDuel, sanitizeProgression,
  type AttemptBot, type CosmeticDefinition, type DrillAttemptResult, type DrillMode, type DuelAttemptResult, type DuelAttemptSetup,
  type ProgressionStorage,
} from './progression';

const BUTTERFLY = 'knife-butterfly-emerald';
const definitions: CosmeticDefinition[] = [
  {id: 'test-stock', equipment: 'ak47', label: 'Standard finish', isDefault: true},
  {id: 'test-finish', equipment: 'ak47', label: 'Test finish', imageUrl: '/test/finish.webp', swatch: '#ff00cc', assetKey: 'test-texture'},
  {id: BUTTERFLY, equipment: 'knife', label: 'Test butterfly cosmetic', assetKey: 'test-knife'},
];
const bot = (patch: Partial<AttemptBot> = {}): AttemptBot => ({id: '1', skill: 5, health: 100, armor: true, accuracy: 1, weapon: 'ak47', ...patch});
const setup = (patch: Partial<DuelAttemptSetup> = {}): DuelAttemptSetup => ({playerHealth: 100, playerArmor: true, bots: [bot()], ...patch});
const win = (config = setup(), score = 75): DuelAttemptResult => ({completion: 'completed', outcome: 'won', activeSeconds: 60,
  review: {score, shots: 20 * config.bots.length, hits: 5 * config.bots.length, damage: config.bots.reduce((sum, item) => sum + item.health, 0), kills: config.bots.length},
  opponents: config.bots.map(item => ({id: item.id, healthDamage: item.health, killed: true})),
});
const partial = (config = setup(), damage = 50, score: number | null = 75): DuelAttemptResult => ({completion: 'completed', outcome: 'lost', activeSeconds: 60,
  review: {score, shots: 10, hits: damage ? 2 : 0, kills: 0, damage},
  opponents: config.bots.map((item, index) => ({id: item.id, healthDamage: index ? 0 : damage, killed: false})),
});
const drill = (patch: Partial<DrillAttemptResult> = {}): DrillAttemptResult => ({completion: 'completed', objectiveCompleted: true, score: 80,
  shots: 10, hits: 5, activeSeconds: 5, movementReps: 1, targetsHit: 2, ...patch});
const memory = (initial?: unknown) => {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(PROGRESSION_KEY, JSON.stringify(initial));
  const storage: ProgressionStorage = {getItem: vi.fn(key => data.get(key) ?? null), setItem: vi.fn((key, value) => {data.set(key, value);})};
  return {storage, data};
};
const award = (controller: ReturnType<typeof createProgressionController>, config = setup(), score = 75) => {
  const id = controller.beginDuel(config, 'settings:0')!;
  return controller.completeDuel(id, win(config, score), config, 'settings:0');
};
const fresh = (patch: Record<string, unknown> = {}) => ({version: PROGRESSION_VERSION, completedDrills: 0,
  equipped: {knife: STANDARD_KNIFE_ID}, achievements: sanitizeAchievements(undefined), ...patch});

describe('native catalog boundary', () => {
  it('only provides a neutral standard knife until the main catalog supplies assets', () => {
    expect(prepareCosmeticCatalog()).toEqual([{id: STANDARD_KNIFE_ID, equipment: 'knife', category: 'knife', label: 'Standard knife', isDefault: true}]);
  });
  it('keeps native metadata but rejects duplicate IDs, unsafe previews and prototype keys', () => {
    const catalog = prepareCosmeticCatalog([...definitions,
      {...definitions[1], label: 'Duplicate'},
      {...definitions[1], id: '__proto__'},
      {...definitions[1], id: 'unsafe-preview', imageUrl: '//example.test/tracker', swatch: 'url(bad)'},
    ]);
    expect(catalog.find(item => item.id === 'test-finish')).toMatchObject({label: 'Test finish', imageUrl: '/test/finish.webp', swatch: '#ff00cc', assetKey: 'test-texture'});
    expect(catalog.filter(item => item.id === 'test-finish')).toHaveLength(1);
    expect(catalog.some(item => item.id === '__proto__')).toBe(false);
    expect(catalog.find(item => item.id === 'unsafe-preview')).not.toHaveProperty('imageUrl');
    expect(catalog.find(item => item.id === 'unsafe-preview')).not.toHaveProperty('swatch');
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog[0])).toBe(true);
  });
  it('ignores the level and price fields that native data still carries', () => {
    const legacy = {...definitions[1], unlockLevel: 90, price: 4000, legacyUnlockLevel: 2} as CosmeticDefinition;
    expect(prepareCosmeticCatalog([legacy])[1]).toEqual({id: 'test-finish', equipment: 'ak47', label: 'Test finish', isDefault: false,
      category: 'weapon', imageUrl: '/test/finish.webp', swatch: '#ff00cc', assetKey: 'test-texture'});
  });
  it('keeps the standard knife a stock knife, never mapped to a gun', () => {
    expect(prepareCosmeticCatalog([{id: STANDARD_KNIFE_ID, equipment: 'knife', label: 'Incorrect name', assetKey: 'native-default'}])[0])
      .toMatchObject({label: 'Standard knife', isDefault: true, assetKey: 'native-default'});
    expect(prepareCosmeticCatalog([{...definitions[0], id: STANDARD_KNIFE_ID}])[0].equipment).toBe('knife');
  });
  it('normalizes stock items, thumbnail metadata and equipment categories', () => {
    const catalog = prepareCosmeticCatalog([
      definitions[0], {...definitions[1], category: 'weapon', rarity: 'Covert'},
      {id: 'glove-stock', equipment: 'gloves', label: 'Stock gloves', isDefault: true, category: 'gloves'},
      {id: 'agent-native', equipment: 'agent', label: 'Native agent', imageUrl: '/models/agent.png', assetKey: 'native-agent'},
      {...definitions[1], id: 'bad-category', category: 'agent'}, {...definitions[1], id: 'bad-slot', equipment: 'glove', category: 'gloves'},
    ]);
    expect(catalog.find(item => item.id === 'test-stock')).toMatchObject({category: 'weapon', isDefault: true});
    expect(catalog.find(item => item.id === 'test-finish')).toMatchObject({rarity: 'Covert', imageUrl: '/test/finish.webp'});
    expect(catalog.find(item => item.id === 'glove-stock')).toMatchObject({category: 'gloves', isDefault: true});
    expect(catalog.find(item => item.id === 'agent-native')).toMatchObject({category: 'agent', assetKey: 'native-agent'});
    expect(catalog.some(item => item.id === 'bad-category' || item.id === 'bad-slot')).toBe(false);
    expect(cosmeticCategory(definitions[1])).toBe('weapon');
    expect(cosmeticCategory(definitions[2])).toBe('knife');
  });
  it('lists every cosmetic for an equipment slot', () => {
    expect(cosmeticsForEquipment(prepareCosmeticCatalog(definitions), 'ak47').map(item => item.id)).toEqual(['test-stock', 'test-finish']);
  });
});

describe('duel achievement qualification', () => {
  it('qualifies completed wins and engaged losses, deterministically', () => {
    expect(qualifyDuel(setup(), win())).toEqual({qualified: true, reason: 'qualified'});
    expect(qualifyDuel(setup(), partial())).toEqual({qualified: true, reason: 'qualified'});
    expect(qualifyDuel(setup({bots: [bot(), bot({id: '2', skill: '10+'})]}), win(setup({bots: [bot(), bot({id: '2', skill: '10+'})]}))).qualified).toBe(true);
  });
  it('allows legitimate melee damage with a null gun coaching score', () => {
    expect(qualifyDuel(setup(), partial(setup(), 50, null)).qualified).toBe(true);
  });
  it('does not count AFK, firing at walls, or taking damage without dealing damage', () => {
    expect(qualifyDuel(setup(), partial(setup(), 0)).reason).toBe('no-engagement');
    const result = partial(setup(), 0, null);
    expect(qualifyDuel(setup(), {...result, review: {...result.review, shots: 0, hits: 0}}).qualified).toBe(false);
  });
  it.each(['reset', 'abandoned', 'settings-changed'] as const)('rejects %s even with a good score', completion => {
    expect(qualifyDuel(setup(), {...win(), completion})).toEqual({qualified: false, reason: 'not-completed'});
  });
  it('rejects impossible totals, invented kills, duplicated bots and mismatched outcome', () => {
    const result = win();
    const invalid: DuelAttemptResult[] = [
      {...result, review: {...result.review, damage: 99}},
      {...result, review: {...result.review, shots: 0}},
      {...result, review: {...result.review, score: NaN}},
      {...result, review: {...result.review, score: Infinity}},
      {...result, review: {...result.review, kills: 0}},
      {...result, opponents: [{id: '1', healthDamage: 1000, killed: true}]},
      {...result, opponents: [{id: 'missing', healthDamage: 100, killed: true}]},
      {...result, opponents: [...result.opponents, ...result.opponents]},
      {...result, opponents: [{id: '1', healthDamage: 100, killed: false}]},
      {...result, outcome: 'lost'},
      {...partial(), outcome: 'won'},
    ];
    for (const value of invalid) expect(qualifyDuel(setup(), value)).toEqual({qualified: false, reason: 'invalid-result'});
    expect(qualifyDuel(setup({bots: [bot(), bot()]}), win()).qualified).toBe(false);
    expect(qualifyDuel(setup({bots: []}), win()).qualified).toBe(false);
    expect(qualifyDuel(setup({bots: [bot({health: NaN})]}), win()).qualified).toBe(false);
  });
  it('rejects invalid armor configurations', () => {
    for (const config of [setup({bots: [bot({armorPoints: 101})]}), setup({bots: [bot({armorPoints: -1})]}),
      setup({bots: [bot({helmet: 'yes' as unknown as boolean})]}), setup({playerArmor: 'yes' as unknown as boolean})])
      expect(qualifyDuel(config, win(config)).reason).toBe('invalid-result');
  });
});

describe('drill achievement qualification', () => {
  it('counts quick, successful counterstrafes and reposition bursts without counting idle clicks', () => {
    expect(qualifyDrill('precision', drill({shots: 1, hits: 1, targetsHit: 1, activeSeconds: .4})).qualified).toBe(true);
    expect(qualifyDrill('burst', drill({shots: 6, activeSeconds: .8})).qualified).toBe(true);
    expect(qualifyDrill('precision', drill({activeSeconds: .1})).qualified).toBe(false);
    expect(qualifyDrill('precision', drill({activeSeconds: .4, movementReps: 0})).qualified).toBe(false);
  });
  it.each<DrillMode>(['guided', 'spray', 'transfer', 'peek', 'precision', 'burst'])('qualifies a completed %s attempt', mode => {
    expect(qualifyDrill(mode, drill())).toEqual({qualified: true, reason: 'qualified'});
  });
  it('requires the real objective, completed lifecycle, hits, and active time', () => {
    for (const patch of [{objectiveCompleted: false}, {completion: 'reset' as const}, {hits: 0, targetsHit: 0}, {activeSeconds: .1}, {targetsHit: 0}]) {
      expect(qualifyDrill('guided', drill(patch)).qualified).toBe(false);
    }
  });
  it.each<DrillMode>(['burst', 'precision', 'peek'])('%s requires a legitimate movement repetition', mode => {
    expect(qualifyDrill(mode, drill({movementReps: 0})).qualified).toBe(false);
  });
  it('requires both transfer targets and six shots for spray/burst attempts', () => {
    expect(qualifyDrill('transfer', drill({targetsHit: 1})).qualified).toBe(false);
    for (const mode of ['guided', 'spray', 'burst'] as const) expect(qualifyDrill(mode, drill({shots: 5})).qualified).toBe(false);
  });
  it('rejects malformed stats', () => {
    for (const patch of [{hits: 11}, {score: 101}, {score: NaN}, {shots: -1}, {movementReps: Infinity}, {activeSeconds: -1}, {targetsHit: 10}]) {
      expect(qualifyDrill('guided', drill(patch))).toEqual({qualified: false, reason: 'invalid-result'});
    }
  });
});

describe('persistent profile and equipment sanitation', () => {
  it('ignores malformed and unknown versions', () => {
    for (const raw of [null, [], 5, {}, {version: 99, equipped: {ak47: 'test-finish'}}, {version: '2', completedDrills: 4}]) {
      expect(sanitizeProgression(raw)).toEqual(fresh());
    }
  });
  it('accepts any catalog finish for its own slot and rejects wrong-equipment and prototype entries', () => {
    const catalog = prepareCosmeticCatalog(definitions);
    const raw = JSON.parse(`{"version":3,"equipped":{"knife":"${BUTTERFLY}","ak47":"test-finish","gloves":"test-stock","__proto__":"test-stock"}}`);
    const profile = sanitizeProgression(raw, catalog);
    expect(profile.equipped).toEqual({knife: BUTTERFLY, ak47: 'test-finish'});
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.equipped)).toBe(true);
  });
  it('persists equips and achievements, and restores them without replaying notices', () => {
    const {storage} = memory();
    const first = createProgressionController({storage, catalog: definitions});
    award(first); award(first);
    expect(first.equip('ak47', 'test-finish')).toBe(true);
    expect(first.equip('knife', BUTTERFLY)).toBe(true);
    const second = createProgressionController({storage, catalog: definitions});
    expect(second.getSnapshot().profile).toEqual(first.getSnapshot().profile);
    expect(second.getSnapshot().profile.achievements.stats.duelWins).toBe(2);
    expect(second.getSnapshot().notification).toBeNull();
    expect(equippedCosmetic(second.getSnapshot().profile, second.catalog, 'ak47')?.id).toBe('test-finish');
  });
  it('equips any finish at once and returns to stock, but rejects wrong slots and invalid IDs', () => {
    const controller = createProgressionController({storage: null, catalog: definitions});
    expect(controller.equip('knife', BUTTERFLY)).toBe(true);
    expect(controller.equip('ak47', 'test-finish')).toBe(true);
    expect(controller.equip('ak47', STANDARD_KNIFE_ID)).toBe(false);
    expect(controller.equip('missing', 'unknown')).toBe(false);
    expect(controller.equip('__proto__', 'test-stock')).toBe(false);
    expect(controller.resetEquipment('knife')).toBe(true);
    expect(controller.resetEquipment('ak47')).toBe(true);
    expect(equippedCosmetic(controller.getSnapshot().profile, controller.catalog, 'knife')?.id).toBe(STANDARD_KNIFE_ID);
    expect(equippedCosmetic(controller.getSnapshot().profile, controller.catalog, 'ak47')?.id).toBe('test-stock');
  });
  it('falls back safely on corrupt JSON and blocked or full storage', () => {
    const {storage, data} = memory();
    data.set(PROGRESSION_KEY, '{');
    const corrupt = createProgressionController({storage});
    expect(corrupt.getSnapshot().profile).toEqual(fresh());
    expect(award(corrupt).recorded).toBe(true);
    expect(corrupt.getSnapshot().storageStatus).toBe('saved');
    const blocked = createProgressionController({storage: {getItem() {throw Error('blocked');}, setItem() {throw Error('quota');}}});
    expect(award(blocked).recorded).toBe(true);
    expect(blocked.getSnapshot().storageStatus).toBe('memory-only');
    expect(blocked.getSnapshot().profile.achievements.stats.duelWins).toBe(1);
  });
  it('preserves an unsupported future save verbatim and never overwrites unreadable storage', () => {
    const {storage, data} = memory({version: 99, future: true});
    const original = data.get(PROGRESSION_KEY), controller = createProgressionController({storage, catalog: definitions});
    expect(award(controller).recorded).toBe(true);
    expect(controller.equip('ak47', 'test-finish')).toBe(true);
    expect(controller.getSnapshot().storageStatus).toBe('unsupported-version');
    expect(data.get(PROGRESSION_KEY)).toBe(original);
    expect(storage.setItem).not.toHaveBeenCalled();
    const setItem = vi.fn();
    const unreadable = createProgressionController({storage: {getItem() {throw Error('read blocked');}, setItem}, catalog: definitions});
    award(unreadable); unreadable.equip('ak47', 'test-finish');
    expect(setItem).not.toHaveBeenCalled();
  });
  it('keeps completed drill counts to whole numbers within bounds', () => {
    expect(sanitizeProgression({version: 3, completedDrills: .5}).completedDrills).toBe(0);
    expect(sanitizeProgression({version: 3, completedDrills: MAX_COMPLETIONS + 1}).completedDrills).toBe(0);
    expect(sanitizeProgression({version: 2, completedDrills: MAX_COMPLETIONS}).completedDrills).toBe(MAX_COMPLETIONS);
  });
});

describe('migration from XP and credit saves', () => {
  it('migrates v1 immediately on the same key, keeping equipped items and dropping XP', () => {
    const {storage, data} = memory({version: 1, xp: 15_485, equipped: {ak47: 'test-finish', knife: BUTTERFLY}});
    const controller = createProgressionController({storage, catalog: definitions});
    const expected = fresh({equipped: {knife: BUTTERFLY, ak47: 'test-finish'}});
    expect(controller.getSnapshot().profile).toEqual(expected);
    expect(JSON.parse(data.get(PROGRESSION_KEY)!)).toEqual(expected);
  });
  it('migrates v2: keeps equipment, completed drills and achievements, drops the ledger and ownership', () => {
    const achievements = sanitizeAchievements({stats: {duelWins: 2}, unlocked: {'wins-1': 9}});
    const {storage, data} = memory({version: 2, xp: 99_000, balance: 4198, creditsEarned: 5000, creditsSpent: 802, owned: ['test-finish'],
      completedDuels: 7, completedDrills: 3, milestones: ['level-10'], equipped: {ak47: 'test-finish'}, achievements});
    const controller = createProgressionController({storage, catalog: definitions});
    const expected = fresh({completedDrills: 3, equipped: {knife: STANDARD_KNIFE_ID, ak47: 'test-finish'}, achievements});
    expect(controller.getSnapshot().profile).toEqual(expected);
    expect(JSON.parse(data.get(PROGRESSION_KEY)!)).toEqual(expected);
  });
  it('keeps retired equipped IDs across catalog removal and reintroduction', () => {
    const profile = sanitizeProgression({version: 3, equipped: {ak47: 'retired-finish'}});
    expect(profile.equipped.ak47).toBe('retired-finish');
    expect(equippedCosmetic(profile, prepareCosmeticCatalog(definitions), 'ak47')?.id).toBe('test-stock');
    const catalog = prepareCosmeticCatalog([{...definitions[1], id: 'retired-finish'}]);
    expect(equippedCosmetic(sanitizeProgression(profile, catalog), catalog, 'ak47')?.id).toBe('retired-finish');
  });
  it('continues safely in memory when the migration write fails', () => {
    const {storage} = memory({version: 1, xp: 15_485, equipped: {knife: BUTTERFLY}});
    storage.setItem = vi.fn(() => {throw Error('quota');});
    const controller = createProgressionController({storage, catalog: definitions});
    expect(controller.getSnapshot().storageStatus).toBe('memory-only');
    expect(controller.getSnapshot().profile.equipped.knife).toBe(BUTTERFLY);
    expect(controller.equip('ak47', 'test-finish')).toBe(true);
  });
});

describe('one-use attempt lifecycle, notifications and React contracts', () => {
  it('is idempotent per issued round ID and rejects replay after reload', () => {
    const {storage} = memory(), config = setup(), controller = createProgressionController({storage});
    const id = controller.beginDuel(config, '0')!;
    expect(controller.completeDuel(id, win(config), config, '0').recorded).toBe(true);
    const profile = controller.getSnapshot().profile;
    expect(controller.completeDuel(id, win(config), config, '0').reason).toBe('unknown-attempt');
    const reloaded = createProgressionController({storage});
    expect(reloaded.completeDuel(id, win(config), config, '0').reason).toBe('unknown-attempt');
    expect(reloaded.getSnapshot().profile).toEqual(profile);
  });
  it('does not restore an unfinished attempt after reload', () => {
    const {storage} = memory(), controller = createProgressionController({storage});
    const id = controller.beginDuel(setup(), '0')!;
    const reloaded = createProgressionController({storage});
    expect(reloaded.completeDuel(id, win(), setup(), '0').recorded).toBe(false);
  });
  it('cancels the previous attempt when a different round or mode starts', () => {
    const controller = createProgressionController({storage: null});
    const old = controller.beginDuel(setup(), '0')!;
    const next = controller.beginDrill('guided', '0')!;
    expect(controller.completeDuel(old, win(), setup(), '0').recorded).toBe(false);
    expect(controller.completeDrill(next, drill(), '0').recorded).toBe(true);
    expect(controller.completeDrill(next, drill(), '0').recorded).toBe(false);
    expect(controller.getSnapshot().profile.completedDrills).toBe(1);
  });
  it('cannot turn reset or invalid results into records by resubmitting later', () => {
    const controller = createProgressionController({storage: null});
    const id = controller.beginDuel(setup(), '0')!;
    expect(controller.completeDuel(id, {...win(), completion: 'reset'}, setup(), '0')).toEqual({recorded: false, reason: 'not-completed'});
    expect(controller.completeDuel(id, win(), setup(), '0').recorded).toBe(false);
  });
  it('rejects changes to any setup field or revision, even change-and-revert', () => {
    const controller = createProgressionController({storage: null});
    for (const finalSetup of [setup({playerHealth: 500}), setup({playerArmor: false}), setup({bots: [bot({skill: 10})]}),
      setup({bots: [bot({weapon: 'awp'})]}), setup({bots: [bot({armor: false})]}), setup({bots: [bot({accuracy: .5})]}),
      setup({bots: [bot({helmet: false})]}), setup({bots: [bot({armorPoints: 50})]})]) {
      const id = controller.beginDuel(setup(), '0')!;
      expect(controller.completeDuel(id, win(), finalSetup, '0').reason).toBe('settings-changed');
    }
    const id = controller.beginDuel(setup(), '0')!;
    expect(controller.completeDuel(id, win(), setup(), '2').reason).toBe('settings-changed');
    const drillId = controller.beginDrill('guided', '0')!;
    expect(controller.completeDrill(drillId, drill(), '1').reason).toBe('settings-changed');
    expect(controller.getSnapshot().profile).toEqual(fresh());
  });
  it('copies setup so external mutation cannot rewrite an in-flight difficulty', () => {
    const controller = createProgressionController({storage: null});
    const live = {playerHealth: 100, playerArmor: true, bots: [{...bot()}]};
    const id = controller.beginDuel(live, '0')!;
    live.bots[0].skill = 10;
    expect(controller.completeDuel(id, win(live), live, '0').reason).toBe('settings-changed');
  });
  it('supports explicit cancellation without letting a stale callback cancel a newer attempt', () => {
    const controller = createProgressionController({storage: null});
    const old = controller.beginDuel(setup(), '0')!;
    const next = controller.beginDuel(setup(), '0')!;
    controller.cancelAttempt(old);
    expect(controller.completeDuel(next, win(), setup(), '0').recorded).toBe(true);
    const cancelled = controller.beginDuel(setup(), '0')!;
    controller.cancelAttempt();
    expect(controller.completeDuel(cancelled, win(), setup(), '0').recorded).toBe(false);
  });
  it('does not consume an active duel for a wrong-type completion callback', () => {
    const controller = createProgressionController({storage: null});
    const id = controller.beginDuel(setup(), '0')!;
    expect(controller.completeDrill(id, drill(), '0').recorded).toBe(false);
    expect(controller.completeDuel(id, win(), setup(), '0').recorded).toBe(true);
  });
  it('rejects invalid start state and revision', () => {
    const controller = createProgressionController({storage: null});
    expect(controller.beginDuel(setup({playerHealth: 0}), '0')).toBeNull();
    expect(controller.beginDuel(setup(), '')).toBeNull();
    expect(controller.beginDrill('guided', '')).toBeNull();
  });
  it('publishes immutable stable snapshots only on changes and unsubscribes', () => {
    const controller = createProgressionController({storage: null, catalog: definitions}), listener = vi.fn();
    const unsubscribe = controller.subscribe(listener), initial = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    const id = controller.beginDuel(setup(), '0')!;
    expect(listener).not.toHaveBeenCalled();
    controller.completeDuel(id, win(), setup(), '0');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).not.toBe(initial);
    expect(controller.equip('ak47', 'test-stock')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    controller.dismissNotification();
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it('stops accepting attempts and equips after disposal', () => {
    const controller = createProgressionController({storage: null, catalog: definitions}), listener = vi.fn();
    controller.subscribe(listener);
    const id = controller.beginDuel(setup(), '0')!;
    controller.dispose();
    expect(controller.completeDuel(id, win(), setup(), '0').recorded).toBe(false);
    expect(controller.beginDrill('guided', '0')).toBeNull();
    expect(controller.beginDuel(setup(), '0')).toBeNull();
    expect(controller.equip('ak47', 'test-finish')).toBe(false);
    expect(controller.resetEquipment('ak47')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
  it('renders no armory or header widget until the loadout or a toast requests it, even on the server', () => {
    const controller = createProgressionController({storage: null});
    expect(renderToStaticMarkup(createElement(ProgressionPanel, {controller}))).toBe('');
    expect(renderToStaticMarkup(createElement(ProgressionPanel, {controller, requestedEquipment: 'knife'}))).toBe('');
  });
  it('renders achievement notices in a live region with an accessible dismissal, and nothing about XP', () => {
    const controller = createProgressionController({storage: null});
    expect(renderToStaticMarkup(createElement(AchievementNotification, {controller}))).toContain('aria-live="polite"');
    award(controller);
    const html = renderToStaticMarkup(createElement(AchievementNotification, {controller}));
    expect(html).toContain('Achievement earned');
    expect(html).toContain('First blood');
    expect(html).toContain('Dismiss achievement notification');
    expect(html).not.toMatch(/XP|credits/);
  });
});
