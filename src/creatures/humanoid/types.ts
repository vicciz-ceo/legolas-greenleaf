/**
 * Humanoid kind definitions. Dressers add/override kinds in `kinds/<group>.ts`:
 *
 *   export const kinds: Partial<Record<HumanoidKind, KindDef>> = { gimli: { … } };
 *
 * Every field is optional except `height`; anything omitted falls back to DEFAULT_KIND (an
 * average human man in plain clothes). Use `extends` to start from another kind.
 * See KINDS.md for a guide with Legolas as the worked example.
 */
import type * as THREE from 'three';
import type { HumanoidKind, HumanoidSpec, SfxName, WeaponKind } from '../../core/types';
import type { Rng } from '../../core/rng';
import type { Sculpt, V3 } from '../kit/sdf';
import type { RigDef } from '../kit/rig';
import type { SurfaceName, SurfaceSpec } from '../kit/surfaces';
import type { Proportions } from './proportions';
import type { WeaponStyle } from '../weapons';

export interface BodyBuild {
  /** shoulder width multiplier (1 = average man) */
  shoulders: number;
  hips: number;
  /** girth of limbs and torso (muscle + fat) */
  bulk: number;
  /** 0..1 belly */
  belly: number;
  /** chest depth multiplier */
  chest: number;
  /** limb length multipliers */
  armLength: number;
  legLength: number;
  headSize: number;
  /** neck length & thickness multipliers */
  neck: number;
  neckThick: number;
  /** 0..1 permanent forward hunch (posture) */
  hunch: number;
  handSize: number;
  footSize: number;
  /** 0..1 visible muscle definition */
  muscle: number;
}

export type EarShape = 'round' | 'pointed' | 'long' | 'small' | 'orc' | 'bat';

export interface FaceDef {
  /** jaw width multiplier */
  jaw: number;
  /** jaw/chin length (face height below the mouth) */
  jawLength: number;
  /** chin prominence 0..1.5 */
  chin: number;
  /** brow ridge prominence 0..2 (orcs/trolls ~1.5) */
  brow: number;
  cheekbones: number;
  nose: { length: number; width: number; bridge: number; hook: number; tip: number; flat?: number };
  lips: { width: number; fullness: number };
  ears: EarShape;
  /** ear size multiplier */
  earSize: number;
  eyeSize: number;
  eyeSpacing: number;
  /** almond tilt (radians, + = outer corners up) */
  eyeTilt: number;
  /** eyelid opening 0.5 (squint) … 1.3 (wide) */
  eyeOpen: number;
  /** lower tusks size (0 = none) */
  tusks: number;
  /** under-bite / protruding jaw 0..1 */
  underbite: number;
  /** forehead slope 0 (vertical) … 1 (sloped back, orcs) */
  foreheadSlope: number;
  /** 0..1 deliberate asymmetry (orcs, goblins) */
  asym: number;
  /** cranium height multiplier */
  cranium: number;
}

export interface SkinDef {
  color: number;
  /** blotch colour mixed by noise */
  color2?: number;
  /** 0..1 amount of color2 blotches */
  blotch?: number;
  /** 0..1 small dark spots / blemishes */
  blemish?: number;
  /** number of scars on the face/body (0..5) */
  scars?: number;
  /** 0..1 wart bumps (goblins, trolls) */
  warts?: number;
  /** 0..1 wrinkles */
  wrinkles?: number;
  lips?: number;
  /** eyebrow colour (defaults to hair colour) */
  brows?: number;
  surface?: SurfaceName;
  /** subsurface scatter tint (sRGB), e.g. warm red for humans, greenish for orcs */
  scatter?: number;
}

export interface EyeDef {
  color: number;
  /** emissive glow 0..3 (orc/goblin eyes in the dark) */
  glow?: number;
  sclera?: number;
}

export type HairStyle = 'long_straight' | 'long_wavy' | 'shoulder' | 'short' | 'cropped' | 'mohawk' | 'topknot' | 'bald' | 'mane' | 'wild' | 'tied_back' | 'stringy';

export interface HairDef {
  style: HairStyle;
  color: number;
  tipColor?: number;
  /** length multiplier on the style's default */
  length?: number;
  /** 'temple': two thin braids from the temples meeting at the back (elves) */
  braids?: 'temple' | 'side' | 'many' | 'none';
  /** density multiplier (strand count) */
  density?: number;
  /** spring response 0..1 */
  bounce?: number;
}

export interface BeardDef {
  style: 'full' | 'braided' | 'forked' | 'stubble' | 'goatee' | 'mustache';
  color: number;
  /** length in metres below the chin */
  length: number;
}

export type OutfitType =
  | 'tunic' | 'shirt' | 'jerkin' | 'vest' | 'leggings' | 'trousers' | 'boots' | 'shoes' | 'bracers' | 'gloves'
  | 'cloak' | 'robe' | 'skirt' | 'loincloth' | 'belt' | 'sash' | 'collar' | 'hood' | 'scarf' | 'wraps' | 'rags'
  | 'fur_mantle' | 'mail_shirt' | 'gambeson';

export interface OutfitLayer {
  type: OutfitType;
  color: number;
  /** trim / secondary colour */
  color2?: number;
  mat?: SurfaceName | SurfaceSpec;
  /** 0..1 length (tunic/robe/cloak hem, sleeve length…; bracers: fraction of the forearm
   *  covered from the wrist, default 0.7) */
  length?: number;
  /** belt/sash: height offset (m at 1.85 m scale) from the default just above the hip joints */
  offset?: number;
  /** extra thickness (m) */
  thickness?: number;
  /** probability this layer appears (seed-varied crowds) */
  chance?: number;
}

export type ArmorType =
  | 'helmet' | 'pauldrons' | 'breastplate' | 'vambraces' | 'greaves' | 'gorget' | 'tassets' | 'shoulder_spikes'
  | 'plates' | 'crown' | 'circlet' | 'gauntlets' | 'mask';
export type ArmorStyle = 'elven' | 'orc' | 'uruk' | 'rohan' | 'gondor' | 'dwarf' | 'easterling' | 'haradrim' | 'gundabad' | 'goblin' | 'ranger' | 'king';

export interface ArmorPiece {
  type: ArmorType;
  style: ArmorStyle;
  color?: number;
  /** piece appears when spec.armor (default 0.5) ≥ minArmor */
  minArmor?: number;
  /** seed probability */
  chance?: number;
  /** helmets: shown only when spec.helmet !== false (default true) */
}

export interface SfxHints {
  voice?: 'elf' | 'man' | 'dwarf' | 'orc' | 'goblin' | 'uruk' | 'troll';
  grunt?: SfxName;
  hurt?: SfxName;
  die?: SfxName;
  roar?: SfxName;
  footstep?: SfxName;
  /** body weight class for impacts 0..1 */
  weight?: number;
}

export interface AnimStyle {
  /** 0..1 posture hunch while moving/idle */
  hunch: number;
  /** 0..1 shoulder/hip swagger in the gait */
  swagger: number;
  /** 0..1 aggression: wider stance, raised weapon, bigger attack wind-ups */
  aggression: number;
  /** stance width multiplier */
  stance: number;
  /** arm swing multiplier */
  armSwing: number;
  /** cadence multiplier (1 = natural for leg length) */
  cadence: number;
  /** 0..1 elegance: lighter steps, straighter back (elves) */
  grace: number;
}

export interface KindWeapons {
  right?: WeaponKind;
  left?: WeaponKind;
  /** look variant passed to createWeapon (e.g. 'uruk' → falchion & white-hand shield) */
  style?: WeaponStyle;
  /** stowed on the back (bows, swords, axes) */
  back?: WeaponKind[];
}

export interface VariationDef {
  /** ± fraction of height across seed buckets */
  height?: number;
  /** ± bulk */
  bulk?: number;
  /** ± skin value/hue shift */
  skin?: number;
}

export interface DetailDef {
  /** body cell size (m), default 0.019 × height/1.85 */
  res?: number;
  /** head region cell size */
  headRes?: number;
  /** face (eyes/nose/mouth) region cell size; 0 disables the face region */
  faceRes?: number;
  /** procedural detail scale (1 human, 2.5 troll) */
  detailScale?: number;
  /** seam-refinement levels (default: 2 with a face region, else 1). Named NPCs with a face
   *  region use 1 to stay within their budget. */
  refine?: number;
  /** fine hand regions (default: on with a face region) */
  hands?: boolean;
}

/** Everything an `extras` hook may use to add custom sculpt primitives and attachments. */
export interface KindContext {
  kind: HumanoidKind;
  def: ResolvedKind;
  spec: HumanoidSpec;
  /** proportions: joint positions, limb lengths, head frame helpers */
  P: Proportions;
  rig: RigDef;
  /** the body sculpt (skin + clothing). Add primitives with bones from `rig`. */
  sculpt: Sculpt;
  rng: Rng;
  /** add a rigid piece of gear (merged into the body draw call), skinned 100% to `bone` */
  gear(geometry: THREE.BufferGeometry, o: { bone: string; color: number; mat?: SurfaceName | SurfaceSpec; matrix?: THREE.Matrix4; small?: boolean }): void;
  /** add a separate object parented to a bone or socket at build time (e.g. glowing gems) */
  object(make: () => THREE.Object3D, o: { bone?: string; socket?: string; small?: boolean }): void;
  /** armour coverage 0..1 */
  armor: number;
  helmet: boolean;
}

export interface KindDef {
  /** start from another kind (resolved after every kinds file is loaded) */
  extends?: HumanoidKind;
  label?: string;
  height: number;
  build?: Partial<BodyBuild>;
  face?: Partial<Omit<FaceDef, 'nose' | 'lips'>> & { nose?: Partial<FaceDef['nose']>; lips?: Partial<FaceDef['lips']> };
  skin?: SkinDef;
  eyes?: EyeDef;
  hair?: HairDef | null;
  beard?: BeardDef | null;
  outfit?: OutfitLayer[];
  armor?: ArmorPiece[];
  weapons?: KindWeapons;
  /** named colours for extras / dressers */
  palette?: Record<string, number>;
  sfx?: SfxHints;
  anim?: Partial<AnimStyle>;
  variation?: VariationDef;
  detail?: DetailDef;
  /** custom sculpt primitives / attachments; runs after the standard body is sculpted */
  extras?: (ctx: KindContext) => void;
}

export interface ResolvedKind {
  kind: HumanoidKind;
  label: string;
  height: number;
  build: BodyBuild;
  face: FaceDef;
  skin: Required<Omit<SkinDef, 'surface' | 'brows'>> & { surface: SurfaceName; brows: number };
  eyes: Required<EyeDef>;
  hair: HairDef | null;
  beard: BeardDef | null;
  outfit: OutfitLayer[];
  armor: ArmorPiece[];
  weapons: KindWeapons;
  palette: Record<string, number>;
  sfx: SfxHints;
  anim: AnimStyle;
  variation: Required<VariationDef>;
  detail: Required<Omit<DetailDef, 'refine' | 'hands'>> & Pick<DetailDef, 'refine' | 'hands'>;
  extras: ((ctx: KindContext) => void)[];
}

export type { V3 };
