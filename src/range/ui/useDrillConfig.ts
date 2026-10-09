import {useCallback, useEffect, useState} from 'react';
import {sanitizeDuelConfig, type DuelConfig} from '../duel/config';
import {sanitizeBotzConfig, type BotzConfig} from '../duel/botz';

function read(key: string): object {try {return JSON.parse(localStorage.getItem(key) || '{}');} catch {return {};}}
function save(key: string, value: unknown) {try {localStorage.setItem(key, JSON.stringify(value));} catch { /* Session-only setup. */ }}
/** Deathmatch keeps its own bot count, level and respawn delay; a delay above zero is what makes the engine respawn
 * on the imported map instead of ending rounds, so it is pinned to at least 1 s there and 0 for round-based duels. */
const deathmatchDefaults = {botCount: 3, respawnSeconds: 3, radarEnabled: false};
export function useDuelConfig(kind: 'duel' | 'deathmatch' = 'duel') {
  const key = `spraylab.${kind}.v1`;
  const sanitize = useCallback((raw: object) => {
    const config = sanitizeDuelConfig(kind === 'deathmatch' ? {...deathmatchDefaults, ...raw} : raw);
    return {...config, respawnSeconds: kind === 'deathmatch' ? Math.max(1, config.respawnSeconds) : 0};
  }, [kind]);
  const [config, setConfig] = useState(() => sanitize(read(key)));
  useEffect(() => save(key, config), [key, config]);
  const update = useCallback((patch: Partial<DuelConfig>) => setConfig(previous => sanitize({...previous, ...patch})), [sanitize]);
  const reset = useCallback(() => setConfig(sanitize({})), [sanitize]);
  return {config, update, reset};
}
export function useBotzConfig(kind: 'botz' | 'reflex' | 'redline') {
  const map = kind === 'reflex' ? 'island' : kind === 'redline' ? 'redline' : 'yard';
  const key = `spraylab.${kind}.v1`;
  const [config, setConfig] = useState(() => sanitizeBotzConfig({...read(key), map}));
  useEffect(() => save(key, config), [key, config]);
  const update = useCallback((patch: Partial<BotzConfig>) => setConfig(previous => sanitizeBotzConfig({...previous, ...patch, map})), [map]);
  const reset = useCallback(() => setConfig(sanitizeBotzConfig({map})), [map]);
  return {config, update, reset};
}
