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

Lab URL options for humanoid subjects:

| Option | Effect |
|---|---|
| `&portrait=1&focus=head&zoom=0.15` | frame the face (quivers, bows and helmets no longer push the head-focus framing off the face) |
| `&weapons=none` | no held or stowed weapons (clean silhouettes / close-ups) |
| `&weapon=crossbow&offhand=none` | override the held items |
| `&lod=1` / `&lod=2` | preview the reduced geometry and the cheap animation path |
| `&kitdebug=…` | `noao`, `nodetail`, `normals`, `noregions`, `norefine`, `seam` (seam channel view), `noeyes`, `nohair`, `no-<outfitType>` (e.g. `no-jerkin`) |

Subject `kit_placeholder_troll` shows the kit's fallback troll even when a dresser defines the troll.

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
| `detail` | `res headRes faceRes detailScale` — mesh resolution (m) and procedural detail scale. Heroes set `faceRes` (≈0.0048) to get a fine face region, fine ear and hand regions and two seam-refinement levels; crowds leave it unset (one refinement level, ≤ ~12k tris) |
| `extras(ctx)` | your hook: add sculpt primitives and attachments (below) |

How clothing works: garments re-emit the body's anatomy parts slightly inflated with their own
material and cut by planes (hems, sleeve ends), so they follow the body and skin perfectly.
Material boundaries stay crisp (the mesher splits every edge that crosses a colour/material
change, see the kit README "Crisp seams"), and garment edges are **stitched and worn**
automatically: jerkin/vest hem, neckline and armholes, tunic/shirt neckline and sleeve cuffs,
belt edges, bracer ends, boot tops and the hems/edges of skirt panels and cloaks. To stitch an
edge of your own garment in `extras`, add a seam paint plane (same plane as the cut) inside the
garment's group: `s.plane(n, d, { op: 'paint', seam: 0, k: 0.002 })`.

Faces: every kind gets the same sculpted head (full midface and cheek pads, eyelid shells with an
almond opening, nose, lips) driven by `face`; kinds with ordinary skin (`skin.surface: 'skin'`, or
`brow ≤ 1.5`) also get eyelashes and eyebrow hair cards in `skin.brows` (lashes a darker shade),
placed on the sculpted surface. Lip colour is `skin.lips`; light skins get a faint warmth on the
cheeks, nose and ears automatically.
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
3. **Hair** — `long_straight` warm pale gold (`color 0xd2b984`, `tipColor 0xe6d3a2`) with
   `braids: 'temple'` (two thin braids from the temples lying on top of the hair, joining at the
   back of the head). Long styles get a sculpted scalp cap (a shade darker than the strands, with a
   soft hairline that leaves the temples covered and only clears the ears), ~300 strand cards in
   three layers combed back over the scalp and falling down the back behind the ears (lengths
   vary for tapered ends, roots darker), a row of fine cards along the hairline, and the
   `hair1..3` spring chain.
4. **Outfit** (order matters only for readability; layers are sorted inner → outer):
   leggings → boots (`length 0.86`, folded cuff) → tunic (green-grey, `length 0.5` → four skirt
   panels to mid-thigh) → suede jerkin (sleeveless: wraps the ribs and opens only at the shoulder
   joint) → bracers → belt (with buckle). Every edge is stitched and worn (see above).
5. **Weapons** — `left: 'elven_bow'`, `right: 'none'` (the right hand draws the string). The bow
   string follows the right hand while aiming; the arrow is shown nocked. During the `climb`,
   `hang`, `swing` and `barrel` special poses the bow is stowed on the back automatically and
   returned to the hand afterwards (any kind holding a bow).
6. **Extras** — a leather baldric (torso parts inflated and cut by two planes into a diagonal
   band), the quiver on the back (`quiverGear`: tooled leather lathe, 16 white-fletched arrows)
   on the springy `quiver` bone, two sheaths, and the two white-handled knives as separate objects
   with `stowFor`, so they vanish from the back when the knives are drawn.
7. **Detail** — `faceRes: 0.0048` gives Legolas a fine face region (hero quality).

Result: ~57k triangles at LOD0 (body + clothing + gear ≈ 37k in one draw call, hair + lashes +
brows ≈ 18k, eyes), ~12.6k at LOD1, ~5.8k at LOD2.

## Performance rules of thumb

* Shared geometry is cached per (kind, seed bucket ≤ 4, armour level, helmet), so a crowd of 40
  orcs costs one build; instances only create bones and cloned materials.
* Budget: enemies ≤ 12k triangles (default resolutions), heroes ≈ 40–60k at LOD0 (one or two on
  screen) and ≈ 10–13k at LOD1. Each extra garment layer adds SDF primitives (build time) but not
  many triangles.
* **Loading screens:** `await preloadHumanoids(['orc', 'uruk', 'troll'], { seeds, onProgress })`
  sculpts each kind on the main thread (≈ 20–60 ms each) and meshes LOD0 + LOD1 of all of them in
  parallel in the kit worker pool; `createHumanoid` afterwards is a cache hit (~5 ms). Without a
  preload, the first `createHumanoid` of a kind meshes LOD0 synchronously and defers LOD1/2.
* **LOD:** `setLod(1 | 2)` switches to reduced geometry *and* the cheap animation path: no spring
  bones (hair/skirt/cloak/quiver rest rigidly), no look-at, swing-only limb IK (`fastTwoBone`),
  hand frames only at LOD1 (weapons still point right), fingers re-posed only when the grip
  changes, and constant bones (fingers, toes, spring chains) skip their matrix recompose. Bow
  aiming always uses the full solve. 40 orcs: ≈ 0.5–0.6 ms per step to animate at LOD1/2 (node,
  was 1.7–1.9 ms), ≈ 1.2–1.4 ms including three's bone matrix update (was 2.7–2.9 ms).
* Benchmarks (browser): `node scripts/snap.mjs "/lab/?subject=humanoid_orc&view=single" --eval
  "__kitBench.anim(40, 300)"` and `--eval "__kitBench.build()"` (sync vs worker preload).
