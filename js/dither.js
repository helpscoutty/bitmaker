// Core imaging pipeline: load -> resize to fixed long edge -> blur ("fuzz") ->
// downscale to a small block grid -> Atkinson error-diffusion dithering.
//
// Exposes window.Bitmaker with the pieces app.js needs.
(function () {
  "use strict";

  var LONG_EDGE = 2000; // fixed preview/export size, per spec item 1

  // Atkinson dithering only distributes 6/8 of the quantization error
  // (the other 2/8 is discarded), which is what gives it its characteristic
  // crisp, high-contrast look compared to Floyd-Steinberg.
  var ATKINSON_OFFSETS = [
    [1, 0], [2, 0],
    [-1, 1], [0, 1], [1, 1],
    [0, 2]
  ];

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return { r: 0, g: 0, b: 0 };
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    }).join("");
  }

  function computeOutputSize(naturalW, naturalH) {
    if (naturalW >= naturalH) {
      return { w: LONG_EDGE, h: Math.max(1, Math.round(LONG_EDGE * naturalH / naturalW)) };
    }
    return { w: Math.max(1, Math.round(LONG_EDGE * naturalW / naturalH)), h: LONG_EDGE };
  }

  function computeBlockSize(outW, outH, resolution) {
    var r = Math.max(2, Math.round(resolution));
    if (outW >= outH) {
      return { w: r, h: Math.max(1, Math.round(r * outH / outW)) };
    }
    return { w: Math.max(1, Math.round(r * outW / outH)), h: r };
  }

  // Draws the source image into an outW x outH canvas, optionally blurred
  // ("fuzz"), optionally desaturated for B&W mode, before pixelation.
  function prepareWorkingCanvas(img, outW, outH, fuzzAmount, desaturate) {
    var base = document.createElement("canvas");
    base.width = outW;
    base.height = outH;
    var bctx = base.getContext("2d");
    bctx.drawImage(img, 0, 0, outW, outH);

    if (!fuzzAmount && !desaturate) return base;

    var out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    var octx = out.getContext("2d");
    var filters = [];
    if (desaturate) filters.push("grayscale(1)");
    if (fuzzAmount) filters.push("blur(" + (fuzzAmount * 0.24).toFixed(2) + "px)");
    octx.filter = filters.join(" ");
    octx.drawImage(base, 0, 0);
    return out;
  }

  function toBlockImageData(sourceCanvas, blockW, blockH) {
    var block = document.createElement("canvas");
    block.width = blockW;
    block.height = blockH;
    var ctx = block.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceCanvas, 0, 0, blockW, blockH);
    return ctx.getImageData(0, 0, blockW, blockH);
  }

  function nearestPaletteIndex(r, g, b, palette) {
    var bestIdx = 0, bestDist = Infinity;
    for (var i = 0; i < palette.length; i++) {
      var c = palette[i];
      var dr = r - c.r, dg = g - c.g, db = b - c.b;
      var dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  // Generalized N-color Atkinson dithering. `palette` is an array of
  // {r,g,b}. Returns a Uint8Array of palette indices, one per pixel.
  function ditherAtkinson(imageData, palette) {
    var w = imageData.width, h = imageData.height;
    var src = imageData.data;
    var work = new Float32Array(w * h * 3);
    for (var i = 0; i < w * h; i++) {
      work[i * 3] = src[i * 4];
      work[i * 3 + 1] = src[i * 4 + 1];
      work[i * 3 + 2] = src[i * 4 + 2];
    }

    var indices = new Uint8Array(w * h);

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x;
        var r = Math.max(0, Math.min(255, work[p * 3]));
        var g = Math.max(0, Math.min(255, work[p * 3 + 1]));
        var b = Math.max(0, Math.min(255, work[p * 3 + 2]));

        var idx = nearestPaletteIndex(r, g, b, palette);
        indices[p] = idx;
        var chosen = palette[idx];

        var er = (r - chosen.r) / 8;
        var eg = (g - chosen.g) / 8;
        var eb = (b - chosen.b) / 8;

        for (var o = 0; o < ATKINSON_OFFSETS.length; o++) {
          var nx = x + ATKINSON_OFFSETS[o][0];
          var ny = y + ATKINSON_OFFSETS[o][1];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          var np = ny * w + nx;
          work[np * 3] += er;
          work[np * 3 + 1] += eg;
          work[np * 3 + 2] += eb;
        }
      }
    }

    return indices;
  }

  // Maps each of the outW x outH output pixels back to its source block
  // pixel via nearest-neighbor. Shared by the preview canvas and the GIF
  // exporter so both rasterize identically (canvas drawImage scaling and
  // this explicit mapping round non-integer ratios differently, which
  // otherwise shows up as sporadic boundary-pixel mismatches).
  function expandIndices(blockW, blockH, indices, outW, outH) {
    var out = new Uint8Array(outW * outH);
    for (var y = 0; y < outH; y++) {
      var srcY = Math.min(blockH - 1, Math.floor(y * blockH / outH));
      var rowOffset = srcY * blockW;
      var outRowOffset = y * outW;
      for (var x = 0; x < outW; x++) {
        var srcX = Math.min(blockW - 1, Math.floor(x * blockW / outW));
        out[outRowOffset + x] = indices[rowOffset + srcX];
      }
    }
    return out;
  }

  // Builds a display canvas at outW x outH from the small dithered block
  // grid, using the same nearest-neighbor mapping as the exporters so the
  // preview always matches downloaded files pixel-for-pixel.
  function buildPreviewCanvas(blockW, blockH, indices, paletteRGB, outW, outH) {
    var expanded = expandIndices(blockW, blockH, indices, outW, outH);
    var out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    var octx = out.getContext("2d");
    var imgData = octx.createImageData(outW, outH);
    for (var i = 0; i < expanded.length; i++) {
      var c = paletteRGB[expanded[i]];
      imgData.data[i * 4] = c.r;
      imgData.data[i * 4 + 1] = c.g;
      imgData.data[i * 4 + 2] = c.b;
      imgData.data[i * 4 + 3] = 255;
    }
    octx.putImageData(imgData, 0, 0);
    return out;
  }

  // Full pipeline entry point.
  function process(opts) {
    var img = opts.image;
    var mode = opts.mode; // 'color' | 'bw'
    var resolution = opts.resolution;
    var fuzz = opts.fuzz;
    var paletteHexes = opts.paletteColors || []; // array of hex strings

    var outSize = computeOutputSize(img.naturalWidth, img.naturalHeight);
    var blockSize = computeBlockSize(outSize.w, outSize.h, resolution);

    var working = prepareWorkingCanvas(img, outSize.w, outSize.h, fuzz, mode === "bw");
    var blockImageData = toBlockImageData(working, blockSize.w, blockSize.h);

    var palette;
    if (mode === "bw") {
      palette = [
        { r: 255, g: 255, b: 255 },
        { r: 0, g: 0, b: 0 }
      ];
    } else {
      palette = paletteHexes.map(function (hex) {
        return hexToRgb(hex);
      });
    }

    var indices = ditherAtkinson(blockImageData, palette);
    var previewCanvas = buildPreviewCanvas(blockSize.w, blockSize.h, indices, palette, outSize.w, outSize.h);

    return {
      outW: outSize.w,
      outH: outSize.h,
      blockW: blockSize.w,
      blockH: blockSize.h,
      indices: indices,
      palette: palette,
      previewCanvas: previewCanvas
    };
  }

  window.Bitmaker = window.Bitmaker || {};
  window.Bitmaker.process = process;
  window.Bitmaker.hexToRgb = hexToRgb;
  window.Bitmaker.rgbToHex = rgbToHex;
  window.Bitmaker.expandIndices = expandIndices;
  window.Bitmaker.LONG_EDGE = LONG_EDGE;
})();
