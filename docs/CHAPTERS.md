# Chapter Design Brief

Authoritative design for the 9 story chapters. Each chapter author owns `src/game/chapters/cN_<id>.ts`, an optional helper folder `src/game/chapters/<id>/`, and any new creature in `src/creatures/<name>.ts` + `<name>.lab.ts`. Use only the `LevelAPI` (`src/core/types.ts`) and the shared builders. Study `src/game/chapters/c0_arena.ts` (the reference chapter) first, then `docs/CHAPTER_AUTHORING.md` (the practical handbook).

General rules:
- **Real scale, real detail.** Build each setting as a believable film location with the world builders (`src/world/*`), terrain, props and crowds. The player should feel inside the movie scene.
- **Structure.** Title card → short cinematic (`cameraShot`, `cinematic(true)`, 1–3 lines) → combat beats → set-piece/boss → outro → `complete()`. Each beat ends at a checkpoint, and `start(cp)` must rebuild the state for **every** checkpoint index (skip the earlier beats, spawn the right allies, set objectives).
- **Dialogue.** Paraphrase in the films' spirit. Short iconic lines are fine ("That still only counts as one!", "Forty-two!"); no long verbatim quotes.
- **Pacing.** 5–9 minutes per chapter on Normal. No dead air: an objective is always visible, enemies arrive in readable waves, and set-pieces are well signposted (`hud.setPrompt`, `objective`).
- **Bot.** `botHint()` must guide the autopilot through every beat (move targets, interact on prompts, jump during platforming), so the smoke test can get through the chapter with `?god=1`.
- **Rivalry.** It is active in chapters 5–9 (`rivalry: true`). Carry the totals using `ctx.progression.data.rivalryTotals` as `startFrom`.
- **Performance.** Respect the ARCHITECTURE.md budgets. Use crowds for background armies, keep about 12–30 live AI enemies, and instance foliage and debris.

---

## 1. Spiders of Mirkwood (`c1_mirkwood.ts`, id `mirkwood`, env `mirkwood`)
*The Hobbit: The Desolation of Smaug.* Par 6 min. Checkpoints: `['The Web Clearing', 'Free the Dwarves', 'The Brood Mother']`.

- **Setting.** The black depths of Mirkwood: colossal gnarled oaks (trunks 3–6 m wide), roots, fallen logs, a canopy that admits only thin green-gold shafts of light, drifting spores, webs strung between trunks, cocooned dwarves hanging from branches, and a dark hollow choked with web at the far end.
- **Creature: Mirkwood spider** (`src/creatures/spider.ts`, built with the creature kit). A body ~1.2 m tall with a 2.5–3 m leg span. Black-brown chitin with coarse hair, a bulbous patterned abdomen, eight glossy eyes (faint glow), clicking mandibles, and an alternating-tetrapod gait. It can climb tree trunks, drop from the canopy on a silk thread, lunge-bite and spit web (slows the player by 50% for 2 s, with a visible web blob projectile). Ichor blood (`'ichor'`). Variant: **Brood Mother**, 6 m leg span, scarred, pale markings, 10× HP.
- **Beats.**
  1. *Ambush (cp0).* Legolas drops from a branch into the clearing (cinematic) as spiders close on the cocoons: "Easy, dwarf — I would not miss." Then waves of 3, 4 and 5 spiders, some descending on threads, some crawling down trunks. Teach draw/loose, knives and dash with `setPrompt` hints.
  2. *Free the dwarves (cp1).* Cut 4 cocoons (`interact` near each; the knife cut takes 1.5 s, interrupted by damage) while spiders keep coming. **Tauriel** (ally) arrives halfway with 2 elf archers: "Tauriel" / "Lord Legolas, the nest is beyond the hollow."
  3. *The Brood Mother (cp2).* She bursts from the web hollow.
     - Attacks: leg stab combo, web spit, leap slam, and summoning 3 spiderlings.
     - Weak point: the eye cluster (×3 damage).
     - At 50% she climbs into the web canopy overhead. Shoot the 3 glowing web anchors to drop her (fall damage, stunned 4 s).
     - Kill → slow-mo.
  4. *Outro.* Thranduil's guard surrounds the freed dwarves: "Search them." `complete()`.

## 2. The Barrel Escape (`c2_barrels.ts`, id `barrels`, env `forest_river`)
*The Hobbit: The Desolation of Smaug.* Par 5 min. Checkpoints: `['The River Gate', 'Along the Banks', 'Riding the Rapids']`.

- **Setting.** The Forest River gorge below the Elvenking's halls: a stone water-gate with a lever and walkway, white-water rapids in a rocky ravine, mossy boulders, overhanging beech and oak, fallen logs spanning the river, and a calm pool and shingle bank at the end. The water uses the flowing river builder with foam.
- **Set-piece: the barrel ride** (helper `src/game/chapters/barrels/river.ts`).
  - The dwarves (kind `dwarf`, pose `barrel`, waist-deep in barrels) float down a river spline at 7–11 m/s.
  - Legolas leaps across the barrels using the dwarves' heads as stepping stones: a `PlayerMover` that rides the barrel under him (bobbing, rolling). Left/right input plus Jump hops to the barrel in the target lane. Missing means splashing in, a 10 HP penalty and a respawn on the nearest barrel.
  - Shooting is enabled (aim assist on) against orcs on both banks and on fallen-log bridges.
  - Orcs leap down onto barrels (knife them).
  - Obstacles: rocks, low logs (jump) and narrowing chutes.
  - Barrels are moving `ColliderHandle`s (`setTransform` + `velocity`).
- **Beats.**
  1. *The River Gate (cp0).* On foot on the gate walkway, Bolg's hunting party pours from the trees. Kill the orc trying to stop the lever. Tauriel ally.
  2. *Along the Banks (cp1).* An auto-forward run along the bank and over boulders (`PlayerMover`: forward speed 8 m/s along the bank spline; the player steers laterally and jumps gaps), shooting across the river, then a leap onto the barrels.
  3. *Riding the Rapids (cp2).* About 90 s of barrel hopping with escalating orc ambushes and a **log-bridge mini-boss** (an orc captain, `gundabad` archetype, with 4 orcs on the fallen log: shoot the log's supports to drop them all). It ends in the calm pool.
  4. *Outro.* On the shingle bank, an orc survivor taunts about the war to come. `complete()`.

## 3. Lake-town by Night (`c3_laketown.ts`, id `laketown`, env `laketown_night`)
*The Hobbit: The Desolation of Smaug.* Par 6 min. Checkpoints: `['The Walkways', "Bard's House", 'Bolg']`.

- **Setting.** Lake-town at night: wooden stilt houses on the black lake, plank walkways and canals, steep shingled roofs, lanterns and braziers, fishing nets, boats, mist on the water, cold blue moonlight against warm firelight. Bard's house is a two-storey house with an open front room. Drop into the water and you swim back (no instant death; a slow respawn on the nearest walkway).
- **Beats.**
  1. *The Walkways (cp0).* Orc raiders creep across the rooftops toward Bard's house. Fight across the walkways and roofs (vertical play: double jump, roof edges) with Tauriel as an ally.
  2. *Bard's House (cp1).* Defend the house, where Kili lies wounded (the dwarves are invulnerable allies who fight a little). Orcs come from the canals, the roof and the walkways in 3 waves. Objective: "Defend Bard's house".
  3. *Bolg (cp2).* Duel **Bolg** (kind `bolg`, custom boss logic on `createEnemy` with `boss: true`) on the walkway in front of the house.
     - Moves: heavy mace combos, grabs (QTE: mash melee), ground slam knocking planks loose.
     - At 35% HP: a cinematic where Bolg breaks away and flees across the rooftops. Then a chase (`PlayerMover` auto-forward along a rooftop spline; jump gaps, shoot the orcs covering his escape).
     - He escapes on a horse into the dark: "He's going north. I'll follow." `complete()`.

## 4. Ravenhill (`c4_ravenhill.ts`, id `ravenhill`, env `ravenhill_winter`)
*The Hobbit: The Battle of the Five Armies.* Par 7 min. Checkpoints: `['The Frozen Falls', 'The Bat Ride', 'The Tower', 'The Falling Stones']`.

- **Setting.** Ravenhill: a ruined dwarven watchtower on a snowy crag, a frozen waterfall and an ice river below, broken stone bridges, snow drifts, Erebor's mountainside looming, and the battle far below in the valley (crowds, smoke). It is snowing.
- **Creature: Gundabad bat** (`src/creatures/bat.ts`, kit wing demo as a start). A 6–8 m wingspan, leathery translucent wings, rat-like head, clawed feet, shrieking. Flocks are distant cheap bats via the world `bat` prop.
- **Beats.**
  1. *The Frozen Falls (cp0).* Gundabad orcs on the ice river and ruins, with Tauriel as an ally. The ice is slippery (lower friction on `ice` material). A Gundabad troll with a stone slab on its head (troll archetype) charges through.
  2. *The Bat Ride (cp1).* Legolas grabs the claws of a passing giant bat. `PlayerMover` with pose `hang` follows a flight spline up the cliffs to the tower. The player can steer a little and must shoot other bats and orc archers on the ledges; hits cost HP. He lets go at the top.
  3. *The Tower (cp2).* **Bolg** duel on the tower's upper floors (boss phase 1): mace and chain attacks.
  4. *The Falling Stones (cp3).* The tower and bridge collapse. Climb the falling stones: a sequence of blocks falling in mid-air, each a moving `ColliderHandle` that drops a few seconds after you land on it. Chain jumps upward (double jump) under time pressure, shooting a couple of orc archers on the way. At the top, the final **Bolg** duel (phase 2): finish him with a knife finisher cinematic when he is low. `complete()`.

## 5. Balin's Tomb (`c5_moria.ts`, id `moria`, env `moria`, rivalry)
*The Fellowship of the Ring.* Par 6 min. Checkpoints: `['The Chamber of Mazarbul', 'The Cave Troll', 'Flight to the Bridge']`.

- **Setting.** The Chamber of Mazarbul: a square stone hall with carved dwarven geometry, Balin's white tomb lit by a single shaft of light from a high window, a well in the corner, skeletons and scattered armour, broken doors barricaded with axes, pillars, dust, drums booming in the deep (`drums` sfx loop). Later, the great pillared hall of Dwarrowdelf: colossal pillars vanishing into darkness, fire glow far away.
- **Allies.** Gimli (rivalry), Aragorn, Boromir (`gondor` kind, name Boromir).
- **Creature.** Cave Troll (kind `troll`, Moria variant with an ankle chain held by goblins) as a boss using the troll archetype plus custom boss logic.
- **Beats.**
  1. *The Chamber (cp0).* "They have a cave troll." The door breaks; waves of Moria goblins (fast, some crawling down the walls, archers on a ledge).
  2. *The Cave Troll (cp1).* Boss.
     - Moves: club sweeps, slam, picks up and throws goblins.
     - Phase gimmick: when it is stunned (after 3 headshots, or after slamming into a pillar), a chain dangles. `interact` → climb the chain onto its shoulders (`PlayerMover`, pose `climb`), then 2 point-blank arrows to the skull (forced aim).
     - Final phase: it staggers; an arrow into its open mouth kills it (cinematic slow-mo).
     - Gimli: "That counts as mine… well, half."
  3. *Flight to the Bridge (cp2).* Goblins swarm from the pillars and the ceiling: survive a timed run (120 s) through the pillared hall to the exit as a ring of goblins closes in. Then a distant roar of fire (the Balrog, only the glow, never shown). `complete()`.

## 6. Amon Hen (`c6_amon_hen.ts`, id `amon_hen`, env `amon_hen`, rivalry)
*The Fellowship of the Ring.* Par 6 min. Checkpoints: `['The Woods', 'The Ruins', 'Lurtz']`.

- **Setting.** The wooded hill of Amon Hen: tall trunks in golden afternoon haze, fallen leaves, mossy ruins of Númenorean stonework, broken stairs, the stone Seat of Seeing on the summit, toppled statues, and a stream at the foot.
- **Allies.** Aragorn and Gimli (rivalry).
- **Beats.**
  1. *The Woods (cp0).* Uruk-hai scouts sweep through the trees. Running fights, with archers among the trunks.
  2. *The Ruins (cp1).* Defend the ruins against waves (pikes, shields that block frontal arrows: flank them or headshot). Boromir's horn sounds (`horn_rohan`, played lower). Objective: "Reach Boromir".
  3. *Lurtz (cp2).* In the clearing by the stream, **Lurtz** (kind `lurtz`): a bow at range (leads his shots), then sword and shield up close (blocks frontal arrows while advancing; bash attack); he throws a knife. At 15% HP, an outro cinematic: Aragorn and Legolas finish him together. Grief over Boromir: "We will not abandon Merry and Pippin." `complete()`.

## 7. Helm's Deep (`c7_helms_deep.ts`, id `helms_deep`, env `helms_deep_storm`, rivalry)
*The Two Towers.* Par 9 min. Checkpoints: `['The Deeping Wall', 'The Culvert', 'The Shield Stair', 'The Hornburg']`.

- **Setting.** The Deeping Wall at night in a storm: a massive curved crenellated wall with a broad walkway, towers, the Hornburg keep and its causeway gate, broad stone stairs down into the Deep, the culvert at the wall's base, rain sheeting and lightning. An Uruk army of thousands fills the coomb below with torches (crowds: `uruk`, `props: true`). Rain splashes, wet clearcoat stone.
- **Allies.** Elves of Lórien (`elf`, Galadhrim seed) lining the wall, Rohirrim, Aragorn, Gimli (rivalry; the famous count).
- **Beats.**
  1. *The Deeping Wall (cp0).*
     - "Give them a volley." The scripted volley thins the crowd.
     - Ladders rise: 6 ladder points. Kill the climbers or `interact` to push a ladder off (it carries everyone on it).
     - Gimli, "Two already!"; Legolas "I'm on seventeen!"
     - Uruk crossbowmen fire from the field.
  2. *The Culvert (cp1).* Berserker torch-bearers run for the culvert. Stop 3 runners with arrows (Focus helps). The final one is unstoppable (a cinematic: the torch dives into the culvert), and the explosion breaches the wall: a huge `fx.explosion`, debris, and the breach geometry swaps in.
  3. *The Shield Stair (cp2).*
     - Legolas grabs a shield and **shield-surfs** down the broad stone stairs (`PlayerMover`, pose `surf`): steer down a 60 m stair run with speed building, shooting Uruks along the route.
     - Each Uruk you hit at the bottom is a "surf kill" bonus (+2 rivalry).
     - The landing kills the Uruk at the foot of the stair (slow-mo).
     - Then fight in the flooded breach.
  4. *The Hornburg (cp3).*
     - Hold the causeway gate with Aragorn and Gimli against a battering ram team and waves, a 150 s survival bar.
     - Dawn breaks: the exposure and grade ramp to dawn, Rohirrim horns, and the White Rider charge (crowd of `rohirrim` sweeping the field, Uruk crowd thinning and fleeing).
     - The tally banter: Gimli "Forty-two!" and Legolas "Forty-three." (or whatever the actual counts are).
     - `complete()`.

## 8. Pelennor Fields (`c8_pelennor.ts`, id `pelennor`, env `pelennor`, rivalry)
*The Return of the King.* Par 8 min. Checkpoints: `['The Field', 'The Mûmak', 'The Last Charge']`.

- **Setting.** The Pelennor Fields at morning: vast grass plains churned to mud, smoke columns rising, broken siege towers and catapults, fallen horses and banners, the white walls of Minas Tirith on the hill (distant silhouette) with fires, Haradrim and orc companies (crowds), and mûmakil herds roaming in the distance.
- **Creature: Mûmak** (`src/creatures/mumak.ts`, built with the creature kit's quadruped tools).
  - About 14 m at the shoulder, with 4 huge tusks (two pairs), a wrinkled grey-brown hide, a long trunk, war paint, and red and gold banners.
  - A **war howdah** (wooden tower) on its back, strapped on with ropes and girths, crewed by Haradrim archers and a driver.
  - A slow, heavy gait with ground shake (camera shake within range, the `oliphaunt_step` sound). Its trunk sweeps, its tusks gore, and it stomps.
  - It is a `Combatant` with weak points: girth straps (×4, each its own combatant), the head (needs 3 arrows; only damageable once the howdah crew is dead), and a "climbable" rope ladder on the flank.
- **Beats.**
  1. *The Field (cp0).* Fight Haradrim and orcs among the Rohirrim allies. A mûmak tramples through, so stay out of its path (danger telegraph: ground decals and shake).
  2. *The Mûmak (cp1).* The **Oliphaunt climb**:
     - Shoot 2 girth straps to slow it.
     - Leap onto a dangling rope (`interact`) and climb its flank as it walks (`PlayerMover` attached to the moving creature; pose `climb`; dodge archers' arrows by moving left/right).
     - Reach the howdah and kill the crew (knives).
     - Cut the howdah ropes (`interact` ×2): the howdah slides off.
     - Run up its neck and put 3 arrows into its skull.
     - It collapses (a slow, earth-shaking fall), and Legolas slides down the trunk (cinematic).
     - Gimli: "That still only counts as one!"
  3. *The Last Charge (cp2).* A second mûmak and Haradrim reinforcements. Bring down mûmak #2 from range by shooting its 4 girths and then the head, while fighting the infantry. Then the field is won. `complete()`.

## 9. The Black Gate (`c9_black_gate.ts`, id `black_gate`, env `black_gate`, rivalry)
*The Return of the King.* Par 8 min. Checkpoints: `['The Gate Opens', 'The Trolls', 'The Last Stand']`.

- **Setting.** The Morannon: colossal black iron gates between the Towers of the Teeth, a slag plain of ash and rock, two rocky hills where the Army of the West makes its stand, and a red-brown sky with ash falling and Mount Doom glowing on the horizon. The hosts of Mordor (orcs, Easterlings, trolls) surround the hills (crowds of thousands).
- **Allies.** Aragorn, Gimli (rivalry), Gondor and Rohan soldiers.
- **Beats.**
  1. *The Gate Opens (cp0).* The gates grind open (sound, shake), and the armies pour out and encircle you. "For Frodo." Then waves of orcs and Easterlings (spears, shields).
  2. *The Trolls (cp1).* 2–3 armoured war trolls (troll archetype, war variant) wade in. One pins Gimli (scripted: the troll stands over him; kill it within 30 s or Gimli is "wounded" and you lose a rivalry bonus).
  3. *The Last Stand (cp2).*
     - A 120 s survival with escalating waves. Nazgûl (fell beasts as distant silhouettes) swoop overhead.
     - At the end: "The Eagles are coming!" Giant eagle silhouettes fly over (simple kit-built eagles or `bat`-style prop scaled), the ground shakes as Sauron falls (a horizon flash, the tower collapse silhouette), the gate towers crack, and the enemy crowds flee and thin.
     - The final Gimli tally across the whole game (from `rivalryTotals`) is shown with banter.
     - `complete()` → credits.
