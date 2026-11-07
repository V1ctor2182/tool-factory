# Clone any site: a run log on quorum.elianiva.com

Started 2026-11-02. This log records one end-to-end attempt at cloning a whole site, so the steps can become a tool. Each phase says what was done, with which tool, what worked, what failed, and what the tool would need. Claims are marked (measured) when observed in this run, (read) when taken from the site's own text, and (guess) otherwise.

## Goal

Victor wants one tool that clones any website. Quorum is the first worked example. The current `ui-clone` service copies or rebuilds one shadcn component at a time. This run finds what a whole-site clone needs beyond that.

## Phase 0. Explore the site by hand

Tool: the desktop app's built-in browser, driven by screenshots, `get_page_text`, `read_page`, and `javascript_tool`. About 25 tool calls.

What the site is (measured): a browser game about running a company on backend infrastructure. Routes seen: `/` (title), `/company` (main game), `/challenges` (level list). The title screen is DOM. The game board is a single `<canvas>` at device scale 2, with DOM panels around it.

Screens and interactions found (measured):

| Screen | Entry | Interactions |
|---|---|---|
| Badge reader | `/` on load | One button, "Clock in". Card slides in, screen flips to "Clocked in", then a transition |
| Title menu | after badge | Five items. The selected item draws a lit cable to an isometric SVG illustration. Submenus replace the list in place, with a back arrow |
| Board | `/company` | HUD (stage, clock, cash, users, Apdex, latency). Toolbar (help, settings, undo, redo, pause, speed, fit, fullscreen). Canvas of node cards and cables. Build tray with four groups |
| Build tray | click a group or keys 1 to 4 | One card per unlocked part with price. Click a card to arm it, a ghost follows the cursor, click the board to place. Drag to place does nothing |
| Inspector | click a node | Side sheet with the node's full stats and an upgrade button |
| Inbox | mail icon | Mail client with Inbox, Spam, Trash, J and K, Esc. Mentor letters arrive when a feature unlocks |
| Research | appears once Insight is enough | Full-screen tech tree over the board. Columns are branches, rows are funding eras. Detail card plus a buy button |
| Help | `?` or H | Six-step loop plus a full key map |

Progressive disclosure (measured): the Insight HUD row, the Research button, and Undo and Redo appear only after the event that makes them useful. Each unlock comes with a mentor letter.

What failed (measured): wiring two nodes. A cable appears during the drag but is gone on release. Three attempts all failed: the browser drag tool, a drop on the exact port, and 30 stepped synthetic `PointerEvent`s. Phase 2 found the cause in the bundle and wired a cable on the first try.

Friction in the tooling (measured): screenshots trailed the page by about one frame, so each step needed two. Escape that closes a modal also swallows the next click.

## What Phase 0 says the tool needs

The existing atoms cover a DOM component in a scripted session. A whole site adds these needs.

1. **A site map.** Routes, screens, and how each is reached. Phase 0 built this by hand. It is the input every later phase uses.
2. **An interaction inventory.** For each screen, the controls, their states, hotkeys, and what each changes. `read_page` and the help screen gave most of it.
3. **Canvas content.** `page-record` captures DOM, styles, and motion. A canvas gives none of those, only pixels. The clone needs a spec written from screenshots and visible behavior.
4. **State over time.** The game unlocks features as values grow. A recording needs a way to reach later states, by waiting, by playing, or by seeding storage.
5. **The real gesture contract.** Phase 0 guessed that drags needed trusted input. Phase 2 showed the gesture only needed the right drop target. Guessing a gesture from pixels wastes attempts when the handler is readable.

## Decision 1. Switch the example target

Quorum is a game, and the clone would reproduce its name, art, and look. Victor chose on 2026-11-02 to drop it as the example and run the whole pipeline on a non-game site instead. Phase 0 stays here as the first exploration, since its findings on site maps, canvas content, state over time, and drag input carry over to any target.

Next target: to be named by Victor.

Victor asked on 2026-11-02 to finish the recording on Quorum and distill the process. Phases 1 to 3 below study the site only. No part of Quorum is rebuilt. The rebuild steps of the process run on a different target.

## Phase 1. Read the shipped bundle

Tool: `curl` for `index.html`, the one JS bundle (1.5 MB), and the one CSS file (155 KB), then `grep` and short Python scans. About 12 calls. This phase gave more than all of Phase 0.

Stack (read from the bundle):

| Layer | Finding | Evidence |
|---|---|---|
| Build | Vite, one hashed JS and one hashed CSS file | `assets/index-CuRXLkfy.js` |
| DOM view | Snabbdom, about 1000 `h(` calls | the `data.hook.destroy` patch loop |
| App shape | Elm architecture in TypeScript | modules `model.ts`, `update.ts`, `view.ts`, `subscriptions.ts`, `commands.ts` |
| Board | PixiJS on WebGL, cards and cables both drawn | `[PixiJS]` error strings. `getContext('2d')` returns null on the only canvas (measured) |
| Styling | Tailwind v4.3.3 with shadcn token names | `--primary`, `--card`, `--ring`, `components/ui/button.ts` |
| Type | Geist and Geist Mono from Google Fonts | `<link>` in the head |
| Persistence | three `localStorage` keys | `quorum.save.v2` (102 KB), `quorum.founder.v1`, `quorum.playlog.v1` |

The bundle names itself. Every traced function is wrapped as `A(fn, "src/game/update.ts#CheatCash")`. That string table gives:

- **A module map.** 97 source files under `src/`, plus a `packages/simulation` workspace.
- **The full intent list.** 255 tags under `update.ts#`, one per message the app handles: `NodePlaced`, `LinkRequested`, `ResearchBought`, `MailTrashed`, and so on. 1350 tags overall.
- **Typed payloads.** The message schema sits next to the list, for example `LinkRequested: {from: string, to: string}` and `ResizeChosen: {nodeId, direction: 1 | -1}`.
- **The key map.** The `KeyPressed` switch lists every global key: `Escape`, `r` research, `t` team, `p` playbooks, `?` and `h` help, `` ` `` playtest, `i` inbox, `m` mute, `g` glossary, `Enter`, space pause, `s` speed, `f` fit, `c` collect, `z` undo, `Z` and `y` redo, `u` resize, `Delete` and `Backspace` sell.
- **Routes.** `route.ts` names five route kinds: `Title`, `Menu`, `Company`, `Sandbox`, `Challenge`. Paths seen live are `/`, `/company`, `/sandbox`, `/challenges`.
- **The progressive-disclosure rules.** `reveal.ts` owns them: `revealAtStart`, `advanceReveals`, `triggered`, `dockGroups`. This matches the unlock order seen in Phase 0.

Most production sites minify names away. This one keeps trace strings, so the yield here is high. (guess) A typical site gives the stack, routes, tokens, and strings, but not an intent list.

## Phase 2. Find the levers that reach any state

Tool: the built-in browser, plus the bundle from Phase 1. About 15 calls.

**A hidden Playtest panel** (measured). The `` ` `` key opens it. It holds speed (1x, 3x, 10x), skip ahead (next funding stage, more cash, Insight, Legacy), 25 incidents to force on demand, and log export and clear. A recorder can reach late-game screens with it and skip the play needed to unlock them.

**A built-in event log** (measured). `quorum.playlog.v1` keeps every message with its time, payload, and a state diff. One cable added in this run logged `LinkRequested {from: "server", to: "n1"}`, a toast, and a `ChangeSettled` entry with before and after latency, errors, and revenue. That log is an interaction trace the site wrote for itself.

**Offline progress** (measured). Coming back after 43 minutes showed an "Away 43 min" modal with users 336 to 687, cash, Insight, and dev hours. `src/offline.ts` computes it. Phase 0 missed this screen because it never left and came back.

**The wiring cause** (read, then measured). The board's `pointerup` handler completes a link only when `nodeAt(point)` finds a node under the release point. Releasing on the input port springs the cable back. A drag from App Server's out port released on the Database card body wired them on the first try. The cable showed an orthogonal preview during the drag, then moving packets once committed. App Server load fell from 999% to 654% in the next frame.

Side effect: this run added one cable to the save in the built-in browser. `z` undoes it.

## Phase 3. Pull the design and motion layer

Tool: `grep` over the CSS, `curl` for the hero art. About 3 calls.

- **Tokens** (read). 189 custom properties. Colors are `oklch`. The board theme is light (`--canvas: oklch(95.5% .002 260)`) and the title screen is dark. Four group hues name the build tray: `--group-edge`, `--group-compute`, `--group-data`, `--group-ops`. Radius is `10px`.
- **Motion** (read). 30 `@keyframes`. Entry and exit pairs (`exit-modal`, `exit-toast`, `exit-panel`, `stagger-in`), title choreography (`title-draw`, `title-cable-float`, `title-node`), and the badge reader (`reader-in`, `reader-out`, `reader-blink`). The main ease is `cubic-bezier(.23, 1, .32, 1)`. One `prefers-reduced-motion` block, plus an in-app `MotionToggled` setting.
- **Hero art** (read). `/art/hero.svg` is one 515 KB isometric SVG with 548 groups and 1876 paths. Class names split it into layers: `iso-top`, `iso-shade`, `iso-line`, `packets`, `ray`, `pops`. The title animates those layers with CSS. A raster model like gpt-image cannot produce layered, animatable vectors like this, so it does not fit this kind of asset.
- **Sound** (read). `src/game/sound.ts` exists, with no oscillators and no decoded audio files in the bundle. (guess) Sound is off or loaded lazily.

## What the three phases say

1. **Read before you click.** The bundle answered in 12 calls what 25 clicks could not, including the cause of a failure.
2. **The DOM and the canvas need different tools.** DOM parts fall to `page-record` and the shadcn path in `ui-clone`. Canvas parts give only pixels, so the spec comes from screenshots, the bundle's names, and the event log.
3. **Reaching a state is its own problem.** Here three levers existed: a debug panel, a seeded `localStorage` save, and offline progress. A recorder must find levers like these on each site, or play to the state.
4. **Every claim about a gesture needs a test.** The wiring guess in Phase 0 was wrong. One drag settled it.

The distilled process is in [clone-any-site-process.md](clone-any-site-process.md).

## Decision 2. Reference the UX, build an original tool

Victor's real want for Quorum is a system design tool of his own. That is a second path next to a faithful clone: take the interaction patterns, keep the domain, replace name, look, and copy. Prototype "Loadbench" lives in the session scratchpad as one HTML file, served through the `loadbench-proto` entry in `.claude/launch.json`.

Patterns taken from Phase 0 (measured in Quorum, rebuilt from scratch):

| Pattern | In Loadbench |
|---|---|
| Card shows "value / cap" for the resource that runs out | CPU, connections, memory, bandwidth per kind |
| Cables show flow | Dash speed and width scale with rps. Red when the target drops |
| One global score | Apdex against 0.9, from success rate and mean latency |
| Bottleneck pulses and names the resource | "Out of CPU. Dropping 91/s" |
| Click to arm, ghost, click to place | Same, hotkeys 1 to 5, Shift keeps it armed |
| Inspector side sheet | Adds a "why" text and the fix for the bottleneck |

Changed on purpose: no economy or unlocks, a traffic slider and a 10x spike instead, cost shown as $/month to weigh against Apdex. Look is warm graph paper with hard ink shadows and IBM Plex.

Verified in the browser (measured): placing, wiring by mouse drag, cutting a wire, overload, a load balancer split of 151 into 75.5 per app, and the inspector. Two bugs found and fixed. The first fit ran at zero pane width. The load bar shifted the label and value columns.

Lesson for the workflow: Phase 0's screen and interaction inventory was enough input to rebuild the UX without recording anything. The recording atoms matter for pixel parity, not for pattern reuse.
