import {AIM_SIZES, type AimBucket, type AimReport, type AimTip} from './aim-report';
import {equipmentIds, type Equipment} from './equipment';

/** The aim reports of recent sessions, kept in this browser for the Aim tab: newest first, at most `MAX_AIM_REPORTS`. A session
 * saves its report again whenever it pauses or ends, replacing its earlier copy (same id). Every change re-reads storage first,
 * so two tabs do not overwrite each other, and it keeps working in memory when storage is unavailable. Shaped for
 * useSyncExternalStore, like the Direction Calibration store. */
export const MAX_AIM_REPORTS = 60;
const STORAGE_KEY = 'spraylab.aim.reports.v1';

export type AimReportStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type AimReportSnapshot = {reports: readonly AimReport[]; persisted: boolean};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown, limit = 120) => typeof value === 'string' && value.length <= limit;
const share = (value: unknown) => finite(value) && value >= 0 && value <= 1;
const bucket = (value: unknown): value is AimBucket => !!value && typeof value === 'object' &&
  finite((value as AimBucket).shots) && finite((value as AimBucket).hits) && (value as AimBucket).hits <= (value as AimBucket).shots;
const numbers = (value: unknown, keys: readonly string[], optionalKeys: readonly string[] = []) => !!value && typeof value === 'object' &&
  keys.every(key => finite((value as Record<string, unknown>)[key])) && optionalKeys.every(key => (value as Record<string, unknown>)[key] === undefined || finite((value as Record<string, unknown>)[key]));

/** Stored reports: malformed entries are dropped, every number must be finite and every share between 0 and 1. */
export function sanitizeAimReports(raw: unknown): AimReport[] {
  if (!Array.isArray(raw)) return [];
  const reports: AimReport[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>, movement = r.movement as Record<string, unknown> | undefined;
    if (r.version !== 1 || !text(r.id, 40) || !text(r.mode, 40) || !text(r.label) || !equipmentIds.includes(r.weapon as Equipment)) continue;
    if (!text(r.started, 40) || !text(r.date, 40) || !Number.isFinite(Date.parse(r.date as string)) || !Number.isFinite(Date.parse(r.started as string))) continue;
    if (!numbers(r, ['seconds', 'shots', 'hits', 'heads', 'targets', 'cleared', 'hitTimes', 'fresh', 'flicks'], ['timeToHit', 'timeToKill', 'placement', 'reaction'])) continue;
    if (!['firstShot', 'placed'].every(key => r[key] === undefined || share(r[key]))) continue;
    if (!movement || !['standing', 'stopped', 'moving', 'air'].every(key => bucket(movement[key])) || !finite(movement.speed)) continue;
    if (r.phases !== undefined && !numbers(r.phases, ['n', 'before', 'flick', 'adjust', 'confirm', 'total'])) continue;
    const land = r.landing as Record<string, unknown> | undefined;
    if (land !== undefined && !(numbers(land, ['error', 'bias', 'corrections']) && ['inside', 'past', 'short'].every(key => share(land[key])))) continue;
    if (!Array.isArray(r.sizes) || r.sizes.length > AIM_SIZES.length || !r.sizes.every(size => numbers(size, ['n', 'bias', 'error', 'time']) && text((size as Record<string, unknown>).label, 20))) continue;
    const stops = r.stops as Record<string, unknown> | undefined;
    if (stops !== undefined && !(numbers(stops, ['n', 'counter', 'release', 'none', 'early', 'onTime', 'late'], ['since', 'wait']) &&
      (stops.toAccurate === undefined || numbers(stops.toAccurate, [], ['counter', 'release'])))) continue;
    const click = r.click as Record<string, unknown> | undefined;
    if (click !== undefined && !(numbers(click, ['n', 'speed']) && bucket(click.settled) && bucket(click.moving))) continue;
    if (!Array.isArray(r.tips) || r.tips.length > 3 || !r.tips.every(tip => tip && typeof tip === 'object' && ((tip as AimTip).tone === 'good' || (tip as AimTip).tone === 'warn') &&
      text((tip as AimTip).title, 200) && text((tip as AimTip).detail, 600))) continue;
    reports.push(entry as AimReport);
  }
  return reports.slice(0, MAX_AIM_REPORTS);
}

function browserStorage(): AimReportStorage | undefined {
  try {return typeof localStorage === 'undefined' ? undefined : localStorage;} catch {return undefined;}
}

export class AimReportStore {
  private snapshot: AimReportSnapshot;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage: AimReportStorage | undefined = browserStorage()) {
    const stored = this.read();
    this.snapshot = {reports: stored ?? [], persisted: !!storage && stored !== undefined};
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  /** Saves a session's report, replacing its earlier copy, newest first. */
  save(report: AimReport) {
    const others = this.base().filter(entry => entry.id !== report.id);
    this.commit([report, ...others].slice(0, MAX_AIM_REPORTS));
  }
  remove(id: string) {this.commit(this.base().filter(entry => entry.id !== id));}
  clear() {this.commit([]);}
  /** Picks up reports another tab saved. */
  reload() {
    const stored = this.read();
    if (stored) this.publish({reports: stored, persisted: true});
  }
  watchStorage(): () => void {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (event: StorageEvent) => {if (event.key === STORAGE_KEY || event.key === null) this.reload();};
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }
  private read(): AimReport[] | undefined {
    if (!this.storage) return undefined;
    try {
      const value = this.storage.getItem(STORAGE_KEY);
      return value === null ? [] : sanitizeAimReports(JSON.parse(value));
    } catch {return undefined;}
  }
  private base(): readonly AimReport[] {return (this.snapshot.persisted ? this.read() : undefined) ?? this.snapshot.reports;}
  private commit(reports: readonly AimReport[]) {
    let persisted = false;
    try {this.storage?.setItem(STORAGE_KEY, JSON.stringify(reports)); persisted = !!this.storage;} catch {/* Kept for this tab only. */}
    this.publish({reports, persisted});
  }
  private publish(change: Partial<AimReportSnapshot>) {this.snapshot = {...this.snapshot, ...change}; this.listeners.forEach(listener => listener());}
}

/** The one store the engines write and the Aim tab reads. */
export const aimReportStore = new AimReportStore();
