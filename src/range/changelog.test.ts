import {createElement} from 'react';
import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {Changelog} from './Changelog';
import {changelogHistory, changelogReleases, latestChanges} from './changelog-data';

describe('append-only changelog', () => {
  it('identifies the requested baseline without claiming a deployment', () => {
    expect(latestChanges.title).toBe('Latest update');
    expect(latestChanges.baselineCommit).toBe('49d8ea6');
    const html = renderToStaticMarkup(createElement(Changelog));
    expect(html).toContain('Latest update');
    expect(html).toContain('Since baseline <code>49d8ea6</code>');
    expect(html).not.toMatch(/<time|deployed on|released on/i);
  });

  it('keeps every section and item from the previously published update unchanged', () => {
    const previous = changelogHistory.find(release => release.id === 'update-49d8ea6')!;
    expect(previous.baselineCommit).toBe('06774a9');
    // Fingerprint of the sections in commit 49d8ea6, not a copy of the current data.
    expect(createHash('sha256').update(JSON.stringify(previous.sections)).digest('hex'))
      .toBe('86193c4620fecd420ed914d753580dbfee5ac311e32031d5ec4b59375bfa03bf');
    expect(changelogReleases).toEqual([latestChanges, ...changelogHistory]);
    expect(new Set(changelogReleases.map(release => release.id)).size).toBe(changelogReleases.length);
  });

  it('covers the accumulated completed features', () => {
    expect(latestChanges.sections.map(section => section.id)).toEqual([
      'combat', 'weapons', 'movement', 'arenas', 'bot-behavior', 'connection', 'presentation', 'performance', 'tracers', 'fullscreen', 'display', 'crosshair', 'aim-botz', 'controls',
      'armory', 'frame-limit', 'auto-reload', 'weapon-switch', 'input-latency', 'reflex', 'aim-redline', 'botz-movement', 'low-latency', 'defaults', 'input-timing', 'native-reload', 'native-scope', 'native-recovery', 'native-hitboxes', 'native-camera-kick', 'native-landing-camera', 'native-damage-camera',
      'native-shot-effects','viewmodel-handling','native-map-materials','surface-feedback','strafe-transitions','frame-time-diagnostics','native-held-reload','native-map-lighting','native-floor-decals','ui-foundation','ui-hud',
    ]);
    expect(latestChanges.sections.find(section => section.id === 'reflex')!.items.join(' ')).toContain('come at you through its gaps');
    expect(latestChanges.sections.find(section => section.id === 'aim-redline')!.items.join(' ')).toContain('BOT Reed');
    expect(latestChanges.sections.find(section => section.id === 'botz-movement')!.items.join(' ')).toContain('close in');
    expect(latestChanges.sections.find(section => section.id === 'botz-movement')!.items.join(' ')).toContain('never step off');
    expect(latestChanges.sections.find(section => section.id === 'low-latency')!.items.join(' ')).toContain('page compositor');
    expect(latestChanges.sections.find(section => section.id === 'defaults')!.items.join(' ')).toContain('opens aim_redline with the AWP');
    expect(latestChanges.sections.find(section => section.id === 'armory')!.items.join(' ')).toContain('Every weapon finish, knife, glove and bot agent is unlocked');
    expect(latestChanges.sections.find(section => section.id === 'auto-reload')!.items.join(' ')).toContain('reloads by itself');
    expect(latestChanges.sections.find(section => section.id === 'input-latency')!.items.join(' ')).toContain('next frame');
    expect(latestChanges.sections.find(section => section.id === 'weapon-switch')!.items.join(' ')).toContain('no longer freezes');
    expect(latestChanges.sections.find(section => section.id === 'frame-limit')!.items.join(' ')).toContain('500 FPS');
    expect(latestChanges.sections.find(section => section.id === 'display')!.items.join(' ')).toContain('1920 x 1440');
    expect(latestChanges.sections.find(section => section.id === 'crosshair')!.items.join(' ')).toContain('cl_crosshair_length');
    expect(latestChanges.sections.find(section => section.id === 'controls')!.items.join(' ')).toContain('autoexec.cfg');
    expect(latestChanges.sections.find(section => section.id === 'aim-botz')!.items.join(' ')).toContain('respawn');
    expect(new Set(latestChanges.sections.map(section => section.id)).size).toBe(latestChanges.sections.length);
    expect(latestChanges.sections.find(section => section.id === 'connection')!.items.join(' ')).toContain('Removed simulated network latency');
    expect(latestChanges.sections.find(section => section.id === 'bot-behavior')!.items.join(' ')).toContain('shot-confirmed burst timing');
    expect(latestChanges.sections.find(section => section.id === 'performance')!.items.join(' ')).toContain('toolbar FPS toggle');
    for (const section of changelogReleases.flatMap(release => release.sections)) {
      expect(section.items.length).toBeGreaterThan(0);
      expect(section.items.length).toBeLessThanOrEqual(3);
    }
  });

  it('renders labeled sections with lists and local-only accuracy boundaries', () => {
    const html = renderToStaticMarkup(createElement(Changelog));
    for (const release of changelogReleases) {
      expect(html).toContain(`aria-labelledby="changelog-${release.id}"`);
      for (const section of release.sections) {
        expect(html).toContain(`aria-labelledby="changelog-${release.id}-${section.id}"`);
        expect(html).toContain(`id="changelog-${release.id}-${section.id}"`);
      }
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = changelogReleases.flatMap(release => release.sections);
    expect(html.match(/<ul>/g)).toHaveLength(sections.length);
    expect(html.match(/<li>/g)).toHaveLength(sections.reduce((count, section) => count + section.items.length, 0));
    expect(html).toContain('Progress and cosmetics stay in this browser.');
    expect(html).toContain('Cosmetics are not CS2 inventory items.');
    expect(html).toContain('not make the trainer an exact CS2 reproduction.');
  });
});
