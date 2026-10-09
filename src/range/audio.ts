import type {Equipment} from './equipment';
import type {Vec} from './actor-physics';
import {AcousticScene, AcousticReverb, positionListener, spatialChain, type SpatialSound, type SpatialAudioProfile} from './spatial-audio';
import {ActionSoundTimeline, curveGain, inverseDistanceGain, sampleIndex, type ActorSoundState, type SoundAction, type SoundTimelines} from './sound-model';

type NativeEvent = {samples: string[]; volume: number; pitch: number; distanceCurve?: number[][]; mixgroup?: string; pitchRandom?: [number, number]};
/** CS2 emits gunshots and hit feedback 60 units above the player origin, 4 units from the ear at eye height. */
const EAR_TO_GUN_UNITS = 4;
/** Footsteps play at the feet, 64 units below the ear. */
const EAR_TO_FEET_UNITS = 64;
export type RangeAudioProfile = SpatialAudioProfile & {nativeDistanceCurves?: boolean; reverb?: boolean; propagationDelay?: boolean};
/** Pop's default hit sound: the hitmarker file the user supplied (public/revamp/sounds). */
export const POP_HITMARKER_URL = '/sounds/pop-hitmarker.mp3';
export class RangeAudio {
  context?: AudioContext;
  buffers = new Map<Equipment, AudioBuffer>();
  pending = new Map<Equipment, Promise<void>>();
  voices = new Set<AudioBufferSourceNode>();
  disposed = false;
  status: 'locked' | 'ready' | 'unavailable' = 'locked';
  private samples = new Map<string, AudioBuffer>();
  private decoding = new Map<string, Promise<void>>();
  private mono = new WeakMap<AudioBuffer, AudioBuffer>();
  private events: Record<string, NativeEvent> = {};
  /** Default_Mix levels per CS2 mix group, multiplied up the parent chain (scripts/soundmixers.txt). */
  private mixgroups: Record<string, number> = {};
  private manifest?: Promise<void>;
  private common?: Promise<void>;
  private previous = new Map<string, number>();
  private listenerPose = '';
  private listenerPosition: Vec = {x: 0, y: 0, z: 0};
  private master?: DynamicsCompressorNode;
  private voiceCleanup = new Map<AudioBufferSourceNode, () => void>();
  private timelines: SoundTimelines = {};
  private actionSounds = new ActionSoundTimeline();
  private actorSounds = new Map<string | number, {volume: number; spatial?: SpatialSound}>();
  private acoustics?: AcousticScene;
  private reverb?: AcousticReverb;

  constructor(private readonly profile: RangeAudioProfile = {}) {}

  private async unlockContext() {
    const Constructor = window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Constructor || this.disposed) throw new Error('Web Audio unavailable');
    this.context ??= new Constructor({latencyHint: 'interactive'});
    await this.context.resume();
    if (!this.master) {
      this.master = this.context.createDynamicsCompressor();
      this.master.threshold.value = -3; this.master.knee.value = 0; this.master.ratio.value = 12;
      this.master.attack.value = .003; this.master.release.value = .08;
      this.master.connect(this.context.destination);
      this.reverb = new AcousticReverb(this.context, this.master);
    }
  }

  /** Strict, opt-in loading for drills that must not silently play missing samples. */
  async unlockEvents(keys: string[]) {
    try {
      await this.unlockContext();
      if (!Object.keys(this.events).length) {
        const response = await fetch('/audio/events.json');
        if (!response.ok) throw new Error('Native audio manifest unavailable');
        this.readManifest(await response.json());
      }
      const urls = [...new Set(keys.flatMap(key => {
        const event = this.events[key];
        if (!event?.samples.length) throw new Error(`Native audio unavailable: ${key}`);
        return event.samples;
      }))];
      for (let i = 0; i < urls.length; i += 4) await Promise.all(urls.slice(i, i + 4).map(url => this.decode(url)));
      if (this.disposed || this.context?.state !== 'running') return false;
      this.status = 'ready'; return true;
    } catch {this.status = 'unavailable'; return false;}
  }

  async unlock(weapon: Equipment) {
    try {
      if (this.disposed || !(window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext)) return;
      await this.unlockContext();
      this.manifest ??= fetch('/audio/events.json').then(async response => {
        if (response.ok) this.readManifest(await response.json());
      }).catch(() => {});
      await this.manifest;
      this.common ??= this.preload(Object.keys(this.events).filter(key => /^(step-|land-|hit-|hurt-|impact-|death$)/.test(key)));
      void this.decode(POP_HITMARKER_URL).catch(() => {});
      if (!this.pending.has(weapon)) this.pending.set(weapon, this.load(weapon));
      await Promise.all([this.pending.get(weapon), this.common]);
      if (!this.disposed) this.status = 'ready';
    } catch {this.status = 'unavailable'; this.pending.delete(weapon);}
  }
  private readManifest(data: {events: Record<string, NativeEvent>; timelines?: SoundTimelines; mixgroups?: Record<string, number>}) {
    this.events = data.events; this.timelines = data.timelines ?? {}; this.mixgroups = data.mixgroups ?? {};
    this.actionSounds.setTimelines(this.timelines);
  }
  private async decode(url: string) {
    if (this.samples.has(url)) return;
    const pending = this.decoding.get(url); if (pending) return pending;
    const job = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Missing audio: ${url}`);
      const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
      if (!this.disposed) this.samples.set(url, buffer);
    })();
    this.decoding.set(url, job);
    try {await job;} finally {this.decoding.delete(url);}
  }
  private async preload(keys: string[]) {
    const urls = [...new Set(keys.flatMap(key => this.events[key]?.samples ?? []))];
    for (let i = 0; i < urls.length; i += 4) await Promise.all(urls.slice(i, i + 4).map(url => this.decode(url).catch(() => {})));
  }
  private async load(weapon: Equipment) {
    await this.preload([weapon, `${weapon}-distant`, `${weapon}-reload`, `${weapon}-draw`, `${weapon}-scope-in`, `${weapon}-scope-out`,
      ...Object.values(this.timelines[weapon] ?? {}).flatMap(timeline => timeline?.cues.map(cue => cue.key) ?? []),
      ...(weapon === 'knife' ? ['knife-stab', 'knife-hit', 'knife-wall', 'knife-draw'] : [])]);
    let buffer = this.samples.get(this.events[weapon]?.samples[0]);
    if (!buffer) {await this.decode(`/audio/${weapon}.wav`); buffer = this.samples.get(`/audio/${weapon}.wav`);}
    if (buffer) this.buffers.set(weapon, buffer);
  }
  updateListener(position: Vec, yaw: number, pitch: number) {
    this.listenerPosition = {...position};
    if (!this.context || this.disposed) return;
    const pose = `${position.x.toFixed(3)},${position.y.toFixed(3)},${position.z.toFixed(3)},${yaw.toFixed(4)},${pitch.toFixed(4)}`;
    if (pose === this.listenerPose) return;
    this.listenerPose = pose; positionListener(this.context, position, yaw, pitch);
  }
  private monoBuffer(buffer: AudioBuffer) {
    if (buffer.numberOfChannels === 1) return buffer;
    let mono = this.mono.get(buffer);
    if (!mono) {
      mono = this.context!.createBuffer(1, buffer.length, buffer.sampleRate);
      const data = mono.getChannelData(0);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const channel = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] += channel[i] / buffer.numberOfChannels;
      }
      this.mono.set(buffer, mono);
    }
    return mono;
  }
  private emit(buffer: AudioBuffer, volume: number, pitch: number, spatial?: SpatialSound, pan = 0) {
    if (!this.context || this.context.state !== 'running' || !Number.isFinite(volume) || volume <= 0 || this.disposed) return false;
    if (this.voices.size >= 24) {const oldest = this.voices.values().next().value!; oldest.stop(); this.voiceCleanup.get(oldest)?.();}
    const voice = this.context.createBufferSource(), gain = this.context.createGain();
    voice.buffer = spatial ? this.monoBuffer(buffer) : buffer; voice.playbackRate.value = pitch;
    gain.gain.value = Math.max(0, Math.min(1, volume)); voice.connect(gain);
    const chain = spatial ? spatialChain(this.context, spatial, this.profile) : undefined;
    const stereo = !spatial && pan ? this.context.createStereoPanner() : undefined;
    if (chain) {gain.connect(chain.input); chain.output.connect(this.master!);}
    else if (stereo) {stereo.pan.value = pan; gain.connect(stereo); stereo.connect(this.master!);}
    else gain.connect(this.master!);
    if (this.profile.reverb !== false && (spatial?.path?.reverb || spatial?.reverb)) {
      (chain?.output ?? gain).connect(this.reverb!.input(spatial?.path?.reverb ?? spatial!.reverb!));
    }
    this.voices.add(voice);
    const cleanup = () => {voice.disconnect(); gain.disconnect(); stereo?.disconnect(); chain?.dispose(); this.voices.delete(voice); this.voiceCleanup.delete(voice);};
    this.voiceCleanup.set(voice, cleanup); voice.onended = cleanup;
    voice.start(this.context.currentTime + (this.profile.propagationDelay === false ? 0 : spatial?.path?.delay ?? 0));
    return true;
  }
  /** `localUnits`: how far a non-positional (own) sound sits from the ear, for CS2's distance curve. */
  playEvent(key: string, volume: number, spatial?: SpatialSound, pan = 0, localUnits = 0) {
    const event = this.events[key];
    if (key.endsWith('-scope-out') || !event || !event.samples.length || !Number.isFinite(volume) || volume <= 0) return false;
    const index = sampleIndex(event.samples.length, this.previous.get(key), Math.random());
    const buffer = this.samples.get(event.samples[index]);
    if (!buffer) return false;
    this.previous.set(key, index);
    if (spatial && this.acoustics && !spatial.path) spatial = {...spatial,
      path: this.acoustics.resolve(this.listenerPosition, spatial.position, this.context?.currentTime ?? 0)};
    const distance = spatial?.path?.distance ?? (spatial ? Math.hypot(spatial.position.x - this.listenerPosition.x,
      spatial.position.y - this.listenerPosition.y, spatial.position.z - this.listenerPosition.z) : 0);
    const mapped = spatial && event.distanceCurve && this.profile.nativeDistanceCurves !== false;
    const pathMapped = !!spatial?.path && !mapped;
    const attenuation = mapped ? curveGain(distance / .0254, event.distanceCurve!) : pathMapped ? inverseDistanceGain(distance)
      : event.distanceCurve?.length ? curveGain(localUnits, event.distanceCurve) : 1;
    const [low, high] = event.pitchRandom ?? [0, 0];
    const pitch = event.pitch + (high > low ? low + Math.random() * (high - low) : 0);
    return this.emit(buffer, volume * event.volume * (event.mixgroup ? this.mixgroups[event.mixgroup] ?? 1 : 1) * attenuation, pitch,
      (mapped || pathMapped) && spatial ? {...spatial, distanceMapped: true} : spatial, pan);
  }
  /** A shot: the event at CS2's level, plus its distant layer for other shooters (silent inside its curve's 800 units). */
  play(weapon: Equipment, volume: number, spatial?: SpatialSound) {
    if (this.events[weapon]) {
      this.playEvent(weapon, volume, spatial, 0, EAR_TO_GUN_UNITS);
      if (spatial && this.events[`${weapon}-distant`]) this.playEvent(`${weapon}-distant`, volume, spatial);
    } else {
      const buffer = this.buffers.get(weapon); if (buffer) this.emit(buffer, volume, 1, spatial);
    }
  }
  playStep(volume: number, pan = 0, heavy = false, spatial?: SpatialSound, surface = 'concrete') {
    this.playEvent(`${heavy ? 'land' : 'step'}-${surface}`, volume, spatial, pan, EAR_TO_FEET_UNITS);
  }
  playHit(head: boolean, armor: boolean, victim: boolean, volume: number, spatial?: SpatialSound) {
    this.playEvent(`${victim ? 'hurt' : 'hit'}-${head ? armor ? 'helmet' : 'head' : armor ? 'armor' : 'body'}`, volume, spatial, 0, EAR_TO_GUN_UNITS);
  }
  private noise?: AudioBuffer;
  private noiseBuffer(ctx: AudioContext) {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * .08)), ctx.sampleRate);
      const data = this.noise.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
  /** Pop's hit sound: the user's hitmarker file (the synthesized tick stands in until it is decoded), the synthesized tick, or the pop. */
  playPopSound(kind: 'hitmarker' | 'synth' | 'pop', volume: number, count = 1) {
    if (kind === 'pop') return this.playPop(volume, count);
    if (kind === 'hitmarker') {
      const buffer = this.samples.get(POP_HITMARKER_URL);
      if (buffer) return this.emit(buffer, volume, count > 1 ? 1.06 : 1);
      void this.decode(POP_HITMARKER_URL).catch(() => {});
    }
    return this.playHitmarker(volume, count);
  }
  /** Pop's default hit sound, a Battlefield-style hitmarker synthesized here (no game file): a 3.2 kHz tick with a
   * quieter inharmonic partial, a low thump and a few milliseconds of band-passed noise, all gone within 80 ms. */
  playHitmarker(volume: number, count = 1) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.master || !Number.isFinite(volume) || volume <= 0 || this.disposed) return false;
    const now = ctx.currentTime, level = Math.min(1, volume) * .85, lift = count > 1 ? 1.06 : 1;
    for (const [frequency, gain, decay] of [[3200, 1, .07], [4850, .35, .05], [1600, .18, .04]] as const) {
      const tone = ctx.createOscillator(), env = ctx.createGain();
      tone.type = 'sine'; tone.frequency.value = frequency * lift;
      env.gain.setValueAtTime(0, now); env.gain.linearRampToValueAtTime(level * gain, now + .001); env.gain.exponentialRampToValueAtTime(.001, now + decay);
      tone.connect(env); env.connect(this.master);
      tone.onended = () => {tone.disconnect(); env.disconnect();};
      tone.start(now); tone.stop(now + decay + .01);
    }
    const click = ctx.createBufferSource(), band = ctx.createBiquadFilter(), clickGain = ctx.createGain();
    click.buffer = this.noiseBuffer(ctx); band.type = 'bandpass'; band.frequency.value = 4000; band.Q.value = 1.2;
    clickGain.gain.setValueAtTime(level * .5, now); clickGain.gain.exponentialRampToValueAtTime(.001, now + .012);
    click.connect(band); band.connect(clickGain); clickGain.connect(this.master);
    click.onended = () => {click.disconnect(); band.disconnect(); clickGain.disconnect();};
    click.start(now); click.stop(now + .02);
    return true;
  }
  /** Pop mode: a synthesized pop, a sine bloop sweeping down over 180 ms with a short band-passed click, pitched a little
   * at random; several pops at once ring a touch higher. */
  playPop(volume: number, count = 1) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.master || !Number.isFinite(volume) || volume <= 0 || this.disposed) return false;
    const now = ctx.currentTime, level = Math.min(1, volume) * .9;
    const base = 700 * (1 + (Math.random() - .5) * .16) * (count > 1 ? 1.15 : 1);
    const tone = ctx.createOscillator(), toneGain = ctx.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(base * 1.6, now); tone.frequency.exponentialRampToValueAtTime(base * .55, now + .12);
    toneGain.gain.setValueAtTime(0, now); toneGain.gain.linearRampToValueAtTime(level, now + .004); toneGain.gain.exponentialRampToValueAtTime(.001, now + .18);
    tone.connect(toneGain); toneGain.connect(this.master);
    const click = ctx.createBufferSource(), band = ctx.createBiquadFilter(), clickGain = ctx.createGain();
    click.buffer = this.noiseBuffer(ctx); band.type = 'bandpass'; band.frequency.value = 2600; band.Q.value = .9;
    clickGain.gain.setValueAtTime(level * .7, now); clickGain.gain.exponentialRampToValueAtTime(.001, now + .05);
    click.connect(band); band.connect(clickGain); clickGain.connect(this.master);
    tone.onended = () => {tone.disconnect(); toneGain.disconnect();};
    click.onended = () => {click.disconnect(); band.disconnect(); clickGain.disconnect();};
    tone.start(now); tone.stop(now + .2); click.start(now); click.stop(now + .07);
    return true;
  }
  setAcoustics(scene?: AcousticScene) {this.acoustics = scene;}
  /** Call for every actor each simulation frame; local and remote use the same timeline. */
  syncActor(state: ActorSoundState, now: number, volume: number, spatial?: SpatialSound) {
    if (this.disposed) return;
    if (!this.actorSounds.has(state.id) && this.actorSounds.size >= 32) this.removeActor(this.actorSounds.keys().next().value!);
    this.actorSounds.set(state.id, {volume, spatial}); this.actionSounds.sync(state, now);
  }
  startAction(id: string | number, equipment: string, action: SoundAction, now: number,
    options: {duration?: number; local?: boolean; silent?: boolean; volume: number; spatial?: SpatialSound}) {
    if (this.disposed) return false;
    if (!this.actorSounds.has(id) && this.actorSounds.size >= 32) this.removeActor(this.actorSounds.keys().next().value!);
    this.actorSounds.set(id, {volume: options.volume, spatial: options.spatial});
    return this.actionSounds.start(id, equipment, action, now, options);
  }
  /** Consumer for DuelEvent.action. Time is simulation seconds, never the raw tick number. */
  playAction(id: string | number, equipment: string, action: string, now: number,
    options: {duration?: number; local?: boolean; silent?: boolean; volume: number; spatial?: SpatialSound}) {
    if (options.silent || this.disposed) {this.cancelAction(id); return false;}
    if (action === 'reload-cancel') {this.cancelAction(id); return false;}
    if (action === 'reload-mode') return false;
    if (action === 'reload-shell') return this.playEvent(`${equipment}-reload-shell`, options.volume, options.spatial);
    if (action === 'reload-start' && !this.timelines[equipment]?.['reload-start']) action = 'reload';
    if (action === 'reload-end' && !this.timelines[equipment]?.['reload-end']) {this.cancelAction(id); return false;}
    if (action === 'zeus-discharge') return false; // Physical fire already plays discharge.
    if (action === 'zeus-ready') return this.playEvent('zeus-ready', options.volume, options.spatial);
    if (action === 'scope-in' || action === 'scope-out' || action === 'zoom-in' || action === 'zoom-out')
      return this.playScope(equipment, action.endsWith('-in'), options.volume, options.spatial);
    if (action === 'knife-hit' || action === 'knife-wall' || action === 'knife-stab')
      return this.playKnife(action.slice(6) as 'hit' | 'wall' | 'stab', options.volume, options.spatial);
    if (action === 'cancel') {this.cancelAction(id); return false;}
    if (!['reload', 'reload-empty', 'reload-start', 'reload-loop', 'reload-end', 'draw', 'inspect', 'fire', 'fire-alt', 'charge'].includes(action)) return false;
    return this.startAction(id, equipment, action as SoundAction, now, options);
  }
  updateActions(now: number) {
    let played = 0;
    for (const cue of this.actionSounds.update(now)) {
      const actor = this.actorSounds.get(cue.actorId);
      if (actor && this.playEvent(cue.key, actor.volume, actor.spatial)) played++;
    }
    return played;
  }
  cancelAction(id: string | number) {this.actionSounds.cancel(id);}
  removeActor(id: string | number) {this.actionSounds.remove(id); this.actorSounds.delete(id);}
  playScope(equipment: string, entering: boolean, volume: number, spatial?: SpatialSound) {
    if (!entering) return false;
    return this.playEvent(`${equipment}-scope-${entering ? 'in' : 'out'}`, volume, spatial);
  }
  playKnife(kind: 'slash' | 'stab' | 'hit' | 'wall' | 'draw', volume: number, spatial?: SpatialSound) {
    return this.playEvent(kind === 'slash' ? 'knife' : `knife-${kind}`, volume, spatial, 0, EAR_TO_GUN_UNITS);
  }
  playImpact(surface: 'concrete' | 'metal' | 'wood' | 'glass', volume: number, spatial?: SpatialSound) {
    return this.playEvent(`impact-${surface}`, volume, spatial);
  }
  stopVoices() {this.actionSounds.clear(); this.actorSounds.clear(); for (const v of this.voices) {try {v.stop();} catch {} this.voiceCleanup.get(v)?.();}}
  dispose() {this.disposed = true; this.stopVoices(); this.reverb?.dispose(); this.samples.clear(); this.buffers.clear();
    this.pending.clear(); void this.context?.close().catch(() => {});}
}
