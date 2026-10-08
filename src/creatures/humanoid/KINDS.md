# Dressing humanoid kinds

Every `HumanoidKind` is defined by a **`KindDef`** object. You never edit the humanoid system's
base files: add a file in `src/creatures/humanoid/kinds/` that exports

```ts
import type { HumanoidKind } from '../../../core/types';
import type { KindDef } from '../types';
export const kinds: Partial<Record<HumanoidKind, KindDef>> = { gimli: { … }, dwarf: { … } };
```

The registry (`registry.ts`) loads every `kinds/*.ts` with `import.meta.glob`, applies
`_placeholders.ts` first and the other files after it in **sorted file-name order**, so your
definition replaces the placeholder deterministically (one file per group: `elves.ts`,
`men.ts`, `dwarves.ts`, `orcs.ts`, `trolls.ts`…). A definition **replaces** the previous one for
that kind; to start from another kind use `extends: 'uruk'` (resolved after all files load).

Check your work in the Creature Lab: every kind has a subject `humanoid_<kind>` (Legolas is
`legolas`), and `humanoid_lineup` shows all kinds side by side at true scale:

```
node scripts/snap.mjs "/lab/?subject=humanoid_gimli&view=quad&anim=idle&t=1" --size 960x540 --out shots/gimli.png
node scripts/snap.mjs "/lab/?subject=humanoid_gimli&view=quad&anim=rest&focus=head&zoom=0.6" --out shots/gimli-face.png
node scripts/snap.mjs "/lab/?subject=humanoid_lineup&view=single&zoom=0.55" --size 1600x700 --out shots/lineup.png
```
Animations in the lab: `idle walk run slash backslash thrust overhead slam sweep shoot throw punch
stomp bite hit death block roar cheer stagger crouch` (`rest` = bind pose, for debugging skinning).
Debug URL flags: `&kitdebug=noao,nodetail,normals,noregions,no-<outfitType>` (e.g. `no-jerkin`).

## The KindDef format

| Field | What it controls |
|---|---|
| `height` (required) | total height in metres (crown). Everything scales from it. |
| `extends` | start from another kind |
| `build` | `shoulders hips bulk belly chest armLength legLength headSize neck neckThick hunch handSize footSize muscle` (multipliers, 1 = average man; `belly`, `hunch`, `muscle` 0..1) |
| `face` | `jaw jawLength chin brow cheekbones cranium foreheadSlope`, `nose{length width bridge hook tip flat}`, `lips{width fullness}`, `ears: 'round'│'pointed'│'long'│'small'│'orc'│'bat'`, `earSize`, `eyeSize eyeSpacing eyeTilt eyeOpen`, `tusks underbite asym` |
| `skin` | `color color2 blotch blemish scars warts wrinkles lips brows surface scatter` — `surface` is a kit preset (`skin`, `skin_weathered`, `skin_orc`, `skin_troll`), `scatter` the subsurface tint |
| `eyes` | `color glow sclera` (`glow` > 0 makes the irises emissive) |
| `hair` | `style` (`long_straight long_wavy shoulder short cropped mohawk topknot bald mane wild tied_back stringy`), `color tipColor length density braids('temple'│'side'│'many')` |
| `beard` | `style` (`full braided forked stubble goatee mustache`), `color`, `length` (m) |
| `outfit` | ordered layers `{type, color, color2?, mat?, length?, thickness?, chance?}`; types: `tunic shirt jerkin vest leggings trousers boots shoes bracers gloves cloak robe skirt loincloth belt sash collar hood scarf wraps rags fur_mantle mail_shirt gambeson` |
| `armor` | pieces `{type, style, color?, minArmor?, chance?}`; types `helmet pauldrons breastplate vambraces greaves gorget tassets shoulder_spikes plates crown circlet gauntlets mask`; styles `elven orc uruk rohan gondor dwarf easterling haradrim gundabad goblin ranger king`. A piece appears when `spec.armor ≥ minArmor`; helmets only when `spec.helmet !== false` |
| `weapons` | `{ right?, left?, back?: WeaponKind[], style? }` — `style` picks a weapon look (`'uruk'` → falchion + white-hand shield, `'gondor'`, `'dwarf'`, `'easterling'` shields…). Bows always go to the left hand; a default bow not in hand is shown stowed on the back |
| `palette` | named colours for your own extras |
| `sfx` | hints for gameplay/audio: `voice grunt hurt die roar footstep weight` |
| `anim` | `hunch swagger aggression stance armSwing cadence grace` — posture and gait character |
| `variation` | `height bulk skin` (± fractions) across the ≤4 seed buckets (bucket 0 is canonical) |
| `detail` | `res headRes faceRes detailScale` — mesh resolution (m) and procedural detail scale. Heroes set `faceRes` (≈0.0048) to get a fine face region; crowds leave it unset (≤ ~12k tris) |
| `extras(ctx)` | your hook: add sculpt primitives and attachments (below) |

How clothing works: garments re-emit the body's anatomy parts slightly inflated with their own
material and cut by planes (hems, sleeve ends), so they follow the body and skin perfectly.
Tunic/robe/skirt hems become separate skinned panels that swing (spring bones `skirt_f/b`);
cloaks are skinned sheets on two spring chains (`cloak1..3_l/r`).

### The `extras` hook

`extras(ctx: KindContext)` runs after the standard body, face, outfit and armour are sculpted:

```ts
extras: (ctx) => {
  const { sculpt: s, P, rig, rng } = ctx;
  // P.j.<bone>  rest joint positions (model space), P.h(x,y,z) head-unit → model point,
  // P.hp('l', along, thumb, palm) hand-frame point, P.s = height/1.85, P.headH, P.eyeR …
  s.cone(P.h(0.3, 0.2, 0), P.h(0.5, 0.5, -0.2), 0.03 * P.headH, 0.005 * P.headH, { bone: 'head', mat: 'horn', color: 0xd0c0a0 });
  s.ellipsoid(P.h(0, -0.1, 0.38), [0.1 * P.headH, 0.1 * P.headH, 0.1 * P.headH], { op: 'paint', color: 0xe8e4dc, bone: 'head' }); // war paint
  ctx.gear(new THREE.TorusGeometry(0.03, 0.006, 6, 12), { bone: 'head', color: 0xc8a050, mat: 'gold', matrix, small: true }); // merged rigid gear
  ctx.object(() => makeGlowingGem(), { bone: 'chest' });  // separate object (own material)
}
```

`ctx.gear(geometry, {bone, color, mat, matrix, small})` merges a rigid piece into the body draw
call (positions in model space at rest; `small` pieces are dropped at LOD2).
`ctx.object(make, {bone | socket, small})` adds a separate Object3D (positions in model space for
bones). Set `obj.userData.stowFor = { hand: 'hand_r', weapon: 'elven_knives' }` to hide it while
that hand holds that weapon (Legolas' sheathed knives do this).

---

## Worked example: Legolas (`kinds/legolas.ts`)

1. **Body** — tall and slender: `height: 1.85`, `bulk 0.88`, slightly narrow `shoulders 0.97`
   and `hips 0.94`, long legs `legLength 1.03`, long neck `neck 1.06, neckThick 0.9`.
2. **Face** — sharp and elegant: narrow `jaw 0.9` with a defined `chin 1.12`, high
   `cheekbones 1.1`, soft `brow 0.82`, fine straight nose (`length 0.98, width 0.84,
   bridge 1.1`), thin lips, almond eyes with a slight upward tilt `eyeTilt 0.1`, `ears: 'pointed'`.
   Fair skin with little blotching, warm scatter, blue eyes, dark-blond brows.
3. **Hair** — `long_straight` platinum blond (`color 0xd9c89c`, `tipColor 0xe8dbb6`) with
   `braids: 'temple'` (two braids from the temples joining at the back of the head). Long styles
   get a sculpted hair cap, strand cards that hug the scalp and fall down the back, and the
   `hair1..3` spring chain.
4. **Outfit** (order matters only for readability; layers are sorted inner → outer):
   leggings → boots (`length 0.86`, folded cuff) → tunic (green-grey, `length 0.5` → four skirt
   panels to mid-thigh) → suede jerkin (sleeveless, stand-up collar) → bracers (with tooled edge
   rings) → belt (with buckle).
5. **Weapons** — `left: 'elven_bow'`, `right: 'none'` (the right hand draws the string). The bow
   string follows the right hand while aiming; the arrow is shown nocked.
6. **Extras** — a leather baldric (torso parts inflated and cut by two planes into a diagonal
   band), the quiver on the back (`quiverGear`: tooled leather lathe, 16 white-fletched arrows)
   on the springy `quiver` bone, two sheaths, and the two white-handled knives as separate objects
   with `stowFor`, so they vanish from the back when the knives are drawn.
7. **Detail** — `faceRes: 0.0048` gives Legolas a fine face region (hero quality).

Result: ~25k triangles at LOD0 (body + clothing + gear in one draw call, hair, eyes), ~40% at LOD1.

## Performance rules of thumb

* Shared geometry is cached per (kind, seed bucket ≤ 4, armour level, helmet), so a crowd of 40
  orcs costs one build; instances only create bones and cloned materials.
* Budget: enemies ≤ 12k triangles (default resolutions), heroes ≤ 25k. Each extra garment layer
  adds SDF primitives (build time) but not many triangles.
* `preloadHumanoids(['orc','uruk'])` warms the cache during a loading screen.
