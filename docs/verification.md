# Release verification

Start/fullscreen reliability and transition releases checked on 2026-10-16. Catalog/media and physical-resolution browser checks below were completed on 2026-10-15.

## Automated and media checks

- 57 Node tests pass: catalog diversity and attribution, portrait resolution/coverage thresholds, larger-catalog retention, media/input validation, filter composition, queue reordering, portable import/export, custom-library retention, one-hour mix construction, shuffle, failed-work quarantine, pause timing, stale asynchronous callbacks, paused navigation, fullscreen ownership, transition preference migration, fade timing, rapid navigation, stale fade callbacks, immediate/reduced-motion cleanup, and continuous single-artwork loops. New startup tests cover media-before-fullscreen ordering, the complete player surface inside its modal, synchronous and asynchronous fullscreen denial, repeated toggles, unsupported APIs, pending-request deduplication, late completion after close/reopen, and Escape/cancel. Autoplay tests cover recoverable policy refusal, same-artwork Resume, frozen clocks/watchdogs, genuine media failures, and stale playback events.
- `npm run build` produces a static site with no runtime dependencies.
- All 167 selected videos passed source-page, poster, MP4-signature, native-dimension, and decoded temporal-frame checks. There are 123 artist identities across objkt and Verse, with at most two works per artist. The portrait selection contains 60 works by 53 artists, including 18 native 2160 × 3840 works. See `catalog.md` for the method and maintenance command.
- Accelerated playback simulations cover four 120-work cycles at 30 seconds per work, both with every work available and with 12 additional unavailable works. They verify each healthy work appears once per cycle, no immediate repeat across a cycle boundary, failed works stay skipped, and only two video elements are reused. A regression test covers continuing playback when only one healthy work remains.
- No source artwork binaries, credentials, API keys, or generated build files are included in Git.

## Browser checks

Tested in the Codex browser:

- Start/fullscreen release: both **Start exhibition** and **Play exhibition** open the saved 60-work queue and decode moving artwork. Enter/Exit fullscreen buttons update their labels and preserve the playing video and position; the screenshot includes the artwork, captions, and controls together in fullscreen. Pause/Resume works, Close removes the player and restores focus to the corresponding launch button, and reopening starts a fresh exhibition.
- A temporary browser test page injected one `NotAllowedError` into the first video play request. The player retained the work, showed the Resume message, and a real Resume click began **Resonant Fluidity** at 2160 × 3840. This verifies recovery from a simulated policy refusal using real media and browser events. The temporary page was removed before building/deploying.
- Source captions checked on 2026-10-16: actual playback shows **Resonant Fluidity / Cromwell · objkt** and **Calculated Movements #5 / Larry Cuba · Verse**. Titles remain on their own line, with the artist and marketplace beneath.
- Transition release: older saved exhibitions default to **Soft fade · 1.5 seconds**; **No transition** persists across reload. Changing other settings and building a portrait mix preserve the selected transition.
- Actual automatic and manual fades use the incoming video above an opaque outgoing video. During a measured dissolve, the incoming layer had opacity 0.027 with a 1.5-second transition while the outgoing layer remained at opacity 1. Both video slots work as the incoming layer on successive changes.
- Paused navigation blends decoded frames while both videos stay paused. Rapid Next during a fade settles the current image before the outgoing slot is loaded again; playback resumes normally afterward. **No transition** switches between decoded videos with zero transition duration and immediately pauses the outgoing one. No browser console errors were recorded.

- Desktop layout at 1280 × 720, including all controls in the exhibition panel remaining reachable on a shorter screen.
- Mobile layout at 390 × 844 with no horizontal overflow.
- Exhibition stage at 3840 × 2160; source aspect ratio preserved with `contain`.
- Actual decoded video playback, preloading of the next work, pause, and navigation while paused.
- Artist search, adding to the exhibition, changing order, and settings/queue persistence across reload.
- Building the one-hour mix produces 120 works, 30-second slots, shuffle enabled, and focus on Start exhibition. Undo restores the previous queue and settings; the full mix persists across reload. A newly added artwork decodes and plays with the next work preloaded.
- The portrait preset produces 60 matching works at 60 seconds each, enables shuffle, and overrides crop mode with `contain`. Undo restores the previous queue and crop preference; the portrait queue/settings persist across reload. The default 9:16 filter returns all 60 works, including additions beyond the old 150-work catalog limit.
- A native 2160 × 3840 portrait source decodes and plays in a 2160 × 3840 player/video box with `object-fit: contain`. These are browser geometry and playback checks; the physical Samsung screen was not connected. The embedded browser's large-viewport screenshot capture clips/stitches the canvas, so it is not used as proof of physical-display output.
- Importing a portable exhibition through its file picker.
- A deliberately unavailable video followed by two valid artworks: playback skipped the broken work and continued.
- An exhibition containing only the unavailable work: playback stopped with an actionable message and retained an exit control.

The current embedded browser successfully exercises the Fullscreen API and shows the complete player surface; switching automation contexts can itself leave fullscreen. Earlier API inspection incorrectly inferred no support from unavailable properties in the restricted DOM inspection scope. Unsupported and denied fullscreen paths are now covered by dedicated regression tests. Separate Google Chrome access was not approved, so standalone Chrome and the actual Samsung setup remain unverified. The fullscreen target is now a regular child containing all player UI inside the modal, avoiding the page/document being placed above the modal in the browser's top layer.

## Boundaries

The site and catalog are static, but videos stream from external hosts. Their future availability and the venue's connection cannot be guaranteed. The player retries and skips failures. Source resolution varies; the 4K display mode does not upscale source detail.

The four-hour checks are accelerated logic simulations, not an uninterrupted four-hour browser or physical-display screening. A pass is one nominal hour at 120 × 30 seconds; loading delays, pauses, and skipped works change wall-clock timing. Reshuffling avoids an immediate repeat at the boundary but does not guarantee an hour between individual repeat appearances across adjacent passes.
