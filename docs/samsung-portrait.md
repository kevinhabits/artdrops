# Samsung Follow Me Pro 43″ — portrait show

The linked bundle is S43FM703UC-FollowMe Pro. Its panel is 3840 × 2160, 16:9, up to 60 Hz. Turned vertically, the intended canvas is **2160 × 3840, 9:16**. Samsung lists an active image area of 941.184 × 529.416 mm in landscape; rotated, that is approximately **52.9 cm wide × 94.1 cm tall**.

Sources checked on 2026-10-15: [the selected retailer listing](https://www.tk3c.com/product/263252) and [Samsung's S43FM703UC specifications](https://www.samsung.com/tw/monitors/smart/smart-monitor-m7-43-inch-smart-tv-apps-4k-uhd-ls43fm703ucxzw/).

## Start the show

1. Connect the show laptop over HDMI or USB-C. Use the screen as an extended display so the laptop can keep its normal orientation.
2. In the computer's display settings, select the Samsung, rotate its output 90° or 270° to match the physical screen, and use 2160 × 3840 at 60 Hz when available. The desktop and text should be upright before opening the exhibition. ArtDrops does not rotate the operating system's display.
3. Open [ArtDrops](https://artdrops.vercel.app/), move the browser window to that screen, and keep **Mix for → Portrait screen · 9:16**.
4. Choose **Build a 1-hour mix**, then **Start exhibition**. The preset enables shuffle and **Show full artwork**. Press F for fullscreen. Captions can be switched off before starting if the event uses separate artist labels.
5. Leave it playing through the event. Every pass reshuffles; it keeps repeating until you close it. Keep the laptop powered, disable system sleep, and maintain the internet connection that streams the source videos.

This setup uses the laptop browser. The screen's built-in Samsung/Tizen browser, native rotation behavior, and a physical four-hour screening have not been tested.

## How the art is matched

The **9:16 screen** filter includes only artwork with verified width ≥1080 and height ≥1920 whose aspect ratio fills at least 90% of the portrait screen in `contain` mode, accounting for individual artwork rotation. Exact 9:16 fills the canvas. A 1200 × 1920 work fills 90%, leaving small bars above and below. Square and landscape works are excluded from this selection. The library initially shows **All shapes** so every requested collection is discoverable; the one-hour mix still defaults to portrait.

The one-hour portrait preset uses 60 distinct works at one minute each when available. With 40–59 matching works it uses 40 at 90 seconds each; with 30–39 it uses 30 at two minutes each. Fewer than 30 disables the preset. The current catalog has 50 qualifying works, so the preset uses 40 at 90 seconds. It sorts by aspect-ratio match, then pixel area, before choosing works. Playback shuffles that selection. The original curated catalog caps each artist at two works; requested collections can contain many works by one artist.

The 25 catalog works previously labeled **4K PORTRAIT** (sources at least 2160 × 3840) were removed on October 31, 2026 after reports of slow loading. Sources at 1080 × 1920 or similar meet the shape requirement and are scaled for the display, but contain less detail than native 4K. Reference verification checks file types and dimensions, with decoded motion and codec checks for animations. See [reference import status](reference-import.md) for source-specific limits. Short clips loop within their slot; longer videos play an excerpt. The 560 × 560 Orkhan gallery images are available for manual selection, but are excluded from this high-resolution preset.

The 60-minute duration is scheduled artwork time. Loading, pauses, or failed sources can change elapsed time. Use a short rehearsal on the actual laptop, connection, and screen to check orientation, brightness, and fullscreen behavior.
