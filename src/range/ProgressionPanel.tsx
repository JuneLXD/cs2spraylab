import {useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Check, Package, Paintbrush, Search, Sword, Trophy, UserRound, X} from 'lucide-react';
import {ACHIEVEMENTS} from './achievements';
import {AchievementPanel} from './AchievementPanel';
import {cosmeticCategory, cosmeticsForEquipment, equippedCosmetic, type CosmeticCategory, type CosmeticDefinition, type ProgressionController} from './progression';
import {DEFAULT_GLOVE_PREVIEW} from './cosmetics';
import './progression.css';

export function useProgression(controller: ProgressionController) {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

function CosmeticPreview({item}: {item: CosmeticDefinition}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.imageUrl]);
  return <span className="progression-preview" style={{'--cosmetic-swatch': item.swatch ?? '#859b96'} as CSSProperties}>
    {item.imageUrl && !failed ? <img src={item.imageUrl} alt="" loading="lazy" onError={() => setFailed(true)}/> :
      cosmeticCategory(item) === 'knife' ? <Sword size={36} aria-hidden="true"/> : cosmeticCategory(item) === 'gloves' ? <Package size={32} aria-hidden="true"/> :
        cosmeticCategory(item) === 'agent' ? <UserRound size={32} aria-hidden="true"/> : <Paintbrush size={32} aria-hidden="true"/>}
    {item.swatch && <span className="progression-swatch" aria-hidden="true"/>}
  </span>;
}

export type ProgressionPanelProps = {
  controller: ProgressionController;
  equipmentLabels?: Readonly<Record<string, string>>;
  activeEquipment?: string;
  /** Main pauses the range and releases pointer lock before the armory opens. */
  onOpenChange?: (open: boolean) => void;
  /** Opens the armory on this equipment's finishes. Parent closes its loadout first. */
  requestedEquipment?: string | null;
  requestedAchievements?: boolean;
  onRequestHandled?: () => void;
};

const categories: readonly {id: CosmeticCategory; label: string; icon: typeof Sword}[] = [
  {id: 'weapon', label: 'Weapons', icon: Paintbrush}, {id: 'knife', label: 'Knives', icon: Sword},
  {id: 'gloves', label: 'Gloves', icon: Package}, {id: 'agent', label: 'Agents', icon: UserRound},
];

/** The armory dialog: any finish, knife, glove or agent can be equipped. It opens on request from the loadout or an achievement toast. */
export function ProgressionPanel({controller, equipmentLabels = {}, activeEquipment, onOpenChange, requestedEquipment, requestedAchievements, onRequestHandled}: ProgressionPanelProps) {
  const snapshot = useProgression(controller);
  const profile = snapshot.profile;
  const firstEquipment = (id: CosmeticCategory) => (id === 'weapon' && controller.catalog.some(item => item.equipment === activeEquipment && cosmeticCategory(item) === id)
    ? activeEquipment : controller.catalog.find(item => cosmeticCategory(item) === id)?.equipment) ?? '';
  const knifeTypes = [...new Map(controller.catalog.filter(item => item.equipment === 'knife').map(item =>
    [item.assetKey ?? 'knife', (item.assetKey ?? 'knife') === 'knife' ? 'Default CT knife' : item.label.split(' | ')[0]])).entries()];
  // Show the equipped knife's model rather than rendering every knife finish at once.
  const defaultKnifeType = () => {
    const knife = equippedCosmetic(profile, controller.catalog, 'knife');
    return knife && !knife.isDefault && knife.assetKey ? knife.assetKey : knifeTypes.find(([key]) => key !== 'knife')?.[0] ?? 'knife';
  };
  const [open, setOpen] = useState(false), [equipment, setEquipment] = useState(() => firstEquipment('weapon'));
  const [category, setCategory] = useState<CosmeticCategory>('weapon'), [view, setView] = useState<'collection' | 'achievements'>('collection');
  const [query, setQuery] = useState(''), [sort, setSort] = useState('default');
  const [actionNotice, setActionNotice] = useState('');
  const [knifeType, setKnifeType] = useState(defaultKnifeType);
  const dialog = useRef<HTMLDialogElement>(null), restoreFocus = useRef<HTMLElement | null>(null);
  const titleId = useId(), noticeId = useId(), filterId = useId(), itemsId = useId(), searchId = useId();
  const openCallback = useRef(onOpenChange);
  openCallback.current = onOpenChange;
  const handledRequest = useRef<string | null>(null), requestCallback = useRef(onRequestHandled);
  requestCallback.current = onRequestHandled;
  const equipmentLabel = (id: string) => equipmentLabels[id] ?? ({knife: 'Knife', gloves: 'Gloves', agent: 'Bot agent'}[id] ?? id);
  const equipmentIds = [...new Set(controller.catalog.filter(item => cosmeticCategory(item) === category).map(item => item.equipment))];
  const matches = (open && view === 'collection' ? cosmeticsForEquipment(controller.catalog, equipment) : []).filter(item => cosmeticCategory(item) === category &&
    (category !== 'knife' || knifeType === 'all' || (item.assetKey ?? 'knife') === knifeType) &&
    `${item.label} ${equipmentLabel(item.equipment)} ${item.rarity ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const items = sort === 'name' ? [...matches].sort((a, b) => a.label.localeCompare(b.label)) : matches;
  const equippedId = equippedCosmetic(profile, controller.catalog, equipment)?.id;
  const selectCategory = (id: CosmeticCategory) => {if (id !== category) {setCategory(id); setEquipment(firstEquipment(id)); setQuery('');
    if (id === 'knife') setKnifeType(defaultKnifeType());}};
  const show = (next: 'collection' | 'achievements') => {
    restoreFocus.current = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setView(next); setQuery(''); setActionNotice(''); setOpen(true);
  };

  useEffect(() => {
    if (!requestedEquipment) {handledRequest.current = null; return;}
    if (handledRequest.current === requestedEquipment) return;
    handledRequest.current = requestedEquipment;
    const item = controller.catalog.find(candidate => candidate.equipment === requestedEquipment);
    const next = item ? cosmeticCategory(item) : 'weapon';
    setCategory(next);
    setEquipment(item ? requestedEquipment : firstEquipment('weapon'));
    if (next === 'knife') setKnifeType(defaultKnifeType());
    show('collection');
    requestCallback.current?.();
  }, [controller, requestedEquipment]);

  useEffect(() => {
    if (!requestedAchievements) return;
    show('achievements');
    requestCallback.current?.();
  }, [requestedAchievements]);

  useEffect(() => {
    if (!open) return;
    openCallback.current?.(true);
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      openCallback.current?.(false);
      if (restoreFocus.current?.isConnected) restoreFocus.current.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(<dialog ref={dialog} className="progression-armory" aria-labelledby={titleId} aria-describedby={noticeId}
    onCancel={event => {event.preventDefault(); setOpen(false);}} onClose={() => setOpen(false)} onClick={event => {if (event.target === event.currentTarget) setOpen(false);}}>
    <div className="progression-armory-content">
      <header className="progression-armory-header"><div><h2 id={titleId}>Armory</h2><p id={noticeId}>Every finish is unlocked. Local cosmetics only. Not CS2 inventory items.</p></div>
        <button type="button" autoFocus className="progression-icon-button" aria-label="Close armory" title="Close armory" onClick={() => setOpen(false)}><X size={20}/></button></header>
      {snapshot.storageStatus !== 'saved' && <p className="progression-storage-warning" role="status">{snapshot.storageStatus === 'unsupported-version'
        ? 'A newer save was found and kept unchanged. This session will not be saved.' : 'Browser storage is unavailable. Your selections are kept for this session only.'}</p>}
      <div className="progression-views" role="group" aria-label="Armory view"><button type="button" aria-pressed={view === 'collection'} onClick={() => setView('collection')}><Paintbrush size={15} aria-hidden="true"/>Collection</button>
        <button type="button" aria-pressed={view === 'achievements'} onClick={() => setView('achievements')}><Trophy size={15} aria-hidden="true"/>Achievements <span className="achievement-count">{Object.keys(profile.achievements.unlocked).length}/{ACHIEVEMENTS.length}</span></button></div>
      <p className="progression-action-notice" role="status" aria-live="polite">{actionNotice}</p>
      {view === 'collection' ? <><div className="progression-tabs" role="tablist" aria-label="Cosmetic category">{categories.map(({id, label, icon: Icon}, index) =>
        <button key={id} id={`${itemsId}-${id}`} type="button" role="tab" aria-selected={category === id} aria-controls={itemsId} tabIndex={category === id ? 0 : -1}
          onClick={() => selectCategory(id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % categories.length : event.key === 'ArrowLeft' ? (index + categories.length - 1) % categories.length :
              event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); selectCategory(categories[next].id);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}>{id === 'gloves' ? <img className="progression-gloves-icon" src={DEFAULT_GLOVE_PREVIEW} alt=""/> : <Icon size={16} aria-hidden="true"/>}{label}</button>)}</div>
      <div role="tabpanel" id={itemsId} aria-labelledby={`${itemsId}-${category}`}>
      <div className="progression-filter">{equipmentIds.length > 1 && <><label htmlFor={filterId}>Equipment</label><select id={filterId} value={equipment} onChange={event => {setEquipment(event.target.value); setQuery('');}}>
        {equipmentIds.map(id => <option key={id} value={id}>{equipmentLabel(id)}</option>)}
      </select></>}{category === 'knife' && <select aria-label="Knife type" value={knifeType} onChange={event => {setKnifeType(event.target.value); setQuery('');}}>
        <option value="all">All knives</option>{knifeTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>}
        <select aria-label="Sort cosmetics" value={sort} onChange={event => setSort(event.target.value)}><option value="default">Default order</option><option value="name">Name</option></select>
        <div className="progression-search"><Search size={15} aria-hidden="true"/><input id={searchId} aria-label="Search cosmetics" type="search" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)}/></div>
      </div>
      <div className="progression-catalog-title"><h3>{equipmentLabel(equipment)}</h3><span>{items.length} {items.length === 1 ? 'finish' : 'finishes'}</span></div>
      <ul className="progression-items" aria-label="Cosmetic choices">{items.map(item => {
        const selected = equippedId === item.id;
        return <li key={item.id}><article className={`progression-choice${selected ? ' is-equipped' : ''}`}>
          <CosmeticPreview item={item}/><span className="progression-choice-name">{item.label}<small>{equipmentLabel(item.equipment)}</small></span>
          <div className="progression-item-meta"><span>{item.rarity ?? (item.isDefault ? 'Standard' : 'Finish')}</span></div>
          <button type="button" className="progression-item-action" disabled={selected} aria-disabled={selected} aria-pressed={selected}
            aria-label={`${item.label}, ${equipmentLabel(item.equipment)}, ${selected ? 'equipped' : 'equip'}`} title={selected ? 'Equipped' : `Equip ${item.label}`}
            onClick={() => {if (controller.equip(item.equipment, item.id)) setActionNotice(`${item.label} equipped.`);}}>
            <Check size={14} aria-hidden="true"/>{selected ? 'Equipped' : 'Equip'}</button>
        </article></li>;
      })}</ul>
      {!items.length && <p className="progression-empty">No items match these filters.</p>}</div></> : <AchievementPanel profile={profile}/>}
    </div>
  </dialog>, document.body);
}

export function AchievementNotification({controller, durationMs = 8000, onOpenAchievements}: {controller: ProgressionController; durationMs?: number; onOpenAchievements?: () => void}) {
  const {notification} = useProgression(controller);
  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => controller.dismissNotification(), Number.isFinite(durationMs) ? Math.max(2000, durationMs) : 8000);
    return () => window.clearTimeout(timer);
  }, [controller, notification, durationMs]);
  const achievements = notification?.achievementIds.map(id => ACHIEVEMENTS.find(item => item.id === id)?.title).filter(Boolean) ?? [];
  return <div className="progression-notification-region" role="status" aria-live="polite" aria-atomic="true">
    {notification && achievements.length > 0 && <div className="progression-notification" key={notification.id}><Trophy size={20} aria-hidden="true"/><div>
      <strong>Achievement earned</strong>
      <small className="achievement-toast-label">{achievements.slice(0, 2).join(', ')}{achievements.length > 2 ? ` +${achievements.length - 2} more` : ''}</small>
      {onOpenAchievements && <button type="button" className="achievement-toast-action" onClick={() => {onOpenAchievements(); controller.dismissNotification();}}><Trophy size={13} aria-hidden="true"/>View achievements</button>}
    </div><button type="button" className="progression-icon-button" aria-label="Dismiss achievement notification" title="Dismiss achievement notification" onClick={() => controller.dismissNotification()}><X size={16}/></button></div>}
  </div>;
}
