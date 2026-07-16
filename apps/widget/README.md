# RhetorLint widget

Select text on any web page and mark the rhetorical tells — right where you're reading. On-device: nothing you select ever leaves your browser.

Two ways to run it, one engine (the real `@rhetorlint/core`, inlined at build time so it never drifts).

## The bookmarklet (zero install)

```bash
node apps/widget/build.mjs        # generates bookmarklet.html
open apps/widget/bookmarklet.html # then drag the button to your bookmarks bar
```

Select text on any page, click the bookmark. A panel shows the density, the marked phrases, and the deterministic `strip`. (Some sites with a strict Content-Security-Policy block bookmarklets — use the extension there.)

## The extension (Chrome / Edge / Brave / Firefox)

```bash
node apps/widget/build.mjs        # generates content.js
```

Then load it unpacked:

- **Chrome/Edge/Brave:** `chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick `apps/widget/`.
- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on* → pick `apps/widget/manifest.json`.

Use it: select text and press **Alt+Shift+R**, or click the toolbar button. The panel renders in a Shadow DOM so page styles never leak in or out.

## What it asks for, and what it doesn't

- Permissions: only `activeTab`. No host data collection, no network, no telemetry.
- It reads the current **selection** (or, with nothing selected, the visible text) and analyzes it locally.
- It marks tells in the **words**. It does not read the person, detect lies, or judge whether a claim is factually true.

## Build

`content.js` and `bookmarklet.html` are generated — do not edit them by hand. Edit the panel UI in [`src/panel.js`](src/panel.js) or the engine in `packages/core`, then rerun `node apps/widget/build.mjs`. A test (`test/widget-build.test.mjs`) fails if the committed `content.js` is out of sync.
