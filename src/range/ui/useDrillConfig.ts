import {useCallback, useEffect, useState} from 'react';
import {sanitizeDuelConfig, type DuelConfig} from '../duel/config';
import {sanitizeBotzConfig, type BotzConfig} from '../duel/botz';

function read(key: string): object {try {return JSON.parse(localStorage.getItem(key) || '{}');} catch {return {};}}
function save(key: string, value: unknown) {try {localStorage.setItem(key, JSON.stringify(value));} catch { /* Session-only setup. */ }}
export function useDuelConfig() {
  const [config, setConfig] = useState(() => sanitizeDuelConfig(read('spraylab.duel.v1')));
  useEffect(() => save('spraylab.duel.v1', config), [config]);
  const update = useCallback((patch: Partial<DuelConfig>) => setConfig(previous => sanitizeDuelConfig({...previous, ...patch})), []);
  return {config, update};
}
export function useBotzConfig(kind: 'botz' | 'reflex' | 'redline') {
  const map = kind === 'reflex' ? 'island' : kind === 'redline' ? 'redline' : 'yard';
  const key = `spraylab.${kind}.v1`;
  const [config, setConfig] = useState(() => sanitizeBotzConfig({...read(key), map}));
  useEffect(() => save(key, config), [key, config]);
  const update = useCallback((patch: Partial<BotzConfig>) => setConfig(previous => sanitizeBotzConfig({...previous, ...patch, map})), [map]);
  return {config, update};
}
