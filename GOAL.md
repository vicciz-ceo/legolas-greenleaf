# /goal: Greenleaf

> Build **Greenleaf**: a complete, playable 3D third-person Legolas action game in Vite + TypeScript + Three.js. It covers his main fights across the five films he appears in, in story order, with a realistic-looking rendering pipeline where every mesh, texture and sound is generated in code. It must run in the browser on desktop (keyboard/mouse and gamepad) and mobile (touch).

## Decisions (brainstorm, 2026-10-07)

| Topic | Decision |
|---|---|
| Gameplay | 3D third-person action: bow (draw/loose, aim zoom), twin knives, jump, dash |
| Stack | Vite + TypeScript (strict) + Three.js, no build-time assets |
| Fights | All five films Legolas appears in, in story order (9 chapters) |
| Look | Realistic rendering: PBR, image-based lighting from a procedural sky, shadows, GTAO, bloom, film tone mapping and grading, fog, weather |
| Assets | All built in code (characters, creatures, textures, audio). Zero files in the repo. |
| Set-pieces | Shield-surf, Oliphaunt climb, Gimli kill-count rivalry, Focus slow-mo volley, barrel ride, Ravenhill bat ride and falling-stones climb |
| Progression | Chapters unlock in order, with mid-chapter checkpoints, upgrade points spent between chapters, Easy/Normal/Hard |
| Input | Keyboard + mouse, gamepad, mobile touch (virtual sticks + buttons) |

## Chapters (story order)

| # | Chapter | Film | Core fight | Set-piece / boss |
|---|---|---|---|---|
| 1 | Spiders of Mirkwood | The Desolation of Smaug | Giant spiders in the dark forest, rescuing webbed dwarves | Brood-mother spider |
| 2 | The Barrel Escape | The Desolation of Smaug | Orcs on both banks of the Forest River | **Barrel ride**: on-rails river run, leaping across dwarves' barrels |
| 3 | Lake-town by Night | The Desolation of Smaug | Bolg's raid on Bard's house, rooftop fight | Duel with **Bolg** (he escapes) |
| 4 | Ravenhill | The Battle of the Five Armies | Gundabad orcs on the frozen ruins | **Bat ride** up to the tower, **falling-stones climb**, final duel with **Bolg** |
| 5 | Balin's Tomb | The Fellowship of the Ring | Moria goblins pour into the chamber | **Cave Troll** (chain climb, arrow to the head) |
| 6 | Amon Hen | The Fellowship of the Ring | Uruk-hai in the woods | **Lurtz** |
| 7 | Helm's Deep | The Two Towers | Night storm, ladders, the Deeping Wall | **Shield-surf** down the stairs, Uruk berserker with the torch, Gimli count |
| 8 | Pelennor Fields | The Return of the King | Haradrim and mûmakil | **Oliphaunt climb**: cut the girths, three arrows to the head, slide down the trunk, Gimli count |
| 9 | The Black Gate | The Return of the King | Last stand against the hosts of Mordor and the trolls | Survive until the Eagles arrive and the Ring is destroyed, final Gimli tally, credits |

## Core mechanics

- **Bow**: hold to draw (charge sets damage, speed and accuracy), release to loose. Aim mode zooms over the shoulder. Headshots do 2.5× damage. The quiver is infinite (a movie joke). Arrow types: Standard, Piercing (Galadhrim, passes through enemies) and Triple (spread).
- **Knives**: 3-hit combo with a finisher stagger.
- **Agility**: double jump (elven leap), dash with i-frames.
- **Focus**: hold to slow time to 20%, sweep the crosshair to mark up to N targets, release to loose a homing volley. The meter refills from kills.
- **Gimli rivalry** (LOTR chapters): a running count on the HUD, with banter at milestones and a bonus for beating him. Totals carry across chapters.
- **Ranks**: S–D per chapter (time, accuracy, headshots, damage taken). Points buy upgrades: draw speed, arrow damage, knife mastery, agility, focus, vitality, piercing arrows, triple shot.

## Acceptance criteria (the goal is met when all are true)

1. `npm run build` passes, with TypeScript strict and zero type errors.
2. Title screen → chapter select → each of the 9 chapters is playable from start to completion, and checkpoints work (die → respawn at the last checkpoint).
3. Every chapter has its listed core fight and set-piece or boss, working as described above.
4. Every character and creature (Legolas, Gimli, Aragorn, Tauriel, orcs, goblins, Uruk-hai, Bolg, Lurtz, spiders, Cave Troll, trolls, mûmak, bats) is built in code with skinned, animated meshes and inspectable in the Creature Lab (`/lab/`).
5. Visual standard: PBR materials with procedural albedo/normal/roughness maps, image-based lighting, soft shadows, GTAO, bloom, AgX tone mapping and colour grading, fog and weather. Quality presets Low / Medium / High / Ultra.
6. Input: keyboard/mouse with pointer lock, gamepad, and on-screen touch controls on mobile.
7. Audio: procedural SFX, ambience and adaptive music (explore/combat/boss).
8. Save: progress, upgrades, ranks and settings persist in localStorage.
9. The smoke test (`npm run smoke`) loads every chapter headless, simulates 20 s with the autopilot, and reports zero page errors. Screenshots are reviewed for every chapter.
10. Performance: 60 fps target on a mid-range desktop at 1080p on High; Low preset for mobile.
