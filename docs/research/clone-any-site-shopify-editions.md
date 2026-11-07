# Clone any site: a run log on Shopify Editions Fall '26

Run on 2026-11-02 against `https://www.shopify.com/editions/fall2026`. This is the second worked example after [Quorum](clone-any-site-quorum.md). Quorum was a canvas game. This one is a scroll-driven marketing page with WebGPU, 3D models, Rive, and video. The process it feeds is [clone-any-site-process.md](clone-any-site-process.md).

Claims are marked (measured) when observed in this run, (read) when taken from the shipped code, and (guess) otherwise.

## Gate

Shopify is a brand, so the page is study-only under process step 1. This run tears it down and says how each part would be rebuilt. It builds no lookalike. A rebuild of these techniques runs on Victor's own content.

## Phase 1. Read before clicking

Tools: `curl` into the scratchpad, `grep`, the built-in browser's `javascript_tool`. About 15 calls.

**Stack (read).** Hydrogen on Oxygen (`cdn.shopify.com/oxygen-v2/...`), one Tailwind stylesheet, Lenis smooth scroll (`window.lenis`), 72 lazy chunks from one `entry.browser` script. No three.js, GSAP, or Framer Motion. The renderer is hand-written WebGPU.

**Chunk names survived minification (read).** `HeroGraph`, `ExponentialGraph`, `GraphLabels`, `renderer`, `controller`, `pointer`, `nodes`, `edges`, `wire`, `cardWire`, `sectionHub`, `journey`, `heroTap`, `heroMediaFlight`, `graphEggs`, `HtmlInCanvasRuntime`, `PrototypeStage`, `MerchModal`, `MerchWidget`, `VideoModal`, `StackedFigmaMotionVideoSync`, `RelatedUpdatesMotion`, `Rive`, `gltf`, `mesh.wgsl`. The names alone are a component list.

**Capability gates (read).**
- `getContext("webgpu")` in five chunks, with three `.wgsl` files fetched at runtime: `nodes`, `edges`, `fade`.
- `htmlInCanvasSupport` checks for `HTMLCanvasElement.prototype.requestPaint` and `GPUQueue.copyElementImageToTexture`. That is the experimental HTML-in-Canvas API. The built-in browser has WebGPU but not this API (measured).
- `?no-webgpu` forces the fallback outside production (read, `disabledByUrl`).
- `matchMedia("(prefers-reduced-motion: reduce)")` in the hero, and `(hover: hover) and (pointer: fine)` in the graph.

**The pointer module is a fluid simulation (read).** Pipeline labels `graph fluid ambient`, `graph-fluid-splats`, `divergenceMain`, `compositeMain`, `graph glyph glitch`, `graph page colour`. The cursor splats dye into a WebGPU fluid that tints the graph.

**Motion vocabulary (read).** 36 `@keyframes`, prefixed by component: `hero-*`, `ana-*`, `related-signal-*`, `wire-pulse`, `signup-morph-*`, `video-modal-*`. One easing module exports smoothstep, cubic out, cubic in-out, lerp, and an inverse lerp. Two CSS curves appear in the hero: `cubic-bezier(0.83, 0, 0.17, 1)` and `cubic-bezier(0.333333, 0, 0.666667, 1)`.

**Fonts (read).** PP Neue Montreal for display, Shopify Inter for body, Sohne Mono for labels, plus GT Standard, JetBrains Mono, Figtree. All but Inter, JetBrains Mono, and Figtree are licensed faces. A rebuild substitutes them.

**Assets (read).** 73 `.mp4` or `.webm` files, 7 `.riv` files, one `.glb`, 55 PNGs on first paint. The `.glb` came back gzip-encoded from `curl` without `--compressed` (measured). A fetch atom has to decode it.

**The console (measured).** The page logs an animated SVG and a note. "Open it in the latest Chrome on desktop, then press Shift + ~ to switch on Growth Mode", with `?expo-mode`. The console is a place to look for eggs and debug hooks.

## Phase 2. Click through

Tools: the built-in browser at 1440x900 and 375x812, screenshots, `read_page`, `find`. About 35 calls.

### Page map

| Part | What it is | Interactions |
|---|---|---|
| Header | Wordmark, "Editions" menu, search, two CTAs | Editions opens a list of past editions. Search is a typeahead with Suggestions and Results columns (measured) |
| Hero, bento | Vertical "Exponential" wordmark, an 11-item section index, three cards | Index links jump to a section. The cards are described below |
| Hero, graph | WebGPU force graph. 11 section hubs, one node per update with a thumbnail, edges to hubs | Nodes drift under physics. The pointer splats fluid. Scroll takes the graph full-bleed, then flies into the first hub (measured) |
| 11 sections | Agentic, Sidekick, Online, Merchandising, Retail, Payments, Operations, Shop, Marketing, Fulfillment, Developer | Each is a big title over its hub, a lead article with a looping video, then 2 to 7 shorter articles. Each has a "Back to navigation" button |
| Section colour | Five colours rotate: blue `#051DAA`, purple `#7000A9`, pink `#B2005B`, orange `#B03400`, green `#00632E`. Developer is slate `#0F0F0F` | The whole page repaints between sections. Each `<section>` carries `data-f26-section-previous-color`, `-next-color`, and a named scroll timeline `--f26-page-N` (measured) |
| Footer | Disclaimers, linked from `*` marks | |

### The hero cards

| Card | What it is | Interactions (from the canvas's own label, measured) |
|---|---|---|
| Product | A WebGPU render of a real 3D model | "Hover to see its parts, click for the next product, drag to rotate." "Data" and "AI Chats" modes. AI Chats fans wires out to five AI channel labels. Drag cycled camera, earbuds case, mushroom lamp (measured) |
| Plaza | An isometric scene of shoppers | "Point to walk one about; rest on another to take them over. Click someone, or press Enter, to pay on their phone and see their Shop profile; then follow them home, and to a store. Escape returns." |
| Fraud | A particle stream | "Transactions arrive in a disordered crowd, meet a protective line and leave in four orderly streams. Blocked events disappear at the line and tint it." |

### The 3D model (measured, glTF JSON)

The camera `.glb` holds 36 meshes with Blender names ("Film door", "Lens barrel", "AA cell"). Meshes sit under `part_*` groups (`part_rear_shell`, `part_film_pack`, `part_batteries`). There are `anchor_*` empties named `channel`, `format`, `price`, `stock`, and `variants`. Ten flat materials (`body_gloss`, `chrome`, `frost`), no textures, no animations. Extensions are `EXT_meshopt_compression`, `KHR_materials_clearcoat`, and `KHR_mesh_quantization`. 16,531 vertices.

So the exploded view is the code moving `part_*` groups apart, and the data labels are pinned to `anchor_*` empties (inferred). Colourways are material swaps, so the Blue, Pink, and Orange buttons need no extra assets (inferred).

### Scroll choreography

The hero's inline style names its scroll stops in px per 900 px of viewport height (measured): cover at 252, push 420, takeover 612, gather 980, focus 1152, end 1692. The section then lands at `--section-journey-lands: 40svh`. Every hero animation reports `currentTime: null` (measured). They run on CSS scroll timelines, not clocks.

### The section jump (read, then measured)

A click on a hero index link is caught by a document listener. It does not scroll 18,000 px. It crossfades to the section, sets the hash, and focuses the section. Any `wheel`, `touchstart`, `pointerdown`, or `keydown` cancels the jump, and so does `popstate` (read, `HeroGraph`). Clicking "Payments" landed on `#payments` at `scrollY` 18146 with focus on `#payments` (measured).

### Page state machine (measured)

`<html>` carries the page's state as attributes: `data-f26-home`, `data-f26-hero-graph`, `data-f26-video`, `data-f26-menu`, `data-f26-merch`, `data-f26-merch-phase`, `data-page-graph-intro`, `data-f26-page-settled`. The hero adds `data-hero-expanded` at full takeover (read). A rebuild can copy this state list as its own state type.

### Accessibility labels as a spec (measured)

Every looping video sits in a `role="img"` with a storyboard sentence. One example is "A channel mapping flow selects product fields, highlights connections, and updates a Google listing when the product name changes." Stat cards are `role="group"` with the stat as the label. This was the cheapest spec source on the page. It is worth more than screenshots of a looping video.

### Mobile (measured)

At 375x812 the wordmark turns horizontal, the hero is one tall graph card, the bento cards drop out, and a hamburger menu replaces the index. The page shrinks from 60,458 px to 47,614 px.

### Server routes (measured)

Search posts to `/editions/fall2026/predictive-search`. A clone needs its own search index. The rest of the page is static content.

### Not verified

- Growth Mode. Shift+~ on `?expo-mode` changed nothing visible. My guess is that it needs the HTML-in-Canvas API, which this browser lacks.
- The plaza's phone flow. The click landed while the scroll takeover was moving, and the page scrolled instead.
- The merch modal. The "Explore Exponential Socks" buttons exist but sit off-canvas until something opens them. I did not find the trigger.

## Phase 3. Record with `page-record`

A steps file with three states (intro with frames, scroll to `#agentic`, jump to `#payments`) against the live page.

**First failure (measured).** It crashed in 4.9 s with "Setting currentTime using absolute time values is not supported for progress based animations." The atom's virtual clock paused every running animation and set `currentTime` in ms. Scroll-driven animations take a progress value, and they are already deterministic, because scroll position sets them. Fixed in `atoms/page-record/src/page.js`, where the driver now skips any animation whose timeline is not `document.timeline`. Added `test/fixtures/scroll-timeline.html` and a test case. The case fails without the fix and passes with it (measured).

**Second failure (measured, fixed).** With the fix in, the capture stopped after 21.6 s with "kept a request open for 20s, so page time could not advance." Virtual time waits until no fetch is pending, and a stream that never ends keeps one pending forever. The stall did not recur on later Shopify runs, so the request behind it is unconfirmed. A local fixture confirmed the mechanism (measured). A page holding an EventSource or a video stream open stalled for 20 s, and an open `fetch` did not. `page-record` now fails Media and EventSource requests at the CDP layer, so a video shows its poster. The stream fixture passes in under 6 s, and two Shopify runs of the intro and agentic states finished in 32 s and 16 s.

**Missing step types (inferred).** `scroll` only scrolls a selector into view. This hero needs exact offsets (252, 612, 1152 px). A `scroll` with `y` would cover it. Capability states (reduced motion, no WebGPU, touch) need a per-state media or URL override.

## Tooling friction (measured)

- Clicks by screenshot coordinate missed three times. The screenshot frame (800x500) did not match the 1440x900 CSS viewport the way I assumed. Clicks by `ref` from `read_page` or `find` worked every time.
- `window.lenis` exposes only `version`, so there was no scroll API to drive. `scrollTo(0, y)` worked.
- `read_console_messages` returned two copies of a huge base64 SVG. Filter it with `pattern`.
- The page takes 5 to 8 s to assemble its graph after load. A screenshot before that shows a black panel.

## Asset lanes for a rebuild

| Asset | On this page | Rebuild with |
|---|---|---|
| 3D product | `.glb` with named parts and anchor empties | Blender. Model the parts, name them `part_*`, add `anchor_*` empties for labels, export glTF, compress with `gltfpack` (meshopt). gpt-image cannot make this |
| Product video | Looping `.mp4`/`.webm`, a phone UI over 3D props | A screen recording of the real UI. Props rendered in Blender, or gpt-image stills for a flat look. Compose in a video editor. The `role="img"` label is the storyboard |
| Isometric illustration | The plaza card | gpt-image for a flat set of sprites. Blender with an orthographic camera when many views must share one angle |
| Rive | 7 `.riv` files with PNG posters | Rive's editor. A `.riv` holds the state machine, so record its inputs and states from the runtime rather than guessing them |
| Graph, fluid, glyphs | WebGPU and three WGSL shaders | Hand-written. Read the shader function names (`nodeCoverage`, `edgeCoverage`, `gradientT`) for structure, then write new ones |
| Scroll choreography | CSS `animation-timeline` with named stops | CSS scroll-driven animations. Copy the stop table and the easing curves, not the code |
| Colour system | Six section colours and blends | Design tokens. Copy the structure (previous, current, next), choose new values |
| Fonts | Licensed display and mono faces | Free substitutes matched by metrics |

## Phase 4. Rebuild the hero as a motion study

Victor asked for the animation and effects only, with his own content. The study lives in `docs/research/motion-study/`, and the `motion-study` entry in `.claude/launch.json` serves it on port 4300. It draws the graph in Canvas2D and the glyph fluid in WebGL, scrolls with Lenis, and renders the card part with three.js. It uses no Shopify code, shader, asset, or text. The hero took four rounds.

### Round 1. Build from this log

I built the hero from the summaries in Phases 1 to 3. Victor's verdict was that the animation, the details, and the hover were nothing like the original. The cause was the source. A summary says what happens, not what it looks like, so I guessed the colours, the mark shapes, the label type, and the hover sequence.

### Round 2. Build from the original's numbers

A subagent read the bundle for numbers, and I captured the live hero. The numbers included mark radii, tether lengths, packet speeds, a 25% hover pull, a 265 u glow radius, the scroll stops (252, 420, 612, 1152, 1692 px per 900 px of viewport), and the 1400 ms jump. I rewrote `graph.js`, `main.js`, and `style.css` on that spec and checked each stop in the study. That check found two bugs:

- At rest on a section, the colour wipe stopped at 40% (measured). The journey was anchored at the section's top, but a section docks 0.4 screens minus 51 px above its top. The journey now ends at the dock.
- I read "the first title fades in over 33% to 95% of focus" and made the title wait at the bottom-left of the viewport.

Victor's verdict was "still off". The cause was the check. Every comparison set the study against my spec, never against the original, so a wrong reading of the spec passed. The title was one such reading.

### Round 3. Compare at the same stops

I opened the original and the study in two tabs at 1440x900. I scrolled both to the same offsets, put the pointer on the same kind of target, took screenshots, and read `getBoundingClientRect` and computed styles on the original. Seven differences came out of it.

| Surface | Original (measured) | Round 2 | Fix |
|---|---|---|---|
| Thumbnails | Small monochrome screens, mostly landscape, thin light outline | Bright coloured squares with an icon | Dark or light panels with a few interface bars, drawn at their own aspect |
| Hub mark | Small blue square, no halo | Glowing circle | Square, 6 px |
| Hub hover | Hub turns into a green square, its tethers turn green from the hub out, the label grows white with no underline, then children pull in with white rings | Green underlined label | Same sequence as the original |
| Ambient pulse | One hub's tethers light green, and two or three of its update labels show | Rings on that hub's children | Green tethers and three labels, eased in and out over 2.5 s |
| Spread | Hubs fill the card, and outer tethers run off its edges | A cluster in the middle | The overview fits the hubs, not every node, to 78% of the frame |
| Glyph field at rest | Not visible | Dotted stripes | Ambient glyphs off. The pointer still writes them |
| First title | Scrolls in with its section. No transform, opacity 1 at every stop | Waits at the bottom-left, fades in | Natural scroll. The section starts at document y 1692 |

The title now matches to the pixel. The original's `h2` is 120 px, weight 500, with `padding: 30px 0` and `margin-top: -30px`, at left 194 px. At scroll 800, 1250, and 1800 its top is at 862, 412, and -138 px. The study gives the same three numbers (measured).

### Round 4. Compare at full resolution and on a fake clock

Victor said most of it was there and asked for the small details. The browser pane's screenshots were the limit, since they show a 1440 px viewport in an 800 px frame. I wrote throwaway Playwright scripts, kept outside the repo, that load both pages headless at 1440x900:

- `capture.py` screenshots both pages at full resolution at the same scroll offsets, and `pair.py` stacks each pair into one image.
- `intro2.py` installs Playwright's fake clock, pauses it, and advances both pages 150 ms per frame. Real-time screenshots drifted by up to 0.5 s each, so real-time intro frames did not line up. The fake clock fixes `performance.now()` and `requestAnimationFrame` on both pages. CSS animations still run on real time.

They found these differences:

| Surface | Original (measured) | Round 3 | Fix |
|---|---|---|---|
| Intro | Hubs leave the root first as large squares, updates follow, and the spread grows at a steady pace on screen. Marks shrink as the camera zooms out. The graph settles in about 8 frames (1.2 s) | Hubs ran out on ease-out while the camera sat at 5.6x, so they left the frame and the zoom-out revealed a finished graph. Marks kept their resting size | Travel is set in screen terms (spread divided by zoom). The camera starts at 3.2x, centred on the root. Marks start at about 5x and shrink with the zoom |
| Hub labels in the intro | Faint until the graph is nearly settled | Full strength from the start | Fade in over intro time 0.8 to 1.7 |
| Background | Faint blue specks across the dark card, and lighter specks on blue | None | 180 specks in graph space |
| Tether colour | Cyan-blue, with green-teal on some hubs, as the bundle read said | All blue | The three bundle inks restored |
| Tether length | Varies from short to long on every hub | Nearly uniform | `80 * 4 ** rand()` |
| Ambient pulse | Like a hover: green hub, white rings, green thumbnail outlines | Green tethers and labels only | Adds the green hub, rings, and outlines |
| Bento columns | 162 px and 244 px | 177 px and 265 px | `(100svh - 70px) * 144 / 740 + 1px` and `clamp(205px, 17vw, 255px)` |
| Index numbers | Step left along an exponential curve: 0 px for three rows, then 6, 11, 18, 26, 38, 53, 75, 132 | One column | `--curve` per row, 132 px at the last row |
| Scroll 340 | Every hub still visible, edges whiter on blue, no labels | Other hubs at 40%, faint labels | Isolation runs over focus 0.28 to 0.48. Labels fade out over 0.05 to 0.2. Edges mix toward white with the blend |
| Scroll 520 and 800 | The camera zooms in on one star. Other hubs stay faintly visible | The overview refit to the growing frame, so the hub pose barely zoomed | The overview zoom comes from the cover card and holds while the frame opens. The other hubs keep 6% |
| Side nav | Scroll-scrubbed. Row 0 fades in from y 885 over 80 px, and each row starts 5.6 px after the last | Started at 980 with the open stage | Same numbers. At 950 rows read 0.81 to 0.32 against the original's 0.79 to 0.14 |
| Mobile | Not compared | Wordmark clipped to "Atc", header wrapped | Horizontal wordmark, header note hidden on narrow screens |

One edit in this round broke the page. It deleted a variable that a later line still read, so the frame loop threw on every frame. The next capture only showed rows stuck at opacity 0. Adding `pageerror` and console listeners to the capture script found it at once. A capture script should report page errors on every run.

### Round 5. Pointer push and the 3D page mode

Victor said the hero graph pushed nodes away so hard he could not hover them. Reading the code showed two causes. Any pointer speed over 24 px/s pushed nodes up to 265 px away, and the pointer velocity only updated on `mousemove`, so a resting pointer kept its last speed and kept pushing. The fix pushes only on a sweep over 450 px/s, within 160 px, at half the force. Nodes within 56 px of the pointer are never pushed, and the velocity decays every frame. In a headless test, the pointer circled 30 px from a node for a second and then stepped onto it. That landed a hover on 0 of 15 nodes before the fix and 10 of 15 after. A teleport control also scores 10 of 15, since the nodes orbit off their spot.

He then pointed at the corner button on the original that opens a second view. The button never showed in headless Chromium or in the browser pane. Its support check (read in its code) needs `requestPaint`, WebGPU, and `GPUQueue.copyElementImageToTexture`, which is Chrome's experimental HTML-in-canvas API. Headless Chromium with `--enable-experimental-web-platform-features` passed the check, but WebGPU failed there. Headless real Chrome 156 (`channel="chrome"`) with the same flags opened the view. Visitors need no flag. The original sends an `origin-trial` response header, so plain Chrome 156 has the API on shopify.com and not on localhost. The study therefore needs that flag locally, or its own origin trial token. Its button stays hidden without one.

The view draws the live page onto a strip that runs into the distance, its far end bending up to face the camera. The strip sits in a black void with a curved grid, wireframe maths props, rulers with page offsets, formula plots, card callouts, standing extruded titles, and wires from the side nav to cards. A subagent read the 297 KB bundle for numbers and gave a spec, without running it:

- The strip is 5 screens long, bent along `expm1(6.54u)`.
- The camera uses fov 45°, a 30.2° pitch, and sits 1.015 H up.
- The flat state uses fov 50° looking straight down.
- Entering takes 800 ms, linear.
- Lifts grow with distance, and titles stand up 90° and float 60 px.
- The props sit one every 2000 px, and the formulas one every 700 px.

The rebuild (`expo.js`) is our own code and uses WebGL2 instead of WebGPU. The page goes under a `layoutsubtree` canvas through a shadow-root slot. A paint handler draws a 6.9-screen band with `drawElementImage`, and the band uploads as a texture every 80 ms. Between uploads the texture slides with the scroll. Three API facts were found by measuring:

| Fact | Evidence |
|---|---|
| A subtree under `opacity: 0` is not painted, so `drawElementImage` draws nothing | 0 non-blank pixels, then 168 after removing the opacity |
| Client rects inside a `layoutsubtree` canvas come out scaled by its CSS size over its bitmap size | A section at 2681 read as 957, and 957 × 2520 / 900 = 2680 |
| `offsetParent` chains that cross the shadow root double-count | Cards read at 4260 against 2361 |

After the fixes, card rects match the flat page within 0.04 px at device scale 1 and 2. At the same scroll, the first pass placed the camera too close. The strip's near edge spanned 1.02 W against the original's 0.79 W, so the 3D distance is stretched 1.3×. The original's hero graph shows at the far end of its strip. The study hides its fixed graph layer in this mode, so that spot is empty.

### Round 6. Depth mode lag and the details against the original

Victor reported that clicking Depth mode stalled for about a second. He asked for the view to keep moving toward the original and for everything to be recorded.

**The lag.** `lag.py` timed each API call, the view transition, and the frame gaps at device scale 2. The view transition's update callback finished at 1563 ms, the longest frame gap was 1567 ms, and the transition ended at 1934 ms. The draw and upload calls took under 3 ms each, so they were not the cost. The callback awaited the band's `paint` event, but rendering is paused during that callback, so the paint could not fire until Chrome's timeout of about 1500 ms (inferred from the timings). The fix removes the view transition and swaps on the click. The first 3D frame now draws in the same rendering step. After the fix, with a 12 s wait before the click, the worst gap in the first 300 ms is 67 ms and settled frames have a median of 17 ms (measured).

**The gaps.** Full-size captures of both pages at the same scroll gave this list. All the code is our own, and the numbers come from reading or measuring the original.

| Detail | Original (measured unless noted) | Study before | Study now |
|---|---|---|---|
| Header in 3D | transparent | solid fill | transparent |
| Side nav | x 16, width 110, 12 px mono, 24 px rows, hollow dots, filled when current | x 20, width 150, 11 px, 19 px rows | matches, in both modes |
| Fill | section colour per row (read in code) | one colour for the whole strip | per-row bands |
| Strip past the top | fill runs on past row 0 | strip ended at row 0 | runs on |
| Panels | white outline on top, second line at the base | no outline | both lines |
| Panel label | bold sans off the top right corner, circle, leader, underline | none | built |
| Callouts | Δx and axis triad per panel | per note | per panel |
| Ground | fine low-alpha grid, faint rings and rays, bright sweeps on the rings | heavy white grid with moiré | rebuilt |
| Props | black solids with white edges and size labels | wireframes only | three machines of our own design, plus a denser knot |
| Section star | hub, mono label, tethers, thumbnails, shadow on the strip | none | built from the section data |
| Hero graph | on the strip, spilling past the top, with rings and numbered labels | hidden, an empty spot | built, static |
| Title | ground shadow, letters spin one after another on click | no shadow, no click | both |
| Buttons | float with a dark smear to the right | hard shadow | soft smear |
| Ruler and section names | about 11 to 13 px, close to the edge, with a tick | small and far out | matches |
| Clicks | page links and buttons work in 3D | nothing reached the page | a hit test maps the pointer to the raised element |
| Flat frame | graph layer visible as the mode starts | popped to plain fill | graph layer crossfades out with the fade |

**Checks in real Chrome with the flag.** The cursor turns to a pointer over a link, and a click on "Back to navigation" scrolled from 3000 to 0. A side nav link jumped to `#kit` at 6442. Escape returned to flat with the scroll kept, and the document height stayed at 12428. Clicking a title spins its letters in sequence, seen in three frames. No page errors in any run. In plain Chrome the API is absent, the button stays hidden, and there are no errors or failed requests. Flagged runs logged one 404 console line. `/favicon.ico` returns 404 on the study server, so that is the likely source (inferred).

**Two more API facts.** Rendering is paused during a view transition's callback, so awaiting a `paint` there stalls until the timeout. The page's own `measure()` reads scaled client rects while the page is inside the canvas, so it now keeps its flat numbers until the mode ends and measures again on exit.

**A test mistake.** The first click test swept the screen on a 20 by 12 px grid and found no pointer spots, which looked like a bug. The far links are only about 4 px tall on screen, so the grid stepped over them. Aiming at each link's projected centre found them. Sweep tests need a step smaller than the target.

**Still different.** The hero graph in 3D is drawn from the section data, so it does not hover or pulse. The hero's index curve with numbered dots, cube grids, wire flow dots, card hover, and the hidden ball game are not built. The entrance's timing is compared only by eye, because screenshots drift, and the 800 ms and its ease follow the bundle spec. Reduced motion finishes the entrance at once in code, but no run has exercised it.

### Round 7. Scrolling past the hero

Victor asked for the details after the hero to match. `stops.py` wheel-scrolled both pages to 11 stops, 600 px apart, and saved frames plus a DOM summary. A second script walked the DOM up from known text to read the original's rects, type, and colours. A third listed `document.getAnimations()` to find what scroll actually drives.

| Detail | Original (measured) | Study before | Study now |
|---|---|---|---|
| Panel box | x 194, width 1052, fill white at 0.08, border white at 0.1, no blur | width 1160, fill 0.1, blur 2 px | matches. The blur was what smeared the graph's lines into wide streaks |
| Panel head | heading and paragraph 18/22 px at weight 500, paragraph white at 0.7 and at most 512 px wide, padding 24/24/16 | small mono label, text at the panel's bottom left | matches |
| Button | dark navy pill, 12/16 px mono, padding 4/12, inside the head | outlined box under the panel | matches |
| Media | runs edge to edge inside the panel | bordered and inset | edge to edge |
| Notes | outside the panel, 4 columns, 14/18 px, a small bullet, 94 px below | 3 columns inside the panel | matches, with 3 notes per section |
| Notes rail | at x 1351, width 260, 11/14 px mono, clipped by the screen, moving at 0.86 of the scroll speed | none | built |
| Wires | corner dot on the panel to the rail, current nav dot to each note on screen, with pulses | depth mode only | built on the flat page too |
| Colour change | a soft bloom out of the next hub, about 500 px wide mid-change | a hard-edged disc | soft radial bloom |
| Graph past the hero | a few bright spokes and many faint ones, other hubs still faintly visible | every spoke bright, other hubs gone | at the time, 1 in 8 spokes stayed bright and others sat at 0.26. Now about 12 per hub stay bright and others sit at 0.2. Other hubs stay at 0.16 |

The rail's speed came from sampling its top against an item's top every 200 px of scroll. The gap changed by 28 px per 200, which is a rate of 0.86, and crossed zero when the item's top sat near 58% of the screen height. Computed `transform` read `none` on both elements, so the source of the motion is unknown, and the study uses `translate`. `RAIL_CENTRE` and `RAIL_DRIFT` hold the numbers. At scroll 999 to 1799 the study's rail top reads 933, 760, 588, 416, 244 against the original's 928, 758, 586, 414, 242.

**Checked.** All 11 stops ran with no page errors. Depth mode still opens, and its wires now end at text blocks outside the panel, as on the original. Its links, side nav, and exit all still work. Plain Chrome has no button, no errors, and no failed requests. At 390 px wide there is no horizontal overflow, and the rail and corner dot are hidden.

**A dead end avoided.** The `scroll-reveal` class names suggested a reveal animation. Sampled elements read opacity 1 and no transform at every stop, and the animation list held only wire pulses and section colour layers. So the study adds no reveal. The original's stylesheets are cross-origin and could not be read, so a reveal on deeper children is not ruled out.

**Still different.** The original has more content per section, including paired half-width panels, and the study keeps one panel per section with its own content. Hovering a panel or a note was not compared. The bright spoke's green tint and the circle at its tip were built later, in the flash sections below.

**A regression from this round.** Victor then reported a problem when scrolling back. His message did not say what he saw. Round 7's notes rail had widened the page to 1610 px at a 1440 px viewport, and a sideways wheel of 170 px moved the page by 170 px (measured). A diagonal trackpad swipe would slide the whole page sideways (inferred). My Round 7 overflow check ran only at 390 px, where the rail is hidden. `overflow-x: clip` on `.page-host` fixes it: width reads 1440 and the same wheel leaves `scrollX` at 0, with the rail still running off the right edge and the sticky hero unchanged.

Other checks in the same pass found nothing wrong. Scrolling up from `#services` moved steadily to 0 on both views, with no wrong-way steps and frame gaps of at most 33 ms after the first sample on the way up. "Back to navigation" went from 3863 to 0 in about 1.3 s. Screenshots taken mid-scroll showed the whole frame shifted by about 50 px on both views, but the header and canvas read top 0 and the visual viewport offset read 0 on every frame, so that shift is probably a capture artifact (inferred). It is not ruled out in a real window.

**The colour fade.** Victor confirmed the scroll-back fix, then said the colour change was not as smooth as the original's, which fades more. Round 7's soft edge had only blurred the disc. `fade.py` sampled the page at five fixed points every 40 px of scroll, on both pages, and normalised each point from the old colour (0) to the new one (1).

| Measure | Original | Study before | Study now |
|---|---|---|---|
| Whole change | about 480 px | about 220 px | about 440 px |
| Largest 40 px step at any point | 0.24 | more than 0.5 (the corners) | 0.29 |
| Header | same colour field as the page | its own straight fade, so a seam showed | same field as the page |
| In-between colours | not a straight RGB blend (inferred, green stays up while red rises) | RGB blend | OKLab mix |

The study now runs the bloom across almost the whole journey to the next section. A point starts later and finishes later the farther it is from the new hub, and eases out as it arrives. Stops are opaque OKLab mixes, 17 per frame, drawn on the graph canvas. The same stops are written to the header as a CSS `radial-gradient` in viewport pixels, so header and page match with no seam. A 250 ms transition I had put on the header is gone, because it made the header lag the scroll.

The mean difference between the two curves is 0.10, and the largest is 0.54, at the start of the bottom right point. Hubs sit in different places on each page, so a point near the hub on one page is far from it on the other. The timing constants were fitted by hand to one section change on the original (Agentic to Sidekick). On the study I sampled one change (Model to Observe). The other changes use the same code and were not sampled. Scrolling up runs the same function of scroll position, and I did not sample it separately.

**The flash between sections.** Victor pointed out that the original's lines blink when it sits between two sections, and that its colour change has a feather. A burst of screenshots was too slow and its diff was dominated by the graph's drift, so `cast.py` recorded CDP screencasts at 60 fps with the page at rest. On the original, the current hub's spokes light one at a time, clockwise. Tracking brightness on a ring 70 px around the hub gave these numbers (measured):

| Part | Original |
|---|---|
| Cycle | about 3.6 s, seen twice over 8 s |
| Spokes lit per cycle | about 10 |
| Gap between onsets | about 0.22 s, one gap of 0.45 s |
| One spoke | full in about 0.05 s, holds to about 0.3 s, gone by about 0.75 s |
| Quiet part | about 1.2 s before the next cycle |
| Tip | a pale green ring that shrinks as it fades |

The study builds this in `graph.js` as `SWEEP`. Each hub marks about 10 evenly spaced spokes as bright, and they light in order around the current hub. That hub is the one the colour blooms from, so the sweep moves to the new hub as the journey begins. Screencast frames from the study repeat at 3.6 s and match the pattern. Resting bright spokes dropped from 1 to 0.55 so a flash stands out. The sweep stops while a hub is hovered and does not run under reduced motion. The study's gaps are even, so the original's one longer gap is not copied. The original's ring also sits on any node along the same line, and the study's ring sits only at the spoke's tip. Whether the original's order is by angle or by data is inferred from one hub.

**The flash, corrected.** Victor sent two screenshots of the original and said it still was not right. The rhythm was close, but the colours and the state around them were wrong. I had read the colour from 1 px lines in a downscaled JPEG screencast, where the line blends into the page, so I built a pale tint. The screenshots show saturated green. The next pass used a lossless PNG screencast at 60 fps, and a hover test to separate the two states in his screenshots.

| Part | Original (measured) | Study before | Study now |
|---|---|---|---|
| Lit line | `#4bf08e` within 0.03 s, pale lilac by 0.3 s, at rest by 0.6 s | pale `rgb(190 255 225)`, gone by 0.75 s | same curve |
| Cycle | about 3.95 s, 12 spokes, 0.215 s apart, then a pause of about 1.55 s | 3.6 s, about 10 spokes, 0.22 s apart | same numbers |
| Order | clockwise, with the pause near the spoke to the next hub (one hub) | list order | clockwise from the next hub's direction |
| Tip ring | green and 6 px in radius, then white and about 2.5 px by 0.4 s | pale, 7 to 3.5 px | same |
| Branch | the lit tip also sends a line to a far node, gone by about 0.9 s | none | built, to a seeded node of another hub |
| Resting tips | small open white rings | filled blue dots | same as the original for the current hub |
| Resting spokes | one flat pale tint, no travelling pulses | gradient with pulses | flat, pulses fade out past the hero |
| Hub at rest | pale square | blue square | pale square |
| Hub hover | flat green spokes, green hub, white 5 px rings, sweep keeps running | green gradient, sweep stopped | same as the original |

Victor's second screenshot, with every spoke green, is the hub hover. Moving the pointer onto the hub produced that state, so it is not an ambient pulse. The first capture landed on a thumbnail by mistake, and that showed a separate state: its one spoke and its onward line turn green. That thumbnail state was not compared.

Running the same spoke script on the study gives green at 0.03 s, pale at 0.3 s, and rest by 0.6 s, the same shape as the original. The study's resting line is slightly brighter (white at about 0.18 against 0.135 at 1x, before a last trim to the alpha that I did not re-measure). The previous hub now reaches its resting alpha by 50% of the journey, not at the end, because the original's stills show it gone (inferred from one stop, the fade itself was not measured).

Still different: the study's section title is solid and the original's is outlined at this stop. Which node a branch ends on in the original is unknown. Other sections' sweeps use the same code and were not captured. The hero's gradient hover is unchanged. Depth mode and plain Chrome still run with no errors or failed requests.

**The flash and the feather, third pass.** Victor corrected me again. He meant the background colour, and said the lines do not sit there flashing like a beam, they flash one by one after you scroll down. My earlier checks all held the page still at one stop, so they could not show either point. `rec.py` recorded a lossless screencast of a wheel scroll through a section change on both pages, and the frames went side by side at matching colour progress.

The largest miss was a gate. `gate2.py` rested at each stop on the original and counted long green lines. `vis.py` stepped through a section change every 200 px.

| Scroll on the original | What sits behind the content (measured) |
|---|---|
| 4200 to 4600, panels and notes | nothing, a plain colour with no lines and no flash |
| about 4800 to 5000 | the graph fades in while the last panel is still on screen |
| 5137 to 5480 | the colour change, with flashes one by one |
| 5480 to 5800 | an empty stretch with the graph and flashes |
| 5800 to 6000, the title rises from 590 to 390 px | the graph fades out |
| 6000 to 6200 | nothing again |

The next section change has the same ending: flashes through 8600 and none at 8800. Where the graph fades back in before that change is less clear, since those stops also have green page content. The study had no gate, so its lines stayed behind every panel and flashed forever. That is the beam Victor saw. The study now has `s.lines`, from `LINES_IN` and `TITLE_OUT` in `main.js`. It scales every graph part, and the graph can't be hovered while nearly hidden. The same count on the study reads no long green lines at 1400, 1800, 2100, 3000, 3300, or 3700, and flashes at 2400 and 2700. The fade-in point is placed by distance before the colour change (0.37 screens on the original), since the study's sections are shorter.

The colour field had matched numerically (`field.py`), and it still looked wrong. There were three reasons:

- **Centre.** The original's bloom opens around the middle of the screen with all four edges still dark. The study's new hub was off to the right, so its colour swept across. `PAN_END` now lands the camera by 55% of the journey, and colour starts at 25%. The field maps are now centred, like the original's.
- **Contrast.** The study's blue and purple were close and pale, so the glow barely read. The two colours are now deeper (`#0a24b4`, `#680cae`). These stay the study's own and are not the original's values. This is a judgment call.
- **Width.** The bloom's front is a little wider, with the old hub out by 35% of the journey.

Line levels also dropped: resting spokes to 0.15, other hubs' spokes to 0.3 of their alpha, and the branch to a pale line at 0.4 with no green. Exactly 12 spokes per hub are bright now. These levels were set by eye against frames, except the resting spoke, which came from the 0.135 measured earlier.

Still different: other section changes were not recorded on the study. Which scroll signal the original uses for its gate is unknown, and rests at each stop rule out scroll speed as the trigger. The section title stays solid where the original's title starts outlined.

**Slower on request.** Victor then asked for a slower transition between colours. This goes past the original on purpose. Screen centre, 10% to 90% of the change: 125 px on the original, about 283 px on the study now. The screen edge reads 180 px against about 340 px. The journey now runs over 0.85 screens (`JOURNEY`), the camera still lands in about the same distance (`PAN_END` 0.33), colour starts at 10% of the journey, and each stop eases with a smoothstep. `LINES_IN` moved to 1.15 and 0.93 screens so the graph still appears about 0.37 screens before the colour starts. A 661 px reading at one mid-screen point is left out, because a panel crosses that point and spoils the sample (inferred).

**Random flashes and new machines.** Victor then asked for two changes. The flashes should not run in order: one here, one there, sometimes two together. This replaces the measured clockwise sweep on purpose, so that part of the study no longer follows the original. Each round now lights one spoke (60%), two (32%), or three (8%), each at least 60° from the last, with a wait of 0.15 to 0.6 s, or 0.9 to 1.8 s one time in five. `flashlog.py` logged 19 onsets in 12 s at rest, at angles such as 60°, 120°, then 0°, 300°, and 210° together. Gaps ran from 0.2 s to 1.83 s, and four onsets landed with another. The log samples the first 55 px of each spoke in 15° bins, so it may undercount.

He also asked for the line-art 3D models in Depth mode. The original's stand large at the strip's edge in clusters, with hidden lines and a height label per model. The study's three machines were small boxes set apart. `machines.js` replaces them with a factory of our own: a parts cabinet labelled ATOMS, a press, a robot arm, a conveyor, crates, and a drum. No shape is taken from the original's models. Parts are boxes, beams, and cylinders, built once in local units and placed each frame as black solids with white edges. Three yard layouts rotate by side and section, at 1.5 times the old size, and each model has its own height line.

Checked: Depth mode opens with no page errors, its side link and exit still work, and plain Chrome has no button and no errors. The only console error is a 404 for a missing favicon (the file does not exist). The arm's height line and a plot's formula label first crossed the cabinet, because the overlay has no depth test and world-vertical lines lean in perspective. Height lines now sit in screen space beside the machine's projected box. Each keeps its side while clear of other machines, the strip, the nav, and other labels, tries the other side next, and fades out if neither is clear. So some machines have no label at a given moment. Plots now skip rows 900 px beyond and 350 px before a yard, since a machine's height covers the rows behind it on screen. Screenshots at two scroll stops show no label on a machine. The nav wires still cross machines, and a height line can touch a ruler number.

**The feather.** A radial profile around the hub showed the original's colour falling almost in a straight line, from 0.91 at 100 px to 0.02 at 800 px. The study already read 0.94 at 100 px and 0.16 at 800 px at a comparable moment, so its tail runs a little long. The only feather change was doubling the gradient to 32 stops, to reduce visible rings. The hubs on the two pages are at different positions, so this compares the shape, not the same pixels.

### Not compared yet

- Update-node hover.
- Reduced motion.
- The 3D page mode's hover tilt on cards, cube grids, the hero index curve, and the hidden ball game. None are built.
- Depth mode under reduced motion.
- The index jump at full resolution. The pane checks in Round 2 covered it only at 800 px.

## What this run adds to the process

1. Read four free spec sources before clicking: chunk names, the console, `aria-label`s, and `<html>` data attributes. Together they gave the component list, an egg, a behaviour spec per canvas, and the page state machine.
2. A site has capability tiers (WebGPU, HTML-in-Canvas, reduced motion, fine pointer, mobile). Each tier is a separate state to map and record.
3. Asset files are inspectable. A `.glb`'s JSON names its parts and anchors. A `.wgsl` names its functions. A `.riv` holds its state machine.
4. `page-record` needs three changes for marketing sites: scroll timelines (done here), long-lived media requests (done here), and scroll offsets (open).
5. A page with a server route (search) needs a data lane, not just a visual one.
6. Check a rebuild against the original at the same stops, never against your notes. Rounds 1 and 2 both failed on that premise. Round 3 found seven differences in one pass by reading the original's DOM numbers next to the study's. Round 4 found twelve more at full resolution and on a fake clock.
7. A capability tier the default browser lacks still needs recording. Find the flag that passes the page's own support check, and try the real Chrome channel when the bundled Chromium fails it. Check the response headers for `origin-trial` too, because a rebuild on another origin won't inherit that access.
8. When an interaction lags, time the browser's own steps before optimising your code. The draw calls took under 3 ms, and the second of lag was a deadlock with the view transition.
9. Rebuild a second view from full-size crops of the original at the same scroll. Round 6's sixteen details came from one pass over those crops, after the bundle spec alone had left them as gaps.
10. For a scroll page, walk up the DOM from known text to read its real rects and type, then list `document.getAnimations()`. Class names can mislead. `scroll-reveal` suggested an animation that no sample showed.
11. Check `scrollWidth` against the viewport at desktop width after any layout change, not only at phone width. An element meant to run off the edge needs clipping, or it makes the page pan sideways.
12. Judge a transition by its curve, not by a frame. Normalise fixed screen points from the old state to the new one at even scroll steps, then compare the length and the largest step on both pages. Separate layers that show the same effect (here the header and the page) need checking too.
13. To study a looping effect at rest, record a 60 fps screencast and track brightness on a ring around its centre. Screenshots at 5 fps miss it, and their diffs mostly show slow drift.
