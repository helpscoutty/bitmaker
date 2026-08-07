(function () {
  "use strict";

  // The only colors selectable anywhere in the palette editor.
  var ALL_COLORS = ["#FFFFFF", "#F5F2F0", "#FFDD99", "#FA7A64", "#096DF9", "#7935CF", "#131B24"];
  var MAX_COLORS = ALL_COLORS.length;
  var MIN_COLORS = 2;

  var state = {
    mode: "color",
    resolution: 64,
    fuzz: 0,
    palette: ALL_COLORS.slice(),
    image: null,
    lastResult: null,
    dragIndex: null
  };

  var els = {
    previewCanvas: document.getElementById("previewCanvas"),
    dropZone: document.getElementById("dropZone"),
    dropHint: document.getElementById("dropHint"),
    fileInput: document.getElementById("fileInput"),
    uploadBtn: document.getElementById("uploadBtn"),
    changeImageBtn: document.getElementById("changeImageBtn"),
    modeToggle: document.getElementById("modeToggle"),
    resolutionSlider: document.getElementById("resolutionSlider"),
    resolutionValue: document.getElementById("resolutionValue"),
    fuzzSlider: document.getElementById("fuzzSlider"),
    fuzzValue: document.getElementById("fuzzValue"),
    paletteGroup: document.getElementById("paletteGroup"),
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
      mode: state.mode,
      resolution: state.resolution,
      fuzz: state.fuzz,
      paletteColors: state.palette
    });
    state.lastResult = result;

    var ctx = els.previewCanvas.getContext("2d");
    els.previewCanvas.width = result.outW;
    els.previewCanvas.height = result.outH;
    ctx.drawImage(result.previewCanvas, 0, 0);
    els.previewCanvas.classList.add("has-image");
    els.dropHint.classList.add("hidden");
    els.changeImageBtn.classList.add("visible");

    els.downloadSvgBtn.disabled = false;
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

  // --- Upload wiring ---
  els.uploadBtn.addEventListener("click", function () { els.fileInput.click(); });
  els.changeImageBtn.addEventListener("click", function () { els.fileInput.click(); });
  els.fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) loadImageFile(e.target.files[0]);
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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) loadImageFile(e.dataTransfer.files[0]);
  });

  // --- Mode toggle ---
  els.modeToggle.addEventListener("click", function (e) {
    var btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.mode = btn.dataset.mode;
    Array.prototype.forEach.call(els.modeToggle.querySelectorAll(".seg-btn"), function (b) {
      b.classList.toggle("active", b === btn);
    });
    els.paletteGroup.style.display = state.mode === "bw" ? "none" : "";
    scheduleRender();
  });
  els.paletteGroup.style.display = state.mode === "bw" ? "none" : "";

  // --- Sliders ---
  els.resolutionSlider.addEventListener("input", function () {
    state.resolution = Number(els.resolutionSlider.value);
    els.resolutionValue.textContent = state.resolution;
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
      li.draggable = true;
      li.dataset.index = i;

      var handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "⋮⋮";
      handle.title = "Drag to reorder";

      var reorderBtns = document.createElement("div");
      reorderBtns.className = "reorder-btns";
      var upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.textContent = "▲";
      upBtn.disabled = i === 0;
      upBtn.title = "Move up (brighter/darker order)";
      upBtn.addEventListener("click", function () { moveColor(i, i - 1); });
      var downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.textContent = "▼";
      downBtn.disabled = i === state.palette.length - 1;
      downBtn.title = "Move down";
      downBtn.addEventListener("click", function () { moveColor(i, i + 1); });
      reorderBtns.appendChild(upBtn);
      reorderBtns.appendChild(downBtn);

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

      li.appendChild(handle);
      li.appendChild(reorderBtns);
      li.appendChild(swatch);
      li.appendChild(hexLabel);
      li.appendChild(removeBtn);

      li.addEventListener("dragstart", function () {
        state.dragIndex = i;
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", function () {
        li.classList.remove("dragging");
      });
      li.addEventListener("dragover", function (e) {
        e.preventDefault();
        li.classList.add("drag-over");
      });
      li.addEventListener("dragleave", function () {
        li.classList.remove("drag-over");
      });
      li.addEventListener("drop", function (e) {
        e.preventDefault();
        li.classList.remove("drag-over");
        if (state.dragIndex === null || state.dragIndex === i) return;
        moveColor(state.dragIndex, i);
        state.dragIndex = null;
      });

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

  function moveColor(from, to) {
    if (to < 0 || to >= state.palette.length) return;
    var item = state.palette.splice(from, 1)[0];
    state.palette.splice(to, 0, item);
    renderPaletteList();
    scheduleRender();
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

  // --- Downloads ---
  var MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // e.g. "hs-bitmaker-aug-7-2:43pm.svg"
  function buildFilename(ext) {
    var now = new Date();
    var month = MONTH_ABBR[now.getMonth()];
    var day = now.getDate();
    var hours24 = now.getHours();
    var hours12 = hours24 % 12 || 12;
    var minutes = String(now.getMinutes()).padStart(2, "0");
    var ampm = hours24 < 12 ? "am" : "pm";
    return "hs-bitmaker-" + month + "-" + day + "-" + hours12 + ":" + minutes + ampm + "." + ext;
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
    if (!state.lastResult) return;
    var svg = window.Bitmaker.buildSvg(state.lastResult);
    triggerDownload(new Blob([svg], { type: "image/svg+xml" }), buildFilename("svg"));
  });

  els.downloadGifBtn.addEventListener("click", function () {
    if (!state.lastResult) return;
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
  });
})();
