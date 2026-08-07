// Minimal, dependency-free indexed-color GIF89a encoder (single static
// frame). GIF is a natural fit here since it's palette-based and our
// dithered output already only ever uses a handful of colors.
(function () {
  "use strict";

  function BitWriter() {
    this.bytes = [];
    this.bitBuffer = 0;
    this.bitCount = 0;
  }
  BitWriter.prototype.writeCode = function (code, size) {
    this.bitBuffer |= (code << this.bitCount);
    this.bitCount += size;
    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer >>= 8;
      this.bitCount -= 8;
    }
  };
  BitWriter.prototype.finish = function () {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer & 0xff);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
    return this.bytes;
  };

  // Standard GIF LZW variant: codes 0..clearCode-1 are raw color indices,
  // clearCode resets the dictionary, eoiCode terminates the stream.
  //
  // A GIF decoder can only reconstruct a new dictionary entry once it has
  // read the *following* code (it needs that code's first symbol to
  // complete the entry), so its codeSize growth lags the encoder's own
  // bookkeeping by exactly one emitted code. The encoder must delay its
  // own codeSize bump by one emission to stay in sync with that lag
  // (verified by round-tripping through independent GIF decoders).
  function lzwEncode(minCodeSize, indices) {
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var writer = new BitWriter();

    var codeSize, nextCode, dict;
    function reset() {
      dict = {};
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }
    reset();
    writer.writeCode(clearCode, codeSize);

    if (indices.length === 0) {
      writer.writeCode(eoiCode, codeSize);
      return writer.finish();
    }

    var w = String(indices[0]);
    var wLastSymbol = indices[0];
    var emissionCount = 0;
    var pendingBumpAt = -1;
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i];
      var wk = w + "," + k;
      if (dict[wk] !== undefined) {
        w = wk;
      } else {
        writer.writeCode(w.indexOf(",") === -1 ? wLastSymbol : dict[w], codeSize);
        emissionCount++;
        var assignedCode = nextCode;
        dict[wk] = assignedCode;
        nextCode++;
        if (assignedCode === (1 << codeSize) - 1) {
          pendingBumpAt = emissionCount + 1;
        }
        if (pendingBumpAt !== -1 && emissionCount >= pendingBumpAt) {
          pendingBumpAt = -1;
          if (codeSize < 12) {
            codeSize++;
          } else {
            writer.writeCode(clearCode, codeSize);
            reset();
          }
        }
        w = String(k);
      }
      wLastSymbol = k;
    }
    writer.writeCode(w.indexOf(",") === -1 ? wLastSymbol : dict[w], codeSize);
    writer.writeCode(eoiCode, codeSize);
    return writer.finish();
  }

  function toSubBlocks(bytes) {
    var out = [];
    var i = 0;
    while (i < bytes.length) {
      var chunk = bytes.slice(i, i + 255);
      out.push(chunk.length);
      for (var j = 0; j < chunk.length; j++) out.push(chunk[j]);
      i += 255;
    }
    out.push(0);
    return out;
  }

  function pushU16(arr, v) {
    arr.push(v & 0xff, (v >> 8) & 0xff);
  }

  // palette: array of {r,g,b} (max 256 entries). indices: Uint8Array/Array
  // of palette indices, length width*height.
  function encodeGif(width, height, indices, palette) {
    var numColors = Math.max(2, palette.length);
    var bitsPerPixel = Math.max(1, Math.ceil(Math.log2(numColors)));
    var tableSizeExp = bitsPerPixel - 1; // N: table has 2^(N+1) entries
    var tableEntries = 1 << (tableSizeExp + 1);
    var minCodeSize = Math.max(bitsPerPixel, 2);

    var bytes = [];
    // Header
    "GIF89a".split("").forEach(function (ch) { bytes.push(ch.charCodeAt(0)); });
    // Logical Screen Descriptor
    pushU16(bytes, width);
    pushU16(bytes, height);
    var packed = 0x80 | (tableSizeExp << 4) | tableSizeExp;
    bytes.push(packed);
    bytes.push(0); // background color index
    bytes.push(0); // pixel aspect ratio
    // Global Color Table
    for (var i = 0; i < tableEntries; i++) {
      var c = palette[i] || { r: 0, g: 0, b: 0 };
      bytes.push(c.r, c.g, c.b);
    }
    // Image Descriptor
    bytes.push(0x2c);
    pushU16(bytes, 0);
    pushU16(bytes, 0);
    pushU16(bytes, width);
    pushU16(bytes, height);
    bytes.push(0x00);
    // Image Data
    bytes.push(minCodeSize);
    var lzwBytes = lzwEncode(minCodeSize, indices);
    var subBlocks = toSubBlocks(lzwBytes);
    for (var j = 0; j < subBlocks.length; j++) bytes.push(subBlocks[j]);
    // Trailer
    bytes.push(0x3b);

    return new Uint8Array(bytes);
  }

  function buildGif(result) {
    // Reuses dither.js's expandIndices so the exported GIF rasterizes
    // pixel-for-pixel identically to the on-screen preview.
    var expanded = window.Bitmaker.expandIndices(result.blockW, result.blockH, result.indices, result.outW, result.outH);
    return encodeGif(result.outW, result.outH, expanded, result.palette);
  }

  window.Bitmaker = window.Bitmaker || {};
  window.Bitmaker.buildGif = buildGif;
})();
