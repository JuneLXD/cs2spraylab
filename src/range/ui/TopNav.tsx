import {memo} from 'react';
import {Backpack, Crosshair, Gem, Gauge, History, ListPlus, Maximize, Minimize, Play, Settings2, Volume2, VolumeX} from 'lucide-react';
import {IconButton} from './primitives';
export type MenuScreen = 'play' | 'home' | 'results';
export const TopNav = memo(function TopNav({screen, navigate, loadout, armory, session, settings, changelog, changelogOpen, count, fps, volume, toggleFps, mute, fullscreen, fullscreenActive = false}: {
  screen: MenuScreen | 'game' | 'loadout' | 'session'; navigate: (screen: MenuScreen) => void;
  loadout: () => void; armory: () => void; session: () => void; settings: () => void; changelog: () => void;
  changelogOpen: boolean; count: number; fps: boolean; volume: number; toggleFps: () => void; mute: () => void; fullscreen: () => void;
  /** Whether the stage is fullscreen now: the button then reads Exit fullscreen. */
  fullscreenActive?: boolean;
}) {
  return <header className="sl-top-nav appbar">
    <button className="brand" aria-label="SprayLab home" title="Home" onClick={() => navigate('home')}><Crosshair size={28}/><span>SPRAYLAB</span></button>
    <nav className="main-nav" aria-label="Workspace">
      <button aria-current={screen === 'play' ? 'page' : undefined} onClick={() => navigate('play')}><Play size={19}/><span>Play</span></button>
      <button aria-current={screen === 'loadout' ? 'page' : undefined} onClick={loadout}><Backpack size={19}/><span>Loadout</span></button>
      <button onClick={armory}><Gem size={19}/><span>Armory</span></button>
      <button aria-current={screen === 'session' || screen === 'results' ? 'page' : undefined} onClick={session}><History size={19}/><span>Session</span><span className="count">{count}</span></button>
    </nav>
    <div className="app-actions"><button className="changelog-button" onClick={changelog} aria-label="Changelog" title="Changelog" aria-expanded={changelogOpen} aria-haspopup="dialog"><ListPlus size={17}/><span>Changelog</span></button>
      <IconButton label="Toggle FPS counter" aria-pressed={fps} onClick={toggleFps}><Gauge size={18}/></IconButton>
      <IconButton label={volume ? 'Mute' : 'Unmute'} onClick={mute}>{volume ? <Volume2 size={18}/> : <VolumeX size={18}/>}</IconButton>
      <IconButton label={fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'} onClick={fullscreen}>{fullscreenActive ? <Minimize size={18}/> : <Maximize size={18}/>}</IconButton>
      <IconButton label="Settings" className="settings-button" onClick={settings}><Settings2 size={18}/></IconButton>
    </div>
  </header>;
});
