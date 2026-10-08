/**
 * Body shaping shared by the brutes: extra muscle masses (SDF additions in the skin material),
 * defined abdominals, clavicles, ribs and veins that are too fine for the kit's anatomy.
 */
import type { KindContext } from '../../types';
import { type Projector, V, tup } from './common';
import type { PrimOpts } from '../../../kit/sdf';

export function skinOpts(ctx: KindContext): PrimOpts {
  const sk = ctx.def.skin;
  return { color: sk.color, color2: sk.color2, colorNoise: sk.blotch, colorFreq: 14 / ctx.P.s, mat: sk.surface };
}

/** extra muscle masses so the build reads as a brutal V-shaped fighter */
export function brawnBody(ctx: KindContext, o: { traps: number; lats: number; delts: number; forearm: number; thigh?: number; calf?: number; biceps?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const g = P.build.bulk;
  const sh = P.build.shoulders;
  const j = P.j;
  const L = P.hand.l.L;
  s.with({ ...skinOpts(ctx), k: 0.05 * sc }, () => {
    // trapezius mass: neck → shoulder tip
    s.mirrored(() => s.cone([0.035 * sc, j.neck[1] + 0.005 * sc, -0.03 * sc], [0.15 * sc * sh, j.upperarm_l[1] + 0.035 * sc, -0.02 * sc], 0.062 * sc * o.traps, 0.046 * sc * o.traps, { bone: 'chest', bone2: 'shoulder_l', blend: [0.6, 1], k: 0.06 * sc }));
    // lats / teres: V-taper of the back
    s.mirrored(() => s.ellipsoid([0.1 * sc * sh, j.upperarm_l[1] - 0.15 * sc, -0.075 * sc * g], [0.05 * sc * g * o.lats, 0.115 * sc, 0.045 * sc * g * o.lats], { bone: 'chest', k: 0.05 * sc }));
    // deltoid caps
    s.mirrored(() => {
      const c: [number, number, number] = [j.upperarm_l[0] + L.x * 0.03 * sc, j.upperarm_l[1] + L.y * 0.03 * sc + 0.012 * sc, j.upperarm_l[2]];
      s.ellipsoid(c, [0.06 * sc * g * o.delts, 0.07 * sc * o.delts, 0.06 * sc * g * o.delts], { bone: 'upperarm_l', k: 0.04 * sc, rot: [0, 0, 0.6] });
    });
    if (o.biceps) {
      const bi = o.biceps;
      s.mirrored(() => {
        const c: [number, number, number] = [j.upperarm_l[0] + L.x * P.upperArm * 0.5, j.upperarm_l[1] + L.y * P.upperArm * 0.5, j.upperarm_l[2] + 0.008 * sc];
        s.ellipsoid(c, [0.04 * sc * g * bi, 0.085 * sc, 0.042 * sc * g * bi], { bone: 'upperarm_l', k: 0.035 * sc, rot: [0, 0, Math.PI / 4] });
      });
    }
    // forearm brawn
    s.mirrored(() => {
      const a: [number, number, number] = [j.forearm_l[0] + L.x * 0.03 * sc, j.forearm_l[1] + L.y * 0.03 * sc, j.forearm_l[2]];
      const b: [number, number, number] = [j.hand_l[0] - L.x * 0.05 * sc, j.hand_l[1] - L.y * 0.05 * sc, j.hand_l[2]];
      s.cone(a, b, 0.047 * sc * g * o.forearm, 0.03 * sc * g * o.forearm, { bone: 'forearm_l', k: 0.03 * sc });
    });
    const th = o.thigh;
    if (th) {
      s.mirrored(() => s.ellipsoid([j.thigh_l[0] + 0.012 * sc, (j.thigh_l[1] + j.shin_l[1]) / 2 + 0.05 * sc, 0.0], [0.07 * sc * g * th, 0.16 * sc, 0.07 * sc * g * th], { bone: 'thigh_l', k: 0.05 * sc }));
    }
    const ca = o.calf;
    if (ca) {
      s.mirrored(() => s.ellipsoid([j.shin_l[0] + 0.004 * sc, j.shin_l[1] - 0.12 * sc, j.shin_l[2] - 0.03 * sc], [0.05 * sc * g * ca, 0.11 * sc, 0.05 * sc * g * ca], { bone: 'shin_l', k: 0.04 * sc }));
    }
  });
}

/** abdominals, clavicles and a rib cage that show through the skin (bare-chested brutes) */
export function bareTorso(ctx: KindContext, proj: Projector, o: { abs: number; ribs?: number }) {
  const { P, sculpt: s } = ctx;
  const sc = P.s;
  const g = P.build.bulk;
  const j = P.j;
  const hipY = j.thigh_l[1];
  const chestY = j.chest[1];
  const yTop = chestY - 0.012 * sc;
  const yBot = hipY + 0.115 * sc;
  const rows = 4;
  const n = V();
  s.with({ ...skinOpts(ctx), k: 0.02 * sc }, () => {
    for (let r = 0; r < rows; r++) {
      const y = yTop + (yBot - yTop) * ((r + 0.5) / rows);
      const w = (0.034 - r * 0.0015) * sc * g;
      for (const sx of [1, -1]) {
        const p = V(sx * w * 1.05, y, 0.3 * sc);
        if (!proj.project(p, n)) continue;
        const rz = 0.022 * sc * o.abs;
        const c = p.clone().addScaledVector(n, -rz * 0.55);
        s.ellipsoid(tup(c), [w * 0.95, ((yTop - yBot) / rows) * 0.46, rz], { bone: r < 2 ? 'chest' : 'spine', k: 0.016 * sc });
      }
    }
    // clavicles
    s.mirrored(() => {
      const a = V(0.014 * sc, j.neck[1] - 0.04 * sc, 0.1 * sc);
      const b = V(0.125 * sc * P.build.shoulders, j.upperarm_l[1] + 0.025 * sc, 0.06 * sc);
      const na = V(), nb = V();
      if (proj.project(a, na) && proj.project(b, nb)) s.cone(tup(a.addScaledVector(na, -0.004 * sc)), tup(b.addScaledVector(nb, -0.004 * sc)), 0.011 * sc, 0.009 * sc, { bone: 'chest', k: 0.012 * sc });
    });
    // rib cage side definition
    const rb = o.ribs;
    if (rb) {
      for (let r = 0; r < 4; r++) {
        const y = chestY - (0.015 + r * 0.03) * sc;
        s.mirrored(() => {
          const p = V(0.2 * sc, y, 0.04 * sc);
          if (!proj.project(p, n)) return;
          const c = p.clone().addScaledVector(n, -0.004 * sc);
          s.cone(tup(c.clone().add(V(-0.01 * sc, 0.005 * sc, 0.075 * sc))), tup(c.clone().add(V(0.005 * sc, -0.006 * sc, -0.05 * sc))), 0.008 * sc * rb, 0.007 * sc * rb, { bone: 'chest', k: 0.008 * sc });
        });
      }
    }
  });
}
