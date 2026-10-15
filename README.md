# ArtDrops

A small, motion-only digital art exhibition app. Browse a saved selection, make a queue, and give the artwork the whole screen.

**Vanilla HTML, CSS, and JavaScript. Zero runtime dependencies. No account, API key, wallet, database, or backend.**

## Run locally

Requires Node.js 22 or newer. No install step is needed.

```sh
npm run dev
```

Open <http://127.0.0.1:4173>. An internet connection is needed to stream the artwork.

```sh
npm test       # Data validation, queue logic, player behavior
npm run build # Produces the deployable dist directory
npm start     # Serves the production build locally
```

## Put on a show

1. Connect the laptop to the display. For the Samsung Follow Me Pro 43″ in portrait, rotate the computer's output 90° or 270° and select **2160 × 3840 at 60 Hz** when supported. Move this browser window to that display. See the [portrait display guide](docs/samsung-portrait.md).
2. Keep **Mix for → Portrait screen · 9:16** and choose **Build a 1-hour mix** for upright works with shuffle enabled. The mix note shows the number of works and time per work. **All artwork** retains the original 120-work / 30-second mix. Or make your own selection and choose 10–120 seconds per work. A new browser starts with six portrait works from different artists; existing saved queues stay intact until you replace them. The mix button offers Undo.
3. Choose **Show full artwork** to preserve the composition, or **Fill screen** to crop to the display. Artist captions and shuffle are optional.
4. Start the exhibition. Arrow keys navigate, Space pauses both rotation and video, and F toggles fullscreen. Close or Escape leaves the player; some browsers use the first Escape to leave fullscreen.
5. Keep the laptop powered and disable system sleep for a long show. A browser screen wake lock is requested when supported, but system settings still matter.

Art plays silently and loops. **9:16 screen** filters for videos at least 1080 × 1920 that cover at least 90% of the portrait display without cropping. The portrait mix selects the closest aspect ratios and then the highest resolutions, and sets **Show full artwork**. Artwork cards show actual decoded dimensions; **4K PORTRAIT** identifies sources at least 2160 × 3840. A 4K display does not make a lower-resolution original 4K.

For a four-hour event, start the one-hour mix and leave it running. Every work appears once per pass, then the next pass uses a fresh shuffle with no immediate repeat at the boundary. The exhibition continues until you stop it; there is no four-hour cutoff. Loading delays, pauses, and unavailable works can change the wall-clock length of a pass.

## Your exhibition

The queue and settings save locally in this browser. **Export exhibition** downloads a JSON backup you can import on another computer. Export contains links and credits, not the artwork files. Removing a work or importing an exhibition offers Undo.

**Add your own** accepts a direct, public HTTPS MP4 or WebM URL and verifies that the browser decodes a video frame. YouTube pages, marketplace pages, still images, and arbitrary HTML embeds are not video files. Imported external links are rendered only inside native video elements; remote scripts are never embedded.

## The collection

The versioned catalog lives in `public/catalog.json`. See [catalog selection and verification](docs/catalog.md) for sources and checks. Catalog data is a checked snapshot, not a live sales ranking. Discovery does not require a marketplace API to be available at page load. Art still streams from external hosts, whose availability can change.

The player preloads the next work, crossfades only after actual playback starts, retries an alternate URL when present, and skips failed or stalled works. If every work fails, it stops with a clear message rather than spinning through an endless queue. On the collection page, a maximum of four visible previews animate at once; reduced-motion users get still identification previews until they explicitly start playback.

Artwork titles and artist credits come from the source platforms. ArtDrops does not own or sell the artwork. Public display permissions are artwork-specific; consult each source or artist before a public exhibition. The repository includes metadata and links, not copies of the original artwork.

## Deployment

On Vercel, import this GitHub repository, select **Other**, use `npm run build`, and set the output directory to `dist`. No environment variables or secrets are required. The same `dist` directory can be served by any static host.

## Layout

```
public/       Page, stylesheet, favicon, checked catalog
src/          UI, validation and persistence helpers, exhibition player
scripts/      Local server, static build, catalog maintenance
tests/        Node built-in test runner
docs/         Catalog methodology and release verification
```
