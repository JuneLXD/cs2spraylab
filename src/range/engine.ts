import * as THREE from 'three';
import {recoilView} from './view-recoil';
import {ViewmodelAir} from './viewmodel-air';
import {followCrosshairDirection, followCrosshairOffset} from './crosshair-follow';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Settings, MeasuredProfile, Weapon, gameData, type Viewmodel } from './config';
import { DEG, direction, Simulation, Shot, Vec, VERTICAL_FOV, TARGET_Z, type Result } from './simulation';
import { UNIT } from './actor-physics';
import { dynamicCrosshairGap } from './crosshair-spread';
import { RangeAudio } from './audio';
import { requestRawLock } from './input';
import {InputClock, inputTimestamp} from './input-clock';
import { createGameRenderer } from './render-context';
import { VIEWMODEL_FOV, VIEWMODEL_OFFSET, viewmodelFov, viewmodelOffset, viewmodelViewport, viewmodelAspect } from './viewmodel';
import { GUIDE_COLORS, SprayDemonstration } from './spray-demonstration';
import {type Equipment, type Slot} from './equipment';
import {DrillScenery} from './drill-scene';
import {HEAD_HEIGHT, peekDirection, type DrillMetrics, type Exposure} from './drills';
import {guidanceAngles} from './guidance';
import {ViewAnimation} from './view-animation';
import {ScopeOverlay} from './scope-overlay';
import {applyCosmetic, cosmeticAsset} from './cosmetics';
import {prepareNativeViewAssembly} from './native-view-actions';
import {loadoutWeapon, recoilPattern, resolutionPixelRatio, viewAspect} from './config';
import {REVOLVER_WINDUP} from './weapon-actions';
import type {DrillMode, ProgressionController} from './progression';
import {batchStaticMeshes, disposeResources} from './duel/render-resources';
import {ImpactCloud} from './impact-cloud';
import {FrameMetrics, FramePacer, PerformanceMeter, qualityPolicy, renderPixelRatio} from './performance';
import {ShortcutGuard, requestStageFullscreen} from './shortcut-guard';
import {BindRuntime, cycleSlot, trainerSlot, type BindEvent} from './keybinds/runtime';
import {attachBindInput} from './keybinds/dom-input';
import {protectedCodes} from './keybinds/profile';
import {MuzzleFlashes, ShotEffects} from './weapon-effects';
import {muzzleAnchor, viewMuzzleToWorld} from './duel/tracers';
import {resolveBulletRay,type PenetrationSolid,type SurfaceContact} from './duel/penetration';
import {resolveDamage} from './duel/damage';
import {equipmentStats} from './equipment';
import {AcousticScene} from './spatial-audio';

export type RangeStatus = {
  weapon: Weapon;
  active: boolean; firing: boolean; hitFlash?:boolean; shots: number; hits: number; heads: number; remaining: number;
  reload: number; reloadProgress?: number; speed: number; distance: number;
  reserve?:number;reloadSilent?:boolean;recharge?:number;
  input: string; audio: string; assets: string; fps: number; shortcutProtected?: boolean;
  equipped: Equipment; slot: Slot; equipReady: boolean; magazine: number;
  targetHealth?: number[];
  /** Pop mode: the session tally. */
  pop?: {pops: number; shots: number; seconds: number};
  drill?: {round:number; completed:number; passed:number; scenario:string; covered:boolean; exposure:Exposure; side:number; peekDirection?:number; phase:'prepare'|'exposed'|'feedback'|'reposition'; accurate:boolean; error:number; remaining?:number; last?:DrillMetrics};
};
const vector = (v: Vec) => new THREE.Vector3(v.x, v.y, v.z);
const targetMeshCache = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
function scoringMeshes(model: THREE.Object3D) {
  let meshes = targetMeshCache.get(model);
  if (!meshes) {meshes = []; model.traverse(node => {if (node instanceof THREE.Mesh) meshes!.push(node);}); targetMeshCache.set(model, meshes);}
  return meshes.filter(mesh => !mesh.userData.skipScoring);
}
export class RangeEngine {
  sim: Simulation;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, .025, 250);
  viewScene = new THREE.Scene();
  viewCamera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, .01, 10);
  private viewOffset = VIEWMODEL_OFFSET;
  viewViewport = viewmodelViewport(1, 1);
  demonstration = new SprayDemonstration();
  mouseDemonstration = new SprayDemonstration('mouse');
  drillScenery = new DrillScenery(); drillRevision = -1;
  weaponRoot = new THREE.Group();
  private readonly viewAir = new ViewmodelAir();
  targets = [new THREE.Group(), new THREE.Group()];
  /** Pop mode: the balls by id, their burst animations, the dark wall behind them, and the lights it dims. */
  pop = new THREE.Group();
  private popMeshes = new Map<number, THREE.Mesh>();
  private popBursts: {mesh: THREE.Mesh; at: number; radius: number}[] = [];
  private popBackdrop?: THREE.Mesh;
  private popGeometry = new THREE.SphereGeometry(1, 32, 20);
  popMaterial = new THREE.MeshStandardMaterial({color: '#ff6a4d', emissive: '#ff6a4d', emissiveIntensity: .8, roughness: .35, metalness: 0, fog: false});
  private popColorApplied = '';
  private popAtmosphere = false;
  private hemi!: THREE.HemisphereLight; private sun!: THREE.DirectionalLight;
  private readonly sceneLook = {background: '#c7d1d1', fog: [100, 230] as const, hemi: 1.35, sun: 2.2, environment: .3};
  targetModels: THREE.Object3D[] = [];
  mixers: THREE.AnimationMixer[] = [];
  targetActions: THREE.AnimationAction[][] = [];
  animationState = -1;
  private animationElapsed = 0;
  private shadowAt = -1;
  private width = 1; private height = 1;
  private pacer = new FramePacer();
  private metrics = new FrameMetrics();
  private meter: PerformanceMeter;
  private shortcuts: ShortcutGuard;
  private readonly stage: HTMLElement | null;
  private entering = false;
  private enterRevision = 0;
  private shotEffects: ShotEffects;
  private viewFlashes: MuzzleFlashes;
  private viewMuzzles = new Map<Equipment, {main?: THREE.Object3D; left?: THREE.Object3D; right?: THREE.Object3D}>();
  private traceColor = new THREE.Color('#fff0c9');
  private impactClouds?: Map<THREE.Object3D, ImpactCloud>;
  solids: THREE.Object3D[] = [];
  impacts = new THREE.Group();
  ray = new THREE.Raycaster();
  audio = new RangeAudio();
  private readonly acoustics=new AcousticScene([], 'warehouse');
  private coverRevision=-1;
  private coverSolids:PenetrationSolid[]=[];
  observer: ResizeObserver;
  disposed = false; frame = 0; previous = 0; elapsed = 0; statusTime = 0;
  private readonly inputClock = new InputClock();
  private presentedDrill = -1;
  inputStatus = 'Ready'; assetStatus = 'Loading models'; loadedTarget = false;
  crosshair: HTMLElement; hitmarker: HTMLElement;
  cues = [document.createElement('div'), document.createElement('div')];
  private cueLabels: HTMLElement[];
  hitCaption = document.createElement('div');
  cleanup: (() => void)[] = [];
  clearInput?: () => void;
  /** CS2 bind table for keyboard, mouse buttons and wheel. */
  binds!: BindRuntime;
  /** Other console commands a bind runs, such as crosshair convars. */
  onConsole?: (args: string[]) => void;
  modelCache = new Map<Equipment, THREE.Object3D>();
  viewAnimations = new Map<Equipment, ViewAnimation>();
  private wasReloading = false;
  private scope: ScopeOverlay;
  private cosmeticKey = '';
  private cosmeticRevision = 0;
  private attemptId: string | null = null;
  private attemptRevision = 0;
  private attemptTargets = new Set<number>();
  loading = new Map<Equipment, Promise<THREE.Object3D>>();
  private preloading = false;
  revision = 0; kick = 0; hitTime = 0;
  markerGeometry = new THREE.SphereGeometry(.018, 6, 4);
  missMaterial = new THREE.MeshBasicMaterial({ color: '#ff6259' });
  hitMaterial = new THREE.MeshBasicMaterial({ color: '#ffca50' });
  bodyMaterial = new THREE.MeshBasicMaterial({ color: '#51edee' });
  targetAsset?: THREE.Object3D;
  muzzle = new THREE.PointLight('#ffd781', 0, 1.6, 2);
  environment?: THREE.WebGLRenderTarget;
  constructor(public host: HTMLElement, public onStatus: (s: RangeStatus) => void, settings: Settings, crosshair: HTMLElement, hitmarker: HTMLElement, public onError: (s: string) => void,
    private readonly progression?: ProgressionController) {
    this.cosmeticKey = JSON.stringify(progression?.getSnapshot().profile.equipped);
    this.crosshair = crosshair; this.hitmarker = hitmarker;
    this.scope = new ScopeOverlay(host);
    this.meter = new PerformanceMeter(host); this.meter.configure(settings.showFps);
    this.stage = host.closest('.range-stage'); this.shortcuts = new ShortcutGuard(this.stage);
    this.shortcuts.codes = protectedCodes(settings.keyboard.binds);
    this.cues.forEach((cue, i) => { cue.className = `aim-cue ${i ? 'next' : 'now'}`; cue.style.color = i ? GUIDE_COLORS.next : GUIDE_COLORS.now; cue.innerHTML = `<i></i><span>${i ? 'NEXT' : 'NOW'}</span>`; host.append(cue); });
    this.cueLabels = this.cues.map(cue => cue.querySelector('span')!);
    this.hitCaption.className = 'hit-caption'; host.append(this.hitCaption);
    this.sim = new Simulation(settings);
    this.binds = new BindRuntime(settings.keyboard, event => this.onBind(event));
    this.applyViewmodel(settings.viewmodel);
    this.renderer = createGameRenderer({antialias: qualityPolicy(settings.quality).shadows, lowLatency: settings.lowLatency});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = qualityPolicy(settings.quality).shadows;
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive practice range');
    this.renderer.domElement.setAttribute('tabindex', '0');
    this.renderer.domElement.dataset.range = 'true';
    host.prepend(this.renderer.domElement);
    this.buildScene();
    this.audio.setAcoustics(this.acoustics);
    this.shotEffects = new ShotEffects(this.scene); this.viewFlashes = new MuzzleFlashes(this.viewScene, 2);
    this.updateDemonstration();
    this.sim.onShot = s => this.shot(s);
    this.sim.onSound = landing => this.audio.playStep(this.sim.settings.volume, 0, landing);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.bindInput(); this.resize();
    void this.loadTarget(); void this.setWeapon(loadoutWeapon(settings));
    this.frame = requestAnimationFrame(t => this.tick(t));
  }
  private box(size: number[], pos: number[], mat: THREE.Material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), mat);
    mesh.position.set(...pos as [number, number, number]); mesh.receiveShadow = true;
    this.scene.add(mesh); if (solid) this.solids.push(mesh); return mesh;
  }
  private label(text: string, width: number, height: number, color = '#eeeeda', background = '') {
    const c = document.createElement('canvas'); c.width = 1024; c.height = Math.max(64, Math.round(1024 * height / width));
    const ctx = c.getContext('2d')!;
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let font = Math.floor(c.height * .65); ctx.font = `bold ${font}px Arial`;
    while (ctx.measureText(text).width > c.width * .92) ctx.font = `bold ${--font}px Arial`;
    ctx.fillText(text, c.width / 2, c.height / 2);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, polygonOffset: true, polygonOffsetFactor: -1 }));
  }
  buildScene() {
    const palette = new Map<string, THREE.MeshStandardMaterial>();
    const material = (color: string, roughness = .8) => {
      const key = `${color}:${roughness}`;
      if (!palette.has(key)) palette.set(key, new THREE.MeshStandardMaterial({color, roughness}));
      return palette.get(key)!;
    };
    this.scene.background = new THREE.Color('#c7d1d1');
    this.scene.fog = new THREE.Fog('#c7d1d1', 100, 230);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.viewScene.environment = this.environment.texture;
    this.scene.environmentIntensity = .3; this.viewScene.environmentIntensity = .32;
    room.dispose(); pmrem.dispose();
    this.hemi = new THREE.HemisphereLight('#f1f6fa', '#626850', 1.35); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight('#fff4df', 2.2); sun.position.set(-15, 24, TARGET_Z + 18);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -35; sun.shadow.normalBias = .025;
    sun.target.position.set(0, 0, TARGET_Z + 3); this.scene.add(sun, sun.target);
    this.viewScene.add(new THREE.HemisphereLight('#ffffff', '#696b64', .7));
    const key = new THREE.DirectionalLight('#fff4dd', 1.4); key.position.set(-2, 4, 2); this.viewScene.add(key);
    this.viewScene.add(this.weaponRoot);
    this.muzzle.position.set(.2, -.1, -.9); this.viewScene.add(this.muzzle);
    const surface = (name: string, repeatX: number, repeatY: number, color: string) => {
      const m = material(color);
      for (const [slot, suffix] of [['map', ''], ['normalMap', '-normal']] as const) {
        const texture = new THREE.TextureLoader().load(`/textures/${name}${suffix}.webp`, undefined, undefined, () => {});
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeatX, repeatY);
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        if (slot === 'map') texture.colorSpace = THREE.SRGBColorSpace;
        m[slot] = texture;
      }
      m.normalScale.set(.4, .4); return m;
    };
    const concrete = surface('wall', 31.5, 1.5, '#8d9993'); const dark = material('#444d4b'); const steel = material('#4e6766', .48);
    this.box([24, .2, 126], [0, -.1, -52], surface('floor', 12, 63, '#8a9389'));
    this.box([.5, 5, 126], [-12, 2.5, -52], concrete);
    this.box([.5, 5, 126], [12, 2.5, -52], concrete);
    this.box([24, 12, .5], [0, 6, -115], dark);
    this.box([24, 4, .5], [0, 2, 10], concrete);
    for (const x of [-11.7, 11.7]) {
      this.box([.03, 1.15, 124], [x, .58, -52], material('#3c7474'), false);
      this.box([.05, .045, 124], [x, 1.22, -52], material('#e3be65'), false);
    }
    for (const z of [5, 0, -5]) {
      this.box([24, .22, .3], [0, 4.9, z], steel, false);
      const roof = this.box([24, .08, 1], [0, 5.1, z + 1], material('#69756e'), false); roof.castShadow = true;
    }
    for (const x of [-9.5, 9.5]) {
      this.box([1.5, .9, 2.4], [x, .45, 3], material('#4b6461'), false);
      this.box([1.6, .12, 2.5], [x, .95, 3], material('#a6a795'), false);
    }
    for (let z = 5; z >= -110; z -= 5) {
      const stripe = this.box([23, .004, .025], [0, .008, z], material('#d0d4cd'), false);
      stripe.receiveShadow = false;
      for (const x of [-11.7, 11.7]) this.box([.12, 5, .18], [x, 2.5, z], steel, false);
      if (z > TARGET_Z && z < 0 && z % 10 === 0) {
        const number = this.label(`${z - TARGET_Z} M`, 2.3, .57, '#d5dfd9'); number.position.set(-11.72, 1.8, z); number.rotation.y = Math.PI / 2; this.scene.add(number);
      }
    }
    for (const x of [-6, 0, 6]) {
      this.box([.035, .008, 122], [x, .011, -52], material('#c6d0c4'), false);
      this.box([.12, .008, 2], [x - 2, .012, 1], material('#d0c46e'), false);
    }
    const sign = this.label('SPRAYLAB / RANGE 01', 9, .7, '#e1e8e2'); sign.position.set(0, 5.3, -102.77); this.scene.add(sign);
    void new GLTFLoader().loadAsync('/models/range-kit.glb').then(({ scene }) => {
      if (this.disposed) { this.disposeObject(scene); return; }
      scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(scene);
      // Blender's individual prop groups otherwise prevent cross-prop batching.
      this.scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = []; scene.traverse(o => {if (o instanceof THREE.Mesh) meshes.push(o);});
      meshes.forEach(mesh => scene.attach(mesh));
      batchStaticMeshes(scene);
      this.renderer.shadowMap.needsUpdate = true;
    }).catch(() => {});
    // Target backplates give useful impact feedback even at 100 m.
    this.box([16, 4.2, .25], [0, 2.1, TARGET_Z - 1.6], material('#536765'));
    this.scene.add(this.demonstration.mesh, this.mouseDemonstration.mesh);
    this.scene.add(this.drillScenery.group); this.solids.push(...this.drillScenery.solids);
    for (const x of [-8, 8]) this.box([.18, 4.5, .4], [x, 2.25, TARGET_Z - 1.6], steel);
    this.targets.forEach((target, i) => {
      const tag = this.label(i ? 'B' : 'A', .32, .16, '#ffffff'); tag.position.set(0, 2.05, 0); tag.name = 'lane-tag'; target.add(tag);
      const marker = new THREE.Mesh(new THREE.RingGeometry(.4, .44, 48), new THREE.MeshBasicMaterial({ color: GUIDE_COLORS.now, side: THREE.DoubleSide, transparent: true, opacity: .8 }));
      marker.name = 'active-lane'; marker.rotation.x = -Math.PI / 2; marker.position.y = .015; target.add(marker);
      this.scene.add(target);
    });
    this.scene.add(this.impacts, this.pop);
    this.syncTargets();
    // Collision references retain their geometry and baked world matrix after batching.
    this.scene.updateMatrixWorld(true);
    batchStaticMeshes(this.scene, new Set(this.solids));
  }
  syncTargets() {
    if (this.drillRevision !== this.sim.drillRevision) {
      this.drillRevision = this.sim.drillRevision; this.drillScenery.setScenario(this.sim.drill?.scenario); this.clearImpacts();
      if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    }
    this.targets.forEach((target, i) => {
      target.visible = (i === 0 || this.sim.settings.mode === 'transfer') && this.sim.settings.mode !== 'pop';
      target.position.copy(vector(this.sim.targetPosition(i)));
      target.updateMatrixWorld(true);
    });
  }
  async loadTarget() {
    try {
      const { scene, animations } = await new GLTFLoader().loadAsync('/models/target.glb');
      if (this.disposed) { this.disposeObject(scene); return; }
      this.targetAsset = scene;
      // Native GLB coordinates are already metres. A loading-pose bounding box
      // includes extended limbs and must not be used to resize the standing player.
      scene.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = true; o.receiveShadow = true; o.userData.skipScoring = /held_weapon|weapons[\\/]/i.test(o.name);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          // Source character shaders reuse the metalness input as a cloth mask.
          if (m instanceof THREE.MeshStandardMaterial && /ctm_sas|glove/.test(m.name) && !/lenses/.test(m.name)) {
            m.metalness = 0; m.roughness = .8;
            m.roughnessMap = null; m.metalnessMap = null;
          }
        }
      });
      this.targets.forEach(target => {
        const model = cloneSkeleton(scene); target.add(model); this.targetModels.push(model);
        const mixer = new THREE.AnimationMixer(model); this.mixers.push(mixer);
        this.targetActions.push(['idle_rifle', 'run_e_rifle', 'run_w_rifle'].flatMap(name => {
          const clip = animations.find(a => a.name.includes('/world/') && a.name.includes(name));
          return clip ? [mixer.clipAction(clip)] : [];
        }));
      });
      this.loadedTarget = true; this.updateAssetStatus(); void this.preloadModels();
      if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
    } catch { if (!this.disposed) { this.assetStatus = 'Target asset missing'; this.onError('The player model could not load. Restore the local game assets with npm run assets:build.'); } }
  }
  updateAssetStatus() {
    if (this.loadedTarget && this.modelCache.has(this.sim.equipped)) this.assetStatus = 'Models ready';
  }
  async equip(slot: Slot) {
    if (this.sim.active) this.renderer.domElement.focus({preventScroll:true});
    if (!this.sim.equip(slot)) return;
    this.updateDemonstration();
    void this.audio.unlock(this.sim.equipped);
    await this.setWeapon(this.sim.equipped);
    this.viewAnimations.get(this.sim.equipped)?.playDraw(Math.max(.01, this.sim.equipReadyAt - this.sim.time));
    this.audio.playAction('range-player',this.sim.equipped,'draw',this.sim.time,{local:true,volume:this.sim.settings.volume,duration:this.sim.stats.deploy});
  }
  inspect() {if (!this.sim.firing && !this.sim.reloadState.active && this.sim.time >= this.sim.equipReadyAt) {
    this.viewAnimations.get(this.sim.equipped)?.playInspect();
    this.audio.playAction('range-player',this.sim.equipped,'inspect',this.sim.time,{local:true,volume:this.sim.settings.volume});
  }}
  secondary(held = false) {
    if (this.sim.firing || this.sim.reloadState.active) return;
    if (this.sim.equipped==='knife'||this.sim.actions.isRevolver) {
      if (held) this.sim.pressTrigger(true); else {this.sim.start(false, true); this.sim.release('mouse');}
    }
    else {
      const zoom=this.sim.actions.zoom;
      this.sim.actions.secondary(this.sim.time);
      if(zoom!==this.sim.actions.zoom)this.audio.playScope(this.sim.equipped,!!this.sim.actions.zoom,this.sim.settings.volume);
    }
  }
  async setWeapon(id: Equipment) {
    const revision = ++this.revision;
    this.assetStatus = 'Loading weapon';
    this.weaponRoot.clear();
    try {
      const model = this.modelCache.get(id) ?? await this.loadModel(id);
      if (this.disposed) return;
      if (revision !== this.revision) { this.trimModelCache(); return; }
      this.modelCache.delete(id); this.modelCache.set(id, model);
      this.weaponRoot.add(model);
      this.weaponRoot.position.set(0, 0, 0);
      this.weaponRoot.rotation.set(0, 0, 0);
      this.trimModelCache();
      this.updateAssetStatus();
      // Preload only once the target is in too, so it never delays the range becoming ready.
      if (this.loadedTarget) void this.preloadModels();
    } catch {
      if (!this.disposed && revision === this.revision) {
        this.assetStatus = 'Weapon asset missing';
        this.onError('The weapon model could not load. Check the local asset export.');
      }
    }
  }
  private loadModel(id: Equipment) {
    const loading = this.loading.get(id);
    if (loading) return loading;
    const profile = this.progression?.getSnapshot().profile;
    const asset = profile ? cosmeticAsset(profile, id) : id;
    const cosmeticRevision = this.cosmeticRevision;
    const pending = new GLTFLoader().loadAsync(`/models/view-${asset}.glb`).then(async ({ scene: model, animations }) => {
      prepareNativeViewAssembly(model);
      try {if (profile) await applyCosmetic(model, profile, id);}
      catch {this.disposeObject(model); throw new Error('Cosmetic could not load');}
      if (this.disposed || cosmeticRevision !== this.cosmeticRevision) { this.disposeObject(model); return model; }
      const wrapper = new THREE.Group();
      model.rotation.y = Math.PI;
      model.traverse(o => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m instanceof THREE.MeshStandardMaterial) {
          m.envMapIntensity = .3;
          // The imported roughness map already contains the native surface values.
          if (m.roughnessMap) m.roughness = 1;
          if (/sleeve|glove|bare_arm/.test(m.name)) { m.metalness = 0; m.roughness = .9; m.roughnessMap = null; m.metalnessMap = null; }
        }
        // Upload textures now rather than on the first frame after a switch.
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) this.renderer.initTexture(value);
      } });
      wrapper.add(model);
      await this.renderer.compileAsync(wrapper, this.viewCamera, this.viewScene);
      if (this.disposed || cosmeticRevision !== this.cosmeticRevision) { this.disposeObject(model); return model; }
      this.viewAnimations.set(id, new ViewAnimation(model, animations));
      this.viewMuzzles.set(id, id === 'elite' ? {left: muzzleAnchor(model, 'left'), right: muzzleAnchor(model, 'right')} : {main: muzzleAnchor(model)});
      this.modelCache.set(id, wrapper);
      return wrapper;
    }).finally(() => { if (cosmeticRevision === this.cosmeticRevision) this.loading.delete(id); });
    this.loading.set(id, pending);
    return pending;
  }
  private loadoutEquipment(): Equipment[] {
    const {weapon, sidearm, primaryEnabled} = this.sim.settings;
    return [...(primaryEnabled ? [weapon] : []), sidearm, 'knife', 'zeus'];
  }
  /** Prepares the rest of the loadout in the background, one model at a time, so a switch only swaps it in. */
  private async preloadModels() {
    if (this.preloading) return;
    this.preloading = true;
    try {
      for (const id of this.loadoutEquipment()) {
        if (this.disposed) return;
        if (!this.modelCache.has(id)) await this.loadModel(id).catch(() => undefined);
      }
    } finally {this.preloading = false;}
  }
  async refreshCosmetics() {
    const key = JSON.stringify(this.progression?.getSnapshot().profile.equipped);
    if (key === this.cosmeticKey) return;
    this.cosmeticKey = key; this.cosmeticRevision++; this.revision++;
    this.weaponRoot.clear(); this.loading.clear();
    this.viewAnimations.forEach(animation => animation.dispose()); this.viewAnimations.clear();
    this.viewMuzzles.clear(); this.viewFlashes.clear();
    this.modelCache.forEach(model => this.disposeObject(model)); this.modelCache.clear();
    await this.setWeapon(this.sim.equipped);
  }
  settleProgression(result: Result) {
    if (!this.attemptId) return;
    const drill = result.drill;
    this.progression?.completeDrill(this.attemptId, {completion: 'completed',
      objectiveCompleted: drill ? drill.passed : result.shots >= 6 && result.hits / result.shots >= .5,
      score: drill?.movementScore ?? result.hits / Math.max(1, result.shots) * 100,
      shots: result.shots, hits: result.hits, activeSeconds: result.seconds,
      movementReps: drill?.counterStrafed ? 1 : 0, targetsHit: this.attemptTargets.size,
    }, String(this.attemptRevision));
    this.attemptId = null; this.attemptTargets.clear();
  }
  private cancelProgression() {
    if (this.attemptId) this.progression?.cancelAttempt(this.attemptId);
    this.attemptId = null; this.attemptRevision++; this.attemptTargets.clear();
  }
  reset() {this.cancelProgression(); this.viewAnimations.get(this.sim.equipped)?.cancel(); this.sim.reset(); this.clearImpacts();}
  trimModelCache() {
    // Embedded glove textures are duplicated per GLB, so only the loadout's assemblies stay on the GPU.
    const loadout = new Set(this.loadoutEquipment());
    for (const [id, model] of this.modelCache) {
      if (loadout.has(id) || id === this.sim.equipped) continue;
      this.modelCache.delete(id); this.viewAnimations.get(id)?.dispose(); this.viewAnimations.delete(id); this.disposeObject(model);
      this.viewMuzzles.delete(id);
    }
  }
  /** CS2 viewmodel_fov / viewmodel_offset_*: the arms camera and weapon placement. */
  private applyViewmodel(viewmodel: Viewmodel) {
    this.viewOffset = viewmodelOffset(viewmodel);
    const fov = viewmodelFov(viewmodel.fov);
    if (this.viewCamera.fov !== fov) {this.viewCamera.fov = fov; this.viewCamera.updateProjectionMatrix();}
  }
  configure(settings: Settings, measured?: MeasuredProfile) {
    this.binds?.setProfile(settings.keyboard);
    if (settings.viewmodel) this.applyViewmodel(settings.viewmodel);
    if (this.shortcuts) this.shortcuts.codes = protectedCodes(settings.keyboard.binds);
    if (settings.quality !== this.sim.settings.quality) this.metrics.resetResolution();
    this.meter.configure(settings.showFps);
    if (!settings.protectShortcuts) this.shortcuts.release();
    this.renderer.shadowMap.enabled = qualityPolicy(settings.quality).shadows;
    this.renderer.shadowMap.needsUpdate = true;
    // Presentation changes, such as a crosshair or volume toggle bound to a key, keep the attempt.
    const presentation = new Set<keyof Settings>(['crosshair', 'cs2Crosshair', 'volume', 'showFps', 'viewmodel', 'tracers', 'impactSize',
      'showImpactPattern', 'showMousePath', 'animatedGuides', 'quality', 'frameLimit', 'protectShortcuts', 'popColor']);
    if ((Object.keys({...settings, ...this.sim.settings}) as (keyof Settings)[]).some(key => !presentation.has(key) && settings[key] !== this.sim.settings[key])
      || measured !== this.sim.measured) this.cancelProgression();
    const changedWeapon = settings.weapon !== this.sim.settings.weapon || settings.primaryEnabled !== this.sim.settings.primaryEnabled;
    const changedSidearm = settings.sidearm !== this.sim.settings.sidearm;
    const resetKeys: (keyof Settings)[] = ['weapon', 'sidearm', 'primaryEnabled', 'mode', 'moving', 'targetSpeed', 'burst', 'peekScenario', 'peekDuration', 'drillPace',
      'popSize', 'popCount', 'popSpacing', 'popDistance'];
    if (!resetKeys.some(key => settings[key] !== this.sim.settings[key]) && measured === this.sim.measured) {
      const changedInversion = settings.invertY !== this.sim.settings.invertY;
      if (settings.popHideImpacts && !this.sim.settings.popHideImpacts) this.clearImpacts();
      this.sim.settings = settings;
      this.resizeImpacts();
      if (changedInversion) this.updateDemonstration();
      this.demonstration.mesh.visible = settings.showImpactPattern && this.guidesAllowed;
      this.mouseDemonstration.mesh.visible = settings.showMousePath && this.guidesAllowed;
      this.syncPop(); this.resize(); return;
    }
    this.clearInput?.(); this.sim.configure(settings, measured); this.syncPop(true);
    if (changedWeapon) {this.sim.slot = settings.primaryEnabled ? 1 : 2; this.sim.pattern = recoilPattern(loadoutWeapon(settings), measured);}
    this.updateDemonstration();
    this.clearImpacts(); this.syncTargets(); this.resize();
    this.renderer.shadowMap.enabled = qualityPolicy(settings.quality).shadows;
    if (changedWeapon) void this.setWeapon(loadoutWeapon(settings));
    else if (changedSidearm && this.sim.slot === 2) void this.setWeapon(settings.sidearm);
  }
  /** Wall guides belong to the spray drills: never in a positioned drill, with the knife out, or in Pop. */
  private get guidesAllowed() {return !this.sim.drill && this.sim.slot !== 3 && this.sim.settings.mode !== 'pop';}
  updateDemonstration() {
    const weapon = this.sim.equipped === 'knife' ? loadoutWeapon(this.sim.settings) : this.sim.equipped;
    this.demonstration.mesh.visible = this.sim.settings.showImpactPattern && this.guidesAllowed;
    this.mouseDemonstration.mesh.visible = this.sim.settings.showMousePath && this.guidesAllowed;
    this.demonstration.setPattern(weapon, this.sim.pattern, gameData.weapons[weapon].cycle, this.elapsed);
    this.mouseDemonstration.setPattern(weapon, this.sim.pattern, gameData.weapons[weapon].cycle, this.elapsed, this.sim.settings.invertY);
  }
  clearImpacts() {
    this.shotEffects?.clear(); this.viewFlashes?.clear();
    this.impactClouds?.forEach(cloud => cloud.clear());
    this.impacts.children.filter(c => c.name !== 'batched-bullet-impacts').forEach(c => this.impacts.remove(c));
    this.targets.forEach(t => t.children.filter(c => c.userData.impact).forEach(c => t.remove(c)));
  }
  resizeImpacts() {
    this.impactClouds?.forEach(cloud => cloud.resize(this.sim.settings.impactSize));
    for(const parent of [this.impacts,...this.targets])for(const mark of parent.children){
      if(typeof mark.userData.impactScale==='number')mark.scale.setScalar(mark.userData.impactScale*this.sim.settings.impactSize);
    }
  }
  castTargets(origin: Vec, dir: Vec) {
    this.syncTargets(); this.ray.set(vector(origin), vector(dir));
    const obstacle = this.ray.intersectObjects(this.visibleSolids(), false)[0];
    return this.ray.intersectObjects(this.targetModels.filter(m => m.parent?.visible).flatMap(scoringMeshes), false)
      .filter(hit => !obstacle || hit.distance < obstacle.distance);
  }
  visibleSolids() {
    return this.solids.filter(o=>{ for(let node:THREE.Object3D|null=o;node;node=node.parent) if(!node.visible) return false; return true; });
  }
  private physicalCover() {
    if(this.coverRevision===this.sim.drillRevision)return this.coverSolids;
    this.coverRevision=this.sim.drillRevision;
    this.coverSolids=this.visibleSolids().flatMap(object=>{
      if(!(object instanceof THREE.Mesh))return[];
      object.geometry.computeBoundingBox();
      const bounds=object.geometry.boundingBox?.clone().applyMatrix4(object.matrixWorld);
      if(!bounds)return[];
      const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
      return [{id:`range-cover:${object.id}`,center:{x:center.x,y:center.y,z:center.z},size:{x:size.x,y:size.y,z:size.z},material:object.userData.material??'concrete'}];
    });
    this.acoustics.setBoxes(this.coverSolids);return this.coverSolids;
  }
  shot(shot: Shot) {
    if (!shot.melee && !this.attemptId && !this.sim.pop) {
      this.attemptTargets.clear();
      this.attemptId = this.progression?.beginDrill(this.sim.settings.mode as DrillMode, String(this.attemptRevision)) ?? null;
    }
    const animationAmmo = this.sim.loadedAmmo;
    this.viewAnimations.get(this.sim.equipped)?.playFire(this.sim.equipped, {side:animationAmmo % 2 ? 'right' : 'left',lastShot:animationAmmo===0,
      alternate:this.sim.actions.alternateFire, zoomed:this.sim.actions.zoom > 0});
    if (this.sim.pop) {this.popShot(shot); return;}
    // Moving-target shots use the meshes at their last displayed position.
    // New drills still need an initial scene before their first rendered frame.
    if (this.presentedDrill !== this.sim.drillRevision) this.syncTargets();
    const expectedIndex=this.sim.targetForShot(shot.index);
    const expectedTarget = this.targets[expectedIndex];
    const meshes=this.targetModels.filter(model=>model.parent?.visible).flatMap(scoringMeshes);
    const covers=this.physicalCover();
    const rays=(shot.pelletDirections??[shot.direction]).map(dir=>{
      this.ray.set(vector(shot.origin),vector(dir));
      const intersections=this.ray.intersectObjects(meshes,false).filter(hit=>hit.distance<=shot.maxDistance);
      const target=intersections[0];
      const wall=this.ray.intersectObjects(this.visibleSolids(),false)[0];
      if(shot.kind==='melee'||shot.kind==='zeus') {
        const physical=target&&(!wall||target.distance<wall.distance)?target:undefined;
        const targetIndex=physical?this.targets.findIndex(parent=>!!parent.getObjectById(physical.object.id)):-1;
        const head=!!physical&&physical.point.y>this.targets[targetIndex].position.y+1.52;
        const healthDamage=physical?resolveDamage(this.sim.equipped,head?'head':'chest',physical.distance,0,false,
          {attack:shot.attack,firstSlash:shot.firstSlash}).healthDamage:0;
        return {dir,physical,wall,hits:physical?[{physical,targetIndex,head,healthDamage}]:[],contacts:[] as SurfaceContact[]};
      }
      const crossings=this.targets.flatMap((parent,targetIndex)=>{
        const physical=intersections.find(hit=>!!parent.getObjectById(hit.object.id));
        if(!physical)return[];
        // Reverse raycasting the same scoring meshes gives a physical flesh
        // chord. Neither hit position nor scoring is replaced with a proxy.
        const beyond=physical.distance+3;
        this.ray.set(vector(shot.origin).addScaledVector(vector(dir),beyond),vector(dir).negate());
        const back=this.ray.intersectObjects(scoringMeshes(this.targetModels[targetIndex]),false)[0];
        return [{physical,targetIndex,exit:Math.max(physical.distance,back?beyond-back.distance:physical.distance),
          head:physical.point.y>parent.position.y+1.52}];
      });
      const ray=resolveBulletRay({origin:shot.origin,direction:dir,range:shot.maxDistance,
        equipment:this.sim.equipped,stats:this.sim.stats,arena:{solids:covers},
        actors:crossings.map(crossing=>({id:crossing.targetIndex,side:'target',alive:true,feet:0,
          position:this.sim.targetPosition(crossing.targetIndex),armor:0,helmet:false})),
        physicalActorIntervals:crossings.map(crossing=>({actorId:crossing.targetIndex,entry:crossing.physical.distance,
          exit:crossing.exit,group:crossing.head?'head':'chest'}))});
      const hits=ray.hits.map(hit=>{
        const crossing=crossings.find(crossing=>crossing.targetIndex===hit.actorId)!;
        return {...crossing,healthDamage:hit.healthDamage};
      });
      return {dir,physical:hits[0]?.physical,wall,hits,contacts:ray.surfaces};
    });
    const physicalHit=rays.find(ray=>ray.physical)?.physical;
    const accepted=rays.flatMap(ray=>ray.hits).filter(hit=>hit.targetIndex===expectedIndex);
    const hit=accepted[0]?.physical;
    const head=accepted.some(hit=>hit.head);
    if (shot.melee) {
      this.sim.resolveMeleeHit(shot.ordinal,!!physicalHit);
      this.kick=1;this.audio.playKnife(shot.attack==='secondary'?'stab':'slash',this.sim.settings.volume);
      if(physicalHit)this.audio.playKnife('hit',this.sim.settings.volume);
      this.hitCaption.textContent=hit?'KNIFE HIT':'';this.hitTime=hit ? .45 : 0;
      this.hitmarker.style.color=this.hitCaption.style.color='#51edee';
      return;
    }
    const muzzles = this.viewMuzzles.get(this.sim.equipped), muzzle = muzzles?.main ?? muzzles?.[animationAmmo % 2 ? 'right' : 'left'];
    this.viewFlashes.fire(muzzle, this.sim.equipped, this.elapsed);
    for(const ray of rays) {
    const impact=ray.physical??ray.wall;
    if (muzzle) {
      this.viewScene.updateMatrixWorld(true);
      const start = viewMuzzleToWorld(muzzle.getWorldPosition(new THREE.Vector3()), this.viewCamera, this.camera, this.width, this.height);
      const end = ray.contacts[0]?vector(ray.contacts[0].point):impact?.point ?? vector(shot.origin).addScaledVector(vector(ray.dir), Math.min(80,shot.maxDistance));
      const delta = end.clone().sub(start), length = delta.length();
      this.ray.set(start, delta.normalize());
      const obstruction = this.ray.intersectObjects(this.visibleSolids(), false)[0];
      if (length > .15 && (!obstruction || obstruction.distance >= length - .08))
        this.shotEffects.trace(this.sim.equipped, shot.index, start, end, this.elapsed, this.traceColor, this.sim.settings.tracers);
    }
    for(const {physical,targetIndex,head:isHead,healthDamage} of ray.hits) {
      const parent=this.targets[targetIndex];
      const point=parent.worldToLocal(physical.point.clone().addScaledVector(vector(ray.dir),-.012));
      this.addImpact(parent,point,physical.distance,parent===expectedTarget?(isHead?this.hitMaterial.color:this.bodyMaterial.color):this.missMaterial.color);
      this.sim.damageTarget(targetIndex,isHead,physical.distance,healthDamage);
    }
    for(const contact of ray.contacts)this.shotEffects.surfaces.fire(contact.point,contact.normal,contact.material,this.sim.settings.impactSize,this.elapsed);
    if(!ray.contacts.length&&!ray.physical&&ray.wall)this.addImpact(this.impacts,ray.wall.point.clone().addScaledVector(vector(ray.dir),-.012),ray.wall.distance,this.missMaterial.color);
    }
    const target = expectedTarget;
    const t = (target.position.z - shot.origin.z) / shot.direction.z;
    this.sim.samples.push({ x: t > 0 ? shot.origin.x + shot.direction.x * t - target.position.x : 100,
      y: t > 0 ? shot.origin.y + shot.direction.y * t - target.position.y - HEAD_HEIGHT : 100, hit: !!hit, head,
      bullet: this.sim.drill ? this.sim.drill.shots+1 : shot.index + 1 });
    this.hitTime = .45;
    this.hitmarker.style.color = head ? '#ffdc59' : hit ? '#51edee' : '#ff7469';
    this.hitCaption.textContent = head ? 'HEADSHOT' : hit ? 'BODY HIT' : physicalHit ? 'WRONG TARGET' : 'MISS';
    this.hitCaption.style.color = this.hitmarker.style.color;
    if (hit) {
      this.attemptTargets.add(expectedIndex);
      this.audio.playHit(head, false, false, this.sim.settings.volume);
      this.sim.hits++;
      if (head) this.sim.heads++;
    }
    this.kick = 1;
    this.audio.play(this.sim.equipped, this.sim.settings.volume);
    this.audio.playAction('range-player',this.sim.equipped,shot.attack==='secondary'?'fire-alt':'fire',this.sim.time,
      {local:true,volume:this.sim.settings.volume});
  }

  /** Pop: every ray pops the first ball it crosses; misses mark the dark wall behind them. Knife swings count too. */
  private popShot(shot: Shot) {
    const pop = this.sim.pop!;
    const muzzles = this.viewMuzzles.get(this.sim.equipped), muzzle = muzzles?.main ?? muzzles?.[this.sim.loadedAmmo % 2 ? 'right' : 'left'];
    if (!shot.melee) this.viewFlashes.fire(muzzle, this.sim.equipped, this.elapsed);
    let popped = 0;
    for (const dir of shot.pelletDirections ?? [shot.direction]) {
      const hit = pop.hit(shot.origin, dir, shot.maxDistance);
      const end = hit ? vector(hit.point) : this.popBackdropPoint(shot.origin, dir, shot.maxDistance);
      if (hit) popped++;
      else if (end && !this.sim.settings.popHideImpacts) this.addImpact(this.impacts, end.clone().addScaledVector(vector(dir), -.012), end.distanceTo(vector(shot.origin)), this.missMaterial.color);
      if (muzzle && !shot.melee && end) {
        this.viewScene.updateMatrixWorld(true);
        const start = viewMuzzleToWorld(muzzle.getWorldPosition(new THREE.Vector3()), this.viewCamera, this.camera, this.width, this.height);
        if (start.distanceTo(end) > .15) this.shotEffects.trace(this.sim.equipped, shot.index, start, end, this.elapsed, this.traceColor, this.sim.settings.tracers);
      }
    }
    if (shot.melee) this.sim.resolveMeleeHit(shot.ordinal, popped > 0);
    this.kick = 1; this.hitTime = .45;
    this.hitmarker.style.color = this.hitCaption.style.color = popped ? '#ffdc59' : '#ff7469';
    this.hitCaption.textContent = popped > 1 ? `${popped} POPS` : popped ? 'POP' : 'MISS';
    if (popped) this.audio.playPopSound(this.sim.settings.popSound, this.sim.settings.volume, popped);
    if (shot.melee) this.audio.playKnife(shot.attack === 'secondary' ? 'stab' : 'slash', this.sim.settings.volume);
    else if (!this.sim.settings.popMuteGun) {
      this.audio.play(this.sim.equipped, this.sim.settings.volume);
      this.audio.playAction('range-player', this.sim.equipped, shot.attack === 'secondary' ? 'fire-alt' : 'fire', this.sim.time, {local: true, volume: this.sim.settings.volume});
    }
  }
  private popBackdropPoint(origin: Vec, dir: Vec, maxDistance: number) {
    if (!this.popBackdrop) return undefined;
    this.ray.set(vector(origin), vector(dir));
    const hit = this.ray.intersectObject(this.popBackdrop, false)[0];
    return hit && hit.distance <= maxDistance ? hit.point : undefined;
  }
  /** Mirrors the simulation's balls as glowing spheres, animates the popped ones away, and keeps the dark wall behind them. */
  private syncPop(rebuild = false) {
    const pop = this.sim.pop;
    this.pop.visible = !!pop;
    if (!pop) {
      if (this.popMeshes.size || this.popBursts.length || this.popBackdrop) {this.pop.clear(); this.popMeshes.clear(); this.popBursts = []; this.popBackdrop = undefined;}
      this.setPopAtmosphere(false); return;
    }
    this.setPopAtmosphere(true);
    if (rebuild) {this.pop.clear(); this.popMeshes.clear(); this.popBursts = []; this.popBackdrop = undefined; this.clearImpacts();}
    if (this.popColorApplied !== this.sim.settings.popColor) {
      this.popColorApplied = this.sim.settings.popColor;
      this.popMaterial.color.set(this.popColorApplied); this.popMaterial.emissive.set(this.popColorApplied);
    }
    const {region, config} = pop;
    if (!this.popBackdrop) {
      const width = Math.max(24, region.halfW * 2 + 6), height = Math.max(8, region.halfH * 2 + 4);
      this.popBackdrop = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({color: '#151a28', roughness: .95, fog: false}));
      this.popBackdrop.position.set(region.x, Math.max(height / 2, region.y), region.z - config.size - .5);
      this.popBackdrop.name = 'pop-backdrop'; this.pop.add(this.popBackdrop);
    }
    for (const ball of pop.drainPopped()) {
      const mesh = this.popMeshes.get(ball.id); if (!mesh) continue;
      this.popMeshes.delete(ball.id);
      const burst = this.popMaterial.clone(); burst.transparent = true; mesh.material = burst;
      this.popBursts.push({mesh, at: this.elapsed, radius: ball.radius});
    }
    const live = new Set<number>();
    for (const ball of pop.balls) {
      live.add(ball.id);
      let mesh = this.popMeshes.get(ball.id);
      if (!mesh) {mesh = new THREE.Mesh(this.popGeometry, this.popMaterial); mesh.name = `pop-ball-${ball.id}`; this.popMeshes.set(ball.id, mesh); this.pop.add(mesh);}
      mesh.position.set(ball.x, ball.y, ball.z); mesh.scale.setScalar(ball.radius);
    }
    for (const [id, mesh] of this.popMeshes) if (!live.has(id)) {this.popMeshes.delete(id); mesh.removeFromParent();}
    this.popBursts = this.popBursts.filter(({mesh, at, radius}) => {
      const t = (this.elapsed - at) / .18;
      if (t >= 1) {mesh.removeFromParent(); (mesh.material as THREE.Material).dispose(); return false;}
      mesh.scale.setScalar(radius * (1 + .9 * t)); (mesh.material as THREE.MeshStandardMaterial).opacity = 1 - t;
      return true;
    });
  }
  /** Pop darkens the range: black sky and near fog, dim lights, so the glowing balls stand out. */
  private setPopAtmosphere(on: boolean) {
    const fog = this.scene.fog as THREE.Fog;
    if (on) {fog.near = 1.5; fog.far = (this.sim.pop?.config.distance ?? 12) + 8;}
    if (on === this.popAtmosphere) return;
    this.popAtmosphere = on;
    const look = this.sceneLook, dark = '#07080d';
    (this.scene.background as THREE.Color).set(on ? dark : look.background); fog.color.set(on ? dark : look.background);
    if (!on) {fog.near = look.fog[0]; fog.far = look.fog[1];}
    this.hemi.intensity = on ? .16 : look.hemi; this.sun.intensity = on ? .12 : look.sun;
    this.scene.environmentIntensity = on ? .05 : look.environment;
    this.renderer.shadowMap.needsUpdate = true;
  }
  private addImpact(parent:THREE.Object3D,point:THREE.Vector3,distance:number,color:THREE.Color) {
    this.impactClouds??=new Map();let cloud=this.impactClouds.get(parent);
    if(!cloud){cloud=new ImpactCloud(this.markerGeometry,parent===this.impacts?200:60,parent);this.impactClouds.set(parent,cloud);}
    cloud.add(point,Math.max(1,distance/18),this.sim.settings.impactSize,color);
  }
  async enter() {
    if (this.disposed || this.entering) return;
    const revision = ++this.enterRevision;
    this.entering = true;
    this.sim.active = true;
    this.inputClock.reset(performance.now());
    this.renderer.domElement.focus({ preventScroll: true });
    void this.audio.unlock(this.sim.equipped);
    // Fullscreen consumes user activation. Request pointer lock first, without
    // awaiting it, so both browser requests belong to the same click.
    const coarse = matchMedia('(pointer: coarse)').matches;
    const supported = typeof this.renderer.domElement.requestPointerLock === 'function';
    const capture = coarse || !supported ? Promise.resolve<'drag'>('drag') : requestRawLock(this.renderer.domElement);
    const fullscreen = this.sim.settings.autoFullscreen && !coarse ? requestStageFullscreen(this.stage) : undefined;
    const protect = this.sim.settings.protectShortcuts && supported && !coarse;
    const guard = protect && fullscreen ? this.shortcuts.enter(protect, fullscreen) : this.shortcuts.enter(protect);
    try {
      const mode = await capture;
      await guard;
      if (revision !== this.enterRevision || this.disposed || !this.sim.active) return;
      if (coarse) {this.inputStatus = 'Touch'; return;}
      if (!supported) {this.inputStatus = 'Drag aim (mouse capture unsupported)'; return;}
      if (mode === 'drag' || document.pointerLockElement !== this.renderer.domElement) {
        this.pause(); this.inputStatus = 'Mouse capture blocked. Click Enter range again.'; return;
      }
      this.inputStatus = mode === 'raw' ? 'Raw mouse' : 'Standard mouse';
    } finally {
      if (revision === this.enterRevision) this.entering = false;
      if ((this.disposed || !this.sim.active) && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    }
  }
  pause() {
    this.enterRevision = (this.enterRevision ?? 0) + 1; this.entering = false;
    this.shortcuts?.release();
    this.clearInput?.();
    this.sim.publishPopResult(); this.sim.cancel();
    this.hitTime = 0;
    this.hitmarker.style.opacity = this.hitCaption.style.opacity = '0';
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }
  private updateMovement() {
    const held = this.binds.isHeld.bind(this.binds);
    this.sim.input = {...this.sim.input, forward: +held('forward') - +held('back'), side: +held('right') - +held('left'),
      walk: held('walk'), crouch: held('duck'), jump: held('jump')};
  }
  private onBind(event: BindEvent) {
    if (event.kind === 'press' || event.kind === 'release') {
      const down = event.kind === 'press';
      switch (event.action) {
        case 'attack': if (!down) this.sim.release('mouse'); else if (this.loadedTarget && this.modelCache.has(this.sim.equipped)) this.sim.pressTrigger(); return;
        case 'attack2': if (down) this.secondary(true); else if (this.sim.actions.isRevolver && this.sim.actions.alternateFire) this.sim.release('mouse'); return;
        case 'reload': this.sim.reloadHeld = down; if (down) this.sim.reload(true); return;
        case 'inspect': if (down) this.inspect(); return;
        case 'use': return;
        case 'jump': if (down) this.sim.input.jumpPressed = true;
      }
      this.updateMovement(); return;
    }
    if (event.kind === 'slot') {const slot = trainerSlot(event.slot, this.sim.slot); if (slot) void this.equip(slot);}
    else if (event.kind === 'lastinv') void this.equip(this.sim.previousSlot);
    else if (event.kind === 'invnext' || event.kind === 'invprev')
      void this.equip(cycleSlot(this.sim.slot, event.kind === 'invnext' ? 1 : -1, this.sim.settings.primaryEnabled ? [1, 2, 3, 4] : [2, 3, 4]));
    else if (event.kind === 'cancelselect') this.pause();
    else if (event.kind === 'console') this.onConsole?.(event.args);
  }
  /** CS2's "Zoom Button Hold: Repeat Enabled" re-zooms while Secondary Fire stays held. */
  private repeatZoom() {
    const id = this.sim.equipped;
    if (!this.sim.active || !this.sim.settings.keyboard.zoomRepeat || id === 'knife' || !gameData.weapons[id].zoomLevels) return;
    if (this.binds.isHeld('attack2') && this.sim.time >= this.sim.actions.secondaryReadyAt) this.secondary(true);
  }
  bindInput() {
    const canvas = this.renderer.domElement;
    const listen = (target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, options); this.cleanup.push(() => target.removeEventListener(type, fn, options));
    };
    let pointer: number | null = null, lastX = 0, lastY = 0;
    const capture = (id: number) => { try { canvas.setPointerCapture(id); } catch { /* Some embedded engines reject pointer capture. */ } };
    listen(canvas, 'pointerdown', ((e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      if (!this.loadedTarget || !this.modelCache.has(this.sim.equipped)) return;
      void this.audio.unlock(this.sim.equipped);
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        this.syncInput(e.timeStamp, true);
        e.preventDefault();
        this.inputStatus = 'Touch'; this.sim.active = true;
        pointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
        capture(e.pointerId); this.sim.start(true);
      } else if (!this.sim.active) {e.preventDefault(); void this.enter();}
      else {
        // Mouse buttons fire through their binds; this only keeps drag aiming without pointer lock.
        pointer = e.pointerId; lastX = e.clientX; lastY = e.clientY;
        if (!document.pointerLockElement) capture(e.pointerId);
      }
    }) as EventListener);
    listen(window, 'pointermove', ((e: PointerEvent) => {
      if (!this.sim.active) return;
      this.syncInput(e.timeStamp);
      if (document.pointerLockElement === canvas && e.pointerType === 'mouse') this.sim.aim(e.movementX, e.movementY);
      else if (e.pointerId === pointer) {
        this.sim.aim(e.clientX - lastX, e.clientY - lastY, e.pointerType !== 'mouse');
        lastX = e.clientX; lastY = e.clientY;
      }
    }) as EventListener, {capture: true});
    listen(document, 'pointerup', ((e: PointerEvent) => {
      if (pointer === e.pointerId) pointer = null;
      if (e.pointerType !== 'mouse' && e.button === 0) this.sim.release(e.pointerType);
    }) as EventListener);
    listen(canvas, 'pointercancel', (() => { pointer = null; this.pause(); }) as EventListener);
    listen(canvas, 'contextmenu', e => e.preventDefault());
    listen(document, 'pointerlockchange', (() => {
      if (this.entering) return;
      if (document.pointerLockElement !== canvas && this.inputStatus !== 'Touch' && this.inputStatus !== 'Drag aim') this.pause();
    }) as EventListener);
    listen(document, 'fullscreenchange', (() => {
      if (this.shortcuts.protected && !document.fullscreenElement) this.pause();
    }) as EventListener);
    const input = attachBindInput({canvas, runtime: this.binds, active: () => this.sim.active, listen,
      beforeInput: timestamp => this.syncInput(timestamp, true)});
    this.clearInput = () => { this.binds.releaseAll(); input.reset(); pointer = null; this.sim.input.jumpPressed = false; this.sim.reloadHeld = false; this.updateMovement(); };
    listen(window, 'keydown', ((e: KeyboardEvent) => {
      if (!this.sim.active || (e.target instanceof HTMLElement && e.target.matches('input,select,textarea,button'))) return;
      if (e.code === 'Escape') this.pause();
    }) as EventListener);
    const blur = () => { this.binds.releaseAll(); input.reset(); pointer = null; if (!this.entering || document.hidden) this.pause(); };
    listen(window, 'blur', blur);
    listen(document, 'visibilitychange', () => { if (document.hidden) blur(); });
    listen(canvas, 'webglcontextlost', e => { e.preventDefault(); this.pause(); this.onError('Graphics context lost. Restart the range to recover.'); });
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width; this.height = height;
    this.renderer.setPixelRatio(renderPixelRatio(width, height, resolutionPixelRatio(this.sim.settings.resolution), this.sim.settings.quality, this.metrics.adaptive));
    this.renderer.setSize(width, height);
    const aspect = viewAspect(this.sim.settings.resolution, width, height);
    this.camera.aspect = aspect;
    // CS2 stretches the crosshair with the world.
    this.crosshair?.style.setProperty('--cross-stretch', String(width / height / aspect));
    this.viewViewport = viewmodelViewport(width, height);
    this.viewCamera.aspect = viewmodelAspect(width,height,aspect);
    this.camera.updateProjectionMatrix(); this.viewCamera.updateProjectionMatrix();
  }
  private syncInput(timestamp: number, flush = false) {
    const now = inputTimestamp(timestamp);
    if (!this.sim.active) { this.inputClock.reset(now); return; }
    this.inputClock.advance(now, elapsed => this.sim.advance(elapsed));
    if (flush) this.sim.flushInput();
  }
  tick(timestamp: number) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(t => this.tick(t));
    const cpuStart = performance.now();
    if (document.hidden) this.inputClock.reset(performance.now());
    else this.syncInput(performance.now());
    if (document.hidden || !this.pacer.ready(timestamp, this.sim.active ? this.sim.settings.frameLimit : 15)) {
      if (document.hidden) this.previous = timestamp;
      return;
    }
    const policy = qualityPolicy(this.sim.settings.quality);
    const frameSeconds = this.previous ? Math.max(0,(timestamp - this.previous) / 1000) : 0;
    const dt = Math.min(frameSeconds,.25);
    this.previous = timestamp; this.elapsed += dt;
    this.repeatZoom(); this.syncTargets(); this.syncPop();
    const activeLane = this.sim.firing ? this.sim.targetForShot() : 0;
    this.targets.forEach((t, i) => {
      const marker = t.getObjectByName('active-lane') as THREE.Mesh;
      marker.visible = !this.sim.drill;
      (marker.material as THREE.MeshBasicMaterial).color.set(i === activeLane ? GUIDE_COLORS.now : GUIDE_COLORS.next);
      t.getObjectByName('lane-tag')!.visible = this.sim.settings.mode === 'transfer';
    });
    const animation = Math.abs(this.sim.targetVelocity) < .1 ? 0 : this.sim.targetVelocity > 0 ? 1 : 2;
    const animationChanged = animation !== this.animationState && this.loadedTarget;
    if (animationChanged) {
      this.animationState = animation;
      this.targetActions.forEach(actions => { actions.forEach(a => a.stop()); actions[animation]?.reset().play(); });
    }
    this.animationElapsed += this.sim.active ? dt : 0;
    const animate = this.animationElapsed >= 1 / this.metrics.animationRate(this.sim.settings.quality) || animationChanged;
    if (animate) {
      this.mixers.forEach((m, i) => {if (this.targets[i].visible) m.update(this.animationElapsed);});
      if (animationChanged) this.renderer.shadowMap.needsUpdate = true;
    }
    this.camera.position.copy(vector(this.sim.renderPosition()));
    const visualRecoil = this.sim.slot === 3 ? {yaw: 0, pitch: 0} : this.sim.recovery.predict(this.sim.accumulator);
    const viewPunch = this.sim.viewPunch.sample(this.sim.time + this.sim.accumulator);
    const view = recoilView(this.sim.yaw, this.sim.pitch, visualRecoil, viewPunch);
    this.camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
    const scoped = this.scope.update(this.sim.actions, this.camera, this.sim.time + this.sim.accumulator);
    this.weaponRoot.visible = !scoped;
    this.crosshair.style.visibility = scoped || this.sim.equipped !== 'knife' && !gameData.weapons[this.sim.equipped].showCrosshair ? 'hidden' : '';
    this.camera.updateMatrixWorld();
    this.kick = Math.max(0, this.kick - dt * 10);
    this.muzzle.intensity = 0;
    this.hitTime = Math.max(0, this.hitTime - dt);
    this.hitmarker.style.opacity = this.hitTime > 0 ? '1' : '0';
    this.hitCaption.style.opacity = this.hitTime > 0 ? '1' : '0';
    const moving = Math.hypot(this.sim.velocity.x, this.sim.velocity.z);
    const drawing = Math.max(0,this.sim.equipReadyAt-this.sim.time);
    const reloadRemaining = Math.max(0, this.sim.reloadState.until - this.sim.time);
    const reloading = reloadRemaining > 0;
    this.viewAnimations.get(this.sim.equipped)?.update(reloadRemaining, this.sim.reloadState.phaseDuration||this.sim.stats.reload, this.sim.active ? dt : 0, {reloadEmpty: this.sim.reloadEmpty,
      equipment:this.sim.equipped,reloadPhase:this.sim.reloadState.phase,reloadProgress:this.sim.reloadState.progress,
      ammo:this.sim.loadedAmmo,charging:this.sim.actions.charging,chargeDuration:REVOLVER_WINDUP});
    if (animate) this.animationElapsed = 0;
    this.wasReloading = reloading;
    this.audio.updateListener(this.sim.position,this.sim.yaw,this.sim.pitch);
    this.audio.syncActor({id:'range-player',generation:this.sim.drillRevision,equipment:this.sim.equipped,alive:true,local:true,
      reloading,silent:this.sim.reloadSilent,reloadEmpty:this.sim.reloadEmpty,reloadRemaining,reloadDuration:this.sim.reloadState.phaseDuration||this.sim.stats.reload,
      reloadPhase:this.sim.reloadPhase,reloadProgress:this.sim.reloadState.progress},
      this.sim.time,this.sim.settings.volume);
    for(const action of this.sim.drainActionEvents())if(action.kind==='reload-cancel')this.audio.cancelAction('range-player');
    this.audio.updateActions(this.sim.time);
    const offset = this.viewOffset ?? VIEWMODEL_OFFSET;
    const modelKick=this.viewAnimations.get(this.sim.equipped)?.hasFireMotion?0:this.kick;
    this.weaponRoot.position.set(offset.x, offset.y + Math.sin(this.elapsed * 12) * Math.min(moving, 1) * .002, offset.z + modelKick * .015);
    this.viewAir.apply(this.weaponRoot, view, this.sim.grounded);
    if (modelKick && this.sim.slot !== 3) this.weaponRoot.rotation.x += modelKick * .02;
    const point = vector(followCrosshairDirection(this.sim.yaw, this.sim.pitch, visualRecoil))
      .multiplyScalar(10).add(this.camera.position).project(this.camera);
    const crosshairOffset = followCrosshairOffset(this.sim.settings.follow ? point : {x: 0, y: 0}, this.width, this.height);
    this.crosshair.style.transform = `translate(${crosshairOffset.x}px, ${crosshairOffset.y}px)`;
    // The dynamic gap is the live accuracy cone (penalty, movement, air, spread)
    // projected to the screen, as the game's HUD does, not a speed heuristic.
    if (this.sim.settings.crosshair.dynamic) {
      const stats = this.sim.stats;
      const cone = this.sim.recovery.inaccuracy(moving / (stats.speed * UNIT), this.sim.input.walk,
        !this.sim.grounded, this.sim.verticalVelocity / UNIT);
      this.crosshair.style.setProperty('--motion-gap',
        `${dynamicCrosshairGap({inaccuracy: cone, spread: stats.spread}, this.height, VERTICAL_FOV)}px`);
    } else this.crosshair.style.setProperty('--motion-gap', '0px');
    const targetPosition = this.targets[activeLane].position;
    const dx = targetPosition.x - this.sim.position.x, dz = targetPosition.z - this.sim.position.z;
    const distance = Math.hypot(dx, dz);
    this.cues.forEach((cue, i) => {
      const index = (this.sim.firing ? this.sim.shots : 0) + i;
      const visible = this.sim.slot!==3 && ['guided', 'transfer'].includes(this.sim.settings.mode) && index < this.sim.burstSize;
      if (!visible) {cue.hidden = true; return;}
      const target = this.sim.targetPosition(this.sim.targetForShot(index));
      const p = visible ? this.sim.predictedRecoil(i===1) : {yaw:0,pitch:0};
      const angles = guidanceAngles(this.sim.position, target, p, visualRecoil, this.sim.settings.follow, viewPunch);
      const aim = direction(angles.yaw, angles.pitch);
      const point = vector(aim).multiplyScalar(10).add(this.camera.position).project(this.camera);
      cue.hidden = !visible || point.z > 1 || Math.abs(point.x) > .95 || Math.abs(point.y) > .88;
      cue.style.left = `${(point.x + 1) * 50}%`; cue.style.top = `${(1 - point.y) * 50}%`;
      const label = `${i ? 'NEXT' : 'NOW'} ${index + 1}${this.sim.settings.mode === 'transfer' ? this.sim.targetForShot(index) ? ' / B' : ' / A' : ''}`;
      if (this.cueLabels[i].textContent !== label) this.cueLabels[i].textContent = label;
    });
    this.demonstration.update(this.elapsed, policy.guideHz, this.sim.settings.animatedGuides);
    this.mouseDemonstration.update(this.elapsed, policy.guideHz, this.sim.settings.animatedGuides);
    if (this.sim.settings.moving && this.elapsed - this.shadowAt > 1 / (this.sim.settings.quality === 'high' ? 30 : 15)) {
      this.shadowAt = this.elapsed; this.renderer.shadowMap.needsUpdate = true;
    }
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.shotEffects.update(this.elapsed); this.viewFlashes.update(this.elapsed);
    this.renderer.autoClear = true; this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false; this.renderer.clearDepth();
    const v = this.viewViewport; this.renderer.setViewport(v.x, v.y, v.width, v.height);
    this.renderer.render(this.viewScene, this.viewCamera);
    this.presentedDrill = this.sim.drillRevision;
    const oldResolution = this.metrics.adaptive;
    if (this.metrics.sample(dt, performance.now() - cpuStart, this.sim.settings.quality === 'auto', this.sim.active, this.sim.settings.frameLimit,frameSeconds)) {
      this.meter.update(this.metrics, this.renderer.getPixelRatio());
      if (oldResolution !== this.metrics.adaptive) this.resize();
    }
    if (this.elapsed - this.statusTime > .1) {
      this.statusTime = this.elapsed;
      const drill=this.sim.drill;
      this.onStatus({ weapon: loadoutWeapon(this.sim.settings), equipped:this.sim.equipped,slot:this.sim.slot,equipReady:this.sim.time>=this.sim.equipReadyAt,
        magazine:this.sim.slot===1?this.sim.burstSize:this.sim.stats.magazine, targetHealth: [...this.sim.targetHealth],
        pop: this.sim.pop ? {pops: this.sim.pop.pops, shots: this.sim.pop.shots, seconds: this.sim.pop.shots ? this.sim.time - this.sim.popStartedAt : 0} : undefined,
        active: this.sim.active, firing: this.sim.firing, hitFlash:this.hitTime>0, shots: drill?.shots ?? this.sim.shots, hits: drill?.hits ?? this.sim.hits, heads: drill?.heads ?? this.sim.heads,
        remaining:this.sim.slot===3?0:this.sim.loadedAmmo,reserve:this.sim.reserveAmmo,reloadSilent:this.sim.reloadSilent,
        recharge:Math.max(0,this.sim.rechargeUntil-this.sim.time),reload: reloadRemaining, reloadProgress: reloading ? this.sim.reloadState.progress : undefined,
        ...(drill ? {drill:{round:this.sim.drillRound,completed:this.sim.drillCompleted,passed:this.sim.drillPassed,scenario:drill.scenario.name,covered:drill.scenario.covered,exposure:drill.scenario.exposure,side:drill.scenario.side,
          peekDirection:this.sim.settings.mode==='peek'?peekDirection(this.sim.position,this.sim.yaw,drill.scenario):0,
          phase:drill.finished?(this.sim.repositionFrom?'reposition':'feedback'):drill.visible?'exposed':'prepare',accurate:drill.accurate,error:drill.error,
          remaining:this.sim.settings.mode==='peek' && drill.firstShotAt!==null ? Math.max(0,this.sim.settings.peekDuration-(this.sim.time-drill.firstShotAt)) : undefined,
          last:this.sim.settings.mode==='peek' && drill.shots>0 ? drill.result() : this.sim.drillResult}} : {}),
        speed: moving / .0254, distance: this.sim.pop ? this.sim.pop.config.distance : distance, input: this.inputStatus, shortcutProtected: this.shortcuts.protected, audio: this.audio.status, assets: this.assetStatus, fps: this.metrics.fps });
    }
  }
  disposeObject(root: THREE.Object3D) {
    disposeResources([root]);
  }
  dispose() {
    this.cancelProgression();
    this.disposed = true; this.pause(); cancelAnimationFrame(this.frame); this.observer.disconnect();
    this.cleanup.forEach(fn => fn()); this.audio.dispose();
    this.meter.dispose(); this.impactClouds?.forEach(cloud => cloud.dispose());
    this.shotEffects.dispose(); this.viewFlashes.dispose();
    this.demonstration.dispose();
    this.mouseDemonstration.dispose();
    this.drillScenery.dispose();
    disposeResources([this.scene, ...this.solids]); this.modelCache.forEach(m => this.disposeObject(m));
    this.viewAnimations.forEach(animation => animation.dispose());
    this.scope.dispose();
    this.popGeometry.dispose(); this.popMaterial.dispose(); this.popBackdrop?.geometry.dispose(); (this.popBackdrop?.material as THREE.Material | undefined)?.dispose();
    this.markerGeometry.dispose(); this.missMaterial.dispose(); this.hitMaterial.dispose(); this.bodyMaterial.dispose();
    this.cues.forEach(c => c.remove()); this.hitCaption.remove();
    this.environment?.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
