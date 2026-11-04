---
name: inconsistent-motion
description: The shared motion language of InconsisID and InconsisTable (tokens, page changes, entrances, overlays, feedback, reduced motion) and how to check it. Use before adding or changing any animation, transition, view transition, dialog, toast or page in either app, and when reviewing UI for motion.
---

# Inconsistent motion

Both apps move the same way, so a person crossing from InconsisTable to its sign-in and back feels one product. This file
is the rule set. It is identical in both repositories, apart from the **Where it lives** section. Change it in both or in neither.

## Tokens

Every duration and easing is a token. A literal `ms` or `cubic-bezier` in a rule is a bug, except inside a keyframe.

| Token | Value | Use |
|---|---|---|
| `--dur-tap` | 90ms | press feedback, a toggle's mark |
| `--dur-quick` | 160ms | leaving, fades, hover and focus settles |
| `--dur-move` | 260ms | arriving content, a row moving, a toast |
| `--dur-scene` | 420ms | a shared element gliding between pages, a dialog or sheet |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | everything that arrives or settles |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | everything that leaves |
| `--ease-glide` | `cubic-bezier(0.3, 1.25, 0.4, 1)` | a shared element travelling (a nav marker, a title) |
| `--ease-spring` | `linear(0, 0.18, 0.56, 0.9, 1.06, 1.08, 1.04, 1.01, 1, 0.995, 1)` | a mark that pops in on toggle |

A surface may scale the durations as a group (InconsisTable's felt theme is snappier, its TV density about 1.5x slower).
It never changes the easings.

## The moves

1. **Page change.** Chrome that is the same on both pages (a side rail, a top bar, a card's frame) stays put. The content
   leaves 12px to the inline start and fades (`--dur-quick`, `--ease-in`). The new content arrives 16px from the inline
   end (`--dur-move`, `--ease-out`, 40ms later). One element that marks where you are (the active nav item's highlight)
   and the title of the thing you opened glide from their old place to their new one (`--dur-scene`, `--ease-glide`).
   Going back plays the same, mirrored.
2. **Entrance.** A list or grid that a page opens with rises in: `opacity 0, translate 0 6px` to rest, `--dur-move`,
   `--ease-out`, each item 30ms after the one before, capped at the twelfth. A single block that appears after an action
   (a ticket, a new key, an offer) rises the same way without the stagger.
3. **Overlay.** A dialog, sheet, menu or toast enters from `@starting-style` (dialog: opacity 0, 10px down, scale 0.97;
   toast: 12px down) and leaves the reverse, with `overlay` and `display` transitioned `allow-discrete` so it animates
   out of the top layer. The backdrop fades with it.
4. **Feedback.** A busy button spins a small ring after its label. A value that a change just updated flashes the accent
   once (1.2s). A meter fills from the start edge. A refused field shakes once. None of these move layout.
5. **Within a page.** When a filter or a reorder moves rows, the rows travel to their new places (`--dur-move`) instead of
   the whole page sliding. A row that appears rises, and one that goes fades (`--dur-quick`, `--ease-in`).

## Rules

- Animate `transform` (`translate`, `scale`, `rotate`), `opacity`, `clip-path`, `filter` and `box-shadow` only. Never
  width, height, top, left or margin.
- Content is readable with no script and no animation. An entrance that starts at opacity 0 runs only under a class the
  page's script adds at its first animation frame (`html.motion`), so a frozen or scriptless page still shows everything.
- Nothing waits for `animationend` or `transitionend` to become usable. Focus moves and data lands at once, and the
  motion only follows.
- `prefers-reduced-motion: reduce` removes movement. Durations collapse to near zero, keyframes that translate become
  opacity-only, and view transitions cut. Opacity fades may stay.
- A page change never animates the same pixels twice. When an inner animation runs (filtering rows), the page's own
  transition is switched off for that change.
- Do not add a motion library. CSS, the View Transitions API and the platform's `@starting-style` cover every move above.

## Where it lives

**InconsisID.** Tokens are in `src/page/assets/style.css` on `:root`. The console's moves are in
`src/page/assets/admin.css`. The card pages' moves (sign-in, sign-up, enrol, recovery, logout, error, legal) are in
`style.css`, which also holds the view-transition rules both share (`content` in the console, `card` and `step` on a card
page). Page changes are cross-document view transitions (`@view-transition { navigation: auto; }`, in `style.css`).
`src/page/assets/theme.js`, loaded by every page, adds `html.motion` (and `html.vt` when a view transition brought the
page in). `common.js`'s `show()` rises a revealed step. `.claude/skills/verify-inconsisid` drives the pages
headless, with its `admin-layout` and `admin-theme` journeys as the layout checks.

**InconsisTable.** Tokens and the shared keyframes are in `apps/web/app/theme/motion.css`; felt and the TV density
scale the durations there. The moves are in `apps/web/app/globals.css` (sections Page change and Entrances, the
dialog beside `.ledger-confirm`). Workspace pages change through React's `<ViewTransition>` in
`app/(workspace)/template.tsx`, and the rail's lit link glides as `nav-mark`; full loads (a room, admin, back to the
rooms) are cross-document view transitions of type `page`. A rail link above the current page carries the `back`
type. The root layout's `beforeInteractive` script adds `html.motion` and marks a step back through history. A list
that rises takes the `rise-list` class with `--i` set inline on each item. `lib/tokens/tokens.test.ts` fails on a
literal time or `cubic-bezier` in a rule.

## Checking it

1. Grep the changed CSS for a literal `ms` or `cubic-bezier` outside `@keyframes` and the token block. There should be
   none.
2. Load each changed page with animations frozen (an automation browser that does not run frames, or `html` without
   `motion`). Every piece of content must be visible.
3. Load it with `prefers-reduced-motion: reduce` emulated, and check that nothing translates.
4. Click through a page change and back in a real browser, and look at it. The chrome must hold still, and the marker and
   title must glide.
