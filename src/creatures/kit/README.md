# Creature construction kit

Everything you need to build a skinned, animated, film-look creature **in code**:

| # | Capability | Where |
|---|---|---|
| 1 | Rig builder (bones at rest-pose joint positions → `THREE.Bone`s + `Skeleton`) | `rig.ts` — `RigDef` |
| 2 | SDF sculpting: round cone / capsule / sphere / tube, ellipsoid, rounded box, torus, plane; smooth union / subtract / intersect (blend `k`), nested groups, paint-only primitives, per-primitive bone(s), colour, surface preset and noise displacement | `sdf.ts` — `Sculpt` |
| 3 | Narrow-band surface nets with Newton projection, SDF-gradient normals, fine **detail regions** (face, hands) stitched invisibly, SDF ambient occlusion, cached per definition hash | `mesher.ts`, `cache.ts` |
| 4 | Auto-skinning: weights from primitive ownership, blended over `skinK` across unions, bone→bone blends along a primitive, Laplacian smoothing, top-4 | `sdf.ts` + `mesher.ts` |
| 5 | Surface detail: vertex colour + per-vertex surface (roughness, metalness, sheen, skin scatter) + 8 procedural detail patterns (pores, weave, leather, scales/mail, chitin, fur/wood, scratches, wrinkles) evaluated in the rest pose in the shader; skin wrap-lighting | `surfaces.ts`, `material.ts` |
| 6 | Rigid attachments merged into the body draw call (`paintGeometry`, `segmentMatrix`, `limbSegment`); parametric skinned sheets (wings, cloaks, sails) | `geometry.ts`, `sheet.ts` |
| 6b | Hair & fur: strands grown under gravity around ellipsoid colliders (scalp hugging), cards + braids, Kajiya-Kay highlight, spring bones | `hair.ts`, `anim.ts` |
| 7 | Procedural animation: `PoseSolver` (FK), `solveTwoBone` IK, `aimBone`, `lookAt`, `SpringChain`, `bipedGait`, `quadGait`, `insectGait` (alternating tetrapod), `wingFlap`, `PoseBuffer` layering/masks, `envelope` | `anim.ts` |
| 8 | One-call assembly with geometry sharing between instances | `creature.ts` — `buildCreature` |

Import from `src/creatures/kit` (the `index.ts` re-exports everything).

Runnable examples (also lab subjects — start from these):

| Lab subject | File | Shows |
|---|---|---|
| `kit_demo_spider` | `examples/spider.ts` | 8-leg tetrapod gait + IK, rigid leg segments, bristle strands, rear-up attack, curled death |
| `kit_demo_quadruped` | `examples/quadruped.ts` | warg: quadGait walk/trot/gallop, digitigrade hind legs, tail springs, fur that lies on the body |
| `kit_demo_bat` | `examples/bat.ts` | wing bones + membrane sheets, wingFlap, glide/screech/perch |

The humanoid system (`createHumanoid`, `src/creatures/humanoid*`) is built on this kit, so it is
also the largest example (anatomy re-emitted as clothing, face sculpt, hair, IK animator).

---

## Conventions

* Metres, +Y up, creatures face **+Z**. The creature's **left is +X** (`_l` bones at +X).
* Bones are declared with **model-space rest positions** and **identity rest rotations**, so a
  local rotation is expressed in model axes at rest (rotate a thigh about X to swing it forward).
* Sculpt in the rest pose with limbs apart (an A-pose for arms) so smooth unions don't fuse them.
* Everything is deterministic: `pose(anim, t)` must produce the same pose for the same `t`.
  Springs are deterministic for a given dt sequence — the lab pre-rolls them from a reset.

## 1. Rig

```ts
import { RigDef } from '../kit';
const rig = new RigDef()
  .bone('root', null, [0, 0, 0])
  .bone('body', 'root', [0, 0.8, 0])
  .pair('leg_l', 'body', [0.2, 0.7, 0.1])     // adds leg_l and its mirror leg_r
  .bone('tail1', 'body', [0, 0.8, -0.5]);
rig.at('leg_l', 0, -0.1, 0);   // joint position + offset (model space)
rig.lerp('body', 'tail1', 0.5); // point between joints
const inst = rig.instantiate(); // fresh Bones + Skeleton (bone inverses shared)
```

## 2. Sculpt

```ts
import { Sculpt, surface } from '../kit';
const s = new Sculpt(rig, { skinK: 0.04 });          // skinK: default skin-weight blend radius
s.set({ bone: 'body', mat: 'scales', color: 0x4a5a3a }); // defaults for the following prims
s.ellipsoid([0, 0.8, 0], [0.3, 0.25, 0.5], { k: 0.05 });
s.capsule(rig.at('body'), rig.at('tail1'), 0.12, { bone: 'tail1', k: 0.08 });
s.cone(a, b, 0.1, 0.03, { bone: 'leg_l', bone2: 'foot_l', blend: [0.6, 1] }); // weights blend along a→b
s.box(c, [0.1, 0.05, 0.2], 0.02, { rot: [0, 0.3, 0] });
s.torus(c, 0.2, 0.03, { rot: [Math.PI / 2, 0, 0] });
s.tube([p0, p1, p2, p3], [0.1, 0.08, 0.05, 0.02]);   // chain of round cones (tails, horns)
s.sphere(eye, 0.05, { op: 'subtract', k: 0.01 });     // carve
s.ellipsoid(c, r, { op: 'paint', color: 0xaa2222, k: 0.02 }); // colour/material only
s.group('union', 0.01, () => {                        // nested group: shape then cut
  s.ellipsoid(c, r);
  s.plane([0, 1, 0], 0.9, { op: 'intersect' });       // keep y ≤ 0.9
});
s.mirrored(() => s.capsule(rig.at('leg_l'), rig.at('foot_l'), 0.05, { bone: 'leg_l' })); // left + mirrored right
s.with({ noise: { amp: 0.004, freq: 60, type: 'cells' } }, () => { /* warts / scales */ });
```

Primitive options (`PrimOpts`): `op` (`union`/`subtract`/`intersect`/`paint`), `k` (blend radius),
`bone`, `bone2` + `blend` + `blendAxis` (weight blend along an axis), `skinK`, `color`,
`color2` + `colorNoise` + `colorFreq` (blotches), `mat` (surface preset name or `surface(...)`),
`noise` (`fbm` / `ridged` wrinkles / `cells` warts & scales / `dents`), `strength` (paint),
`paintCarve` (repaint carved surfaces), `rot` (Euler or quaternion).

Surface presets (`SURFACES`): `skin`, `skin_weathered`, `skin_orc`, `skin_troll`, `lips`, `nail`,
`horn`, `bone`, `teeth`, `eye`, `cloth`, `linen`, `wool`, `rags`, `leather`, `suede`,
`leather_worn`, `metal`, `metal_dark`, `metal_rusty`, `gold`, `mail`, `wood`, `chitin`, `scales`,
`fur`, `hair`, `hide`, `membrane`, `stone`. Derive variants with
`surface('chitin', { rough: 0.5, pat: { fur: 1 } })`.

## 3. Mesh (and cache)

```ts
import { meshSculpt, meshDataToGeometry } from '../kit';
const data = meshSculpt(s, {
  res: 0.025,                                   // cell size (m)
  regions: [{ min: headMin, max: headMax, res: 0.008 }], // finer detail, invisible seams
  ao: { dist: 0.08 },                           // SDF ambient occlusion (false to disable)
  smooth: 2,                                    // skin-weight smoothing iterations
});
const geo = meshDataToGeometry(data);           // cached per (sculpt hash + options)
```

Guidelines: thin parts need ≥ 2 cells across — mesh legs/fingers of insects as rigid
`limbSegment`s instead (see the spider). Rough budget: triangles ≈ 2.6 × area / res².

## 4. Skinning

Automatic: every primitive carries its bone(s); unions blend weights over `max(k, skinK)`; the
mesher smooths across the mesh and keeps the top 4. Use `bone2`/`blend` on long primitives that
should bend (torso spine → chest, neck → head). Rigid parts: `paintGeometry(geo, { bone, … })`.

## 5. Material

```ts
import { createCreatureMaterial, cloneCreatureMaterial } from '../kit';
const mat = createCreatureMaterial({ detailScale: 1, scatterColor: 0xd04a30, wrap: 0.55, side: THREE.DoubleSide, clearcoat: 0.3 });
const perInstance = cloneCreatureMaterial(mat);  // for hit flashes (emissive)
```

## 6. Attachments, sheets, hair

```ts
import { paintGeometry, segmentMatrix, limbSegment, sheetGeometry, quadGrid } from '../kit';
// rigid piece merged into the body draw call
parts.push(paintGeometry(new THREE.ConeGeometry(0.02, 0.2, 6), { bone: rig.boneIndex('head'), color: 0xd8d0b8, mat: 'horn', matrix }));
// a limb segment between two points
parts.push(paintGeometry(limbSegment(0.03, 0.01, 1, 0.3), { bone: i, color, mat, matrix: segmentMatrix(a, b) }));
// a skinned sheet (wing membrane / banner)
parts.push(sheetGeometry({ grid: quadGrid(a, b, c, d, 6, 10), color: 0x3a2a24, mat: 'membrane', weights: (r, c, p, out) => out.push([bone, 1]) }));
```

Hair & fur:

```ts
import { growStrands, hairGeometry, createHairMaterial } from '../kit';
const strands = growStrands(roots /* {p, dir, length, width, bone?, color?, minY?} */, {
  segments: 8, gravity: 20, colliders: [{ c: headC, r: [0.12, 0.14, 0.13] }], hug: 0 /* or 'nearest' */,
});
const geo = hairGeometry(strands, braids, { color: 0xd8c8a0, weights: (p, along, out) => out.push([headBone, 1]) });
const mat = createHairMaterial({ anisotropy: 0.8 }); // alpha-tested strand cards + Kajiya-Kay highlight
```

## 7. Animation

```ts
import { PoseSolver, solveTwoBone, aimBone, lookAt, SpringChain, bipedGait, quadGait, insectGait, wingFlap, PoseBuffer, boneMask } from '../kit';
const ps = new PoseSolver(rig);             // or creature.pose
ps.reset();
ps.offset[ps.i('body')].set(0, bob, 0);     // translations
ps.euler(ps.i('body'), pitch, yaw, roll);   // local rotations (model axes at rest)
ps.fk();
solveTwoBone(ps, ps.i('thigh_l'), ps.i('shin_l'), ps.i('foot_l'), footTarget, kneePole, { restUp: new THREE.Vector3(0, 0, -1) });
lookAt(ps, [ps.i('neck'), ps.i('head')], [0.4, 0.6], targetModel, { maxYaw: 1.2 });
spring.update(ps, dt, root.matrixWorld);    // after the animated pose
ps.apply(bones);                            // → THREE.Bone quaternions/positions
```

Gaits return per-foot samples `{ along, lift, planted, pitch }`: during stance a foot moves
backward at exactly the body speed (stride = speed / frequency), so feet never slide.
`restUp` for `solveTwoBone` is the rest-pose direction the middle joint points **away** from
(knee forward → `(0,0,-1)`; elbow back → `(0,0,1)`; spider knee up → `(0,-1,0)`).

---

## Copy-paste: giant spider

```ts
import { createSpider } from '../kit/examples/spider';
const spider = createSpider(seed, 1);        // scale 2.4 → brood mother (~6 m span)
scene.add(spider.object);
// per frame (deterministic in t):
spider.pose(alive ? (speed > 2 ? 'run' : speed > 0.1 ? 'walk' : 'idle') : 'death', t);
```
Key ideas in `examples/spider.ts`: legs as `limbSegment`s skinned to femur/tibia/tarsus bones;
`insectGait(phase, speed, reach, 8, samples, 'tetrapod')`; per leg `solveTwoBone` to the ankle
(foot target + rest tarsus offset) with the pole above the hip (`restUp = (0,-1,0)`), then
`aimBone` the tarsus at the foot; body bob/rear-up; chevrons via `op: 'paint'`.

## Copy-paste: quadruped (warg / horse / mûmak)

```ts
import { createWarg } from '../kit/examples/quadruped';
const warg = createWarg(seed, 1);
warg.pose(speed > 7 ? 'gallop' : speed > 2.5 ? 'trot' : speed > 0.1 ? 'walk' : 'idle', t);
```
For a mûmak: scale ×3.5 in `wargRig`, replace the snout with a `tube` trunk chain driven by a
`SpringChain`, add tusks with `paintGeometry(ConeGeometry)` on the head bone, use `hide` surface
with `noise: { type: 'ridged' }`, and pass `quadGait(..., 'walk')` (elephants never trot).

## Copy-paste: bat (Ravenhill)

```ts
import { createBat } from '../kit/examples/bat';
const bat = createBat(seed, 1);  // ~4.6 m wingspan
bat.pose('fly', t);              // 'glide' | 'screech' | 'perch'
// Legolas hangs from the feet: parent a helper to bat.creature.rig.byName.foot_l
```

## Copy-paste: giant (cave) troll

Trolls are humanoids, so the fastest route is a kind definition (see
`src/creatures/humanoid/KINDS.md`):

```ts
// src/creatures/humanoid/kinds/trolls.ts
import type { HumanoidKind } from '../../../core/types';
import type { KindDef } from '../types';
export const kinds: Partial<Record<HumanoidKind, KindDef>> = {
  troll: {
    height: 4.5,
    build: { shoulders: 1.45, bulk: 1.55, belly: 0.75, armLength: 1.3, legLength: 0.8, headSize: 0.72, neck: 0.35, hunch: 0.55, handSize: 1.5 },
    face: { brow: 2, jaw: 1.5, underbite: 0.7, tusks: 0.5, ears: 'small', nose: { width: 1.8, flat: 0.9 } },
    skin: { color: 0x6c7660, color2: 0x4e5644, blotch: 0.6, warts: 0.7, scars: 3, surface: 'skin_troll' },
    outfit: [{ type: 'loincloth', color: 0x3a3226, length: 0.7 }],
    weapons: { right: 'club' },
    anim: { hunch: 0.55, swagger: 0.7, aggression: 0.8, cadence: 0.9 },
    detail: { detailScale: 2.4 },
    extras: ({ sculpt: s, P }) => {
      // chain manacle on the left wrist (the Moria cave troll)
      s.torus(P.j.hand_l, 0.09 * P.s, 0.025 * P.s, { bone: 'forearm_l', mat: 'metal_rusty', color: 0x3a3632, rot: [0, 0, Math.PI / 4] });
    },
  },
};
```
Or build one from scratch with the kit: copy `humanoid/proportions.ts` + `anatomy.ts` for the
rig/body parts and drive it with `bipedGait` + `solveTwoBone` like `humanoid/animator.ts`.
