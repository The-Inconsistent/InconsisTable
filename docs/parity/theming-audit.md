# Theming audit: what a World reaches (#235)

Every screen on `main` paints from the Theme tokens, so a room's World dresses it whole. This is the checklist of part A
of issue #235, and the rules that keep it true. It is checked by commands that are now tests in
`apps/web/lib/tokens/tokens.test.ts`, so a screen added later that breaks a rule fails `bun run test`.

## The rules and the test that holds each

| Rule | Test (`tokens.test.ts`) | Exemptions, each with its reason |
|---|---|---|
| No hex in TSX | "the style guide's floors hold" (was there) | none |
| No literal colour in `globals.css` a World cannot reach: hex (also `%23` in a data URI), `rgb()`, `hsl()`, `oklch()` and the other colour functions, named colours, an SVG `fill`/`stroke` in a data URI | "globals.css paints no literal colour a World cannot reach" (its guard is proven by "the plain-colour guard catches ...") | black and grey shades (`rgb(0 0 0 / a)`, `rgb(128 128 128 / a)`: shadows and the disabled hatch, the same on any ground); a `mask` (its SVG fill is only a shape); the safety screen (`.xcard`, `.xcard-mark`: plain black and white in every Theme and World, on purpose) |
| No size or literal colour in a TSX `style` object (read to its closing brace): a number or numeric string for `fontSize`, a literal colour, named colour or gradient for a painting property | "inline styles in TSX read tokens" (proven by "the inline-style guard catches ...") | none (`harm-pad.tsx`'s `fontSize: 22` became `var(--fs-name)`) |
| Rounded boxes read `--radius-sm/md/lg` (a World's square corners set them to 2px) | "rounded boxes read the radius tokens" (proven by "the radius guard catches ...") | up to 4px in any unit (already square to the eye), 50% (a circle), 999px (a pill), a cap on a token (`min(var(--radius-btn), 10px)`) |
| A rule painting with lantern's palette (wood, brass, candle, wax ...) is restyled under a World: a `world.css` rule names every class of the selector and its pseudo-element, and sets the same property (or its longhand or shorthand) | "a rule that paints with lantern's palette is restyled under a World, or listed" (proven by "the restyle guard needs every class ...") | `KEEPS_ITS_MATERIAL` in the test, by selector, each with its reason: the workspace shell (`.ws-*`, outside every room), states and the main action in brass or the candle ("now"), and chips and slips in a card that read the card's own line, which a World sets |
| A plate on a light app page carries the page's ink | "a plate on a light app page carries the page's ink" | none |
| Every `var(--x)` is declared; felt re-maps every token; text pairs keep 4.5:1, focus 3:1 | (were there) | none |

Font sizes: a World sets no size (density is the platform's: `--fs-*`, `--tap`), so the literal px sizes in `globals.css`
(55, all at or above 12px) stay, held by the 12px floor. Typefaces: `globals.css` names no family outside the three roles
(`grep -n "font-family:" app/globals.css | grep -v "var("` is empty).

## The admin page's buttons (the known defect)

`--plate` was the dark wood gradient on `:root` in both sets, under `--ink`, which is dark in the light set. It now
follows the surface's set (`light-dark()` in `lantern.css` and `felt.css`): light plates on a light app page, wood on the
table and in the dark set. `.band` is always wood, so it now says `color-scheme: dark` (a World's band follows its own
set: `world.css` lists `.band` with the surfaces that inherit). Held by the plate test above.

## Screens

Under a World each screen below reads only the tokens, by the tests above. Where a screen painted with lantern's
materials, `theme/world.css` now restyles it; the column says what changed.

| Screen | Files (under `apps/web`) | Under a World |
|---|---|---|
| Sheet widgets (#191) | `components/sheet/widgets/`, `lib/sheet-widgets` | tokens only |
| Reminder lines (#192) | `components/gm/track/components/reminder-lines/` | stripe in the second ink, not brass |
| Whisper sheet and panel (#203) | `components/player/whisper-sheet/`, `components/gm/whisper-button/`, `components/ui/whisper-reply/` | tokens only |
| Setup checklist (#200) | `components/gm/setup-checklist/` | tokens only |
| Strike guide, fight log, command line (#207, #208) | `components/ui/strike-guide/`, `components/gm/track/components/{fight-log,command-line}/` | tokens only |
| Tables panel and trail (#197, #198, #210) | `components/gm/track/components/tables-panel/`, `components/ui/table-trail/` | radii tokens |
| Held items, item card (#205, #214) | `components/sheet/components/{item-line,acquire-box}/`, `components/gm/codex/components/item-give/` | tokens only |
| Generator wizard (#210) | `components/gm/codex/components/generator-wizard/` | tokens only |
| Markers and spawn options (#202) | `components/ui/marker-swatch/`, `components/ui/spawn-options/` | marker colours stay the platform's (house decision #92) |
| Room export and import (#211) | `components/gm/rules/room-export/`, `components/gm/prep/components/import-adventure/`, `components/lobby/import-room/` | tokens only (the lobby is outside a room) |
| Library pages (#212) | `components/lobby/your-characters/`, `components/builder/{library-build,import-from-library}/` | outside a room: lantern and felt, both sets |
| Admin console (#204) | `components/admin/admin-view/` | outside a room; light plates fixed (above) |
| The phone's Fight tab and strip (#114, #115, #117) | `components/player/{fight-tab,phone-strip}/`, `components/ui/value-cells/` | `.phone-strip` and `.fight-plate` lie on the band; the seat's own turn keeps brass |
| Panels (#114) | `components/player/panel-view/` | tokens only |
| Meanings and term cards (#126) | `components/ui/term-card/`, `.bottom-sheet` | the card's own line |
| TV layout cards (#127) | `components/screen/table-screen/` | tokens only; the TV keeps the World's ink |
| Codex peek and the notebook INBOX / MISSION / ARCHIVE (#218) | `components/ui/peek/`, `components/player/notebook/` | tokens only; `.entry-picture`'s frame in the line |
| SCENE (#106) | `components/gm/scene/` | radii tokens |
| GM header | `.band` | always wood under the base Themes; the World's band under a World |
| Roll card | `.roll-card` | rings in the line, the wax seal becomes the card's stud |
| Lobby GM issues | `.lb-issue-list` | the GM's line in the second ink |

## Screens in pull requests still open

These get the same treatment once they merge: run `bun run test` (the tests above name any rule they break) and add
their restyling to `theme/world.css`, or a reason to `KEEPS_ITS_MATERIAL`.

- the party journal and session history: their cards and the recap list;
- printing: printed cards and sheets are built in the GM's browser and print on white, so check that a World's dark set
  never reaches the print stylesheet (`@media print`);
- pictures: the picture canvas fills with the base paper (`lib/entry-picture`), by house decision (see #235's rows);
- SHOW TO TABLE: the TV's shown card;
- books: the book relay's page viewer (`book:*`), whose frame should read the line;
- the engine stack's UI: any new widget under `components/sheet/widgets/`.
