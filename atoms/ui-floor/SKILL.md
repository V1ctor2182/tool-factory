---
name: ui-floor
description: Check a rendered page against the lines of vstack's design floor that a script can see, at desktop and phone width. Use before showing Victor a UI you built or changed, after the screenshot check, and on any page he calls cheap or AI-ish.
---

# ui-floor

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/ui-floor check --help` prints them.

```sh
bin/ui-floor check http://localhost:5173/
bin/ui-floor check file:///path/to/page.html --json
```

The result is a list of findings, as `contracts/ui-floor.schema.json` defines it. Without `--json` it prints a count per floor line and up to five elements each.

`check` loads the page at 1280 and 390 pixels wide in headless Chromium and waits until the network has been idle for 500 ms. It reads every visible element and reports four lines of the floor table in vstack's `principle-design-floor`:

| Line | Rule | What fails |
|---|---|---|
| 4 | `clipped` | Text cut off by its own box's `overflow`, unless it ends in an ellipsis |
| 4 | `off-screen` | A control past the left or right edge of the screen |
| 4 | `page-scrolls-sideways` | The page is wider than the screen |
| 6 | `pure-black` | Text in `#000`, or a `#000` background over a tenth of the screen |
| 7 | `low-contrast` | Text under 4.5:1 against its nearest solid background, or under 3:1 for large text. Text over an image or gradient is skipped |
| 8 | `emoji-icon` | An element whose own text is only emoji, or an emoji inside a control |

The other floor lines (motion, extra text, boxes, focus, fake materials) need judgment, so check them by eye. A clean result does not mean the page is good, only that these lines hold.

It checks only the state the page loads in. Open a menu or a hover state yourself and screenshot it. The atom is `observe`, so it never caches. On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `blocked` | The page shows a bot check | Stop. Open the page yourself |
| `unavailable` | The page answered an HTTP error, or Chromium is missing. The message says which | For Chromium, run the command in the message |
| `network_error` | The page could not be reached or never went idle within 45 s | Start the dev server, or retry |
| `invalid_source` | The URL is not http, https, or file | Pass a page URL |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
