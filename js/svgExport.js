// Builds a vector SVG from the dithered block grid, scaled to the fixed
// long-edge output size. Adjacent same-color blocks in a row are merged
// into a single <rect> to keep file size and element count down.
(function () {
  "use strict";

  function buildSvg(result) {
    var blockW = result.blockW, blockH = result.blockH;
    var indices = result.indices;
    var palette = result.palette;
    var outW = result.outW, outH = result.outH;
    var scaleX = outW / blockW;
    var scaleY = outH / blockH;

    var rects = [];
    for (var y = 0; y < blockH; y++) {
      var x = 0;
      while (x < blockW) {
        var idx = indices[y * blockW + x];
        var runStart = x;
        while (x + 1 < blockW && indices[y * blockW + x + 1] === idx) {
          x++;
        }
        var runLen = x - runStart + 1;
        var c = palette[idx];
        var hex = window.Bitmaker.rgbToHex(c.r, c.g, c.b);
        var rx = (runStart * scaleX).toFixed(2);
        var ry = (y * scaleY).toFixed(2);
        var rw = (runLen * scaleX).toFixed(2);
        var rh = scaleY.toFixed(2);
        rects.push('<rect x="' + rx + '" y="' + ry + '" width="' + rw + '" height="' + rh + '" fill="' + hex + '"/>');
        x++;
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + outW + '" height="' + outH +
      '" viewBox="0 0 ' + outW + ' ' + outH + '" shape-rendering="crispEdges">' +
      rects.join("") + "</svg>";
  }

  window.Bitmaker = window.Bitmaker || {};
  window.Bitmaker.buildSvg = buildSvg;
})();
