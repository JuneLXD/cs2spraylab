import {sanitizeFlickRecords, type FlickRecord} from './aim-vector';

/** Direction Calibration's flicks, kept in this browser so calibration can build up over several sessions. The newest
 * `MAX_FLICK_RECORDS` are kept. Every change re-reads storage first, so two tabs do not overwrite each other, and it keeps
 * working in memory when storage is unavailable. Shaped for useSyncExternalStore. */
export const MAX_FLICK_RECORDS = 3000;
const STORAGE_KEY = 'spraylab.direction.v1';

export type DirectionStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type DirectionSnapshot = {records: readonly FlickRecord[]; persisted: boolean};

function browserStorage(): DirectionStorage | undefined {
  try {return typeof localStorage === 'undefined' ? undefined : localStorage;} catch {return undefined;}
}

export class DirectionStore {
  private snapshot: DirectionSnapshot;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage: DirectionStorage | undefined = browserStorage()) {
    const stored = this.read();
    this.snapshot = {records: stored ?? [], persisted: !!storage && stored !== undefined};
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  add(records: readonly FlickRecord[]) {
    if (!records.length) return;
    this.commit([...this.base(), ...sanitizeFlickRecords(records)].slice(-MAX_FLICK_RECORDS));
  }
  clear() {this.commit([]);}
  /** Picks up flicks another tab recorded. */
  reload() {
    const stored = this.read();
    if (stored && stored.length !== this.snapshot.records.length) this.publish({records: stored, persisted: true});
  }
  watchStorage(): () => void {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (event: StorageEvent) => {if (event.key === STORAGE_KEY || event.key === null) this.reload();};
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }
  private read(): FlickRecord[] | undefined {
    if (!this.storage) return undefined;
    try {
      const text = this.storage.getItem(STORAGE_KEY);
      return text === null ? [] : sanitizeFlickRecords(JSON.parse(text));
    } catch {return undefined;}
  }
  private base(): readonly FlickRecord[] {return (this.snapshot.persisted ? this.read() : undefined) ?? this.snapshot.records;}
  private commit(records: readonly FlickRecord[]) {
    let persisted = false;
    try {this.storage?.setItem(STORAGE_KEY, JSON.stringify(records)); persisted = !!this.storage;} catch {/* Kept for this tab only. */}
    this.publish({records, persisted});
  }
  private publish(change: Partial<DirectionSnapshot>) {this.snapshot = {...this.snapshot, ...change}; this.listeners.forEach(listener => listener());}
}

/** The one store the engine writes and the results panel reads. */
export const directionStore = new DirectionStore();
