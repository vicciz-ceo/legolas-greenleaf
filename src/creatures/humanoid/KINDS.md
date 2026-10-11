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
| `skin` | `color color2 blotch blemish scars warts wrinkles lips brows surface scatter` — `surface` is a kit preset (`skin`, `skin_weathered`, `skin_brute` (sweaty sheen: Uruk-hai, Lurtz, berserker), `skin_scarred` (procedural healed cuts: Bolg), `skin_orc`, `skin_troll`), `scatter` the subsurface tint. Keep albedos plausible: fair skin ≈ `0xd9ab8c`, pale brute ≈ `0x9e7b6b` (the lab and the game's AgX render them lighter and greyer than the hex suggests) |
| `eyes` | `color glow sclera` (`glow` > 0 makes the irises emissive) |
| `hair` | `style` (`long_straight long_wavy shoulder short cropped mohawk topknot bald mane wild tied_back stringy`), `color tipColor length density braids('temple'│'side'│'many')`. `length` also moves the end height of long styles |
| `beard` | `style` (`full braided forked stubble goatee mustache`), `color`, `length` (m) |
| `outfit` | ordered layers `{type, color, color2?, mat?, length?, thickness?, offset?, chance?, tatter?, strips?}` (bracers: `length` = fraction of the forearm from the wrist, default 0.7; belt/sash: `offset` raises it (m); skirt: `thickness` adds clearance for bodies bigger than the anatomy, `mat: 'rags'` tears the hem; skirt/loincloth: `tatter` (m) cuts torn zig-zag points into the hem, `strips: { count, color, color2?, mat?, width, length, phase? }` hangs pointed leather strips over the cloth (Bolg's and Lurtz's layered kilts); jerkin/vest: `color2` mottles the leather; any layer: `mat: 'leather_tooled'` for embossed leaf work, `'twill'` for wool twill); types: `tunic shirt jerkin vest leggings trousers boots shoes bracers gloves cloak robe skirt loincloth belt sash collar hood scarf wraps rags fur_mantle mail_shirt gambeson` |
| `armor` | pieces `{type, style, color?, minArmor?, chance?}`; types `helmet pauldrons breastplate vambraces greaves gorget tassets shoulder_spikes plates crown circlet gauntlets mask`; styles `elven orc uruk rohan gondor dwarf easterling haradrim gundabad goblin ranger king`. A piece appears when `spec.armor ≥ minArmor`; helmets only when `spec.helmet !== false` |
| `weapons` | `{ right?, left?, back?: WeaponKind[], style? }` — `style` picks a weapon look (`'uruk'` → falchion + white-hand shield, `'orc'` → the mace becomes a spiked morning star (Bolg, Gundabad), `'gondor'`, `'dwarf'`, `'easterling'` shields…). Bows always go to the left hand; a default bow not in hand is shown stowed on the back |
| `palette` | named colours for your own extras |
| `sfx` | hints for gameplay/audio: `voice grunt hurt die roar footstep weight` |
| `anim` | `hunch swagger aggression stance armSwing cadence grace` — posture and gait character |
| `variation` | `height bulk skin` (± fractions) across the ≤4 seed buckets (bucket 0 is canonical) |
| `detail` | `res headRes faceRes detailScale refine hands` — mesh resolution (m) and procedural detail scale. Heroes set `faceRes` (≈0.0048) to get a fine face region, fine ear and hand regions and two seam-refinement levels; crowds leave it unset (one refinement level, ≤ ~12k tris). Named NPCs take a face region within ~45k with `faceRes ≈ 0.0056, refine: 1, hands: false` (Tauriel, Thranduil, Aragorn, Gimli) |
| `extras(ctx)` | your hook: add sculpt primitives and attachments (below) |

How clothing works: garments re-emit the body's anatomy parts slightly inflated with their own
material and cut by planes (hems, sleeve ends), so they follow the body and skin perfectly.
Material boundaries stay crisp (the mesher splits every edge that crosses a colour/material
change, see the kit README "Crisp seams"), and garment edges are **stitched and worn**
automatically: jerkin/vest hem, neckline and armholes, tunic/shirt neckline and sleeve cuffs,
belt edges, bracer ends, boot tops and the hems/edges of skirt panels and cloaks. To stitch an
edge of your own garment in `extras`, add a seam paint plane (same plane as the cut) inside the
garment's group: `s.plane(n, d, { op: 'paint', seam: 0, k: 0.002 })`.

Belts get a buckle automatically (heroes, i.e. kinds with a `faceRes`: a cast oval frame with a
tongue in `palette.buckle`; crowds: a 12-triangle plate). Eyes are wet clear-coated eyeballs with a
corneal bulge; the iris is looked up through the cornea with a view-dependent offset (parallax
depth), the sclera is never paper-white and the upper lid shades the eyeball (heroes: a finer eye
mesh).

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
3. **Hair** — `long_straight` warm platinum (`color 0xc9ae80`, `tipColor 0xe1d4af`, sheet colours)
   with `braids: 'temple'`: half-up elven hair. Long styles get a sculpted scalp cap and ~280
   strand cards in two layers so no card start or tip lies on the crown: **A**, the outer sweep,
   rooted in rows along the hairline and combed up and back over the top (with temple braids it
   is steered to the braids' meeting point at the back of the crown, then falls), and **B**, the
   back layer behind the ears and below the braid line. Cards hug the scalp with little gravity,
   are sampled densely where they bend over the skull (`adaptive`), and every card has its own
   lift (no coplanar z-fighting). Below the scalp the strands **clump into locks**
   (`clumpStrands`: per-lock tone, cards turned around the lock, outer members trimmed shorter)
   so the ends are soft tapered points in a gentle V, not a straw fringe. Skinning: head on the
   scalp, then the `hair1..3` spring chain behind the neck — whose twist follows the chest
   (`SpringChain` `frame`), so a turned head (aiming) no longer swings the hair through the
   shoulder — and the chest bone for side locks. `shoulder` hair has a centre part and waves
   (Aragorn). Lab: `?kitdebug=hairlayers` tints A/B, `noclump` skips the clumping; subject
   `legolas_shoulder` shows him from behind as the game camera does (`&yaw=` turns him).
4. **Outfit** (order matters only for readability; layers are sorted inner → outer):
   dark brown wool leggings (`mat: twill` variant) → tooled boots (`length 0.86`, folded cuff) →
   olive grey-green wool twill tunic (`length 0.5` → four skirt panels to mid-thigh) → tooled
   leather jerkin (`mat: leather_tooled`; sleeveless: wraps the ribs and opens only at the shoulder
   joint; `color2` mottles it) → tooled bracers (`length 0.9`, wrist to elbow, `thickness` so they
   stand proud) → belt (`offset` raises it to the waist, bronze buckle). The jerkin's skirt below
   the belt (flat-backed, split at the back, open at the front) is sculpted in `extras`. Every edge
   is stitched and worn (see above).
5. **Weapons** — `left: 'elven_bow'`, `right: 'none'` (the right hand draws the string). The bow
   string follows the right hand while aiming; the arrow is shown nocked. During the `climb`,
   `hang`, `swing` and `barrel` special poses the bow is stowed on the back automatically and
   returned to the hand afterwards (any kind holding a bow).
6. **Extras** — a leather baldric (torso parts inflated and cut by two planes into a diagonal
   band) with a bronze ring buckle on the right breast (placed with the uruks' `makeProjector` +
   `snapPoint` on the finished sculpt), raised darker rolls at both bracer ends (the forearm part
   inflated a little more and cut by two planes), the tooled quiver (`QuiverOpts.mat`) on the right back (`quiverGear`: tooled leather lathe, 16 arrows standing
   nock-up so the white fletchings show) on the springy `quiver` bone, two sheaths side by side on
   its spine side (`sheathSide: -1`), and the two white-handled knives as separate objects with
   `stowFor`, so they vanish from the back when the knives are drawn.
7. **Detail** — `faceRes: 0.0048` gives Legolas a fine face region (hero quality).

Result: ~63k triangles at LOD0 (body + clothing + gear ≈ 39k in one draw call, hair + braids +
lashes + brows ≈ 18k, eyes ≈ 2k), ~19k at LOD1 in the lab (body, hair, eyes), ~6.5k at LOD2. The
bow (a separate object) is a Galadhrim recurve: golden wood with leaf work carved by the shader,
dark curled tips, a leather grip wrap between two metal rings.

## Worked example: Bolg (`kinds/uruks_bosses/bolg.ts`)

2.6 m, ~43k triangles at LOD0. What makes him read at the duel distance:
* **Muscle at a resolution that can show it**: `detail.res 0.038` (was 0.05 — 5 cm cells cannot
  draw an abdominal), `brawnBody` masses, `bareTorso` abs/clavicles/ribs, extra pecs with a defined
  lower edge, serratus ridges and a sternum/linea alba groove, all projected onto the finished body.
* **Skin**: `skin_scarred` (pale warm albedo `0x9e7b6b`, procedural healed cuts everywhere) plus a
  few carved face scars and raised arm welts; a painted beard shadow over the jaw, chin and cheeks.
* **Head**: `headSize 1.12`, heavy brow, small amber eyes, flattened nose, lower fangs that come
  forward with the under-bite, orc ears; a face region (`faceRes 0.009`, `refine 1`, `hands: false`)
  keeps the features crisp inside the boss budget. Hardware is an iron band bolted down the left side
  of the skull continuing as a brace along the jaw (no helmet rim, no chin plate).
* **Kit**: tattered leather mantle under three rust-brown iron lames with a crown of spikes and
  rivets (`bolgPauldron`), spiked leather bracers with iron bands, X straps with an iron ring and
  rivets, a wide two-tier riveted belt with a front ring, a tattered kilt with leather strips
  (`tatter`, `strips`), strapped greaves with iron splints and a spiked knee cap over the shin wraps,
  sandals, and the `'orc'`-style morning star.

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
