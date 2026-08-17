# bitmaker

A browser-based Atkinson-dithering bitmap generator. Upload an image or a short video and export as SVG or GIF.

No build step, no server — plain HTML/CSS/JS. To run locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Features

- **Still** mode rasterizes/vectorizes at a fixed 3000px long edge — smaller images are upscaled and larger ones downscaled to hit it. Exports as **SVG** (run-length-optimized rects) or **GIF**.
- **Video** mode (MP4/WebM/MOV) samples the first 7 seconds at 10fps (max 70 frames) at a 1200px long edge, reprocesses every frame through the same pipeline, and exports as an animated **GIF** only (no SVG — a still-frame vector doesn't apply to video).
- Dithers against a removable palette of 2–7 colors chosen from a fixed set (white + 6 brand colors) — no free-form hex entry. White and near-black are excluded by default but can be added back.
- **Resolution** controls the pixelation block count along the long edge; **Fuzz** applies a pre-dither blur; **Exposure** shifts overall brightness before dithering; **Invert values** negates the source before any of that runs.
- Dithering is fixed to Atkinson at full strength (no other method, no strength slider).
- Palette generation is a simple nearest-color match (no k-means method picker to configure).
- Both GIF variants (static and animated) come from a hand-rolled indexed-color GIF89a encoder — no image or video ever leaves the browser. Filenames are timestamped and include the current settings, e.g. `hs-bitmaker-aug-14-4_57pm-res1200-exp0-fuzz21.gif`.

## Deploying (GitHub Pages)

`.github/workflows/deploy.yml` publishes the site to GitHub Pages on every push to `main`. To enable it:

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).
