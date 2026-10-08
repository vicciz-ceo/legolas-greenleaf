/**
 * Kind registry. Discovers every `./kinds/*.ts` (eager glob), applies `_placeholders` first and the
 * other files after in sorted order, so a dresser's definition replaces the placeholder
 * deterministically. `extends` is resolved lazily against the final table.
 */
import type { HumanoidKind } from '../../core/types';
import type { KindDef, ResolvedKind, BodyBuild, FaceDef, AnimStyle } from './types';

export const ALL_KINDS: HumanoidKind[] = [
  'legolas', 'tauriel', 'elf', 'thranduil', 'aragorn', 'man', 'rohirrim', 'gondor', 'gimli', 'dwarf',
  'orc', 'goblin', 'gundabad', 'uruk', 'berserker', 'lurtz', 'bolg', 'easterling', 'haradrim', 'troll',
];

export const DEFAULT_BUILD: BodyBuild = {
  shoulders: 1,
  hips: 1,
  bulk: 1,
  belly: 0,
  chest: 1,
  armLength: 1,
  legLength: 1,
  headSize: 1,
  neck: 1,
  neckThick: 1,
  hunch: 0,
  handSize: 1,
  footSize: 1,
  muscle: 0.4,
};

export const DEFAULT_FACE: FaceDef = {
  jaw: 1,
  jawLength: 1,
  chin: 1,
  brow: 1,
  cheekbones: 1,
  nose: { length: 1, width: 1, bridge: 1, hook: 0, tip: 1, flat: 0 },
  lips: { width: 1, fullness: 1 },
  ears: 'round',
  earSize: 1,
  eyeSize: 1,
  eyeSpacing: 1,
  eyeTilt: 0.05,
  eyeOpen: 1,
  tusks: 0,
  underbite: 0,
  foreheadSlope: 0.15,
  asym: 0,
  cranium: 1,
};

export const DEFAULT_ANIM: AnimStyle = {
  hunch: 0,
  swagger: 0.2,
  aggression: 0.3,
  stance: 1,
  armSwing: 1,
  cadence: 1,
  grace: 0.3,
};

const DEFAULT_KIND: KindDef = {
  label: 'Man',
  height: 1.78,
  skin: { color: 0xc89878, color2: 0xb07a60, blotch: 0.25, blemish: 0.15, scars: 0, warts: 0, wrinkles: 0.15, lips: 0xb07068, scatter: 0xd04a30 },
  eyes: { color: 0x5a4a32, glow: 0, sclera: 0xe8e2d8 },
  hair: { style: 'short', color: 0x3a2a1c },
  beard: null,
  outfit: [
    { type: 'tunic', color: 0x6a5a44, length: 0.4 },
    { type: 'trousers', color: 0x4a3e30 },
    { type: 'boots', color: 0x3a2a1c },
    { type: 'belt', color: 0x2a1e14 },
  ],
  armor: [],
  weapons: { right: 'sword' },
  sfx: { voice: 'man', grunt: 'orc_grunt', die: 'orc_die', footstep: 'footstep', weight: 0.5 },
};

type KindModule = { kinds?: Partial<Record<HumanoidKind, KindDef>> };
const modules = import.meta.glob<KindModule>('./kinds/*.ts', { eager: true });

const table = new Map<HumanoidKind, KindDef>();
const order = Object.keys(modules).sort((a, b) => {
  const pa = a.includes('_placeholders') ? 0 : 1;
  const pb = b.includes('_placeholders') ? 0 : 1;
  return pa - pb || a.localeCompare(b);
});
for (const path of order) {
  const m = modules[path];
  for (const [k, def] of Object.entries(m.kinds ?? {})) {
    if (def) table.set(k as HumanoidKind, def);
  }
}

/** register/override a kind at runtime (tests, chapter-specific variants) */
export function registerKind(kind: HumanoidKind, def: KindDef) {
  table.set(kind, def);
  resolved.delete(kind);
}

export function kindDef(kind: HumanoidKind): KindDef | undefined {
  return table.get(kind);
}

const resolved = new Map<HumanoidKind, ResolvedKind>();

function mergeDefs(base: KindDef, over: KindDef): KindDef {
  return {
    ...base,
    ...over,
    build: { ...base.build, ...over.build },
    face: {
      ...base.face,
      ...over.face,
      nose: { ...base.face?.nose, ...over.face?.nose },
      lips: { ...base.face?.lips, ...over.face?.lips },
    },
    skin: over.skin ? { ...base.skin, ...over.skin } : base.skin,
    eyes: over.eyes ? { ...base.eyes, ...over.eyes } : base.eyes,
    anim: { ...base.anim, ...over.anim },
    sfx: { ...base.sfx, ...over.sfx },
    palette: { ...base.palette, ...over.palette },
    detail: { ...base.detail, ...over.detail },
    variation: { ...base.variation, ...over.variation },
    weapons: over.weapons ? { ...over.weapons } : base.weapons,
    extras: undefined,
  };
}

function flatten(kind: HumanoidKind, seen: Set<HumanoidKind>): { def: KindDef; extras: ((c: never) => void)[] } {
  const def = table.get(kind) ?? { ...DEFAULT_KIND, label: kind };
  if (def.extends && !seen.has(def.extends)) {
    seen.add(kind);
    const parent = flatten(def.extends, seen);
    const merged = mergeDefs(parent.def, def);
    return { def: merged, extras: def.extras ? [...parent.extras, def.extras] : parent.extras };
  }
  return { def: mergeDefs(DEFAULT_KIND, def), extras: def.extras ? [def.extras] : [] };
}

export function resolveKind(kind: HumanoidKind): ResolvedKind {
  const hit = resolved.get(kind);
  if (hit) return hit;
  const { def, extras } = flatten(kind, new Set([kind]));
  const skin = { ...DEFAULT_KIND.skin!, ...def.skin };
  const hairColor = def.hair?.color ?? 0x3a2a1c;
  const r: ResolvedKind = {
    kind,
    label: def.label ?? kind,
    height: def.height,
    build: { ...DEFAULT_BUILD, ...def.build },
    face: {
      ...DEFAULT_FACE,
      ...def.face,
      nose: { ...DEFAULT_FACE.nose, ...def.face?.nose },
      lips: { ...DEFAULT_FACE.lips, ...def.face?.lips },
    } as FaceDef,
    skin: {
      color: skin.color,
      color2: skin.color2 ?? skin.color,
      blotch: skin.blotch ?? 0.2,
      blemish: skin.blemish ?? 0.1,
      scars: skin.scars ?? 0,
      warts: skin.warts ?? 0,
      wrinkles: skin.wrinkles ?? 0.1,
      lips: skin.lips ?? skin.color,
      brows: skin.brows ?? hairColor,
      surface: skin.surface ?? 'skin',
      scatter: skin.scatter ?? 0xd04a30,
    },
    eyes: { color: def.eyes?.color ?? 0x4a3a28, glow: def.eyes?.glow ?? 0, sclera: def.eyes?.sclera ?? 0xe6e0d6 },
    hair: def.hair === undefined ? null : def.hair,
    beard: def.beard ?? null,
    outfit: def.outfit ?? [],
    armor: def.armor ?? [],
    weapons: def.weapons ?? {},
    palette: def.palette ?? {},
    sfx: def.sfx ?? {},
    anim: { ...DEFAULT_ANIM, ...def.anim },
    variation: { height: def.variation?.height ?? 0.03, bulk: def.variation?.bulk ?? 0.06, skin: def.variation?.skin ?? 0.05 },
    detail: {
      res: def.detail?.res ?? 0,
      headRes: def.detail?.headRes ?? 0,
      faceRes: def.detail?.faceRes ?? -1,
      detailScale: def.detail?.detailScale ?? Math.max(0.8, def.height / 1.85),
    },
    extras: extras as ResolvedKind['extras'],
  };
  resolved.set(kind, r);
  return r;
}

export function registeredKinds(): HumanoidKind[] {
  return ALL_KINDS.slice();
}
