import {openLoadout, chooseWeapon} from './menu-helpers';
import {expect, test, type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';

// Written for the first visit before aim_redline and the AWP became the defaults: AI Duel with the AK-47 at Auto quality.
test.beforeEach(async ({page}) => page.addInitScript(() => {
  if (!localStorage.getItem('spraylab.range.v2')) localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', weapon: 'ak47', quality: 'auto'}));
}));

const finishes = JSON.parse(readFileSync('src/range/cosmetics-data.json', 'utf8')).cosmetics as {id: string; equipment: string; label: string}[];
const ak = finishes.filter(item => item.equipment === 'ak47');
const deagle = finishes.filter(item => item.equipment === 'deagle');

/** The armory opens from the loadout drawer. */
async function openArmory(page: Page) {
  await openLoadout(page);
  await page.getByRole('dialog', {name: 'Loadout'}).getByRole('button', {name: /^Open the armory/}).click();
}

test.beforeEach(async ({page}, info) => {
  test.skip(!['chromium', 'mobile-chromium', 'mobile-webkit', 'brave', 'opera-gx'].includes(info.project.name));
  // An older save with XP, credits and a small owned list: everything is available regardless.
  await page.addInitScript(({ak}) => {
    if (sessionStorage.getItem('collection-seeded')) return;
    localStorage.setItem('spraylab.progression.v1', JSON.stringify({version: 2, xp: 357885, balance: 10000,
      owned: [ak.id], equipped: {ak47: ak.id}}));
    sessionStorage.setItem('collection-seeded', '1');
  }, {ak: ak[0]});
  await page.goto('/');
});

test('every finish is available, scoped to the active gun, and equips without buying', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openArmory(page);
  const armory = page.getByRole('dialog', {name: 'Armory'}), items = armory.locator('.progression-choice');
  await expect(armory.getByRole('button', {name: 'Collection', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(armory.getByRole('button', {name: /^(Unlocks|Milestones)$/})).toHaveCount(0);
  await expect(armory.getByLabel('Equipment', {exact: true})).toHaveValue('ak47');
  await expect(items).toHaveCount(ak.length + 1);
  await expect(items.filter({hasText: ak[0].label})).toHaveClass(/is-equipped/);
  await expect(armory).not.toContainText(/credits|Level \d|Locked/);
  await armory.getByLabel('Equipment', {exact: true}).selectOption('deagle');
  await expect(items).toHaveCount(deagle.length + 1);
  await expect(items.locator('.progression-choice-name small')).toHaveText(Array(deagle.length + 1).fill('Desert Eagle'));
  const choice = deagle[deagle.length - 1];
  await items.filter({hasText: choice.label}).getByRole('button').click();
  await expect(items.filter({hasText: choice.label})).toHaveClass(/is-equipped/);
  await expect(armory.locator('.progression-action-notice')).toContainText(`${choice.label} equipped.`);
  await armory.getByRole('button', {name: 'Close armory'}).click();
  await page.reload();
  await openLoadout(page);
  const loadout = page.getByRole('dialog', {name: 'Loadout'});
  await expect(loadout.locator('.sl-finishes')).toHaveCount(1);
  await expect(loadout.locator('.sl-finish-grid > button')).toHaveCount(ak.length + 1);
  await chooseWeapon(page, 'deagle', false);
  await expect(loadout.locator('.sl-finish-grid > button')).toHaveCount(deagle.length + 1);
  await expect(loadout.locator('.sl-finish-grid button[aria-pressed=true]')).toContainText(choice.label);
  await page.screenshot({path: `test-results/${info.project.name}-loadout-finishes.png`});
  expect(errors).toEqual([]);
});

test('native glove previews and the collection fit small screens', async ({page}, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openArmory(page);
  const armory = page.getByRole('dialog', {name: 'Armory'});
  await armory.getByRole('tab', {name: 'Gloves', exact: true}).click();
  await expect(armory.locator('.progression-choice')).toHaveCount(9);
  await expect(armory.locator('.progression-preview img').first()).toHaveAttribute('src', '/textures/cosmetics/gloves-standard-preview.webp');
  await expect.poll(() => armory.locator('.progression-preview img').evaluateAll(nodes => nodes.every(node => {
    const image = node as HTMLImageElement; return image.complete && image.naturalWidth >= 128;
  }))).toBe(true);
  await expect(armory.getByRole('tab', {name: 'Gloves', exact: true}).locator('img')).toHaveAttribute('src', '/textures/cosmetics/gloves-standard-preview.webp');
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 740], [844, 390]]) {
    await page.setViewportSize({width, height});
    const cards = armory.locator('.progression-choice');
    await cards.first().scrollIntoViewIfNeeded();
    expect(await armory.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await cards.evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
    expect(await armory.locator('.progression-views button, .progression-tabs button').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
    await page.screenshot({path: `test-results/${info.project.name}-glove-inventory-${width}.png`});
  }
  expect(errors).toEqual([]);
});
