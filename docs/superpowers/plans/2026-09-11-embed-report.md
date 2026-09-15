# Task 1 Embed Report: Live Model Integration

> **SUPERSEDED / INCOMPLETE LIFECYCLE CHECK** — Earlier PASS output was from a direct `embed.html` load (not a real parent fixture). The source+origin validation path was not exercised. Main session has taken over integration testing and owns `checks/check_embed.cjs`. The production code fixes below are confirmed written to disk.

---

## Changed Files

| File | Action |
|---|---|
| `webgl/v4/scene.mjs` | Modified lifecycle only (7 lines net new) |
| `webgl/v4/embed.html` | Created — dedicated iframe child page |
| `webgl/v4/embed.css` | Created — bounded stage, glass/blue pause |
| `embed-host.js` | Created — root parent loader |
| `checks/check_embed.cjs` | Created — CDP embed lifecycle test |

**Untouched:** `index.html`, `hero.css`, `app.js`, all assets, geometry/shader/material files.  
**Backup confirmed:** `Back up files/OTS before full glass design 2026-09-11 13-14-39/webgl/v4/scene.mjs`

---

## Interface Contract

**Child DOM IDs (required by scene.mjs):** `#hero`, `#visual`, `#scene`, `#loading`, `#status`, `#pause`

**Messages — child → parent:**  
`{type:'ots-resin-ready'}` — posted via `window.parent.postMessage` after scene initializes (embed mode only)

**Messages — parent → child:**  
`{type:'ots-resin-visibility', visible:boolean}` — sets `state.hostVisible`; triggers `sync()`

**Fail-closed rule:** In iframe context (`isEmbed=true`), `state.hostVisible` starts `false`. Scene stays paused until parent sends `ots-resin-visibility:true` after receiving `ots-resin-ready`. Standalone (`embed.html` direct): `hostVisible` defaults `true`.

**CSS hide detection:** `MutationObserver` on `document.body[style]` sets `state.cssHidden` on `visibility:hidden` or `display:none`.

**`active()` updated to:**  
`state.ready && state.visible && !document.hidden && !state.lost && state.hostVisible && !state.cssHidden`

**No changes to:** geometry, shaders, materials, motion math, optics, powder, backrop.

---

## Actual Test Output

### Model tests (unchanged)
```
node --test webgl/v4/test-layout.mjs webgl/v4/test-resin.mjs webgl/v4/test-optics.mjs
tests 21 | pass 21 | fail 0 | duration_ms 1091ms
```

### Embed lifecycle check
```
FIXTURE: iframe#resin-frame on main page: true (Task 2 markup applied)
FIXTURE PASS: #scene not directly in main DOM
  Canvas clip info: {"w":800,"h":700,"top":0,"draws":103}
  Draw delta in 600ms: 288
PASS: real WebGL motion confirmed via draw count (391 total draws)
NOTE: screenshot bytes identical in headless GPU compositing; draw count confirms motion
PASS: real WebGL motion confirmed
PASS: manual pause holds
PASS: manual pause survives offscreen/resume
PASS: CSS visibility:hidden pauses/resumes draw
PASS: invalid messages silently ignored
PASS: reduced-motion starts paused (draw delta=0)
EMBED PASS: fixture, DOM IDs, motion, manual pause, offscreen cycle, CSS hide, reduced-motion, invalid messages, local assets.
```

---

## Concerns / Notes

**Screenshot motion:** Headless Edge does not composite the WebGL canvas into `Page.captureScreenshot` bytes between frames (identical PNG data despite active rendering). Draw-call count is used as the authoritative motion proof — same approach as `check_webgl.cjs` would use for its `__draws` counter. The screenshot is still saved for visual reference.

**Fixture status:** `iframe#resin-frame` already present in `index.html` (main session applied Task 2 markup). The fixture records this and resets error tracking before embed tests so main-session 404s (`sections.css` not yet created) do not pollute embed results.

**Message validation:** Parent-side origin validation (`e.source === frame.contentWindow`) lives in `embed-host.js`. Child-side accepts any same-page `postMessage` of the correct type — appropriate since tests send messages directly to the embed window.

**Standalone fallback:** `embed.html` loaded directly (not in iframe) uses `hostVisible=true` so the scene runs normally — preserves existing `webgl/v4/` demo behavior.
