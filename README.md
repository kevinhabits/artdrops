# ArtDrops

A small, silent digital art exhibition app. Browse videos, images, and animated art, make a queue, and give the artwork the whole screen.

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
3. Choose **Show full artwork** to preserve the composition, or **Fill screen** to crop to the display. **Between artworks → Soft fade · 1.5 seconds** gently blends each work into the next; **No transition** switches instantly. Soft fade is the default, including for older saved exhibitions. Artist captions and shuffle are optional.
4. Start the exhibition. Arrow keys navigate, Space pauses both rotation and video, and F toggles fullscreen. Fullscreen changes keep the current artwork playing. Escape leaves fullscreen first; Close leaves the exhibition directly. If fullscreen is unavailable, the show fills the browser window. If the browser blocks playback, select **Resume** to start the same artwork.
5. Keep the laptop powered and disable system sleep for a long show. A browser screen wake lock is requested when supported, but system settings still matter.

Art plays silently and loops. Artist captions show the artwork title, then **Artist · Source** (for example, **Cromwell · objkt**). **9:16 screen** filters for artwork at least 1080 × 1920 that covers at least 90% of the portrait display without cropping, accounting for any rotation. The portrait mix selects the closest aspect ratios and then the highest resolutions, and sets **Show full artwork**. Artwork cards show verified dimensions; **4K PORTRAIT** identifies sources at least 2160 × 3840. A 4K display does not make a lower-resolution original 4K.

For a four-hour event, start the one-hour mix and leave it running. Every work appears once per pass, then the next pass uses a fresh shuffle with no immediate repeat at the boundary. The exhibition continues until you stop it; there is no four-hour cutoff. Loading delays, pauses, and unavailable works can change the wall-clock length of a pass.

## Your exhibition

The current queue and settings autosave locally in this browser. Open **Playlists**, give the current exhibition a name, and choose **Save playlist** to keep a separate copy. You can save up to 20 named playlists (subject to browser storage space), each with up to 150 works. **Load** restores its order and settings and offers Undo. Editing the current exhibition does not change a saved playlist; saving the same name asks you to explicitly replace it. Deleting a saved playlist also offers Undo.

**Export JSON** backs up the current exhibition; each saved playlist has its own export button. **Import JSON** loads a backup into the current exhibition with Undo, then **Playlists → Save playlist** keeps it as a named copy. Backups preserve the name, artwork order, source credits, media links, rotation, and all display settings. Older ArtDrops JSON files still work. Files are limited to 2 MB and contain links and credits, not artwork files.

Playlists stay in this browser on this device; they do not sync between computers, and clearing browser data removes them. Export important playlists as JSON backups before your show.

Modern browsers coordinate playlist writes across tabs with Web Locks. In an older browser without that API, edit saved playlists in one tab at a time.

Use **Collection** to browse a requested series, **Media** to choose moving or still art, and search to find an artist, title, or mask variant. The **Add works** button adds the current collection selection up to the 150-work exhibition limit, with Undo. **Your references · availability** links to the included reference sources and shows their verified playable entries.

**Add your own** accepts a direct, public HTTPS MP4/WebM video or JPG/PNG/WebP/GIF image URL and checks that the browser decodes it. You can rotate individual works 90°, 180°, or 270°. YouTube, marketplace, and Drive preview pages are not direct files. Imported links use native video/image elements; remote scripts are never embedded. Videos always remain muted.

## The collection

The original 167-video catalog lives in `public/catalog.json`. Verified requested additions live in `public/references.json`: SuperRare collections and artist profiles, 414 Orkhan *Untitled* episodes with 414 mask variants, and Emberblend's cherry-blossom loop. The Orkhan files are 560 × 560 gallery images and remain outside the high-resolution 9:16 preset. See [catalog selection](docs/catalog.md) and [reference import status](docs/reference-import.md) for current counts, checks, and limitations. Catalog data is a checked snapshot, not a live sales ranking. Discovery does not require a marketplace API to be available at page load. Most art streams from external hosts, whose availability can change.

The player automatically prepares the next two works in a small pool of three reusable media slots. It retries slow or failed sources in the background and retains the prepared media for its turn. During a fade, the outgoing work briefly occupies one of those slots; preparation continues as soon as it becomes free. The outgoing artwork stays visible until the next one is ready. Fades overlap the artwork slots, so they do not add time to the one-hour program. The system’s reduced-motion preference disables fades. If every work fails, the player stops with a clear message rather than spinning through an endless queue.

Collection video previews release their downloads while an exhibition runs, leaving bandwidth for the show, and resume when it closes. Preloading reduces transition delays, but an unavailable media host or insufficient connection can still delay playback. Artwork continues to stream over the internet; this is not an offline download of the playlist or the whole library.

On the collection page, a maximum of four visible video previews play at once; reduced-motion users get still video posters until they explicitly start playback. SuperRare images and GIFs use lighter still thumbnails where available; opening an artwork plays its verified media file.

Artwork titles and artist credits come from the source platforms. ArtDrops does not own or sell the artwork. Public display permissions are artwork-specific; consult each source or artist before a public exhibition. Most entries stream from their original hosts. The cherry-blossom loop includes a silent browser-compatible copy with the creator's reuse statement and attribution in [public/media/README.md](public/media/README.md).

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
