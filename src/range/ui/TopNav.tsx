import {memo} from 'react';
import {Crosshair, Gauge, ListPlus, Maximize, Settings2, Volume2, VolumeX} from 'lucide-react';
import {IconButton} from './primitives';
export type MenuScreen = 'play' | 'home' | 'results';
export const TopNav = memo(function TopNav({screen, navigate, loadout, armory, session, settings, changelog, changelogOpen, count, fps, volume, toggleFps, mute, fullscreen}: {
  screen: MenuScreen | 'game'; navigate: (screen: MenuScreen) => void; loadout: () => void; armory: () => void; session: () => void; settings: () => void; changelog: () => void;
  changelogOpen: boolean; count: number; fps: boolean; volume: number; toggleFps: () => void; mute: () => void; fullscreen: () => void;
}) {
  return <header className="sl-top-nav appbar">
    <button className="brand" aria-label="SprayLab home" onClick={() => navigate('home')}><Crosshair size={28}/><span>SPRAYLAB</span></button>
    <nav className="main-nav" aria-label="Workspace"><button aria-current={screen === 'play' ? 'page' : undefined} onClick={() => navigate('play')}>Play</button><button onClick={loadout}>Loadout</button><button onClick={armory}>Armory</button><button onClick={session}>Session <span className="count">{count}</span></button></nav>
    <div className="app-actions"><button className="changelog-button" onClick={changelog} aria-label="Changelog" aria-expanded={changelogOpen} aria-haspopup="dialog"><ListPlus size={17}/><span>Changelog</span></button>
      <IconButton label="Toggle FPS counter" aria-pressed={fps} onClick={toggleFps}><Gauge size={18}/></IconButton>
      <IconButton label={volume ? 'Mute' : 'Unmute'} onClick={mute}>{volume ? <Volume2 size={18}/> : <VolumeX size={18}/>}</IconButton>
      <IconButton label="Fullscreen" onClick={fullscreen}><Maximize size={18}/></IconButton>
      <IconButton label="Settings" className="settings-button" onClick={settings}><Settings2 size={18}/></IconButton>
    </div>
  </header>;
});
