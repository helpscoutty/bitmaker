# bitmaker

A browser-based Atkinson-dithering bitmap generator. Upload an image, choose Color or Black & White, and export as SVG or GIF.

No build step, no server — plain HTML/CSS/JS. To run locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Features

- Preview and downloads are always rasterized/vectorized at a fixed 3000px long edge — smaller images are upscaled and larger ones downscaled to hit it.
- **Color** mode dithers against a removable palette of 2–7 colors chosen from a fixed set (white + 6 brand colors) — no free-form hex entry. White and near-black are excluded by default but can be added back. **Black & White** mode dithers to pure black/white.
- **Resolution** controls the pixelation block count along the long edge; **Fuzz** applies a pre-dither blur.
- Dithering is fixed to Atkinson at full strength (no other method, no strength slider).
- Palette generation is a simple nearest-color match (no k-means method picker to configure).
- Downloads: a vector **SVG** (run-length-optimized rects) and a hand-rolled indexed-color **GIF89a**, both built entirely client-side — no image ever leaves the browser. Filenames are timestamped, e.g. `hs-bitmaker-aug-7-2:43pm.svg`.

## Deploying (GitHub Pages)

`.github/workflows/deploy.yml` publishes the site to GitHub Pages on every push to `main`. To enable it:

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).
