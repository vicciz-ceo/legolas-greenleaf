# VFX references

28 sheets each include a six-frame sequence and hero. JSON specifies High-quality per-emitter caps, lifetimes, sizes, colour/alpha over life, velocity, gravity, blend and optional light. Continuous effects show representative evolution rather than cessation of emission. Burst effects emit their cap once; rate 0 means burst, not disabled.

World-space sheets use a 1 m scale cue. Screen-space effects have zero particles and zero world size: their 1 m ruler is a separate design legend and does not calibrate the background or postprocess. Cool Focus tint retains a sharp centre; damage flash leaves the aiming centre unobscured.

Fire cores use additive blending; smoke is alpha. Culvert debris uses mesh particles with gravity, never additive stones. Blood variants are non-graphic spray/ground-decal studies with capped decal pools. The burning-house sheet is an effect prototype; it must not be used to turn the Lake-town raid into the later destruction sequence.

All sheet labels, time samples and metre cues are drawn by `../tools/compose_effects_props.py`. Hero looks carry no survey authority. Timelines are seeded illustrative target integration, not captures of game particles. Screen filters are applied by code from the target uniforms.
