# Release verification

Latest loop and navigation reliability checks were completed on 2026-10-31. Earlier release evidence is retained separately below. Collection counts and import status are maintained in [reference-import.md](reference-import.md).

## 2026-10-31 — 90-second slots and loop/navigation reliability

- Added **90 seconds** to Time with each work. The default remains 30 seconds. The value survives autosave/reload, named playlist save/load, and a real exported JSON Blob imported into another app instance.
- Fixed three reproduced app defects: Back crossed shuffled boundaries using the wrong order; retained videos could reveal their old playhead on a paused revisit; a recovered buffering notification could freeze the exhibition timer and falsely skip a still-decoding video after 15 seconds.
- The three-slot pool now prioritizes the current artwork and its actual previous/next neighbors. Startup can still prepare two future works. Existing neighbor elements are reserved before eviction, including two-work queues. Incoming videos rewind while hidden and wait for the seek to finish before appearing. Late media events cannot interrupt a replacement still loading.
- Navigation records up to 200 recent history entries, commits the new selection only on promotion, preserves direction when a previous work fails, and cancels unshown navigation safely. Recovered media progress clears stale watchdogs and restarts the exhibition clock. Native repeat events do not reset the work's duration or restart its fade.
- All **149 Node tests** and the static production build pass. Added regressions cover saved 90-second settings, shuffled history, paused rewind event order, rapid cancellation, repeated warm Back, two-work deduplication, forward/backward wraparound, bounded history, recovered pause/buffering, late playback events, directional failures, and double-failure recovery. Existing four-hour accelerated playback and three-slot bounds continue to pass.
- Headless Chromium checks use real silent 10-second portrait and 20-second square clips from the checked catalog. A full 90-second slot spans native video repeats, followed by automatic advancement; checks also cover paused Back/Next, rapid alternating navigation, shuffled-boundary Back/Forward, source reuse, and close cleanup. The actual app selector persists 90 seconds across reload and starts a show with a 90-second counter.
- In the baseline, a deterministic shuffled sequence `[b, c, d, a, c]` returned to `b` on Back instead of `a`. A separate explicitly synthetic delayed `waiting` event reproduced the recovery race while real video time advanced from 0.417 to 8.421 seconds: the old timer remained frozen and then incorrectly skipped the video. This injected event models an event-ordering edge; it is not evidence that every native loop fails.
- All browser checks run in an isolated headless context with audio muted and fullscreen/wake-lock APIs disabled. No user browser storage or display state is changed. Other browser engines and the physical Samsung display were not available for these checks; an uninterrupted four-hour hardware screening remains untested. Source videos may still have an artistic end/start cut or codec-dependent loop seam; these changes address player-generated reload, timing, and navigation failures.

## 2026-10-30 — earlier presentation preloading

- All 128 Node tests and the static production build pass. Focused regressions cover two-work lookahead, prepared-source reuse, background fallback/timeouts, the original timeout deadline on handoff, shuffled boundaries after failures, rapid navigation, paused preparation, stale callbacks, close cleanup, and the fixed three-slot bound over four simulated hours.
- The player uses three reusable media slots to prepare up to two upcoming works automatically. Background preparation handles errors, alternate sources, and timeouts before a work is due, then retains its prepared element and selected source for display. Only two layers participate in a fade; the outgoing layer is protected until the fade finishes.
- Collection video sources are released while an exhibition runs, including loaded previews that have scrolled out of view. Closing restores visible previews using their working source. Inert application tests cover source release, muted requests, alternate-source preservation, and stale-error suppression.
- A hidden native-browser check used the real player and local silent media: a delayed image, a video with an intentionally broken primary URL, and an alternate video delayed by 3.5 seconds. Before the change, that video's handoff waited 3,538 ms; with early preparation, it took 3 ms. The delayed image and next image each took 2 ms, and the next loop's first video took 3 ms. These are controlled fixture measurements, not a guarantee for remote artwork hosts.
- Native browser checks also covered paused Next/Previous navigation and closing the player. All videos remained muted; closing removed every media source. The test subclass disabled fullscreen and wake-lock requests before playback, and the browser stayed hidden throughout. Production fullscreen and the physical Samsung display were not exercised.
- Preloading is bounded and relies on native browser media buffering. It does not download the complete library or provide offline playback; slow or unavailable media hosts can still affect a show.

## 2026-10-26 — named playlists and reliable JSON backups

- All 115 Node tests and the static production build pass.
- Added a compact **Playlists** dialog with explicit save/load/replace, saved-copy export, and delete with Undo. It uses browser-local storage, with no account, service, or runtime dependency. Saved copies are independent of current-exhibition autosave.
- Automated checks cover storage failures and corruption without destructive rewrites, duplicate names, replacement confirmation/cancel, the 20-playlist limit, delete/Undo, and detached snapshots. Application integration tests execute the actual UI handlers with inert DOM/media/download boundaries: an exported Blob is fed into another app instance's file-import handler, then compared for exact artwork order, metadata, rotation, name, and settings.
- Playlist mutations use Web Locks when available to prevent overlapping tabs from dropping each other's saves. Deterministic overlapping-write and failed-write recovery tests cover this path. Older browsers without Web Locks retain a single-tab fallback; simultaneous saved-playlist edits in those browsers are not guaranteed.
- JSON validation covers legacy v1 files, mixed images/videos/GIFs, Unicode/BOM, malformed and duplicate entries, unsafe URLs, and the exact 2 MB UTF-8 boundary. Every accepted import and newly saved playlist can be exported within the same limit. Invalid imports leave the current exhibition and storage unchanged.
- Fixed two data-loss regressions: a slow import can no longer overwrite a later import, playlist load, or exhibition edit; catalog completion no longer replaces imported artwork snapshots with catalog defaults sharing the same ID.
- In an isolated hidden browser at localhost port 4174, saved two playlists, changed the current queue/settings, loaded the original snapshot, reloaded the page, checked duplicate-name confirmation/cancel, and deleted/restored a saved playlist using Undo. The desktop dialog rendered cleanly and recorded no console errors.
- Browser download automation was unavailable under the existing approval restriction, so actual disk download/file-picker round trips were not repeated. The real export Blob, filename, attached anchor, import event handler, and Undo were verified in isolated application tests. No foreground windows, fullscreen, audible playback, or physical-display checks were used.

## 2026-10-19 — mixed-media release

### Automated and media checks

- All 81 Node tests pass. Coverage includes image decoding and failure recovery, mixed image/video transitions, paused image navigation, quarter-turn geometry, stale decode callbacks, and returning to an image after a video autoplay refusal. Library tests cover collection/media filters, rotation-aware portrait eligibility, portable backups, and the separate catalog and exhibition limits. Shipped-reference tests validate episode pairs, attribution, normalized dimensions, and preservation of the original catalog.
- The hosted cherry-blossom derivative is 60 seconds, 1920 × 1080, H.264 with `yuv420p`, approximately 22.8 MB, and has no audio stream. A full-file decode passed, and six sampled frames confirmed motion. Production delivery and hidden-browser playback also passed, as recorded below.
- Video previews, exhibition slots, and import validation remain muted. No sound toggle was added.

### Browser checks

Tested in the Codex browser:

- An Orkhan image decoded at its actual 560 × 560 resolution. Hazed's **KYC** video decoded at 2000 × 2000, reached `readyState: 4`, and played muted. **DopamineDump** decoded as a 1280 × 960 GIF.
- An image-to-video fade measured incoming opacity 0.095 with a 1.5-second transition while the outgoing frame stayed at opacity 1. Navigation from a paused video to an image displayed the new artwork while retaining the paused state.
- Entering and exiting fullscreen updated the button labels and preserved active video playback in both states. Both **Start exhibition** and **Play exhibition** launched the player.
- At an earlier 20-work Hazed import checkpoint, the filter returned 19 moving works and one still work. Adding those 20 works succeeded; Undo restored the saved 60-work queue. The original saved queue was preserved and restored after testing. Final collection counts are listed in the reference report.
- The 390 × 844 mobile layout had no horizontal overflow. A 2160 × 3840 player surface retained `contain` fitting. These are browser geometry checks, not a physical Samsung display test.
- No browser console errors were recorded during these checks.

### Production delivery

- Application commit `603737e14eda337c8b476ceee0a62d5e63d58fd3` was pushed to GitHub. Vercel deployment `dpl_12Z8pdf7bSJ4trD9XYyAJnxLAgZm` reached **READY** and received the `artdrops.vercel.app` production alias.
- Unauthenticated requests returned HTTP 200 for the page, stylesheet, all three application modules, both catalogs, and the blossom video and poster. Every response matched the local build's SHA-256 hash, including the complete 22,777,524-byte MP4. Content types were correct.
- The hidden production browser displayed **1,757 works, 134 artists, and five sources**, with all 11 requested collection options. Faceprint returned 169 works; the first three visible thumbnails decoded at 550 × 550 while the cards correctly reported the artwork's 1280 × 1280 playback resolution.
- The production blossom preview reached `readyState: 4` at 1920 × 1080, with advancing playback time, `muted: true`, and `paused: false`. No fullscreen element was present. No browser console errors were recorded.

### Remaining validation

The physical Samsung setup and an uninterrupted four-hour screening remain untested. Final import counts and source-resolution limitations are documented in [reference-import.md](reference-import.md).

The fullscreen and visible-browser observations above predate the user's background-only instruction. Final production checks must use a hidden browser or HTTP/media validation; do not repeat fullscreen actions or bring a window forward. A production fullscreen retest is omitted under that constraint.

## Historical verification — 2026-10-15 and 2026-10-16

The following evidence applies to the earlier video-only releases. Start/fullscreen reliability and transition checks were completed on 2026-10-16; catalog/media and display-resolution browser checks were completed on 2026-10-15.

### Automated and media checks

- 57 Node tests pass: catalog diversity and attribution, portrait resolution/coverage thresholds, larger-catalog retention, media/input validation, filter composition, queue reordering, portable import/export, custom-library retention, one-hour mix construction, shuffle, failed-work quarantine, pause timing, stale asynchronous callbacks, paused navigation, fullscreen ownership, transition preference migration, fade timing, rapid navigation, stale fade callbacks, immediate/reduced-motion cleanup, and continuous single-artwork loops. New startup tests cover media-before-fullscreen ordering, the complete player surface inside its modal, synchronous and asynchronous fullscreen denial, repeated toggles, unsupported APIs, pending-request deduplication, late completion after close/reopen, and Escape/cancel. Autoplay tests cover recoverable policy refusal, same-artwork Resume, frozen clocks/watchdogs, genuine media failures, and stale playback events.
- `npm run build` produces a static site with no runtime dependencies.
- All 167 selected videos passed source-page, poster, MP4-signature, native-dimension, and decoded temporal-frame checks. There are 123 artist identities across objkt and Verse, with at most two works per artist. The portrait selection contains 60 works by 53 artists, including 18 native 2160 × 3840 works. See `catalog.md` for the method and maintenance command.
- Accelerated playback simulations cover four 120-work cycles at 30 seconds per work, both with every work available and with 12 additional unavailable works. They verify each healthy work appears once per cycle, no immediate repeat across a cycle boundary, failed works stay skipped, and only two video elements are reused. A regression test covers continuing playback when only one healthy work remains.
- At that earlier release, no source artwork binaries, credentials, API keys, or generated build files were included in Git. This historical statement does not describe the later hosted blossom derivative.

### Browser checks

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

### Boundaries of the historical checks

The site and catalog are static, but videos stream from external hosts. Their future availability and the venue's connection cannot be guaranteed. The player retries and skips failures. Source resolution varies; the 4K display mode does not upscale source detail.

The four-hour checks are accelerated logic simulations, not an uninterrupted four-hour browser or physical-display screening. A pass is one nominal hour at 120 × 30 seconds; loading delays, pauses, and skipped works change wall-clock timing. Reshuffling avoids an immediate repeat at the boundary but does not guarantee an hour between individual repeat appearances across adjacent passes.
