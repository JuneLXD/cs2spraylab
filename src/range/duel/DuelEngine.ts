import {KillFeedBuffer, type KillEntry} from './kill-feed';
import {applyMapPresentation} from './map-presentation';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {clone as cloneSkeleton} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {DEG, UNIT, type Vec} from '../actor-physics';
import {RangeAudio} from '../audio';
import {gameData,loadoutWeapon,resolutionPixelRatio,viewAspect, type Settings, type Viewmodel, type Weapon} from '../config';
import {requestRawLock} from '../input';
import {InputClock, inputTimestamp} from '../input-clock';
import {createGameRenderer} from '../render-context';
import {mouseAngle, VERTICAL_FOV} from '../simulation';
import {dynamicCrosshairGap} from '../crosshair-spread';
import {BindRuntime, cycleSlot, trainerSlot, type BindEvent} from '../keybinds/runtime';
import {attachBindInput} from '../keybinds/dom-input';
import {protectedCodes} from '../keybinds/profile';
import {VIEWMODEL_FOV, VIEWMODEL_OFFSET, viewmodelFov, viewmodelOffset, viewmodelViewport, viewmodelAspect} from '../viewmodel';
import {botConfig, type DuelConfig} from './config';
import {acousticSolids, duelArena, traceSolid, type Arena, type Solid} from './geometry';
import {DuelSimulation} from './simulation';
import type {DuelActorSnapshot, DuelEvent} from './types';
import {DuelAnimator, nativeGestureClips} from './animation';
import {requestStageFullscreen} from '../shortcut-guard';
import {BloodEffects} from '../blood-effects';
import {applyImmunityAlpha} from './immunity-alpha';
import {attackSide, flinchFamily, limbSide} from './flinch';
import {NativeHitboxPose} from './native-hitboxes';
import {batchStaticMeshes, disposeResources, disposeSkeletons} from './render-resources';
import {fullyOccluded} from './visibility';
import {muzzleAnchor, viewMuzzleToWorld} from './tracers';
import type {SpatialSound} from '../spatial-audio';
import {applyViewmodelRecoil, recoilView} from '../view-recoil';
import {ViewmodelAir} from '../viewmodel-air';
import {followCrosshairDirection, followCrosshairOffset} from '../crosshair-follow';
import {RoundFlow, deathView, deathFeet} from './round-flow';
import {type Equipment, type Slot} from '../equipment';
import {DamageFeedback} from './damage-feedback';
import {loadDuelHistory, type DuelReview, type DuelHistory} from './coaching';
import {FOOTSTEP_RANGE} from '../sound-model';
import {ViewAnimation} from '../view-animation';
import {equipmentStats} from '../equipment';
import {ScopeOverlay} from '../scope-overlay';
import {addArenaCover,addArenaTraversal,createEnvironmentRenderMap,syncEnvironmentRenderMap} from './arena-props';
import {blocksMovement} from './environment';
import {AcousticScene} from '../spatial-audio';
import {seedForDesign} from './arena-layout';
import {applyCosmetic, cosmeticAsset, cosmeticCatalog} from '../cosmetics';
import weaponMounts from '../weapon-mounts.json';
import {equippedCosmetic,type DuelAttemptSetup,type ProgressionController,type ProgressionProfile} from '../progression';
import {prepareNativeViewAssembly} from '../native-view-actions';
import {ActorCosmeticLoader, loadAgent, type ActorCosmeticInstance} from '../actor-cosmetics';
import {REVOLVER_WINDUP} from '../weapon-actions';
import {FrameMetrics, FramePacer, PerformanceMeter, qualityPolicy, renderPixelRatio} from '../performance';
import {ShortcutGuard} from '../shortcut-guard';
import {MuzzleFlashes, ShotEffects} from '../weapon-effects';
import {DuelRadar} from './radar';
import {actorShadows,ActorShadowRenderer} from './shadow-scene';
import {BOTZ_PLAYER_SPAWN, botzArena, botzDuelConfig, botzSummary, loadBotzHistory, sanitizeBotzConfig, saveBotzHistory,
  type BotzConfig, type BotzHistory, type BotzSummary} from './botz';
import {REFLEX_ISLAND, REFLEX_ISLAND_HALF, REFLEX_REACH, reflexArena} from './reflex';

export type DuelStatus = {
  killFeed?: readonly KillEntry[]; reloadRemaining?: number; reloadProgress?: number;
  phase: 'ready' | 'fighting' | 'result'; paused: boolean; outcome?: 'won' | 'lost' | 'draw';
  health: number; armor: number; ammo: number; reloading: boolean; enemies: number;
  seconds: number; kills: number; damage: number; input: string; caption: string;
  /** An imported map's model is still loading. */
  mapLoading?: boolean;
  shortcutProtected: boolean;
  nextRoundIn: number;
  /** Deathmatch on an imported map: deaths so far and, while dead, seconds until the respawn. */
  deathmatch?: boolean; deaths?: number; respawnIn?: number;
  /** Deathmatch: seconds of spawn protection left for you. */
  immuneFor?: number;
  equipped?: Equipment; review?: DuelReview; history?: DuelHistory[];
  loadout?: {primary: Weapon | null; sidearm: Settings['sidearm'] | null}; pickup?: Equipment;
  interaction?:string;
  reserve?:number; reloadSilent?:boolean; recharge?:number;
  arenaDesign?: string;
  /** Aim Botz session: kills, accuracy and pace. */
  botz?: BotzSummary; botzHistory?: BotzHistory[];
};

const v3 = (point: Vec) => new THREE.Vector3(point.x, point.y, point.z);
const surface = (color: string, roughness = .86) => new THREE.MeshStandardMaterial({color, roughness});

type ViewModel = {scene: THREE.Object3D; animation: ViewAnimation; muzzle?: THREE.Object3D};

export class DuelEngine {
  sim: DuelSimulation;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(VERTICAL_FOV, 1, .03, 120);
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(VIEWMODEL_FOV, 1, .01, 10);
  private viewOffset = VIEWMODEL_OFFSET;
  readonly viewRoot = new THREE.Group();
  private readonly viewAir = new ViewmodelAir();
  readonly actors = new THREE.Group();
  readonly covers = new THREE.Group();
  private readonly dynamicCovers = new THREE.Group();
  private environmentModels = new Map<string,THREE.Group>();
  private environmentRevision = -1;
  private readonly acoustics = new AcousticScene([], 'warehouse');
  readonly effects = new THREE.Group();
  readonly audio = new RangeAudio();
  /** CS2 bind table for keyboard, mouse buttons and wheel. */
  readonly binds: BindRuntime;
  /** Other console commands a bind runs, such as crosshair convars or cl_radar_scale. */
  onConsole?: (args: string[]) => void;
  private bindHandle?: {reset(): void};
  private lastSlot: Slot = 2;
  private readonly cleanup: (() => void)[] = [];
  private readonly observer: ResizeObserver;
  private frame = 0;
  private last = 0;
  private readonly inputClock = new InputClock();
  private statusAt = 0;
  private disposed = false;
  private paused = false;
  private pointer: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private seed = Math.floor(Math.random() * 0x7fffffff);
  private viewAnimation?: ViewAnimation;
  private kick = 0;
  private inputName = 'Ready';
  private caption = '';
  private captionUntil = 0;
  private shortcuts: ShortcutGuard;
  private entering = false;
  private enterRevision = 0;
  private kills = 0;
  private readonly killFeed = new KillFeedBuffer();
  private damage = 0;
  private models = new Map<number, THREE.Group>();
  private hitboxPoses = new Map<number, NativeHitboxPose>();
  private heldWeapons = new Map<number, THREE.Object3D>();
  private animators = new Map<number, DuelAnimator>();
  private gestureClips=new Map<Equipment,THREE.AnimationClip[]>();
  private flinchClips: THREE.AnimationClip[] = [];
  private readonly stage: HTMLElement | null;
  private readonly blood: BloodEffects;
  private gestureLoading=new Set<Equipment>();
  private targetScene?: THREE.Object3D;
  private targetClips: THREE.AnimationClip[] = [];
  private motionReady = false;
  private worldWeapons = new Map<Equipment, THREE.Object3D>();
  private worldLoading = new Set<Equipment>();
  private viewRevision = 0;
  private shotEffects: ShotEffects;
  private viewFlashes: MuzzleFlashes;
  private shotCounts = new Map<number, number>();
  private ownTraceColor = new THREE.Color('#fff0c9');
  private enemyTraceColor = new THREE.Color('#ffd0a4');
  private width = 1;
  private height = 1;
  private readonly followPoint = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projectionView = new THREE.Matrix4();
  private readonly actorBounds = new THREE.Sphere(new THREE.Vector3(), 1.9);
  private animationTimes = new Map<number, number>();
  private animationClock = 0;
  private viewAnimationElapsed = 0;
  private pacer = new FramePacer();
  private metrics = new FrameMetrics();
  private meter: PerformanceMeter;
  private viewMuzzle?: THREE.Object3D;
  private botMuzzles = new Map<number, THREE.Object3D>();
  private readonly roundFlow = new RoundFlow();
  private sessionStarted = false;
  private deaths = new Map<number, number>();
  private readonly damageFeedback: DamageFeedback;
  private readonly shell = new THREE.Group();
  private renderedEquipment?: Equipment;
  private history = loadDuelHistory();
  private wasReloading = false;
  private scope: ScopeOverlay;
  private dropModels = new Map<number, THREE.Object3D>();
  private pickupDrawing = false;
  /** First-person models for the loadout stay on the GPU, keyed by finish, so a switch only swaps them in. */
  private viewModels = new Map<Equipment, {key: string; model: Promise<ViewModel>}>();
  private retiredViewModels: Promise<ViewModel>[] = [];
  private preloadingViewModels = false;
  /** Bots, their weapons and motion clips are in; only then does the loadout preload start, so it never delays them. */
  private sceneLoaded = false;
  private cosmeticKey = '';
  private attemptId: string | null = null;
  private attemptRevision = 0;
  private attemptDamage = new Map<number, number>();
  private actorLoader = new ActorCosmeticLoader();
  private agentInstance?: ActorCosmeticInstance;
  private agentRevision = 0;
  private readonly radar: DuelRadar;
  private radarAt = 0;
  private readonly actorShadows=new ActorShadowRenderer();
  private shadowAt=0;
  /** Set in Aim Botz: passive respawning bots instead of duel rounds. */
  private botz?: BotzConfig;
  private botzHistory: BotzHistory[] = [];
  private botzRecorded = false;
  /** Reflex arrivals already shown as a caption. */
  private arrivalsShown = 0;
  private generations = new Map<number, number>();
  private playerGeneration = 1;
  private workshopModel?: THREE.Group;

  constructor(private readonly host: HTMLElement, private readonly crosshair: HTMLElement,
    private readonly onStatus: (status: DuelStatus) => void,
    private readonly onError: (message: string) => void, private settings: Settings, private config: DuelConfig,
    private readonly progression?: ProgressionController, botz?: BotzConfig,
    /** An imported map (workshop.ts) for Aim Botz: drawn from its model instead of the hall. */
    private readonly workshop?: Arena) {
    if (botz) {this.botz = sanitizeBotzConfig(botz); this.config = botzDuelConfig(this.botz); this.botzHistory = loadBotzHistory(this.botz.map);}
    this.cosmeticKey = JSON.stringify(progression?.getSnapshot().profile.equipped);
    this.sim = this.createSimulation();
    this.radar = new DuelRadar(host);
    this.scope = new ScopeOverlay(host);
    this.damageFeedback = new DamageFeedback(host);
    this.meter = new PerformanceMeter(host); this.meter.configure(settings.showFps);
    this.stage = host.closest('.range-stage'); this.shortcuts = new ShortcutGuard(this.stage);
    this.shortcuts.codes = protectedCodes(settings.keyboard.binds);
    this.binds = new BindRuntime(settings.keyboard, event => this.onBind(event));
    this.applyViewmodel(settings.viewmodel);
    this.renderer = createGameRenderer({antialias: qualityPolicy(settings.quality).shadows, lowLatency: settings.lowLatency});
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.dataset.duel = 'true';
    this.renderer.domElement.setAttribute('aria-label', this.workshop?.workshop && (this.botz || this.config.respawnSeconds > 0) ? this.workshop.workshop.name
      : !this.botz ? 'AI Duel arena' : this.botz.map === 'island' ? 'Reflex island' : 'Aim Botz yard');
    this.renderer.domElement.tabIndex = 0;
    host.prepend(this.renderer.domElement);
    // An imported map is seen through its windows: a pale sky, and no haze inside a 40 m hall.
    this.scene.background = new THREE.Color(this.workshop ? '#c9d4d8' : '#9baaa5');
    // The Aim Botz yard is 48 m deep: keep the far bots out of the haze.
    this.scene.fog = this.workshop ? new THREE.Fog('#c9d4d8', 90, 180) : this.botz ? new THREE.Fog('#9baaa5', 60, 120) : new THREE.Fog('#9baaa5', 36, 75);
    this.scene.add(new THREE.HemisphereLight('#f5f7ef', '#4d5d55', 2));
    this.scene.add(new THREE.AmbientLight('#bec9c3', .7));
    const sun = new THREE.DirectionalLight('#fff4dc', 2.4);
    sun.position.set(-9, 18, 8); this.scene.add(sun);
    this.viewScene.add(new THREE.HemisphereLight('#ffffff', '#66675b', 1.4));
    const viewLight = new THREE.DirectionalLight('#fff2dd', 2); viewLight.position.set(-2, 4, 2); this.viewScene.add(viewLight);
    this.viewScene.add(this.viewRoot);
    if (this.workshop) this.loadWorkshopModel(); else this.buildHall();
    if (this.botz?.map === 'island') this.markIsland(); else if (this.botz?.map === 'yard') this.markDistances();
    this.scene.add(this.actors, this.covers, this.dynamicCovers, this.effects,this.actorShadows.group);
    this.audio.setAcoustics(this.acoustics);
    this.shotEffects = new ShotEffects(this.effects); this.viewFlashes = new MuzzleFlashes(this.viewScene, 2);
    this.blood = new BloodEffects(this.effects);
    this.rebuildCovers();
    this.bindInput();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.resize();
    void this.loadTarget(); void this.loadViewModel(loadoutWeapon(settings));
    this.report();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  /** The duel hall: floor, walls, lamps and trim, scaled to the arena. */
  private buildHall() {
    const floorMaterial = surface('#a5aea3');
    const floorTexture = new THREE.TextureLoader().load('/textures/floor.webp');
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(12, 16);
    floorMaterial.map = floorTexture;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(24, .18, 32), floorMaterial);
    floor.position.set(0, -.1, -4); this.scene.add(floor);
    const wallMaterial = surface('#899891');
    const wallTexture = new THREE.TextureLoader().load('/textures/wall.webp');
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    wallTexture.wrapS = wallTexture.wrapT = THREE.RepeatWrapping;
    wallTexture.repeat.set(5, 2);
    wallMaterial.map = wallTexture;
    for (const [x, z, sx, sz] of [[-12, -4, .35, 32], [12, -4, .35, 32], [0, -20, 24, .35], [0, 12, 24, .35]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 4, sz), wallMaterial);
      wall.position.set(x, 2, z); this.scene.add(wall);
    }
    const postMaterial = surface('#506d70', .5);
    const lampMaterial = new THREE.MeshBasicMaterial({color: '#e6dfb5'});
    for (const side of [-1, 1]) {
      for (const z of [-15, -8, -1, 6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(.22, 4.4, .22), postMaterial);
        post.position.set(side * 11.7, 2.2, z); this.scene.add(post);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.1, .06, .3),
          lampMaterial);
        lamp.position.set(side * 10.9, 4.25, z); this.scene.add(lamp);
      }
    }
    this.decorateShell();
    const lane = new THREE.Mesh(new THREE.BoxGeometry(.08, .005, 30), surface('#c5c7a6'));
    lane.position.set(0, .002, -4); this.scene.add(lane);
    for (const object of [...this.scene.children]) if (object instanceof THREE.Mesh) this.shell.add(object);
    this.shell.scale.set(this.config.arenaScale, 1, this.config.arenaScale);
    this.scene.add(this.shell); batchStaticMeshes(this.shell);
  }

  /** An imported map's world, exported by tools/import-map.mjs. It never moves, so its matrices are set once. */
  private loadWorkshopModel() {
    const map = this.workshop?.workshop;
    if (!map) return;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.loadAsync(map.model).then(async ({scene}) => {
      try {await applyMapPresentation(scene, map.name);}
      catch (error) {disposeResources([scene]); throw error;}
      if (this.disposed) {disposeResources([scene]); return;}
      scene.traverse(object => {object.matrixAutoUpdate = false; object.updateMatrix();});
      scene.updateMatrixWorld(true);
      this.scene.add(scene); this.workshopModel = scene;
      this.report();
    }).catch(() => {
      if (!this.disposed) this.onError(`The ${map.name} map model is unavailable. Run node tools/import-map.mjs with the map's .vpk, then reload.`);
    });
  }

  /** Ragdolls test at most 128 boxes: on an imported map, the ones nearest the body. */
  private deathBoxes(near?: Vec) {
    const boxes = this.sim.arena.solids.filter(blocksMovement);
    if (!this.sim.arena.workshop || !near || boxes.length <= 128) return boxes;
    const gap = (box: Solid) => Math.hypot(Math.max(0, Math.abs(near.x - box.center.x) - box.size.x / 2),
      Math.max(0, Math.abs(near.y - box.center.y) - box.size.y / 2), Math.max(0, Math.abs(near.z - box.center.z) - box.size.z / 2));
    return boxes.map(box => ({box, gap: gap(box)})).sort((a, b) => a.gap - b.gap).slice(0, 128).map(({box}) => box);
  }

  private createSimulation() {
    const seed = seedForDesign(this.seed++, this.config.mapDesign);
    // Deathmatch plays AI Duel bots on the imported map; round-based duels keep their authored arenas.
    const arena = !this.botz ? (this.workshop && this.config.respawnSeconds > 0 ? this.workshop : duelArena(seed, this.config.arenaScale))
      : this.botz.map === 'island' ? reflexArena(this.botz) : this.workshop ?? botzArena();
    const simulation = new DuelSimulation(this.config, seed, arena, this.settings.weapon, this.settings.sidearm, this.settings.primaryEnabled, this.botz);
    this.botzRecorded = false; this.arrivalsShown = 0;
    simulation.playerAspect = this.camera.aspect;
    return simulation;
  }

  private rebuildCovers() {
    disposeResources([this.covers,this.dynamicCovers]);
    this.covers.clear();this.dynamicCovers.clear();
    const materials = {
      concrete: surface('#697a77'), cargo: surface('#465f64', .64), crate: surface('#967b59', .79),
      barrier: surface('#b3ad91'), cap: surface('#a8b7b1', .55), trim: surface('#354e52', .55),
      hazard: surface('#ddbf70', .62), crateEdge: surface('#654e38'),
      glass:new THREE.MeshStandardMaterial({color:'#88b9bb',transparent:true,opacity:.35,roughness:.15,depthWrite:false}),
      water:new THREE.MeshStandardMaterial({color:'#3d767a',transparent:true,opacity:.62,roughness:.28,depthWrite:false}),
    };
    // An imported map's boxes are invisible collision: its model is what you see.
    if (!this.sim.authoredArena.workshop) for (const solid of this.sim.authoredArena.solids) if(!solid.interaction&&solid.active!==false) addArenaCover(solid, this.covers, materials);
    for (const volume of this.sim.arena.traversalVolumes??[])addArenaTraversal(volume,this.covers,materials);
    this.environmentModels=createEnvironmentRenderMap(this.sim.authoredArena,this.dynamicCovers,materials);
    batchStaticMeshes(this.covers);
    this.environmentRevision=-1;this.syncEnvironment();
  }

  private syncEnvironment() {
    if(this.environmentRevision===this.sim.environment.revision)return;
    this.environmentRevision=this.sim.environment.revision;
    syncEnvironmentRenderMap(this.environmentModels,this.sim.environment);
    this.acoustics.setBoxes(acousticSolids(this.sim.arena));
    for(const [id,animator] of this.animators)animator.setDeathWorld({floor:0,boxes:this.deathBoxes(this.sim.actors[id]?.position)});
  }

  private decorateShell() {
    const steel = surface('#344647', .53);
    const trim = surface('#889794', .57);
    const amber = surface('#d2ad61', .65);
    const panel = surface('#52615c', .73);
    const lamp = new THREE.MeshBasicMaterial({color: '#e9ecdc'});
    const add = (size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position); this.scene.add(mesh);
      return mesh;
    };
    add([24, .22, 32], [0, 5.9, -4], new THREE.MeshBasicMaterial({color: '#677873'}));
    for (const z of [-19, -14, -9, -4, 1, 6, 11]) {
      add([24, .26, .16], [0, 5.68, z], steel);
      for (const x of [-8, 0, 8]) {
        add([2.6, .06, .48], [x, 5.51, z], steel);
        add([2.35, .02, .34], [x, 5.47, z], lamp);
      }
    }
    for (const x of [-11.72, 11.72]) {
      for (const z of [-17, -11, -5, 1, 7]) {
        add([.32, 5.45, .42], [x, 2.72, z], steel);
        add([.54, .12, .64], [x, .06, z], trim);
        add([.37, 1.1, .48], [x, .68, z], amber);
      }
      add([.08, .08, 30], [x * .91, 3.75, -4], trim);
      for (const z of [-15, -5, 5]) {
        add([.08, 1.55, .76], [x * .98, .82, z], panel);
        for (let slot = 0; slot < 5; slot++) add([.09, .022, .56], [x * .975, .38 + slot * .19, z], steel);
      }
    }
    for (const side of [-1, 1]) for (const z of [-11, 3]) {
      add([1.4, .02, 3.1], [side * 9.6, .015, z], trim);
      add([.11, .02, 3.1], [side * 8.85, .03, z], amber);
    }
    for (const z of [-19.79, 11.79]) {
      add([2.6, 3.3, .04], [0, 1.66, z], steel);
      add([2.28, 3.04, .045], [0, 1.55, z + (z < 0 ? .03 : -.03)], panel);
      add([2.6, .12, .07], [0, 3.36, z + (z < 0 ? .04 : -.04)], amber);
    }
  }

  /** Floor lines every 10 m from the Aim Botz spawn, labelled on the left. */
  private markDistances() {
    const markers = new THREE.Group(), line = new THREE.MeshBasicMaterial({color: '#d8d2a8', transparent: true, opacity: .5});
    for (const distance of [10, 20, 30, 40]) {
      const z = BOTZ_PLAYER_SPAWN.z - distance;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(34, .004, .05), line);
      mesh.position.set(0, .004, z); markers.add(mesh);
      const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#ece6c0'; context.font = 'bold 38px sans-serif';
        context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(`${distance} m`, 64, 34);
      }
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .8),
        new THREE.MeshBasicMaterial({map: texture, transparent: true, opacity: .75, depthWrite: false}));
      label.rotation.x = -Math.PI / 2; label.position.set(-15.5, .006, z + .5); markers.add(label);
    }
    this.scene.add(markers);
  }

  /** Reflex: the island, marked on the floor, then a dark band ending in an amber line. A bot that reaches the line has
   * reached you. */
  private markIsland() {
    const marks = new THREE.Group(), {x, z} = REFLEX_ISLAND, inner = REFLEX_ISLAND_HALF, outer = REFLEX_REACH, width = outer - inner;
    const island = new THREE.MeshBasicMaterial({color: '#c9cfc4', transparent: true, opacity: .35, depthWrite: false});
    const edge = new THREE.MeshBasicMaterial({color: '#e6e3d2', transparent: true, opacity: .7});
    const band = new THREE.MeshBasicMaterial({color: '#28322f', transparent: true, opacity: .45, depthWrite: false});
    const line = new THREE.MeshBasicMaterial({color: '#d2ad61'});
    const add = (size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position); marks.add(mesh);
    };
    add([inner * 2, .004, inner * 2], [x, .003, z], island);
    for (const side of [-1, 1]) {
      add([inner * 2 + .05, .006, .05], [x, .005, z + side * inner], edge);
      add([.05, .006, inner * 2 + .05], [x + side * inner, .005, z], edge);
      add([outer * 2, .004, width], [x, .003, z + side * (inner + width / 2)], band);
      add([width, .004, inner * 2], [x + side * (inner + width / 2), .003, z], band);
      add([outer * 2 + .08, .006, .08], [x, .005, z + side * outer], line);
      add([.08, .006, outer * 2 + .08], [x + side * outer, .005, z], line);
    }
    this.scene.add(marks);
  }

  private async loadTarget() {
    const revision = ++this.agentRevision;
    try {
      const profile=this.progression?.getSnapshot().profile;
      const id = profile ? equippedCosmetic(profile,cosmeticCatalog,'agent')?.id : undefined;
      const instance = id && id !== 'agent-standard' ? await loadAgent(id, undefined, this.actorLoader) : undefined;
      const {scene, animations} = instance ?? await new GLTFLoader().loadAsync('/models/target.glb');
      if (this.disposed || revision !== this.agentRevision) {if (instance) instance.dispose(); else disposeResources([scene]); return;}
      const oldScene = this.targetScene, oldInstance = this.agentInstance;
      this.agentInstance = instance;
      this.targetScene = scene; this.targetClips = animations;
      this.rebuildActors();
      if (oldInstance) oldInstance.dispose(); else if (oldScene) disposeResources([oldScene]);
      this.loadWorldWeapons();
      try {
        const motion = await new GLTFLoader().loadAsync('/models/duel-motion.glb?v=extended-actions-2');
        if (this.disposed || revision !== this.agentRevision) {disposeResources([motion.scene]);return;}
        this.targetClips = motion.animations;
        this.motionReady = true;
        this.rebuildActors();
      } catch { /* Keep the baseline idle/run set if local native clips are absent. */ }
      try {
        const flinch = await new GLTFLoader().loadAsync('/models/duel-flinch.glb?v=1');
        const animations = nativeGestureClips(flinch); disposeResources([flinch.scene]);
        if (this.disposed || revision !== this.agentRevision) return;
        this.flinchClips = animations;
        for (const animator of this.animators.values()) animator.addFlinchClips(animations);
      } catch { /* Bots show no hit reaction without the local flinch pack. */ }
      this.sceneLoaded = true;
      void this.preloadViewModels();
    } catch { if (!this.disposed) this.onError('The player model is unavailable. Run npm run assets:build, then reload.'); }
  }

  private rebuildActors() {
    this.animators.forEach(animator => animator.dispose()); this.animators.clear();
    this.animationTimes.clear();
    this.botMuzzles.clear();
    disposeSkeletons(this.actors);
    this.actors.clear(); this.models.clear(); this.heldWeapons.clear(); this.generations.clear();
    this.hitboxPoses.clear();
    if (!this.targetScene) return;
    for (const actor of this.sim.snapshot().slice(1)) this.buildActor(actor);
  }

  private buildActor(actor: DuelActorSnapshot) {
    const root = new THREE.Group();
    const model = cloneSkeleton(this.targetScene!);
    const hitboxes = NativeHitboxPose.bind(model);
    if (hitboxes) this.hitboxPoses.set(actor.id, hitboxes);
    const held = this.attachWorldWeapon(model, actor.equipment);
    if (held) {held.visible = actor.alive; this.heldWeapons.set(actor.id, held);}
    const muzzle = held ? muzzleAnchor(held) : undefined;
    if (muzzle) this.botMuzzles.set(actor.id, muzzle);
    root.add(model); this.actors.add(root); this.models.set(actor.id, root);
    const animator=new DuelAnimator(model, this.targetClips, (actor.id * .317) % 1, actor.equipment);
    animator.addGestureClips(this.gestureClips.get(actor.equipment)??[]);
    animator.addFlinchClips(this.flinchClips);
    animator.setDeathWorld({floor:0,boxes:this.deathBoxes(actor.position)});
    this.animators.set(actor.id,animator);
    this.generations.set(actor.id, actor.generation);
  }

  /** Aim Botz respawns reuse the actor id: replace the ragdoll with a fresh model. */
  private respawnActor(actor: DuelActorSnapshot) {
    const old = this.models.get(actor.id);
    this.animators.get(actor.id)?.dispose(); this.animators.delete(actor.id);
    if (old) {disposeSkeletons(old); this.actors.remove(old);}
    this.models.delete(actor.id); this.heldWeapons.delete(actor.id); this.botMuzzles.delete(actor.id);
    this.hitboxPoses.delete(actor.id);
    this.deaths.delete(actor.id); this.animationTimes.delete(actor.id);
    if (this.targetScene) this.buildActor(actor);
  }

  private loadWorldWeapons() {
    for (const weapon of new Set(this.sim.snapshot().slice(1).map(actor => actor.equipment))) {
      this.loadGesturePack(weapon);
      const cached = this.worldWeapons.get(weapon);
      if (cached) {this.worldWeapons.delete(weapon); this.worldWeapons.set(weapon, cached); continue;}
      if (this.worldLoading.has(weapon)) continue;
      this.worldLoading.add(weapon);
      void new GLTFLoader().loadAsync(`/models/${weapon}.glb`).then(({scene}) => {
        if (this.disposed) {disposeResources([scene]); return;}
        this.worldWeapons.set(weapon, scene);
        this.rebuildActors();
        this.trimWorldWeapons();
      }).catch(() => {
        if (!this.disposed) this.onError(`The ${weapon} world model is unavailable. Run npm run assets:build, then reload.`);
      }).finally(() => this.worldLoading.delete(weapon));
    }
    this.trimWorldWeapons();
  }

  private loadGesturePack(equipment:Equipment) {
    if(this.gestureClips.has(equipment)||this.gestureLoading.has(equipment))return;
    this.gestureLoading.add(equipment);
    void new GLTFLoader().loadAsync(`/models/duel-gestures/${equipment}.glb`).then(asset=>{
      const {scene} = asset, animations = nativeGestureClips(asset);
      disposeResources([scene]);
      if(this.disposed)return;
      this.gestureClips.set(equipment,animations);
      for(const actor of this.sim.snapshot().slice(1))if(actor.equipment===equipment)
        this.animators.get(actor.id)?.addGestureClips(animations);
      const active=new Set(this.sim.snapshot().map(actor=>actor.equipment));
      for(const id of this.gestureClips.keys())if(this.gestureClips.size>8&&!active.has(id))this.gestureClips.delete(id);
    }).catch(()=>{/* Keep native locomotion when an action has no imported world clip. */})
      .finally(()=>this.gestureLoading.delete(equipment));
  }

  private trimWorldWeapons() {
    const active = new Set(this.sim.snapshot().slice(1).map(actor => actor.equipment));
    for (const drop of this.sim.drops) if (!drop.picked) active.add(drop.equipment);
    for (const [weapon, scene] of this.worldWeapons) {
      if (this.worldWeapons.size <= 8) break;
      if (active.has(weapon)) continue;
      this.worldWeapons.delete(weapon); disposeResources([scene]);
    }
  }

  private attachWorldWeapon(model: THREE.Object3D, weapon: Equipment) {
    // GLTFLoader sanitizes periods in animation node names. Blender adds the .001
    // suffix only when the assembly session already held an object of that name.
    const held = model.getObjectByName('held_weapon_target001') ?? model.getObjectByName('held_weapon_target.001')
      ?? model.getObjectByName('held_weapon_target');
    if (weapon === 'm4a1s' && held) return held;
    const mount = model.getObjectByName('wpn');
    const source = this.worldWeapons.get(weapon);
    if (!mount || !source) return held;
    if (held) held.visible = false;
    const replacement = source.clone(true);
    replacement.name = `held_${weapon}`;
    new THREE.Matrix4().fromArray(weaponMounts.mounts[weapon].inverseBind).decompose(
      replacement.position, replacement.quaternion, replacement.scale);
    mount.add(replacement);
    return replacement;
  }

  private async loadViewModel(weapon: Equipment) {
    this.renderedEquipment = weapon;
    const revision = ++this.viewRevision;
    try {
      const entry = await this.viewModel(weapon);
      if (this.disposed || revision !== this.viewRevision) return;
      this.viewRoot.clear(); this.viewRoot.add(entry.scene);
      this.viewAnimation = entry.animation;
      this.viewMuzzle = entry.muzzle;
      const duration = Math.max(.01, this.sim.actors[0].equipReadyAt - this.sim.time);
      if (this.pickupDrawing) entry.animation.playPickup(duration); else entry.animation.playDraw(duration);
      this.pickupDrawing = false;
      this.trimViewModels();
      if (this.sceneLoaded) void this.preloadViewModels();
    } catch { if (!this.disposed && revision === this.viewRevision) this.onError('The weapon model is unavailable. Run npm run assets:build, then reload.'); }
  }

  private viewModel(weapon: Equipment) {
    const profile = this.progression?.getSnapshot().profile;
    const asset = profile ? cosmeticAsset(profile, weapon) : weapon;
    // A model wears its own finish and the gloves; other equip changes leave it valid.
    const key = `${asset}|${profile?.equipped[weapon] ?? ''}|${profile?.equipped.gloves ?? ''}`, cached = this.viewModels.get(weapon);
    if (cached?.key === key) return cached.model;
    if (cached) this.retiredViewModels.push(cached.model);
    const model = this.buildViewModel(weapon, asset, profile);
    this.viewModels.set(weapon, {key, model});
    model.catch(() => {if (this.viewModels.get(weapon)?.model === model) this.viewModels.delete(weapon);});
    return model;
  }

  private async buildViewModel(weapon: Equipment, asset: string, profile?: ProgressionProfile): Promise<ViewModel> {
    const {scene, animations} = await new GLTFLoader().loadAsync(`/models/view-${asset}.glb`);
    prepareNativeViewAssembly(scene);
    try {if (profile) await applyCosmetic(scene, profile, weapon);}
    catch {disposeResources([scene]); throw new Error('Cosmetic could not load');}
    if (this.disposed) {disposeResources([scene]); throw new Error('Engine disposed');}
    scene.rotation.y = Math.PI;
    const muzzle = muzzleAnchor(scene);
    if (weapon === 'elite') {muzzleAnchor(scene, 'left'); muzzleAnchor(scene, 'right');}
    // Upload textures and compile shaders now rather than on the first frame after a switch.
    scene.traverse(node => {
      if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material])
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) this.renderer.initTexture(value);
    });
    await this.renderer.compileAsync(scene, this.viewCamera, this.viewScene);
    if (this.disposed) {disposeResources([scene]); throw new Error('Engine disposed');}
    return {scene, animation: new ViewAnimation(scene, animations), muzzle};
  }

  private loadoutEquipment(): Equipment[] {
    const {primary, sidearm} = this.sim.loadout;
    return [primary, sidearm, 'knife', 'zeus'].filter((id): id is Equipment => !!id);
  }

  /** Prepares the rest of the loadout in the background, one model at a time. */
  private async preloadViewModels() {
    if (this.preloadingViewModels) return;
    this.preloadingViewModels = true;
    try {
      for (const weapon of this.loadoutEquipment()) {
        if (this.disposed) return;
        await this.viewModel(weapon).catch(() => undefined);
      }
    } finally {this.preloadingViewModels = false;}
  }

  /** Frees models dropped from the loadout or replaced by another finish, once they are off screen. */
  private trimViewModels() {
    const loadout = new Set(this.loadoutEquipment());
    for (const [weapon, entry] of this.viewModels) if (!loadout.has(weapon) && weapon !== this.renderedEquipment) {
      this.viewModels.delete(weapon); this.retiredViewModels.push(entry.model);
    }
    const retired = this.retiredViewModels;
    this.retiredViewModels = [];
    for (const model of retired) void model.then(entry => {
      if (entry.scene.parent) {this.retiredViewModels.push(model); return;}
      entry.animation.dispose(); disposeResources([entry.scene]);
    }, () => undefined);
  }

  async refreshCosmetics() {
    const key = JSON.stringify(this.progression?.getSnapshot().profile.equipped);
    if (key === this.cosmeticKey) return;
    const oldAgent = JSON.parse(this.cosmeticKey || '{}')?.agent;
    this.cosmeticKey = key;
    if (oldAgent !== this.progression?.getSnapshot().profile.equipped.agent) await this.loadTarget();
    await this.loadViewModel(this.sim.actors[0].weapon.id);
  }

  private attemptSetup(): DuelAttemptSetup {
    return {playerHealth: this.config.playerHealth, playerArmor: this.config.playerArmor,
      bots: this.sim.actors.slice(1).map((actor, index) => ({id: String(actor.id), ...botConfig(this.config, index)}))};
  }

  private beginProgression() {
    // Passive Aim Botz rounds and endless deathmatch sessions do not count toward duel achievements.
    if (this.botz || this.sim.deathmatch) return;
    this.attemptDamage.clear();
    this.attemptId = this.progression?.beginDuel(this.attemptSetup(), String(this.attemptRevision)) ?? null;
  }

  setSettings(settings: Settings) {
    if (settings === this.settings) return;
    this.binds.setProfile(settings.keyboard);
    this.applyViewmodel(settings.viewmodel);
    this.shortcuts.codes = protectedCodes(settings.keyboard.binds);
    const weaponChanged = settings.weapon !== this.settings.weapon || settings.sidearm !== this.settings.sidearm || settings.primaryEnabled !== this.settings.primaryEnabled;
    const qualityChanged = settings.quality !== this.settings.quality;
    this.settings = settings;
    if (weaponChanged) void this.loadViewModel(loadoutWeapon(settings));
    if (weaponChanged) this.restart();
    if (qualityChanged) this.metrics.resetResolution();
    this.meter.configure(settings.showFps);
    this.resize();
  }

  /** CS2 viewmodel_fov / viewmodel_offset_*: the arms camera and weapon placement. */
  private applyViewmodel(viewmodel: Viewmodel) {
    this.viewOffset = viewmodelOffset(viewmodel);
    const fov = viewmodelFov(viewmodel.fov);
    if (this.viewCamera.fov !== fov) {this.viewCamera.fov = fov; this.viewCamera.updateProjectionMatrix();}
  }

  setConfig(config: DuelConfig) {
    if (config === this.config || this.botz) return;
    // Radar display settings apply live; everything else starts a new round.
    const round = (value: DuelConfig) => JSON.stringify({...value, radarEnabled: 0, radarRotate: 0, radarScale: 0});
    const radarOnly = round(config) === round(this.config);
    this.config = config;
    if (!radarOnly) this.restart();
  }

  setBotz(botz: BotzConfig) {
    if (!this.botz) return;
    const next = sanitizeBotzConfig(botz);
    if (JSON.stringify(next) === JSON.stringify(this.botz)) return;
    this.botz = next; this.config = botzDuelConfig(next);
    this.restart();
  }

  /** Saves an Aim Botz session once: when time runs out, or on a new session or exit. */
  private recordBotz() {
    if (!this.botz || this.botzRecorded) return;
    const summary = botzSummary(this.sim.botzStats, this.sim.time, this.botz.sessionSeconds);
    if (!summary.shots && !summary.kills) return;
    this.botzRecorded = true;
    this.botzHistory = [{date: new Date().toISOString(), weapon: loadoutWeapon(this.settings), distance: this.botz.distance,
      movement: this.botz.movement, headshotOnly: this.botz.headshotOnly, seconds: summary.seconds, kills: summary.kills,
      headshotRate: summary.headshotRate, accuracy: summary.accuracy, killsPerMinute: summary.killsPerMinute,
      ...(this.botz.map === 'island' ? {leaks: summary.leaks} : {})}, ...this.botzHistory].slice(0, 50);
    saveBotzHistory(this.botzHistory, this.botz.map);
  }

  restart(continuous = false) {
    this.recordBotz();
    if (this.attemptId) this.progression?.cancelAttempt(this.attemptId);
    this.attemptId = null; this.attemptRevision++;
    this.paused = false; this.pointer = null; this.pickupDrawing = false; this.viewAnimation?.cancel();
    for (const object of this.dropModels.values()) this.scene.remove(object);
    this.dropModels.clear();
    if (!continuous) {
      this.binds.releaseAll(); this.bindHandle?.reset();
      this.sessionStarted = false;
      this.releaseShortcuts();
      if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    }
    this.sim = this.createSimulation(); this.viewAir.reset(); this.inputClock.reset(performance.now()); this.kills = this.damage = 0;
    this.shell.scale.set(this.config.arenaScale, 1, this.config.arenaScale);
    this.damageFeedback.clear(); this.wasReloading = false;
    this.roundFlow.reset(); this.deaths.clear(); this.playerGeneration = 1;
    this.caption = ''; this.captionUntil = 0; this.kick = 0; this.killFeed.clear();
    this.audio.stopVoices();this.clearEffects(); this.rebuildCovers(); this.rebuildActors(); this.report();
    this.loadWorldWeapons();
    if (continuous) {this.sim.start(); this.beginProgression(); this.updateMovement(); this.report();}
  }

  /** Aim Botz: save the finished session and start the next one straight away. */
  newSession() {
    this.restart(); void this.enter();
  }

  async enter() {
    if (this.disposed || this.entering) return;
    const revision = ++this.enterRevision; this.entering = true;
    if (this.sim.phase === 'ready') {this.sim.start(); this.beginProgression();} else this.sim.resume();
    this.sessionStarted = true;
    this.paused = false;
    this.inputClock.reset(performance.now());
    this.renderer.domElement.focus({preventScroll: true});
    const coarse = matchMedia('(pointer: coarse)').matches;
    const supported = typeof this.renderer.domElement.requestPointerLock === 'function';
    this.inputName = coarse ? 'Touch' : 'Mouse';
    const pointerLock = !coarse ? requestRawLock(this.renderer.domElement) : Promise.resolve<'drag'>('drag');
    const fullscreen = this.settings.autoFullscreen && !coarse ? requestStageFullscreen(this.stage) : undefined;
    const protect = !coarse && supported && this.config.shortcutProtection;
    const guard = protect && fullscreen ? this.shortcuts.enter(protect, fullscreen) : this.shortcuts.enter(protect);
    void this.audio.unlock(this.settings.weapon);
    void this.audio.unlock(this.settings.sidearm); void this.audio.unlock('knife');
    for (const actor of this.sim.actors.slice(1)) if (actor.weapon.id !== this.settings.weapon) void this.audio.unlock(actor.weapon.id);
    try {
      const mode = await pointerLock;
      await guard;
      if (revision !== this.enterRevision || this.disposed || this.paused) return;
      if (!coarse && supported && (mode === 'drag' || document.pointerLockElement !== this.renderer.domElement)) {
        this.pause(); this.inputName = 'Mouse capture blocked. Click Resume duel again.';
      } else this.inputName = coarse ? 'Touch' : !supported ? 'Drag aim (mouse capture unsupported)' : mode === 'raw' ? 'Raw mouse' : 'Standard mouse';
      this.report();
    } finally {
      if (revision === this.enterRevision) this.entering = false;
      if ((this.disposed || this.paused) && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    }
  }

  private releaseShortcuts() {
    this.enterRevision++; this.entering = false;
    this.shortcuts?.release();
  }

  pause() {
    if (this.sim.phase === 'ready') return;
    this.paused = true; this.sim.pause(); this.binds.releaseAll(); this.bindHandle?.reset(); this.updateMovement();
    this.caption = ''; this.captionUntil = 0;
    this.damageFeedback.clear();
    this.releaseShortcuts();
    this.sim.command(0, {fireHeld: false});
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.report();
  }

  private listen(target: EventTarget, name: string, callback: EventListener, options?: AddEventListenerOptions) {
    target.addEventListener(name, callback, options); this.cleanup.push(() => target.removeEventListener(name, callback, options));
  }

  private bindInput() {
    const canvas = this.renderer.domElement;
    this.listen(canvas, 'pointerdown', ((event: PointerEvent) => {
      if (event.button !== 0) return;
      if (this.botz && this.sim.phase === 'result') { this.newSession(); return; }
      if (this.sim.phase === 'ready' || this.paused) { void this.enter(); return; }
      if (this.sim.phase !== 'fighting') return;
      this.pointer = event.pointerId; this.pointerX = event.clientX; this.pointerY = event.clientY;
      // Mouse buttons fire through their binds; touch fires directly.
      if (event.pointerType !== 'mouse') {
        this.syncInput(event.timeStamp, true);
        this.sim.command(0, {firePressed: true}); this.sim.processInput();
      }
      if (!document.pointerLockElement) canvas.setPointerCapture(event.pointerId);
    }) as EventListener);
    // Capture look before the bind listener handles a chorded button edge on
    // the same pointer event; a flick's final delta belongs to that click.
    this.listen(window, 'pointermove', ((event: PointerEvent) => {
      if (this.sim.phase !== 'fighting' || this.paused) return;
      this.syncInput(event.timeStamp);
      let dx = 0, dy = 0;
      if (document.pointerLockElement === canvas && event.pointerType === 'mouse') {
        dx = event.movementX; dy = event.movementY;
      } else if (this.pointer === event.pointerId) {
        dx = event.clientX - this.pointerX; dy = event.clientY - this.pointerY;
        this.pointerX = event.clientX; this.pointerY = event.clientY;
      }
      const actions = this.sim.actors[0].weapon.actions;
      const mouse = event.pointerType === 'mouse';
      const scale = (mouse ? mouseAngle(1, this.settings.sensitivity) : .0025) *
        actions.sensitivityAt(this.sim.time + this.sim.accumulator, mouse ? this.settings.keyboard.zoomSensitivity : 1);
      if (dx || dy) this.sim.command(0, {yawDelta: -dx * scale,
        pitchDelta: -dy * scale * (this.settings.invertY ? -1 : 1)});
    }) as EventListener, {capture: true});
    this.listen(document, 'pointerup', ((event: PointerEvent) => {
      if (this.pointer !== event.pointerId) return;
      this.pointer = null;
      if (event.pointerType !== 'mouse') this.sim.command(0, {fireHeld: false});
    }) as EventListener);
    this.listen(canvas, 'pointercancel', (() => this.pause()) as EventListener);
    this.listen(canvas, 'contextmenu', (event => event.preventDefault()) as EventListener);
    this.bindHandle = attachBindInput({canvas, runtime: this.binds, active: () => this.sim.phase !== 'ready' && !this.paused,
      beforeInput: timestamp => this.syncInput(timestamp, true), afterInput: () => {if (!this.paused) this.sim.processInput();},
      listen: (target, type, listener, options) => this.listen(target, type, listener, options)});
    this.listen(window, 'keydown', ((event: KeyboardEvent) => {
      if (event.ctrlKey && event.code === 'KeyW' && this.sessionStarted) event.preventDefault();
      if (event.code === 'Escape' && this.sim.phase !== 'ready') this.pause();
    }) as EventListener);
    this.listen(window, 'blur', (() => {if (!this.entering) this.pause();}) as EventListener);
    this.listen(document, 'visibilitychange', (() => {if (document.hidden) this.pause();}) as EventListener);
    this.listen(document, 'pointerlockchange', (() => {
      if (this.entering) return;
      if (document.pointerLockElement !== canvas && this.inputName !== 'Drag aim' && this.sim.phase !== 'ready') this.pause();
    }) as EventListener);
    this.listen(document, 'fullscreenchange', (() => {
      if (!this.entering && this.shortcuts.protected && !document.fullscreenElement && this.sim.phase !== 'ready') this.pause();
    }) as EventListener);
  }

  private updateMovement() {
    const held = this.binds.isHeld.bind(this.binds);
    this.sim.command(0, {forward: +held('forward') - +held('back'), side: +held('right') - +held('left'),
      walk: held('walk'), crouch: held('duck'), jump: held('jump')});
  }

  private syncInput(timestamp: number, flush = false) {
    const now = inputTimestamp(timestamp);
    if (this.paused || this.sim.phase !== 'fighting') { this.inputClock.reset(now); return; }
    this.inputClock.advance(now, elapsed => this.sim.advance(elapsed));
    if (flush) this.sim.flushInput();
  }

  private onBind(event: BindEvent) {
    const fighting = this.sim.phase === 'fighting' && !this.paused;
    if (event.kind === 'press' || event.kind === 'release') {
      const down = event.kind === 'press';
      switch (event.action) {
        case 'attack':
          this.sim.command(0, down ? (fighting ? {fireHeld: true, firePressed: true} : {}) : {fireHeld: false});
          return;
        case 'attack2': this.sim.command(0, down ? (fighting ? {secondaryPressed: true, secondaryHeld: true} : {}) : {secondaryHeld: false}); return;
        case 'reload': this.sim.command(0, down ? {reloadPressed: true, reloadHeld: true} : {reloadHeld: false}); return;
        case 'inspect': if (down) this.inspect(); return;
        case 'use': if (down) {this.sim.command(0, {usePressed: true}); this.pickup();} return;
        case 'jump': if (down) this.sim.command(0, {jumpPressed: true});
      }
      this.updateMovement(); return;
    }
    if (event.kind === 'slot') {const slot = trainerSlot(event.slot, this.currentSlot()); if (slot) this.equip(slot);}
    else if (event.kind === 'lastinv') this.equip(this.lastSlot);
    else if (event.kind === 'invnext' || event.kind === 'invprev') this.equip(cycleSlot(this.currentSlot(), event.kind === 'invnext' ? 1 : -1, this.availableSlots()));
    else if (event.kind === 'drop') this.sim.command(0, {dropPressed: true});
    else if (event.kind === 'cancelselect') this.pause();
    else if (event.kind === 'console') this.onConsole?.(event.args);
  }

  private currentSlot(): Slot {
    const id = this.sim.actors[0].weapon.id;
    return id === 'knife' ? 3 : id === 'zeus' ? 4 : id === this.sim.loadout.sidearm ? 2 : 1;
  }

  private availableSlots(): Slot[] {
    const {primary, sidearm} = this.sim.loadout;
    return ([1, 2, 3, 4] as Slot[]).filter(slot => (slot !== 1 || !!primary) && (slot !== 2 || !!sidearm));
  }

  /** CS2's "Zoom Button Hold: Repeat Enabled" re-zooms while Secondary Fire stays held. */
  private repeatZoom() {
    const weapon = this.sim.actors[0].weapon;
    if (!this.settings.keyboard.zoomRepeat || this.paused || this.sim.phase !== 'fighting' || weapon.id === 'knife' || !gameData.weapons[weapon.id].zoomLevels) return;
    if (this.binds.isHeld('attack2') && this.sim.time >= weapon.actions.secondaryReadyAt) this.sim.command(0, {secondaryPressed: true});
  }

  equip(slot: Slot) {
    const current = this.currentSlot();
    if (current !== slot && this.availableSlots().includes(slot)) this.lastSlot = current;
    this.sim.command(0,{equipSlot:slot});if(this.sim.phase==='ready')this.sim.equipPlayer(slot); this.report(); this.renderer.domElement.focus({preventScroll: true});
  }
  pickup() {
    if(!this.sim.nearestPickup())return;
    this.pickupDrawing=true;this.sim.command(0,{pickupPressed:true});
    this.renderer.domElement.focus({preventScroll:true});
  }
  inspect() {const actor = this.sim.actors[0]; if (actor.alive && !actor.weapon.reloadUntil && !actor.command.fireHeld && this.sim.time >= actor.equipReadyAt) {
    if(this.viewAnimation?.playInspect())this.audio.playAction(0,this.sim.actors[0].weapon.id,'inspect',this.sim.time,{local:true,volume:this.settings.volume});
  }}
  secondary() {this.sim.command(0, {secondaryPressed: true});}

  private processEvents(events: DuelEvent[]) {
    if (!events.length) return;
    const shots = new Map<number, Extract<DuelEvent, {kind: 'fire'}>>();
    const endpoints = new Map<number, Vec[]>();
    const endpoint=(shotId:number,point:Vec)=>{
      const points=endpoints.get(shotId)??[];points.push(point);endpoints.set(shotId,points);
    };
    const player = this.sim.snapshot()[0];
    for (const event of events) {
      if(event.kind==='action') {
        const actor=this.sim.actors[event.actorId],local=event.actorId===0;
        const action=event.action==='reload-start'?(actor.weapon.reloadEmpty?'reload-empty':'reload'):
          event.action==='reload-cancel'?'cancel':event.action;
        if(!action.startsWith('reload'))this.audio.playAction(event.actorId,event.equipment,action,this.sim.time,
          {local,silent:event.silent,volume:this.settings.volume,spatial:local?undefined:this.soundLocation(actor.position)});
        this.animators.get(event.actorId)?.playAction(event.equipment,action,{crouched:(actor.duckAmount??0)>.5,
          duration:action.startsWith('reload')?equipmentStats(event.equipment).reload:undefined});
      }else if(event.kind==='environment') {
        if(event.action==='break')this.audio.playImpact(this.sim.authoredArena.solids.find(solid=>solid.id===event.environmentId)?.material==='glass'?'glass':'metal',
          this.settings.volume*.6,this.soundLocation(event.point));
      }else if (event.kind === 'pickup') {
        const model = this.dropModels.get(event.dropId);
        if (model) this.scene.remove(model);
        this.dropModels.delete(event.dropId);
      } else if (event.kind === 'fire') {
        shots.set(event.shotId, event);
        this.animators.get(event.actorId)?.playAction(event.equipment,event.alternate?'fire-alt':'fire',
          {side:this.sim.actors[event.actorId].weapon.ammo%2?'right':'left',lastShot:this.sim.actors[event.actorId].weapon.ammo===0});
        if (event.actorId === 0) {
          const weapon = this.sim.actors[0].weapon;
          this.viewAnimation?.playFire(event.equipment,{side:weapon.ammo%2?'right':'left',lastShot:weapon.ammo===0,alternate:weapon.actions.alternateFire,zoomed:weapon.actions.zoom>0});
          this.kick = 1;
        }
        const location=event.actorId===0?undefined:this.soundLocation(event.origin);
        if(event.equipment==='knife')this.audio.playKnife(event.alternate?'stab':'slash',this.settings.volume,location);
        else this.audio.play(event.equipment,this.settings.volume,location);
        this.audio.playAction(event.actorId,event.equipment,event.alternate?'fire-alt':'fire',this.sim.time,
          {local:event.actorId===0,volume:this.settings.volume,spatial:location});
      } else if (event.kind === 'sound') {
        const dx = event.point.x - player.position.x, dz = event.point.z - player.position.z;
        const distance = Math.hypot(dx, dz);
        const own = event.actorId === 0;
        if (distance < FOOTSTEP_RANGE) {
          const point = {...event.point, y: (this.sim.actors[event.actorId]?.feet ?? 0) + .06};
          const support = this.sim.arena.solids.find(solid => Math.abs(solid.center.y + solid.size.y / 2 - point.y + .06) < .05 &&
            Math.abs(point.x - solid.center.x) < solid.size.x / 2 + .2 && Math.abs(point.z - solid.center.z) < solid.size.z / 2 + .2);
          const material = support?.kind === 'crate' ? 'wood' : support?.kind === 'cargo' ? 'metal' : 'concrete';
          this.audio.playStep(this.settings.volume, 0, event.sound === 'landing',
            own ? undefined : this.soundLocation(point, FOOTSTEP_RANGE), material);
        }
      } else if (event.kind === 'surface') {
        endpoint(event.shotId,event.point);
        if(event.normal)this.shotEffects.surfaces.fire(event.point,event.normal,event.material,this.settings.impactSize,this.animationClock);
        else this.shotEffects.impact(v3(event.point),this.settings.impactSize,event.shooter===0?this.ownTraceColor:this.enemyTraceColor,this.animationClock);
        if(event.phase!=='exit')this.audio.playImpact(['wood','metal','glass'].includes(event.material??'')?event.material as 'wood'|'metal'|'glass':'concrete',
          this.settings.volume,this.soundLocation(event.point));
      }
      else if (event.kind === 'hit') {
        if (event.lethal) this.killFeed.add(event, shots.get(event.shotId)?.equipment ?? this.sim.actors[event.shooter]?.weapon.id ?? 'ak47', this.animationClock, id => {
          if (id === 0) return 'You';
          const behavior = !this.botz ? botConfig(this.config, id - 1).behavior : undefined;
          return `Bot ${id}${behavior && behavior !== 'mixed' ? ` · ${behavior[0].toUpperCase()}${behavior.slice(1)}` : ''}`;
        });
        endpoint(event.shotId,event.point);
        this.shotEffects.impact(v3(event.point),this.settings.impactSize,event.shooter===0?this.ownTraceColor:this.enemyTraceColor,this.animationClock);
        if (!event.lethal && !event.immune && event.victim !== 0) {
          const victim = this.sim.actors[event.victim], shooter = this.sim.actors[event.shooter];
          if (victim && shooter) this.animators.get(event.victim)?.flinch(event.group, attackSide(victim.yaw, victim.position, shooter.position),
            limbSide(victim.yaw, victim.position, event.point), flinchFamily(victim.weapon.id));
        }
        // Blood as hit feedback on a bot's body, along the bullet; a protected spawn bleeds nothing.
        if (!event.immune && event.victim !== 0) {
          const shooter = this.sim.actors[event.shooter], fire = shots.get(event.shotId);
          const direction = fire?.direction ?? (shooter ? {x: event.point.x - shooter.position.x, y: event.point.y - shooter.position.y, z: event.point.z - shooter.position.z} : {x: 0, y: 0, z: 1});
          this.blood.burst(event.point, direction, this.animationClock, event.group === 'head' ? 1.3 : 1);
        }
        // An Aim Botz bot may already have respawned when a frame runs several ticks.
        const down = event.lethal && !this.sim.actors[event.victim]?.alive;
        if(down)this.animationTimes.delete(event.victim);
        if (down && !this.deaths.has(event.victim)) this.deaths.set(event.victim, this.animationClock);
        if (down && event.victim > 0) {
          const held = this.heldWeapons.get(event.victim);
          if (held) held.visible = false;
        }
        if (event.shooter === 0) {
          this.attemptDamage.set(event.victim, (this.attemptDamage.get(event.victim) ?? 0) + event.healthDamage);
          this.audio.playHit(event.group === 'head', event.armorDamage > 0, false, this.settings.volume);
          this.damage += event.healthDamage;
          if (event.lethal) this.kills++;
          this.caption = event.group === 'head' ? 'HEADSHOT' : this.botz?.headshotOnly ? 'BODY - NO DAMAGE' : 'BODY HIT';
          this.captionUntil = this.animationClock + .65;
        } else if (event.victim === 0) {
          const source = this.sim.actors[event.shooter]?.position;
          if (source) this.damageFeedback.hit(player.position, source, event.healthDamage, this.animationClock);
          this.audio.playHit(event.group === 'head', event.armorDamage > 0, true, this.settings.volume);
          this.caption = `HIT -${Math.round(event.healthDamage)}`;
          this.captionUntil = this.animationClock + .65;
        }
        if (event.lethal) this.audio.playEvent('death', this.settings.volume,
          event.victim === 0 ? undefined : this.soundLocation(event.point));
      } else if (event.kind === 'round' && this.botz) {
        // A timed session is over: free the mouse so New session can be clicked.
        this.recordBotz();
        this.binds.releaseAll(); this.bindHandle?.reset(); this.updateMovement(); this.releaseShortcuts();
        this.sim.command(0, {fireHeld: false});
        if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
      } else if (event.kind === 'round') {
        this.roundFlow.finish();
        if (this.attemptId) this.progression?.completeDuel(this.attemptId, {
          completion: 'completed', outcome: event.outcome, activeSeconds:this.sim.time, review: this.sim.coach.review(),
          opponents: this.sim.actors.slice(1).map(actor => ({id: String(actor.id), healthDamage: this.attemptDamage.get(actor.id) ?? 0, killed: !actor.alive})),
        }, this.attemptSetup(), String(this.attemptRevision));
        this.attemptId = null;
        this.history.unshift({date: new Date().toISOString(), outcome: event.outcome, review: this.sim.coach.review()});
        this.history = this.history.slice(0, 50);
        try {localStorage.setItem('spraylab.duel.history.v1', JSON.stringify(this.history));} catch { /* Session-only history. */ }
      }
    }
    for (const [id, shot] of shots) {
      const count = this.shotCounts.get(shot.actorId) ?? 0;
      this.shotCounts.set(shot.actorId, count + 1);
      const trail = Math.min(shot.actorId === 0 ? 10 : 5,equipmentStats(shot.equipment).range*UNIT);
      let start: THREE.Vector3 | undefined;
      if (shot.actorId === 0 && this.viewMuzzle) {
        const ammo = this.sim.actors[0].weapon.ammo;
        const barrel = shot.equipment === 'elite' ? this.viewRoot.getObjectByName(`spraylab-muzzle-${ammo % 2 ? 'right' : 'left'}`) ?? this.viewMuzzle : this.viewMuzzle;
        this.viewFlashes.fire(barrel, shot.equipment, this.animationClock);
        this.viewScene.updateMatrixWorld(true);
        start = viewMuzzleToWorld(barrel.getWorldPosition(new THREE.Vector3()), this.viewCamera,
          this.camera, this.width, this.height);
      } else if (shot.actorId > 0) {
        const muzzle = this.botMuzzles.get(shot.actorId);
        this.shotEffects.flashes.fire(muzzle, shot.equipment, this.animationClock, true);
        muzzle?.updateWorldMatrix(true, false);
        start = muzzle?.getWorldPosition(new THREE.Vector3());
      }
      const points=endpoints.get(id)??[];
      const directions=shot.pelletDirections??[shot.direction];
      for(const direction of directions) {
      const matching=points.filter(point=>{
        const delta=v3(point).sub(v3(shot.origin));
        return delta.lengthSq()>.001&&delta.normalize().dot(v3(direction))>.99999;
      }).sort((a,b)=>v3(a).distanceToSquared(v3(shot.origin))-v3(b).distanceToSquared(v3(shot.origin)));
      const end=matching[0]??{x:shot.origin.x+direction.x*trail,y:shot.origin.y+direction.y*trail,z:shot.origin.z+direction.z*trail};
      if (start && shot.equipment !== 'knife') {
        const delta = v3(end).sub(start), length = delta.length();
        const endpointAhead = v3(end).sub(this.camera.position).dot(this.camera.getWorldDirection(new THREE.Vector3())) > .1;
        const obstruction = traceSolid(start, delta.clone().normalize(), this.sim.arena, length);
        if (length > .15 && endpointAhead && obstruction.distance >= length - .08) {
          // Practice tracers apply to your own shots; bots keep CS2's cadence.
          this.shotEffects.trace(shot.equipment, count, start, v3(end), this.animationClock,
            shot.actorId === 0 ? this.ownTraceColor : this.enemyTraceColor, shot.actorId === 0 ? this.settings.tracers : 'native');
        }
      }
      }
    }
  }

  private soundLocation(point: Vec, range = 55): SpatialSound {
    const delta = v3(point).sub(this.camera.position), distance = delta.length();
    return {position: point, range, occluded: distance > .1 &&
      traceSolid(this.camera.position, delta.normalize(), this.sim.arena, distance - .05).distance < distance - .05};
  }

  private clearEffects() {
    this.shotEffects.clear(); this.viewFlashes.clear(); this.shotCounts.clear(); this.blood.clear();
  }

  private syncDrops() {
    for(const drop of this.sim.drops) {
      if(drop.picked)continue;
      const existing=this.dropModels.get(drop.id);
      if(existing){existing.position.copy(v3(drop.position));continue;}
      const source=this.worldWeapons.get(drop.equipment);if(!source)continue;
      const model=source.clone(true);model.position.copy(v3(drop.position));
      model.rotation.set(0,this.sim.actors[drop.id]?.yaw??0,Math.PI/2);
      model.userData.spraylabDropId=drop.id;
      this.scene.add(model);this.dropModels.set(drop.id,model);
    }
  }

  private syncActors(snapshots: DuelActorSnapshot[], dt: number) {
    this.animationClock += dt;
    this.frustum.setFromProjectionMatrix(this.projectionView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    for (const actor of snapshots.slice(1)) {
      if (this.models.has(actor.id) && this.generations.get(actor.id) !== actor.generation) this.respawnActor(actor);
      const model = this.models.get(actor.id);
      if (!model) continue;
      this.actorBounds.center.set(actor.position.x, actor.feet + 1, actor.position.z);
      model.visible = this.frustum.intersectsSphere(this.actorBounds) &&
        (!this.covers.visible || !fullyOccluded(this.camera.position, actor, this.sim.arena));
      if (!actor.alive && !this.deaths.has(actor.id)) {
        this.deaths.set(actor.id, this.animationClock); this.animationTimes.delete(actor.id);
      }
      const deathAge = this.animationClock - (this.deaths.get(actor.id) ?? this.animationClock);
      model.position.set(actor.position.x, actor.alive ? actor.feet : deathFeet(actor, deathAge, this.sim.arena.solids,
        this.sim.actors[actor.id].verticalVelocity), actor.position.z);
      model.rotation.y = actor.yaw - Math.PI;
      applyImmunityAlpha(model, !!actor.immune && actor.alive);
      if (model.visible || !actor.alive) {
        const elapsed = this.animationTimes.has(actor.id) ? this.animationClock - this.animationTimes.get(actor.id)! : dt;
        if (dt > 0 && this.animationTimes.has(actor.id) && elapsed < 1 / this.metrics.animationRate(this.settings.quality)) continue;
        const weapon=this.sim.actors[actor.id].weapon;
        this.animators.get(actor.id)?.update(this.sim.phase === 'result' && actor.alive
          ? {...actor, velocity: {x: 0, z: 0}} : actor, dt > 0 ? elapsed : 0, actor.alive ? undefined : deathAge,
          {reloadRemaining:Math.max(0,weapon.reloadUntil-this.sim.time),reloadDuration:weapon.reload.phaseDuration||equipmentStats(actor.equipment).reload,
            reloadPhase:weapon.reloadPhase,reloadProgress:weapon.reload.progress,
            deathVelocity:{...actor.velocity,y:actor.verticalVelocity??0}});
        this.animationTimes.set(actor.id, this.animationClock);
      }
    }
  }

  private resize() {
    const width = this.host.clientWidth, height = this.host.clientHeight;
    if (!width || !height) return;
    this.width = width; this.height = height;
    this.renderer.setPixelRatio(renderPixelRatio(width, height, resolutionPixelRatio(this.settings.resolution), this.settings.quality, this.metrics.adaptive));
    this.renderer.setSize(width, height);
    this.camera.aspect = viewAspect(this.settings.resolution, width, height);
    // CS2 stretches the crosshair with the world.
    this.crosshair.style.setProperty('--cross-stretch', String(width / height / this.camera.aspect));
    this.sim.playerAspect = this.camera.aspect;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = viewmodelAspect(width,height,this.camera.aspect);
    this.viewCamera.updateProjectionMatrix();
  }

  private report() {
    const [player, ...bots] = this.sim.renderSnapshot();
    this.onStatus({killFeed: this.killFeed.visible(this.animationClock), phase: this.sim.phase, paused: this.paused, outcome: this.sim.phase==='result'?this.sim.outcome:undefined,
      health: player.health, armor: player.armor, ammo: player.ammo, reloading: player.reloading,
      reloadRemaining: Math.max(0,this.sim.actors[0].weapon.reloadUntil-this.sim.time),
      reloadProgress: player.reloading ? this.sim.actors[0].weapon.reload.progress : undefined,
      reserve:player.reserve,reloadSilent:player.reloadSilent,recharge:Math.max(0,this.sim.actors[0].weapon.rechargeUntil-this.sim.time),
      enemies: bots.filter(bot => bot.alive).length, seconds: this.sim.time, kills: this.kills,
      damage: this.damage, input: this.inputName, caption: this.animationClock < this.captionUntil ? this.caption : '',
      mapLoading: !!this.workshop && !this.workshopModel,
      shortcutProtected: this.shortcuts.protected, nextRoundIn: this.roundFlow.remaining(this.config.feedbackSeconds),
      immuneFor: this.sim.deathmatch ? Math.max(0, (this.sim.actors[0].immuneUntil ?? 0) - this.sim.time) : undefined,
      ...(this.sim.deathmatch ? {deathmatch: true, deaths: this.sim.deathmatchStats.deaths, respawnIn: this.sim.respawnIn(0)} : {}),
      equipped: player.equipment, review: this.sim.coach.review(), history: this.history,
      loadout: this.sim.loadout, pickup: this.sim.nearestPickup()?.equipment, interaction:this.sim.nearestDoor()?.open?'Close door':this.sim.nearestDoor()?'Open door':undefined, arenaDesign: this.sim.arena.design,
      ...(this.botz ? {botz: botzSummary(this.sim.botzStats, this.sim.time, this.botz.sessionSeconds), botzHistory: this.botzHistory} : {})});
  }

  private tick(timestamp: number) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(time => this.tick(time));
    const cpuStart = performance.now();
    const active = this.sim.phase !== 'ready' && !this.paused;
    // Simulation and input share a clock even when a graphics cap skips a draw.
    if (document.hidden) this.inputClock.reset(performance.now());
    else this.syncInput(performance.now());
    if (document.hidden || !this.pacer.ready(timestamp, active ? this.settings.frameLimit : 15)) {
      if (document.hidden) this.last = timestamp;
      return;
    }
    const frameSeconds = this.last ? Math.max(0,(timestamp - this.last) / 1000) : 0;
    const dt = Math.min(frameSeconds,.25);
    this.last = timestamp;
    if (this.sessionStarted && this.roundFlow.advance(dt, this.paused, this.config.feedbackSeconds)) this.restart(true);
    this.repeatZoom();
    this.syncEnvironment();this.syncDrops();
    const snapshots = this.sim.renderSnapshot();
    const events=this.sim.drainEvents();
    const player = snapshots[0];
    const viewWeapon=this.sim.actors[0].weapon;
    if (player.generation !== this.playerGeneration) {
      // A deathmatch respawn: leave the death camera, forget the hit arcs and re-apply any keys still held.
      this.playerGeneration = player.generation;
      this.viewAir.reset();
      this.deaths.delete(0); this.damageFeedback.clear(); this.updateMovement();
    }
    if(timestamp-this.shadowAt>=50){this.shadowAt=timestamp;this.actorShadows.update(actorShadows(snapshots,this.sim.arena));}
    if(timestamp-this.radarAt>=100) {this.radarAt=timestamp;this.radar.update(player,this.sim.radar.snapshot(this.sim.time),this.sim.time,this.sim.arena,this.config);}
    if (player.equipment !== this.renderedEquipment) {
      void this.loadViewModel(player.equipment);
      void this.audio.unlock(player.equipment).then(() => {
        if (!this.disposed && this.sim.actors[0].weapon.id === player.equipment && !this.paused)
          if(!this.audio.playAction(0,player.equipment,'draw',this.sim.time,{local:true,volume:this.settings.volume,duration:equipmentStats(player.equipment).deploy}))
            this.audio.playEvent(`${player.equipment}-draw`, this.settings.volume);
      });
    }
    this.wasReloading = player.reloading;
    this.viewAnimationElapsed += active ? dt : 0;
    // First-person handling follows every displayed frame, independently of
    // the cheaper distant-bot animation sampling policy.
    if (this.viewAnimationElapsed > 0) {
    this.viewAnimation?.update(Math.max(0,viewWeapon.reloadUntil-this.sim.time), viewWeapon.reload.phaseDuration||equipmentStats(player.equipment).reload, this.viewAnimationElapsed,
      {reloadEmpty:viewWeapon.reloadEmpty,ammo:viewWeapon.ammo,equipment:viewWeapon.id,reloadPhase:viewWeapon.reloadPhase,
        reloadProgress:viewWeapon.reload.progress,charging:viewWeapon.actions.charging,chargeDuration:REVOLVER_WINDUP});
    this.viewAnimationElapsed = 0;
    }
    const visualRecoil = viewWeapon.recovery.predict(this.sim.accumulator);
    const punch = this.sim.actors[0].punch.predict(this.paused || this.sim.phase !== 'fighting' ? 0 : this.sim.accumulator,
      viewWeapon.recovery.angle);
    const viewPunch = this.sim.actors[0].viewPunch.sample(this.sim.time + this.sim.accumulator);
    const view = recoilView(player.yaw, player.pitch, {pitch: visualRecoil.pitch + punch.pitch,
      yaw: visualRecoil.yaw + punch.yaw, roll: punch.roll}, viewPunch);
    const deathAge = this.animationClock - (this.deaths.get(0) ?? this.animationClock);
    const death = deathView(deathAge, player.position.y - player.feet);
    this.camera.position.set(player.position.x, player.position.y, player.position.z);
    if (!player.alive) this.camera.position.y = deathFeet(player, deathAge, this.sim.arena.solids,
      this.sim.actors[0].verticalVelocity) + death.height;
    this.camera.rotation.set(view.pitch + (player.alive ? 0 : death.pitch), view.yaw,
      view.roll + (player.alive ? 0 : death.roll), 'YXZ');
    const scoped = this.scope.update(viewWeapon.actions, this.camera, this.sim.time + this.sim.accumulator, player.alive);
    this.camera.updateMatrixWorld();
    this.syncActors(snapshots, this.sim.phase !== 'ready' && !this.paused ? dt : 0);
    this.kick = Math.max(0, this.kick - dt * 8);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const offset = this.viewOffset ?? VIEWMODEL_OFFSET;
    const modelKick=this.viewAnimation?.hasFireMotion?0:this.kick;
    this.viewRoot.position.set(offset.x,
      offset.y + Math.sin(this.sim.time * 12) * Math.min(speed, 1) * .002 - (player.alive ? 0 : death.weaponDrop * .5), offset.z + modelKick * .018);
    this.viewRoot.visible = !scoped && (player.alive || deathAge < .25);
    if (player.alive) this.viewAir.apply(this.viewRoot, view, player.grounded ?? player.feet === 0);
    else applyViewmodelRecoil(this.viewRoot.quaternion, view);
    if (modelKick && player.equipment !== 'knife') this.viewRoot.rotation.x += modelKick * .035;
    this.audio.updateListener(this.camera.position, view.yaw, view.pitch);
    for(const actor of snapshots) {
      const state=actor.id===0?viewWeapon:this.sim.actors[actor.id].weapon;
      this.audio.syncActor({id:actor.id,generation:actor.generation,equipment:actor.equipment,alive:actor.alive,
        reloading:actor.reloading,local:actor.id===0,silent:actor.reloadSilent,reloadEmpty:state.reloadEmpty,
        reloadRemaining:Math.max(0,state.reloadUntil-this.sim.time),reloadDuration:state.reload.phaseDuration||equipmentStats(actor.equipment).reload,
        reloadPhase:state.reloadPhase,reloadProgress:state.reload.progress},
        this.sim.time,this.settings.volume,actor.id===0?undefined:this.soundLocation(actor.position));
    }
    this.processEvents(events);
    if (this.sim.botzStats.leaks > this.arrivalsShown) {
      this.arrivalsShown = this.sim.botzStats.leaks;
      this.caption = 'BOT REACHED YOU'; this.captionUntil = this.animationClock + .8;
    }
    this.audio.updateActions(this.sim.time);
    this.damageFeedback.update(this.animationClock, player.yaw);
    const followPoint = this.followPoint.copy(followCrosshairDirection(player.yaw, player.pitch, visualRecoil))
      .multiplyScalar(10).add(this.camera.position).project(this.camera);
    const crosshairOffset = followCrosshairOffset(this.settings.follow ? followPoint : {x: 0, y: 0}, this.width, this.height);
    this.crosshair.style.visibility = player.alive && !scoped && (player.equipment==='knife'||gameData.weapons[player.equipment].showCrosshair) ? '' : 'hidden';
    this.crosshair.style.transform = `translate(${crosshairOffset.x}px, ${crosshairOffset.y}px)`;
    // The dynamic gap is the live accuracy cone (penalty, movement, air, spread)
    // projected to the screen, as the game's HUD does, not a speed heuristic.
    if (this.settings.crosshair.dynamic) {
      const stats = viewWeapon.actions.stats, command = this.sim.actors[0].command;
      const cone = viewWeapon.recovery.inaccuracy(speed / (stats.speed * UNIT), !!command.walk,
        !(player.grounded ?? true), (player.verticalVelocity ?? 0) / UNIT);
      this.crosshair.style.setProperty('--motion-gap',
        `${dynamicCrosshairGap({inaccuracy: cone, spread: stats.spread}, this.height, VERTICAL_FOV)}px`);
    } else this.crosshair.style.setProperty('--motion-gap', '0px');
    this.shotEffects.update(this.animationClock); this.viewFlashes.update(this.animationClock);
    this.blood.update(this.animationClock, this.camera, this.renderer);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.autoClear = true; this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false; this.renderer.clearDepth();
    const viewport = viewmodelViewport(this.width, this.height);
    this.renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    this.renderer.render(this.viewScene, this.viewCamera);
    for (const actor of snapshots) if (actor.alive) actor.hitboxes = this.hitboxPoses.get(actor.id)?.capture();
    this.sim.present(snapshots);
    const oldResolution = this.metrics.adaptive;
    if (this.metrics.sample(dt, performance.now() - cpuStart, this.settings.quality === 'auto', active, this.settings.frameLimit,frameSeconds)) {
      this.meter.update(this.metrics, this.renderer.getPixelRatio());
      if (oldResolution !== this.metrics.adaptive) this.resize();
    }
    if (events.some(event => event.kind === 'hit' || event.kind === 'round') || timestamp - this.statusAt > 100) {
      this.statusAt = timestamp; this.report();
    }
  }

  dispose() {
    this.recordBotz();
    if (this.attemptId) this.progression?.cancelAttempt(this.attemptId);
    this.disposed = true; cancelAnimationFrame(this.frame); this.pause(); this.releaseShortcuts(); this.observer.disconnect();
    this.cleanup.forEach(fn => fn()); this.clearEffects(); this.audio.dispose(); this.damageFeedback.dispose();
    this.animators.forEach(animator => animator.dispose()); this.viewAnimation?.dispose(); this.scope.dispose();
    for (const model of [...[...this.viewModels.values()].map(entry => entry.model), ...this.retiredViewModels])
      void model.then(entry => {entry.animation.dispose(); disposeResources([entry.scene]);}, () => undefined);
    this.viewModels.clear(); this.retiredViewModels = [];
    this.gestureClips.clear();
    this.hitboxPoses.clear();
    this.meter.dispose();
    this.radar.dispose();
    this.actorShadows.dispose();
    this.shotEffects.dispose(); this.viewFlashes.dispose(); this.blood.dispose();
    disposeResources([this.scene, this.viewScene, ...this.worldWeapons.values(), ...(this.targetScene && !this.agentInstance ? [this.targetScene] : [])]);
    this.agentRevision++;this.agentInstance?.dispose();this.actorLoader.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
