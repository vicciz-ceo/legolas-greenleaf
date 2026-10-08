/**
 * GREENLEAF — core contract.
 *
 * Every module in the game is written against the interfaces in this file. If you need
 * something that is not here, do NOT change the meaning of an existing member: add an
 * optional member, or work around it locally, and report it to the orchestrator.
 *
 * Conventions
 *  - Units are metres and seconds. +Y is up. Characters face +Z in their local space.
 *  - Legolas is 1.85 m tall. A human door is ~2.1 m. Gravity is 22 m/s² (snappy, cinematic).
 *  - "dt" passed to gameplay code is GAME time (already multiplied by the time scale).
 *    UI, camera smoothing and audio use REAL time.
 *  - Colours are 0xRRGGBB numbers in sRGB.
 *  - Nothing in the game loads external files. Every mesh, texture and sound is generated in code.
 */
import type * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Basics
// ─────────────────────────────────────────────────────────────────────────────

export type Team = 'player' | 'ally' | 'enemy' | 'neutral';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type Vec3Tuple = [number, number, number];

/** Surface type, used for footsteps, arrow impact sounds and particles. */
export type SurfaceMaterial =
  | 'dirt' | 'grass' | 'stone' | 'wood' | 'metal' | 'water' | 'web' | 'flesh' | 'snow' | 'ice' | 'leaves';

// ─────────────────────────────────────────────────────────────────────────────
// Engine & rendering  (src/core/engine.ts, src/core/environment.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type EnvironmentName =
  | 'mirkwood' | 'forest_river' | 'laketown_night' | 'ravenhill_winter' | 'moria' | 'amon_hen'
  | 'helms_deep_storm' | 'pelennor' | 'black_gate' | 'menu' | 'lab' | 'arena';

export type WeatherKind = 'none' | 'rain' | 'storm' | 'snow' | 'embers' | 'ash' | 'spores' | 'dust';

export type SkyDef =
  | {
      kind: 'physical';
      /** sun elevation above horizon in degrees, azimuth in degrees (0 = +Z, 90 = +X) */
      elevation: number;
      azimuth: number;
      turbidity: number;
      rayleigh: number;
      mieCoefficient: number;
      mieDirectionalG: number;
      /** 0..1 procedural cloud layer coverage */
      clouds?: number;
    }
  | {
      kind: 'gradient';
      top: number;
      horizon: number;
      bottom: number;
      /** 0..1 star density */
      stars?: number;
      moon?: { elevation: number; azimuth: number; size: number; color?: number };
      clouds?: number;
      cloudColor?: number;
    }
  | { kind: 'cave'; color: number };

export interface EnvironmentPreset {
  name: string;
  sky: SkyDef;
  /** key light (sun or moon). Direction comes from sky elevation/azimuth unless sunDirection is set. */
  sunColor: number;
  sunIntensity: number;
  /** direction FROM the scene TOWARD the light, normalised by the engine */
  sunDirection?: Vec3Tuple;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** scene.environmentIntensity for image-based lighting */
  envIntensity: number;
  fog: { color: number; density: number };
  exposure: number;
  bloom: number;
  grade: {
    lift: Vec3Tuple;
    gamma: Vec3Tuple;
    gain: Vec3Tuple;
    saturation: number;
    /** 0..1 */
    vignette: number;
  };
  weather?: WeatherKind;
  weatherIntensity?: number;
  /** extra ambient loop to start, e.g. 'forest' */
  ambience?: LoopName;
}

export interface PostControls {
  exposure: number;
  bloomStrength: number;
  vignette: number;
  grain: number;
  saturation: number;
  /** 0..1 red damage pulse at the screen edges. Owner sets it; the engine does not decay it. */
  damageFlash: number;
  /** 0..1 desaturate + cool tint + radial blur during Focus slow-motion */
  focusTint: number;
  /** 0..1 cinematic letterbox bars */
  letterbox: number;
  /** depth-of-field for cutscenes and menus */
  dof: { enabled: boolean; focus: number; aperture: number };
}

export interface Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly quality: Quality;
  setQuality(q: Quality): void;
  /** key light. Casts shadows. Its shadow frustum is centred on shadowFocus each frame. */
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  shadowFocus: THREE.Vector3;
  /** Group for all level content. Cleared (and GPU resources disposed) by clearLevel(). */
  readonly levelRoot: THREE.Group;
  readonly env: EnvironmentPreset;
  setEnvironment(preset: EnvironmentName | EnvironmentPreset): void;
  readonly post: PostControls;
  /** render one frame. dtReal in seconds. */
  render(dtReal: number): void;
  resize(): void;
  clearLevel(): void;
  /** frames-per-second estimate (real time) */
  readonly fps: number;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// FX  (src/core/fx.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type BloodKind = 'red' | 'dark' | 'black' | 'ichor';

export interface FxHandle {
  readonly position: THREE.Vector3;
  setIntensity(v: number): void;
  stop(): void;
}

export interface Fx {
  blood(pos: THREE.Vector3, dir: THREE.Vector3, kind: BloodKind, amount?: number): void;
  sparks(pos: THREE.Vector3, normal: THREE.Vector3, amount?: number): void;
  dust(pos: THREE.Vector3, amount?: number, color?: number): void;
  splash(pos: THREE.Vector3, amount?: number): void;
  debris(pos: THREE.Vector3, amount?: number, color?: number): void;
  /** burst of stone chunks + dust + shockwave + light flash + camera-independent sound is NOT played here */
  explosion(pos: THREE.Vector3, scale?: number): void;
  /** persistent fire with flickering point light (respects quality light budget) */
  fire(pos: THREE.Vector3, scale?: number): FxHandle;
  smoke(pos: THREE.Vector3, scale?: number): FxHandle;
  /** flame attached to an object (torch head). Follows the object. */
  torch(obj: THREE.Object3D, offset?: THREE.Vector3): FxHandle;
  /** a glowing trail that follows an object until stop() (arrows in Focus mode) */
  trail(obj: THREE.Object3D, color?: number): FxHandle;
  setWeather(kind: WeatherKind, intensity?: number): void;
  /** storm lightning: sky flash + light pulse. Thunder sound is played by the caller. */
  lightning(): void;
  update(dt: number, camera: THREE.Camera): void;
  /** remove everything (level change) */
  clear(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio  (src/core/audio.ts) — fully procedural WebAudio
// ─────────────────────────────────────────────────────────────────────────────

export type SfxName =
  | 'bow_draw' | 'bow_release' | 'arrow_whoosh' | 'arrow_hit_flesh' | 'arrow_hit_wood' | 'arrow_hit_stone'
  | 'arrow_hit_metal' | 'knife_slash' | 'knife_hit' | 'sword_clash' | 'sword_swing' | 'footstep'
  | 'footstep_stone' | 'footstep_water' | 'jump' | 'land' | 'dash' | 'hurt' | 'player_death'
  | 'orc_grunt' | 'orc_die' | 'orc_roar' | 'uruk_roar' | 'goblin_screech' | 'spider_hiss' | 'spider_die'
  | 'troll_roar' | 'troll_hit' | 'troll_step' | 'oliphaunt_trumpet' | 'oliphaunt_step' | 'bat_screech'
  | 'warg_howl' | 'horse_neigh' | 'explosion' | 'stone_crumble' | 'splash' | 'thunder' | 'horn_rohan'
  | 'horn_orc' | 'drums' | 'shield_slide' | 'kill_count' | 'checkpoint' | 'focus_in' | 'focus_out'
  | 'focus_mark' | 'focus_fire' | 'ui_click' | 'ui_hover' | 'ui_confirm' | 'ui_back' | 'level_complete'
  | 'reward' | 'web_tear' | 'barrel_bump' | 'chain_rattle' | 'bell';

export type LoopName =
  | 'wind' | 'forest' | 'rain' | 'storm' | 'fire' | 'river' | 'rapids' | 'cave' | 'battle' | 'army' | 'snow_wind';

export type MusicMood = 'none' | 'menu' | 'explore' | 'tension' | 'combat' | 'boss' | 'epic' | 'victory' | 'defeat';

export interface AudioSys {
  /** must be called from a user gesture before sound plays (browser autoplay policy) */
  unlock(): void;
  play(name: SfxName, opts?: { pos?: THREE.Vector3; volume?: number; pitch?: number }): void;
  /** start/adjust a looping ambience; volume 0 fades it out */
  loop(name: LoopName, volume: number): void;
  stopAllLoops(): void;
  music(mood: MusicMood): void;
  setListener(pos: THREE.Vector3, forward: THREE.Vector3): void;
  /** 0..1 — applies a low-pass + pitch drop during Focus slow-motion */
  setSlowmo(amount: number): void;
  master: number;
  musicVolume: number;
  sfxVolume: number;
  update(dtReal: number): void;
  /** room reverb: amount 0..1 (0 = dry), decay 0.3–9 s. Default (0.4, 1.7); caves ≈ (0.9, 5.5) */
  setReverb?(amount: number, decaySec?: number): void;
  /** 0..1 — more drums/horns and slightly faster tempo for the current mood (default 0.5) */
  setMusicIntensity?(v: number): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input  (src/core/input.ts) — keyboard/mouse, gamepad, touch unified
// ─────────────────────────────────────────────────────────────────────────────

export interface InputState {
  /** -1..1 strafe (right +) */
  moveX: number;
  /** -1..1 forward (+) / back (-) */
  moveY: number;
  /** look delta this frame in radians, sensitivity applied (right +, up +) */
  lookX: number;
  lookY: number;
  /** precision aim / zoom (RMB, LT, touch aim toggle) */
  aimHeld: boolean;
  /** drawing the bow (LMB, RT, touch fire held) */
  drawHeld: boolean;
  /** edge: the draw input was released this frame → loose the arrow */
  drawReleased: boolean;
  /** edges (true only on the frame pressed) */
  melee: boolean;
  jump: boolean;
  dash: boolean;
  interact: boolean;
  nextArrow: boolean;
  pause: boolean;
  /** 0 = none chosen this frame, 1..3 = arrow slot */
  arrowSlot: 0 | 1 | 2 | 3;
  focusHeld: boolean;
  focusPressed: boolean;
  focusReleased: boolean;
  sprintHeld: boolean;
  /** device that produced the most recent input */
  device: 'kbm' | 'gamepad' | 'touch';
}

export interface Input {
  readonly state: InputState;
  /** call exactly once per frame before gameplay update; computes edges and look deltas */
  poll(): void;
  /** gameplay input enabled (false while menus are open → state is all-zero) */
  enabled: boolean;
  sensitivity: number;
  invertY: boolean;
  lockPointer(): void;
  unlockPointer(): void;
  readonly pointerLocked: boolean;
  readonly isTouch: boolean;
  setTouchVisible(v: boolean): void;
  /** contextual label for the touch interact button (e.g. "Shield"); null hides it */
  setInteractLabel(label: string | null): void;
  /** gamepad rumble if supported */
  rumble(strength: number, ms: number): void;
  dispose(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD & menus  (src/ui/*)
// ─────────────────────────────────────────────────────────────────────────────

export type Speaker =
  | 'Legolas' | 'Gimli' | 'Aragorn' | 'Tauriel' | 'Thranduil' | 'Gandalf' | 'Bard' | 'Thorin' | 'Kili'
  | 'Bolg' | 'Lurtz' | 'Théoden' | 'Éomer' | 'Haldir' | 'Boromir' | 'Orc' | 'Uruk' | 'Narrator' | string;

export interface Hud {
  show(v: boolean): void;
  setHealth(cur: number, max: number): void;
  setFocus(cur: number, max: number, active: boolean): void;
  setArrowType(type: ArrowType, unlocked: readonly ArrowType[]): void;
  /** crosshair draw-charge ring. charge 0..1; aiming tightens the reticle; visible=false hides the crosshair */
  setCrosshair(charge: number, aiming: boolean, visible: boolean): void;
  hitMarker(kind: 'hit' | 'head' | 'kill' | 'armor'): void;
  /** directional damage indicator; angle in radians relative to camera forward (0 = front, +π/2 = right) */
  damage(angle?: number): void;
  setObjective(text: string | null): void;
  /** Gimli rivalry counter; pass null to hide */
  setRivalry(legolas: number | null, gimli?: number): void;
  setBoss(name: string | null, frac?: number): void;
  toast(text: string, kind?: 'checkpoint' | 'info' | 'reward' | 'warning'): void;
  subtitle(speaker: Speaker, text: string, duration?: number): void;
  /** chapter title card; resolves when it has faded out */
  titleCard(title: string, subtitle: string, film?: string): Promise<void>;
  /** Focus-mode target marks in CSS pixels; empty array clears */
  setFocusMarks(points: readonly { x: number; y: number; locked: boolean }[]): void;
  /** contextual prompt, e.g. "Grab the shield" — the UI adds the right key/button glyph for the device */
  setPrompt(action: 'interact' | 'jump' | 'melee' | 'focus' | 'draw' | null, text?: string): void;
  /** generic progress bar, e.g. "Hold the wall" timer; null hides */
  setProgress(label: string | null, frac?: number): void;
  setFps(fps: number | null): void;
  update(dtReal: number): void;
  /** honour Settings.subtitles */
  setSubtitlesEnabled?(v: boolean): void;
}

export interface ChapterResult {
  chapterId: string;
  title: string;
  timeSec: number;
  kills: number;
  headshots: number;
  shots: number;
  hits: number;
  damageTaken: number;
  rivalry?: { legolas: number; gimli: number };
  score: number;
  rank: Rank;
  pointsEarned: number;
  firstClear: boolean;
}

export interface MenuActions {
  startChapter(id: string, checkpoint?: number): void;
  resume(): void;
  restartCheckpoint(): void;
  restartChapter(): void;
  quitToTitle(): void;
  applySettings(s: Settings): void;
  buyUpgrade(id: UpgradeId): boolean;
}

export interface Menus {
  showTitle(): void;
  showChapterSelect(): void;
  showUpgrades(): void;
  showSettings(): void;
  showPause(): void;
  showControls(): void;
  hideAll(): void;
  showLoading(text: string, frac: number): void;
  hideLoading(): void;
  showChapterComplete(result: ChapterResult): Promise<'next' | 'select' | 'retry'>;
  showDefeat(reason: string): Promise<'checkpoint' | 'restart' | 'select'>;
  /** final credits after Black Gate */
  showCredits(): Promise<void>;
  readonly open: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Progression & save  (src/game/progression.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type ArrowType = 'standard' | 'piercing' | 'triple';
export type Rank = 'S' | 'A' | 'B' | 'C' | 'D';
export type UpgradeId =
  | 'draw_speed' | 'arrow_damage' | 'knife_mastery' | 'agility' | 'focus' | 'vitality'
  | 'piercing_arrows' | 'triple_shot';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  maxLevel: number;
  /** cost of each level, length === maxLevel */
  cost: number[];
}

export interface Settings {
  difficulty: Difficulty;
  quality: Quality;
  sensitivity: number;
  invertY: boolean;
  master: number;
  music: number;
  sfx: number;
  subtitles: boolean;
  aimAssist: boolean;
  showFps: boolean;
}

export interface SaveData {
  version: 1;
  /** chapter ids that can be played */
  unlocked: string[];
  best: Record<string, { rank: Rank; score: number }>;
  points: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  settings: Settings;
  rivalryTotals: { legolas: number; gimli: number };
  /** resume info */
  last?: { chapterId: string; checkpoint: number };
}

export interface Progression {
  readonly data: SaveData;
  save(): void;
  reset(): void;
  level(id: UpgradeId): number;
  canBuy(id: UpgradeId): boolean;
  buy(id: UpgradeId): boolean;
  readonly upgrades: readonly UpgradeDef[];
  unlockedArrows(): ArrowType[];
  /** derived player stats from upgrades + difficulty */
  stats(): PlayerStats;
  recordResult(r: ChapterResult): void;
  computeRank(r: Omit<ChapterResult, 'rank' | 'pointsEarned' | 'firstClear' | 'score'>, parTimeSec: number): { score: number; rank: Rank; points: number };
}

export interface PlayerStats {
  maxHp: number;
  /** seconds to reach full draw */
  drawTime: number;
  arrowDamage: number;
  knifeDamage: number;
  moveSpeed: number;
  dashCooldown: number;
  focusMax: number;
  focusTargets: number;
  /** multiplier on damage the player receives */
  damageTakenMul: number;
  /** HP per second regenerated after 4s without damage */
  regen: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Physics world  (src/physics/world.ts) — lightweight character physics
// ─────────────────────────────────────────────────────────────────────────────

export interface ColliderOpts {
  /** can be stood on (top face is ground). default true */
  walkable?: boolean;
  /** stops arrows. default true */
  blocksArrows?: boolean;
  /** stops the camera (camera pulls in). default true */
  blocksCamera?: boolean;
  /** blocks character movement sideways. default true */
  solid?: boolean;
  material?: SurfaceMaterial;
  tag?: string;
}

export interface ColliderHandle {
  readonly id: number;
  readonly tag?: string;
  /** move a box/cylinder/mesh collider (moving platforms). yaw in radians. */
  setTransform(pos: THREE.Vector3, yaw?: number): void;
  /** platform velocity (m/s) carried onto characters standing on it */
  velocity: THREE.Vector3;
  enabled: boolean;
}

export interface GroundHit {
  y: number;
  normal: THREE.Vector3;
  material: SurfaceMaterial;
  collider: ColliderHandle | null;
}

export interface WorldRayHit {
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  material: SurfaceMaterial;
  collider: ColliderHandle | null;
  /** scene object hit if a mesh collider (for sticking arrows into it) */
  object?: THREE.Object3D;
}

export interface PhysicsWorld {
  /** terrain height function, or null for no terrain */
  setTerrain(heightAt: ((x: number, z: number) => number) | null, material?: SurfaceMaterial): void;
  heightAt(x: number, z: number): number;
  /** oriented box (yaw only). center is the box centre. */
  addBox(center: THREE.Vector3, halfExtents: Vec3Tuple, yaw?: number, opts?: ColliderOpts): ColliderHandle;
  /** vertical cylinder from y0 to y1 */
  addCylinder(x: number, z: number, radius: number, y0: number, y1: number, opts?: ColliderOpts): ColliderHandle;
  /** arbitrary static mesh (BVH accelerated). Uses the mesh's current world matrix. */
  addMesh(mesh: THREE.Mesh, opts?: ColliderOpts): ColliderHandle;
  remove(h: ColliderHandle): void;
  clear(): void;
  /** highest walkable surface at (x,z) not higher than fromY + maxStepUp */
  ground(x: number, z: number, fromY: number, maxStepUp?: number): GroundHit | null;
  /** push a vertical capsule (feet at pos) out of solid colliders. Mutates pos. Returns true if collided. */
  collide(pos: THREE.Vector3, radius: number, height: number, stepUp?: number): boolean;
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    filter?: 'arrows' | 'camera' | 'all',
  ): WorldRayHit | null;
  /** below this Y the player dies (fell) */
  killY: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat
// ─────────────────────────────────────────────────────────────────────────────

export type HitZone = 'head' | 'body' | 'limb' | 'weakpoint' | 'armor';

export interface DamageInfo {
  amount: number;
  type: 'arrow' | 'melee' | 'blunt' | 'fire' | 'fall' | 'crush' | 'scripted';
  source: Combatant | null;
  point?: THREE.Vector3;
  dir?: THREE.Vector3;
  zone?: HitZone;
  knockback?: number;
  stagger?: boolean;
}

export interface CombatRayHit {
  t: number;
  point: THREE.Vector3;
  normal?: THREE.Vector3;
  zone: HitZone;
  /** damage multiplier for this zone (head 2.5, body 1, limb 0.75, armor 0.3, weakpoint per creature) */
  multiplier: number;
  /** object to parent stuck arrows to (a bone or mesh) */
  attach?: THREE.Object3D;
}

export interface Combatant {
  readonly id: number;
  team: Team;
  name: string;
  /** root object in the scene; position is the feet */
  readonly object: THREE.Object3D;
  readonly position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  height: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  isBoss?: boolean;
  /** eligible for aim assist and Focus marking */
  targetable: boolean;
  /** world-space aim point (centre mass or weak point) */
  aimPoint(out: THREE.Vector3): THREE.Vector3;
  /** projectile/line test in world space; dir is normalised */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): CombatRayHit | null;
  takeDamage(d: DamageInfo): void;
  update(dt: number): void;
  dispose(): void;
  /** set by the registry; called once when hp reaches 0 */
  onDeath?: ((self: Combatant, killer: Combatant | null) => void) | null;
}

export interface CombatantRegistry {
  add(c: Combatant): void;
  remove(c: Combatant): void;
  all(): readonly Combatant[];
  byTeam(team: Team): readonly Combatant[];
  /** nearest alive combatant of team to pos */
  nearest(team: Team, pos: THREE.Vector3, maxDist?: number, filter?: (c: Combatant) => boolean): Combatant | null;
  query(pos: THREE.Vector3, radius: number, team?: Team): Combatant[];
  /** first combatant hit along a ray (ignores `ignore` and dead) */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, ignoreTeam?: Team, ignore?: Combatant): { combatant: Combatant; hit: CombatRayHit } | null;
  /** subscribe to deaths; returns unsubscribe */
  onKill(cb: (victim: Combatant, killer: Combatant | null, info: DamageInfo) => void): () => void;
  update(dt: number): void;
  clear(): void;
}

export interface ArrowShot {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  /** m/s. Player arrows ~70 at full draw, enemy arrows ~35 */
  speed: number;
  damage: number;
  team: Team;
  owner: Combatant | null;
  type?: ArrowType;
  /** soft homing target (Focus volley) */
  homing?: Combatant | null;
  /** gravity multiplier, default 1 (arrows drop slightly) */
  gravity?: number;
  /** visual: 'elven' (white fletching), 'orc' (black, crude), 'uruk' (dark, heavy), 'bolt' */
  style?: 'elven' | 'orc' | 'uruk' | 'bolt';
  /** called when the arrow hits a combatant */
  onHit?: (target: Combatant, hit: CombatRayHit) => void;
}

export interface Projectiles {
  fire(shot: ArrowShot): void;
  /** generic thrown/arcing object (spears, rocks, firebombs) */
  throwObject(opts: { object: THREE.Object3D; origin: THREE.Vector3; velocity: THREE.Vector3; damage: number; team: Team; owner: Combatant | null; radius: number; onImpact?: (p: THREE.Vector3) => void }): void;
  update(dt: number): void;
  clear(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Characters (src/creatures/*) — everything modelled in code
// ─────────────────────────────────────────────────────────────────────────────

export type HumanoidKind =
  | 'legolas' | 'tauriel' | 'elf' | 'thranduil' | 'aragorn' | 'man' | 'rohirrim' | 'gondor' | 'gimli' | 'dwarf'
  | 'orc' | 'goblin' | 'gundabad' | 'uruk' | 'berserker' | 'lurtz' | 'bolg' | 'easterling' | 'haradrim' | 'troll';

export type WeaponKind =
  | 'elven_bow' | 'elven_knives' | 'sword' | 'elven_sword' | 'scimitar' | 'cleaver' | 'axe' | 'dwarf_axe'
  | 'pike' | 'spear' | 'mace' | 'club' | 'warhammer' | 'crossbow' | 'orc_bow' | 'uruk_bow' | 'torch' | 'shield' | 'none';

/** Bone names every humanoid rig provides (more may exist). */
export type HumanoidBone =
  | 'root' | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulder_l' | 'upperarm_l' | 'forearm_l' | 'hand_l'
  | 'shoulder_r' | 'upperarm_r' | 'forearm_r' | 'hand_r'
  | 'thigh_l' | 'shin_l' | 'foot_l' | 'thigh_r' | 'shin_r' | 'foot_r';

export type SocketName = 'hand_r' | 'hand_l' | 'back' | 'hip_l' | 'hip_r' | 'head' | 'chest';

export interface HumanoidSpec {
  kind: HumanoidKind;
  /** variation seed (face, proportions, armour pieces, colours) */
  seed?: number;
  /** right-hand weapon (default per kind) */
  weapon?: WeaponKind;
  /** left-hand item (default per kind) */
  offhand?: WeaponKind;
  /** 0..1 armour coverage override */
  armor?: number;
  helmet?: boolean;
  /** uniform scale multiplier on top of the kind's natural height */
  scale?: number;
}

export type AttackAnim =
  | 'slash' | 'backslash' | 'thrust' | 'overhead' | 'knife1' | 'knife2' | 'knife3' | 'punch' | 'slam'
  | 'sweep' | 'throw' | 'shoot' | 'bite' | 'stomp';

export type SpecialPose =
  | 'surf' | 'climb' | 'hang' | 'ride' | 'sit' | 'crouch' | 'cheer' | 'roar' | 'block' | 'stagger'
  | 'barrel' | 'kneel' | 'run_wall' | 'swing' | null;

export interface AnimInput {
  /** horizontal speed m/s (drives walk/run blend + cadence) */
  speed: number;
  /** local-space movement direction (x right, z forward); default forward */
  moveDir?: { x: number; z: number };
  grounded: boolean;
  /** vertical velocity (jump/fall poses) */
  vy?: number;
  /** 0..1 blend toward bow-aim stance */
  aim?: number;
  /** 0..1 string pull */
  draw?: number;
  /** radians, + up — torso/arms pitch while aiming */
  aimPitch?: number;
  attack?: { kind: AttackAnim; t: number } | null;
  /** 0..1 flinch */
  hit?: number;
  /** 0..1 death progress (1 = lying still) */
  dead?: number;
  deathVariant?: number;
  special?: SpecialPose;
  /** 0..1 phase or blend for special poses (e.g. climb cycle) */
  specialT?: number;
  /** world-space point to look at (head/neck), null = forward */
  lookAt?: THREE.Vector3 | null;
}

export interface Humanoid {
  /** add to scene. Origin at feet, faces +Z */
  readonly root: THREE.Group;
  readonly kind: HumanoidKind;
  readonly height: number;
  readonly bones: Readonly<Record<HumanoidBone, THREE.Bone>>;
  socket(name: SocketName): THREE.Object3D;
  /** replace the item held in a hand */
  setWeapon(hand: 'hand_r' | 'hand_l', weapon: WeaponKind): void;
  /** current weapon object in a hand (for trails, collisions) */
  weaponObject(hand: 'hand_r' | 'hand_l'): THREE.Object3D | null;
  /** advance procedural animation */
  animate(dt: number, input: AnimInput): void;
  /** emissive hit flash (decays automatically over ~0.15 s) */
  flash(color?: number): void;
  /** bow string pull 0..1 for bow-wielders (also driven by animate.draw) */
  setCastShadow(v: boolean): void;
  /** hide fine detail (hair cards, small armour bits) at distance */
  setLod(level: 0 | 1 | 2): void;
  dispose(): void;
}

/** Spec of a lab subject. Files named `*.lab.ts` anywhere in src export `subjects: LabSubject[]`. */
export interface LabSubject {
  name: string;
  category: 'hero' | 'ally' | 'enemy' | 'creature' | 'prop' | 'environment';
  /** build the subject. Called once per lab page. */
  create(): LabInstance | Promise<LabInstance>;
}

export interface LabInstance {
  object: THREE.Object3D;
  /** approximate height for framing (m) */
  height: number;
  /** animation names the lab can switch between, e.g. ['idle','walk','run','attack','death'] */
  animations?: string[];
  /** pose the subject at time t (s) of animation `anim`. Must be deterministic for a given (anim, t). */
  pose?(anim: string, t: number): void;
  dispose?(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Player  (src/actors/player.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface CameraParams {
  distance: number;
  height: number;
  /** lateral over-the-shoulder offset (m, + = right) */
  shoulder: number;
  fov: number;
}

export interface CameraShot {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov?: number;
  /** if set, position/lookAt are in this object's local space each frame */
  follow?: THREE.Object3D;
  /** seconds to blend in (default 0.6) */
  blend?: number;
}

export interface CameraRig {
  yaw: number;
  pitch: number;
  /** base params; aiming and movers modify them */
  params: CameraParams;
  shake(amount: number, duration: number): void;
  /** scripted camera; null returns to the player camera */
  shot: CameraShot | null;
  /** normalised forward vector of the view (world) */
  readonly forward: THREE.Vector3;
  /** world point under the crosshair (combatants + world), refreshed each frame */
  readonly aimTarget: THREE.Vector3;
  update(dtReal: number): void;
}

/** Override for player locomotion during set-pieces (barrel ride, shield surf, climbing, bat ride). */
export interface PlayerMover {
  /** called every frame instead of default locomotion. Write player.position / player.velocity / player.facing. */
  update(dt: number, player: PlayerAPI, input: InputState): void;
  /** pose to blend into */
  pose?: SpecialPose;
  poseT?: () => number;
  allowShoot?: boolean;
  allowMelee?: boolean;
  allowDash?: boolean;
  allowJump?: boolean;
  /** camera adjustments while active */
  camera?: Partial<CameraParams>;
  /** if true the camera yaw is locked to the player's facing (on-rails sections) */
  lockCameraYaw?: boolean;
}

export interface PlayerAPI extends Combatant {
  readonly humanoid: Humanoid;
  readonly camera: CameraRig;
  readonly stats: PlayerStats;
  /** yaw the character faces (radians, 0 = +Z) */
  facing: number;
  mover: PlayerMover | null;
  teleport(pos: THREE.Vector3, facing?: number): void;
  /** gameplay toggles (cutscenes) */
  controlsEnabled: boolean;
  weaponsEnabled: boolean;
  invulnerable: boolean;
  readonly grounded: boolean;
  readonly aiming: boolean;
  /** 0..1 */
  readonly drawCharge: number;
  arrowType: ArrowType;
  focus: number;
  readonly focusActive: boolean;
  heal(amount: number): void;
  /** stats for chapter results */
  readonly tally: { kills: number; shots: number; hits: number; headshots: number; damageTaken: number };
  resetTally(): void;
  /** respawn at full health */
  revive(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// NPCs  (src/actors/enemy.ts, src/actors/ally.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type EnemyArchetype =
  | 'orc' | 'goblin' | 'gundabad' | 'uruk' | 'uruk_archer' | 'uruk_pike' | 'berserker' | 'orc_archer'
  | 'easterling' | 'haradrim' | 'troll';

export type EnemyBehavior = 'charge' | 'hold' | 'archer' | 'guard' | 'flank' | 'climb';

export interface EnemySpec {
  archetype: EnemyArchetype;
  /** override defaults (difficulty scaling is applied on top) */
  hp?: number;
  damage?: number;
  speed?: number;
  weapon?: WeaponKind;
  behavior?: EnemyBehavior;
  name?: string;
  boss?: boolean;
  /** what to attack: 'player' (default), 'nearest' (player or allies), or a fixed point to advance to */
  target?: 'player' | 'nearest' | THREE.Vector3;
  scale?: number;
  seed?: number;
  /** count toward the Gimli rivalry (default true) */
  countsForRivalry?: boolean;
}

export interface Enemy extends Combatant {
  readonly spec: EnemySpec;
  readonly humanoid: Humanoid;
  behavior: EnemyBehavior;
  /** temporarily freeze AI (scripted moments) */
  aiEnabled: boolean;
  /** force a target position to walk to (null = AI decides) */
  moveTarget: THREE.Vector3 | null;
  /**
   * Boss scripting: start a telegraphed attack now (wind-up defaults to the archetype's). Plays out
   * even while aiEnabled is false. Returns false while dead or already attacking. Troll 'slam' and
   * 'stomp' are area attacks; the others hit the target in a cone in front.
   */
  attack?(kind: AttackAnim, opts?: { windup?: number; target?: Combatant | null }): boolean;
  /** hold a special pose ('roar', 'stagger', 'kneel', 'block'...) for `seconds` */
  playPose?(pose: SpecialPose, seconds: number): void;
  /** true while an attack winds up, strikes or recovers */
  readonly attacking?: boolean;
}

export type AllyKind = 'gimli' | 'aragorn' | 'tauriel' | 'elf_archer' | 'rohirrim' | 'dwarf' | 'gondor' | 'man';

export interface AllySpec {
  kind: AllyKind;
  name?: string;
  /** allies are invulnerable by default (they are story characters) */
  invulnerable?: boolean;
  /** stay near this point / follow the player */
  anchor?: THREE.Vector3 | 'player';
  /** Gimli: his kills feed the rivalry counter */
  rivalry?: boolean;
}

export interface Ally extends Combatant {
  readonly spec: AllySpec;
  readonly humanoid: Humanoid;
  anchor: THREE.Vector3 | 'player';
  aiEnabled: boolean;
  /** play a one-off gesture */
  gesture(kind: 'cheer' | 'roar' | 'point' | 'nod'): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rivalry  (src/game/rivalry.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface Rivalry {
  readonly active: boolean;
  legolas: number;
  gimli: number;
  /** start counting (HUD shows the counter). startFrom carries counts from earlier chapters. */
  start(startFrom?: { legolas: number; gimli: number }): void;
  stop(): void;
  addLegolas(n?: number): void;
  addGimli(n?: number): void;
  /** when true, Gimli's count rises on its own while enemies are alive, rubber-banded to the player's pace */
  autoGimli: boolean;
  update(dt: number): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time
// ─────────────────────────────────────────────────────────────────────────────

export interface TimeControl {
  /** current time scale (eased toward target) */
  readonly scale: number;
  setScale(target: number, easeSec?: number): void;
  /** brief freeze for impact (real seconds) */
  hitStop(sec: number): void;
  /** game time since chapter start */
  readonly t: number;
  /** real time since boot */
  readonly real: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapters  (src/game/chapters/cN_name.ts) and the level API they use
// ─────────────────────────────────────────────────────────────────────────────

export interface WaveDef {
  /** groups spawned together */
  groups: { spec: EnemySpec; count: number; at: THREE.Vector3 | THREE.Vector3[]; spread?: number }[];
  /** seconds between groups (default 0 = all at once) */
  stagger?: number;
  /** resolve when this many enemies of the wave remain (default 0) */
  until?: number;
  /** max seconds before resolving anyway */
  timeout?: number;
}

export interface CrowdDef {
  /** area the crowd fills: centre + half-size (axis aligned, y from terrain) */
  center: THREE.Vector3;
  halfSize: [number, number];
  count: number;
  kind: 'orc' | 'uruk' | 'rohirrim' | 'gondor' | 'easterling' | 'elf' | 'dwarf' | 'goblin';
  /** facing yaw (radians) */
  facing?: number;
  /** march/charge speed m/s, 0 = idle swaying */
  speed?: number;
  /** add torches/spears silhouettes */
  props?: boolean;
}

export interface CrowdHandle {
  readonly mesh: THREE.Object3D;
  setSpeed(v: number): void;
  /** kill a fraction (0..1) of the crowd with a falling animation (scripted battle progression) */
  thin(frac: number): void;
  dispose(): void;
}

export interface LevelAPI {
  /** all level geometry goes under this group (auto-disposed) */
  readonly root: THREE.Group;
  readonly ctx: GameContext;
  objective(text: string | null): void;
  /** mark checkpoint reached (toast + autosave). index is into ChapterDef.checkpoints */
  checkpoint(index: number): void;
  /** finish the chapter successfully */
  complete(): void;
  fail(reason: string): void;
  /** game-time wait; never resolves after the level is disposed */
  wait(seconds: number): Promise<void>;
  waitUntil(pred: () => boolean, timeoutSec?: number): Promise<void>;
  /** subtitle line; resolves after it has been shown */
  say(speaker: Speaker, text: string, duration?: number): Promise<void>;
  spawnEnemy(spec: EnemySpec, pos: THREE.Vector3, facing?: number): Enemy;
  spawnAlly(spec: AllySpec, pos: THREE.Vector3, facing?: number): Ally;
  /** register a custom combatant (creatures, bosses, weak points) */
  addCombatant(c: Combatant): void;
  removeCombatant(c: Combatant): void;
  enemiesAlive(filter?: (c: Combatant) => boolean): number;
  wave(def: WaveDef): Promise<void>;
  /** bind the boss bar to a combatant (null hides) */
  boss(c: Combatant | null, name?: string): void;
  /** letterbox + disable player control */
  cinematic(on: boolean): void;
  cameraShot(shot: CameraShot | null): void;
  setEnvironment(env: EnvironmentName | EnvironmentPreset): void;
  /** per-frame callback (game dt), removed on dispose; returns remover */
  onUpdate(fn: (dt: number) => void): () => void;
  /** instanced background army */
  crowd(def: CrowdDef): CrowdHandle;
  /** deterministic RNG for this level */
  rng(): number;
  /** add a ground/terrain heightfield + mesh in one go (uses core terrain builder) */
  terrain(opts: TerrainOpts): { mesh: THREE.Mesh; heightAt: (x: number, z: number) => number };
  /** true once disposed (use to stop async scripts) */
  readonly disposed: boolean;
  /**
   * Pin the music mood (e.g. 'epic' for a charge, 'tension' before an ambush); null hands control
   * back to the adaptive score (explore / tension / combat / boss). Cleared when the level ends.
   */
  music?(mood: MusicMood | null): void;
}

export interface TerrainOpts {
  size: number;
  segments: number;
  height: (x: number, z: number) => number;
  /** palette for slope/height blending */
  style: 'forest' | 'riverbank' | 'snow' | 'rock' | 'plains' | 'ash' | 'cave' | 'mud';
  material?: SurfaceMaterial;
  /** centre offset */
  center?: [number, number];
  /** optional look tweaks understood by src/world/terrain.ts */
  theme?: 'mirkwood' | 'autumn' | 'wet' | 'dry';
  tint?: number;
  layers?: unknown;
  patchiness?: number;
  /** hidden skirt below the border (default true) */
  skirt?: boolean;
  cavity?: number;
}

export interface ChapterDef {
  id: string;
  /** 1..9 story order. 0 = dev arena (only with ?dev) */
  number: number;
  title: string;
  film: string;
  /** one-paragraph description for chapter select */
  blurb: string;
  environment: EnvironmentName;
  /** checkpoint labels, index 0 = chapter start */
  checkpoints: string[];
  /** par time for ranking (seconds) */
  parTime: number;
  /** Gimli kill-count rivalry active in this chapter */
  rivalry?: boolean;
  dev?: boolean;
  /**
   * Humanoid kinds this chapter spawns. The shell meshes them in worker threads during the loading
   * screen (preloadHumanoids) so createHumanoid is a cache hit in play. 'legolas' is always included.
   */
  preload?: HumanoidKind[];
  create(level: LevelAPI): ChapterInstance | Promise<ChapterInstance>;
}

export interface ChapterInstance {
  /** place the player and start scripts from checkpoint index */
  start(checkpoint: number): void;
  /** game-time update */
  update(dt: number): void;
  dispose?(): void;
  /** smoke-test autopilot hint: where the bot should go / look this frame */
  botHint?(): { moveTo?: THREE.Vector3; lookAt?: THREE.Vector3; interact?: boolean; jump?: boolean } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Game context
// ─────────────────────────────────────────────────────────────────────────────

export interface GameContext {
  engine: Engine;
  input: Input;
  audio: AudioSys;
  fx: Fx;
  hud: Hud;
  menus: Menus;
  physics: PhysicsWorld;
  combatants: CombatantRegistry;
  projectiles: Projectiles;
  player: PlayerAPI;
  time: TimeControl;
  progression: Progression;
  rivalry: Rivalry;
  /** current settings (alias of progression.data.settings) */
  readonly settings: Settings;
  /** parsed URL flags: ?dev=1 &bot=1 &quality=low &chapter=… &cp=… &seed=… &skipIntro=1 &god=1 */
  readonly flags: Readonly<Record<string, string>>;
}

/**
 * Test hooks exposed on window (set by main.ts):
 *   window.__snapReady = true      after the requested chapter (or lab subject) has loaded and rendered 2 frames
 *   window.__snapError = string    on fatal load error
 *   window.__game = {
 *     advance(sec: number, step?: number): void   // run the simulation in fixed steps without rendering
 *     startChapter(id: string, cp?: number): Promise<void>
 *     state(): object                              // {chapter, checkpoint, hp, enemies, kills, playerPos, mode}
 *     bot(on: boolean): void                       // autopilot for smoke tests (shoots nearest enemy, follows botHint)
 *   }
 *   window.scene / window.__THREE_CAMERA__ / window.__renderer__   (parallax-threejs devtools bridge)
 */
export interface GameTestHooks {
  advance(sec: number, step?: number): void;
  startChapter(id: string, cp?: number): Promise<void>;
  state(): Record<string, unknown>;
  bot(on: boolean): void;
}
