(function () {
  "use strict";

  // The only colors selectable anywhere in the palette editor.
  var ALL_COLORS = ["#FFFFFF", "#F5F2F0", "#FFDD99", "#FA7A64", "#0064F0", "#5E18B7", "#131B24"];
  // White and near-black are available but not pre-selected by default.
  var DISABLED_BY_DEFAULT = ["#FFFFFF", "#131B24"];
  var MAX_COLORS = ALL_COLORS.length;
  var MIN_COLORS = 2;

  // Video export is capped to keep processing time and file size sane —
  // 10fps, first 7 seconds only, and a smaller long edge than stills since
  // GIF encoding cost multiplies by frame count.
  var VIDEO_FPS = 10;
  var VIDEO_MAX_SECONDS = 7;
  var VIDEO_LONG_EDGE = 1200;

  var MEDIA_CONFIG = {
    still: { accept: "image/png,image/jpeg,image/webp", hint: "PNG, JPG, WEBP", dropText: "Drop an image here", uploadLabel: "Upload image", changeLabel: "Change image" },
    video: { accept: "video/mp4,video/webm,video/quicktime", hint: "MP4, WEBM, MOV — first " + VIDEO_MAX_SECONDS + "s at " + VIDEO_FPS + "fps", dropText: "Drop a video here", uploadLabel: "Upload video", changeLabel: "Change video" }
  };

  var state = {
    mediaType: "still",
    resolution: 64,
    invert: false,
    exposure: 0,
    fuzz: 0,
    palette: ALL_COLORS.filter(function (hex) { return DISABLED_BY_DEFAULT.indexOf(hex) === -1; }),
    image: null,
    videoEl: null,
    videoUrl: null,
    videoDuration: 0,
    lastResult: null
  };

  var els = {
    previewCanvas: document.getElementById("previewCanvas"),
    dropZone: document.getElementById("dropZone"),
    dropHint: document.getElementById("dropHint"),
    dropHintText: document.getElementById("dropHintText"),
    dropHintFormats: document.getElementById("dropHintFormats"),
    fileInput: document.getElementById("fileInput"),
    uploadBtn: document.getElementById("uploadBtn"),
    uploadHint: document.getElementById("uploadHint"),
    mediaToggle: document.getElementById("mediaToggle"),
    resolutionSlider: document.getElementById("resolutionSlider"),
    resolutionValue: document.getElementById("resolutionValue"),
    invertCheckbox: document.getElementById("invertCheckbox"),
    exposureSlider: document.getElementById("exposureSlider"),
    exposureValue: document.getElementById("exposureValue"),
    fuzzSlider: document.getElementById("fuzzSlider"),
    fuzzValue: document.getElementById("fuzzValue"),
    paletteList: document.getElementById("paletteList"),
    addColorBtn: document.getElementById("addColorBtn"),
    addColorMenu: document.getElementById("addColorMenu"),
    downloadSvgBtn: document.getElementById("downloadSvgBtn"),
    downloadGifBtn: document.getElementById("downloadGifBtn")
  };

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderPreview();
    });
  }

  function renderPreview() {
    if (!state.image) return;
    var result = window.Bitmaker.process({
      image: state.image,
      resolution: state.resolution,
      invert: state.invert,
      exposure: state.exposure,
      fuzz: state.fuzz,
      paletteColors: state.palette,
      longEdge: state.mediaType === "video" ? VIDEO_LONG_EDGE : undefined
    });
    state.lastResult = result;

    var ctx = els.previewCanvas.getContext("2d");
    els.previewCanvas.width = result.outW;
    els.previewCanvas.height = result.outH;
    ctx.drawImage(result.previewCanvas, 0, 0);
    els.previewCanvas.classList.add("has-image");
    els.dropZone.classList.add("has-image");
    els.dropHint.classList.add("hidden");
    els.uploadBtn.textContent = MEDIA_CONFIG[state.mediaType].changeLabel;

    els.downloadSvgBtn.disabled = state.mediaType === "video";
    els.downloadGifBtn.disabled = false;
  }

  function loadImageFile(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      state.image = img;
      scheduleRender();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // Loads a video, then seeks to its first frame so there's an immediate
  // still preview — the full frame-by-frame pass only happens on GIF
  // download.
  function loadVideoFile(file) {
    if (!file || !/^video\/(mp4|webm|quicktime)$/.test(file.type)) return;
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    var url = URL.createObjectURL(file);
    var video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("loadedmetadata", function () {
      state.videoEl = video;
      state.videoUrl = url;
      state.videoDuration = video.duration;
      seekVideoTo(video, 0).then(function () {
        state.image = video;
        scheduleRender();
      });
    });
    video.src = url;
  }

  function seekVideoTo(video, time) {
    return new Promise(function (resolve) {
      if (Math.abs(video.currentTime - time) < 0.001) {
        resolve();
        return;
      }
      function onSeeked() {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      }
      video.addEventListener("seeked", onSeeked);
      video.currentTime = time;
    });
  }

  // Clears whatever media is currently loaded when switching Still/Video,
  // since a loaded image can't just become a video (and vice versa).
  function resetMedia() {
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    state.image = null;
    state.videoEl = null;
    state.videoUrl = null;
    state.videoDuration = 0;
    state.lastResult = null;
    els.previewCanvas.classList.remove("has-image");
    els.dropZone.classList.remove("has-image");
    els.dropHint.classList.remove("hidden");
    els.uploadBtn.textContent = MEDIA_CONFIG[state.mediaType].uploadLabel;
    els.downloadSvgBtn.disabled = true;
    els.downloadGifBtn.disabled = true;
  }

  function applyMediaConfig() {
    var config = MEDIA_CONFIG[state.mediaType];
    els.fileInput.accept = config.accept;
    els.uploadHint.textContent = config.hint;
    els.dropHintText.textContent = config.dropText;
    els.dropHintFormats.textContent = config.hint;
  }

  // A diagonal sweep through the brand palette, shown until the user
  // uploads their own image, so there's always something to preview.
  function loadDefaultGradientImage() {
    var w = 800, h = 600;
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    var gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, "#FFDD99");
    gradient.addColorStop(0.35, "#FA7A64");
    gradient.addColorStop(0.65, "#0064F0");
    gradient.addColorStop(1, "#5E18B7");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    var img = new Image();
    img.onload = function () {
      state.image = img;
      scheduleRender();
    };
    img.src = canvas.toDataURL("image/png");
  }

  // --- Upload wiring ---
  function loadFile(file) {
    if (state.mediaType === "video") loadVideoFile(file);
    else loadImageFile(file);
  }
  els.uploadBtn.addEventListener("click", function () { els.fileInput.click(); });
  els.fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
  });
  els.dropZone.addEventListener("dragover", function (e) {
    e.preventDefault();
    els.dropZone.classList.add("dragover");
  });
  els.dropZone.addEventListener("dragleave", function () {
    els.dropZone.classList.remove("dragover");
  });
  els.dropZone.addEventListener("drop", function (e) {
    e.preventDefault();
    els.dropZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  // --- Media toggle ---
  els.mediaToggle.addEventListener("click", function (e) {
    var btn = e.target.closest(".seg-btn");
    if (!btn || btn.dataset.media === state.mediaType) return;
    state.mediaType = btn.dataset.media;
    Array.prototype.forEach.call(els.mediaToggle.querySelectorAll(".seg-btn"), function (b) {
      b.classList.toggle("active", b === btn);
    });
    applyMediaConfig();
    resetMedia();
  });
  applyMediaConfig();

  // --- Sliders ---
  els.resolutionSlider.addEventListener("input", function () {
    state.resolution = Number(els.resolutionSlider.value);
    els.resolutionValue.textContent = state.resolution;
    scheduleRender();
  });
  els.invertCheckbox.addEventListener("change", function () {
    state.invert = els.invertCheckbox.checked;
    scheduleRender();
  });
  els.exposureSlider.addEventListener("input", function () {
    state.exposure = Number(els.exposureSlider.value);
    els.exposureValue.textContent = state.exposure;
    scheduleRender();
  });
  els.fuzzSlider.addEventListener("input", function () {
    state.fuzz = Number(els.fuzzSlider.value);
    els.fuzzValue.textContent = state.fuzz;
    scheduleRender();
  });

  // --- Palette editor ---
  // Colors are chosen only from ALL_COLORS (the 6 brand colors + white) —
  // no free-form hex entry, no color picker.
  function renderPaletteList() {
    els.paletteList.innerHTML = "";
    state.palette.forEach(function (hex, i) {
      var li = document.createElement("li");
      li.className = "palette-row";

      var swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = hex;

      var hexLabel = document.createElement("span");
      hexLabel.className = "hex-label";
      hexLabel.textContent = hex;

      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "✕";
      removeBtn.disabled = state.palette.length <= MIN_COLORS;
      removeBtn.title = "Remove color";
      removeBtn.addEventListener("click", function () {
        if (state.palette.length <= MIN_COLORS) return;
        state.palette.splice(i, 1);
        renderPaletteList();
        scheduleRender();
      });

      li.appendChild(swatch);
      li.appendChild(hexLabel);
      li.appendChild(removeBtn);

      els.paletteList.appendChild(li);
    });

    var available = ALL_COLORS.filter(function (hex) { return state.palette.indexOf(hex) === -1; });
    els.addColorBtn.disabled = state.palette.length >= MAX_COLORS || available.length === 0;
    renderAddColorMenu(available);
  }

  function renderAddColorMenu(available) {
    els.addColorMenu.innerHTML = "";
    available.forEach(function (hex) {
      var opt = document.createElement("button");
      opt.type = "button";
      opt.className = "add-color-option";
      var sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = hex;
      var label = document.createElement("span");
      label.textContent = hex;
      opt.appendChild(sw);
      opt.appendChild(label);
      opt.addEventListener("click", function () {
        if (state.palette.length >= MAX_COLORS) return;
        state.palette.push(hex);
        closeAddColorMenu();
        renderPaletteList();
        scheduleRender();
      });
      els.addColorMenu.appendChild(opt);
    });
  }

  function openAddColorMenu() {
    els.addColorMenu.classList.remove("hidden");
  }
  function closeAddColorMenu() {
    els.addColorMenu.classList.add("hidden");
  }

  els.addColorBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (els.addColorMenu.classList.contains("hidden")) openAddColorMenu();
    else closeAddColorMenu();
  });
  document.addEventListener("click", function (e) {
    if (!els.addColorMenu.contains(e.target) && e.target !== els.addColorBtn) closeAddColorMenu();
  });

  renderPaletteList();
  loadDefaultGradientImage();

  // --- Downloads ---
  var MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // e.g. "hs-bitmaker-aug-14-4_57pm-res1200-exp0-fuzz21.gif"
  function buildFilename(ext) {
    var now = new Date();
    var month = MONTH_ABBR[now.getMonth()];
    var day = now.getDate();
    var hours24 = now.getHours();
    var hours12 = hours24 % 12 || 12;
    var minutes = String(now.getMinutes()).padStart(2, "0");
    var ampm = hours24 < 12 ? "am" : "pm";
    var settings = "res" + state.resolution + "-exp" + state.exposure + "-fuzz" + state.fuzz;
    return "hs-bitmaker-" + month + "-" + day + "-" + hours12 + "_" + minutes + ampm + "-" + settings + "." + ext;
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  els.downloadSvgBtn.addEventListener("click", function () {
    if (state.mediaType === "video" || !state.lastResult) return;
    var svg = window.Bitmaker.buildSvg(state.lastResult);
    triggerDownload(new Blob([svg], { type: "image/svg+xml" }), buildFilename("svg"));
  });

  function downloadStillGif() {
    els.downloadGifBtn.disabled = true;
    var prevLabel = els.downloadGifBtn.textContent;
    els.downloadGifBtn.textContent = "Generating…";
    setTimeout(function () {
      try {
        var gifBytes = window.Bitmaker.buildGif(state.lastResult);
        triggerDownload(new Blob([gifBytes], { type: "image/gif" }), buildFilename("gif"));
      } finally {
        els.downloadGifBtn.disabled = false;
        els.downloadGifBtn.textContent = prevLabel;
      }
    }, 0);
  }

  // Snapshots the current settings once so a mid-export slider change
  // can't produce a GIF with inconsistent frames, then walks the video
  // frame-by-frame (seeking + reprocessing each one) before encoding.
  async function downloadVideoGif() {
    els.downloadGifBtn.disabled = true;
    var prevLabel = els.downloadGifBtn.textContent;
    var settings = {
      resolution: state.resolution,
      invert: state.invert,
      exposure: state.exposure,
      fuzz: state.fuzz,
      paletteColors: state.palette.slice()
    };
    try {
      var duration = Math.min(state.videoDuration, VIDEO_MAX_SECONDS);
      var frameCount = Math.max(1, Math.round(duration * VIDEO_FPS));
      var blockFrames = [];
      var outW, outH, palette;
      for (var i = 0; i < frameCount; i++) {
        els.downloadGifBtn.textContent = "Processing " + (i + 1) + "/" + frameCount + "…";
        await seekVideoTo(state.videoEl, i / VIDEO_FPS);
        var result = window.Bitmaker.process({
          image: state.videoEl,
          resolution: settings.resolution,
          invert: settings.invert,
          exposure: settings.exposure,
          fuzz: settings.fuzz,
          paletteColors: settings.paletteColors,
          longEdge: VIDEO_LONG_EDGE
        });
        outW = result.outW;
        outH = result.outH;
        palette = result.palette;
        blockFrames.push({ blockW: result.blockW, blockH: result.blockH, indices: result.indices });
      }
      els.downloadGifBtn.textContent = "Encoding…";
      var gifBytes = window.Bitmaker.buildAnimatedGif({
        outW: outW,
        outH: outH,
        palette: palette,
        blockFrames: blockFrames,
        delayCentiseconds: Math.round(100 / VIDEO_FPS)
      });
      triggerDownload(new Blob([gifBytes], { type: "image/gif" }), buildFilename("gif"));
    } finally {
      els.downloadGifBtn.disabled = false;
      els.downloadGifBtn.textContent = prevLabel;
    }
  }

  els.downloadGifBtn.addEventListener("click", function () {
    if (state.mediaType === "video") {
      if (!state.videoEl) return;
      downloadVideoGif();
    } else {
      if (!state.lastResult) return;
      downloadStillGif();
    }
  });
})();
