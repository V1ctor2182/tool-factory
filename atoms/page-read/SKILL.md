---
name: page-read
description: Read what one load of a live page says about itself, before clicking anything: console notes, aria labels, data attributes, sections, canvases, running animations, capabilities, fonts, and the elements a sweep can hover or click. Use after page-bundle when studying a site. Needs Google Chrome.
---

# page-read

```sh
bin/page-read facts https://example.com/ --json
bin/page-read facts https://example.com/ --load-ms 10000
```

The result is `contracts/page-facts.schema.json`. It runs in real headless Chrome with experimental web platform features on, so a capability tier behind a flag shows up.

A `labels` entry often states an animation's behaviour in one sentence. `animations.scrollDriven` counts animations whose timeline is not the document clock. `targets` lists links, buttons, and `cursor: pointer` elements with a CSS path, up to 400. A target's `safe` is true when, as far as the markup says, a click stays on the page and writes nothing. It reads markup, so treat it as a filter and not as a promise.

| Code | Meaning | What to do |
|---|---|---|
| `missing_browser` | Google Chrome did not start | Install Google Chrome |
| `network_error` | The page did not load | Check the URL, retry |
