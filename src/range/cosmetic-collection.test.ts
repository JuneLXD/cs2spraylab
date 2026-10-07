import {describe, expect, it} from 'vitest';
import {cosmeticCatalog, DEFAULT_GLOVE_PREVIEW} from './cosmetics';
import {cosmeticsForEquipment, equippedCosmetic, prepareCosmeticCatalog, sanitizeProgression} from './progression';
import actors from './actor-cosmetics-data.json';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const catalog = prepareCosmeticCatalog(cosmeticCatalog);
const finishes = (equipment: string) => catalog.filter(item => item.equipment === equipment && !item.isDefault);

describe('equipment-focused cosmetic collections', () => {
  it('lists stock and every finish for the selected gun, without mutating the catalog', () => {
    expect(cosmeticsForEquipment(catalog, 'ak47').map(item => item.id)).toEqual(['ak47-standard', ...finishes('ak47').map(item => item.id)]);
    expect(cosmeticsForEquipment(catalog, 'ak47')).toHaveLength(11);
    expect(cosmeticsForEquipment(catalog, 'deagle')[0].id).toBe('deagle-standard');
    expect(cosmeticsForEquipment(catalog, 'missing')).toEqual([]);
    expect(catalog.filter(item => item.equipment === 'ak47')).toHaveLength(11);
  });
  it('keeps the finish an old save had equipped, even the last in the list', () => {
    const item = finishes('ak47')[9];
    const profile = sanitizeProgression({version: 1, xp: 0, equipped: {ak47: item.id}}, catalog);
    expect(equippedCosmetic(profile, catalog, 'ak47')).toBe(item);
  });
  it('separates gloves and agents, including their stock options', () => {
    expect(cosmeticsForEquipment(catalog, 'gloves').map(item => item.id)).toEqual(['gloves-standard', ...finishes('gloves').map(item => item.id)]);
    expect(cosmeticsForEquipment(catalog, 'agent')).toHaveLength(1 + finishes('agent').length);
  });
});

describe('authored native glove inventory previews', () => {
  it('provides a real local preview for standard gloves rather than a raised-hand icon', () => {
    expect(catalog.find(item => item.id === 'gloves-standard')?.imageUrl).toBe(DEFAULT_GLOVE_PREVIEW);
    expect(readFileSync(`public/revamp${DEFAULT_GLOVE_PREVIEW}`).subarray(0, 4).toString()).toBe('RIFF');
  });
  it.each(actors.cosmetics.filter(item => item.equipment === 'gloves'))('$id uses the matching extracted inventory image', item => {
    expect(item.imageSource).toMatch(/^panorama\/images\/econ\/default_generated\/.+_light_png\.vtex_c$/);
    expect(item.imageSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(item.imageUrl).toBe(`/textures/cosmetics/${item.id}-preview.webp`);
    const bytes = readFileSync(`public/revamp${item.imageUrl}`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.imageSha256);
  });
});
