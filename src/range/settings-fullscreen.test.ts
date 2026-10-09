import {describe, expect, it} from 'vitest';
import {defaults, sanitizeSettings} from './config';

describe('Fullscreen when you enter', () => {
  it('is on by default, also for profiles saved before the setting existed, and can be turned off', () => {
    expect(defaults.autoFullscreen).toBe(true);
    expect(sanitizeSettings({}).autoFullscreen).toBe(true);
    expect(sanitizeSettings({autoFullscreen: undefined}).autoFullscreen).toBe(true);
    expect(sanitizeSettings({autoFullscreen: false}).autoFullscreen).toBe(false);
  });
});
