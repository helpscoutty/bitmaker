// Core imaging pipeline: load -> resize to fixed long edge -> blur ("fuzz") ->
// downscale to a small block grid -> Atkinson error-diffusion dithering.
//
// Exposes window.Bitmaker with the pieces app.js needs.
(function () {
  "use strict";

  var LONG_EDGE = 3000; // fixed preview/export size; upscales or downscales to hit this

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

  function computeOutputSize(naturalW, naturalH, longEdge) {
    longEdge = longEdge || LONG_EDGE;
    if (naturalW >= naturalH) {
      return { w: longEdge, h: Math.max(1, Math.round(longEdge * naturalH / naturalW)) };
    }
    return { w: Math.max(1, Math.round(longEdge * naturalW / naturalH)), h: longEdge };
  }

  function computeBlockSize(outW, outH, resolution) {
    var r = Math.max(2, Math.round(resolution));
    if (outW >= outH) {
      return { w: r, h: Math.max(1, Math.round(r * outH / outW)) };
    }
    return { w: Math.max(1, Math.round(r * outW / outH)), h: r };
  }

  // Shifts overall brightness up/down (a plain additive brightness shift,
  // not a multiplicative photographic exposure curve) before anything else
  // runs.
  function applyExposure(pixels, amount) {
    if (!amount) return;
    var shift = amount * 2.55; // maps -100..100 to roughly -255..255
    for (var i = 0; i < pixels.length; i += 4) {
      pixels[i] = clamp255(pixels[i] + shift);
      pixels[i + 1] = clamp255(pixels[i + 1] + shift);
      pixels[i + 2] = clamp255(pixels[i + 2] + shift);
    }
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  // Turns the source into its photographic negative before anything else
  // runs, so exposure/blur/dithering all operate on the inverted image.
  function invertColors(pixels) {
    for (var i = 0; i < pixels.length; i += 4) {
      pixels[i] = 255 - pixels[i];
      pixels[i + 1] = 255 - pixels[i + 1];
      pixels[i + 2] = 255 - pixels[i + 2];
    }
  }

  // Separable sliding-window box blur (O(1) per pixel regardless of
  // radius). Three horizontal+vertical passes approximate a Gaussian blur.
  // Implemented by hand instead of canvas's ctx.filter = "blur(...)"
  // because that CSS-filter path is unreliable in Safari.
  function boxBlurH(src, dst, w, h, r) {
    var windowSize = r * 2 + 1;
    var stride = w * 4;
    for (var y = 0; y < h; y++) {
      var rowOffset = y * stride;
      for (var c = 0; c < 3; c++) {
        var sum = 0;
        for (var i = -r; i <= r; i++) {
          var xi = Math.min(w - 1, Math.max(0, i));
          sum += src[rowOffset + xi * 4 + c];
        }
        dst[rowOffset + c] = Math.round(sum / windowSize);
        for (var x = 1; x < w; x++) {
          var removeX = Math.min(w - 1, Math.max(0, x - 1 - r));
          var addX = Math.min(w - 1, Math.max(0, x + r));
          sum += src[rowOffset + addX * 4 + c] - src[rowOffset + removeX * 4 + c];
          dst[rowOffset + x * 4 + c] = Math.round(sum / windowSize);
        }
      }
      for (var x2 = 0; x2 < w; x2++) dst[rowOffset + x2 * 4 + 3] = src[rowOffset + x2 * 4 + 3];
    }
  }

  function boxBlurV(src, dst, w, h, r) {
    var windowSize = r * 2 + 1;
    var stride = w * 4;
    for (var x = 0; x < w; x++) {
      var colOffset = x * 4;
      for (var c = 0; c < 3; c++) {
        var sum = 0;
        for (var i = -r; i <= r; i++) {
          var yi = Math.min(h - 1, Math.max(0, i));
          sum += src[yi * stride + colOffset + c];
        }
        dst[colOffset + c] = Math.round(sum / windowSize);
        for (var y = 1; y < h; y++) {
          var removeY = Math.min(h - 1, Math.max(0, y - 1 - r));
          var addY = Math.min(h - 1, Math.max(0, y + r));
          sum += src[addY * stride + colOffset + c] - src[removeY * stride + colOffset + c];
          dst[y * stride + colOffset + c] = Math.round(sum / windowSize);
        }
      }
      for (var y2 = 0; y2 < h; y2++) dst[y2 * stride + colOffset + 3] = src[y2 * stride + colOffset + 3];
    }
  }

  function applyBoxBlur(pixels, w, h, radius) {
    if (radius <= 0) return;
    var temp = new Uint8ClampedArray(pixels.length);
    for (var pass = 0; pass < 3; pass++) {
      boxBlurH(pixels, temp, w, h, radius);
      boxBlurV(temp, pixels, w, h, radius);
    }
  }

  // Draws the source image into an outW x outH canvas, applying invert,
  // exposure, and blur ("fuzz") via direct pixel manipulation rather than
  // canvas filters, before pixelation.
  function prepareWorkingCanvas(img, outW, outH, invert, exposure, fuzzAmount) {
    var canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, outW, outH);

    if (!invert && !exposure && !fuzzAmount) return canvas;

    var imageData = ctx.getImageData(0, 0, outW, outH);
    if (invert) invertColors(imageData.data);
    applyExposure(imageData.data, exposure);
    if (fuzzAmount) applyBoxBlur(imageData.data, outW, outH, Math.round(fuzzAmount * 0.72));
    ctx.putImageData(imageData, 0, 0);
    return canvas;
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
    var resolution = opts.resolution;
    var fuzz = opts.fuzz;
    var exposure = opts.exposure || 0;
    var invert = !!opts.invert;
    var paletteHexes = opts.paletteColors || []; // array of hex strings

    // img may be an <img> (naturalWidth/Height), a <video> frame
    // (videoWidth/Height), or a <canvas> (width/height).
    var srcW = img.naturalWidth || img.videoWidth || img.width;
    var srcH = img.naturalHeight || img.videoHeight || img.height;
    var outSize = computeOutputSize(srcW, srcH, opts.longEdge);
    var blockSize = computeBlockSize(outSize.w, outSize.h, resolution);

    var working = prepareWorkingCanvas(img, outSize.w, outSize.h, invert, exposure, fuzz);
    var blockImageData = toBlockImageData(working, blockSize.w, blockSize.h);

    var palette = paletteHexes.map(function (hex) {
      return hexToRgb(hex);
    });

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
