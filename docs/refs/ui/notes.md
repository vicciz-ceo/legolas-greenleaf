# UI development references

All mockups are native HTML/CSS/SVG, with exact positions and percentages in `ui-spec.json`. The HTML files are included to make linework, local font fallback and states inspectable. Generated concept backdrops are development-only and may be substituted by a live procedural canvas; none of these images is a shipped UI dependency. No web fonts, image icons, or network calls.

Desktop 1920 × 1080, touch 844 × 390. Touch buttons are at least 56 CSS pixels; inset guides represent 26 px horizontal and 14 px vertical safe padding. Use runtime `env(safe-area-inset-*)` to recompute for other devices. Nine chapter cards use original artwork with left 40% reserved for labels; recreate with procedural scenes when implementing.

Every SVG icon has a 24 × 24 viewBox and simple currentColor filled paths. Gamepad letters and the GREENLEAF wordmark are hand-drawn paths. The wordmark uses restrained narrow geometric capitals and a simple leaf; no official film font or title treatment.

The desktop sheet displays all requested HUD states for comparison: the actual aiming ring is centred, with empty/half/full charge samples near the selector and hit/headshot sample markers at lower right. These comparison samples are reference annotations, not simultaneous runtime HUD elements. Speaker colour applies to the name; subtitle dialogue uses neutral light text in production. Settings and results values illustrate layout, not an invented balance change.
