const paper = document.getElementById("paper");
const canvas = document.getElementById("ink");
const ctx = canvas.getContext("2d");
const objects = document.getElementById("objects");
const statusEl = document.getElementById("status");
const drawer = document.getElementById("drawer");
const results = document.getElementById("results");

const state = {
  tool: "pen",
  strokes: [],
  current: null,
  objects: [],
  undo: [],
  convertTimer: null,
  dragging: null,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function paperSize() {
  const rect = paper.getBoundingClientRect();
  return { w: Math.max(1, rect.width), h: Math.max(paper.scrollHeight, 1400) };
}

function resizeCanvas() {
  const { w, h } = paperSize();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
}

function pointerOnPaper(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() };
}

function shouldIgnorePointer(e) {
  if (!document.getElementById("penOnly").checked) return false;
  if (e.pointerType === "pen") return false;
  if (e.pointerType === "mouse") return false;
  return e.pointerType === "touch";
}

function redraw() {
  const { w, h } = paperSize();
  ctx.clearRect(0, 0, w, h);
  for (const stroke of state.strokes) drawStroke(stroke);
  if (state.current) drawStroke(state.current);
}

function drawStroke(stroke) {
  if (!stroke.points.length) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i += 1) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

function hitObject(x, y) {
  for (let i = state.objects.length - 1; i >= 0; i -= 1) {
    const obj = state.objects[i];
    if (x >= obj.x && x <= obj.x + obj.w && y >= obj.y && y <= obj.y + obj.h) return obj;
  }
  return null;
}

function renderObjects() {
  objects.innerHTML = "";
  const font = document.getElementById("textFont").value;
  paper.style.setProperty("--note-font", font);
  for (const obj of state.objects) {
    if (obj.type === "text") {
      const el = document.createElement("div");
      el.className = "typed";
      el.textContent = obj.text;
      el.style.left = `${obj.x}px`;
      el.style.top = `${obj.y}px`;
      el.style.width = `${obj.w}px`;
      el.style.fontSize = `${obj.size}px`;
      el.style.fontFamily = font;
      el.dataset.id = obj.id;
      objects.appendChild(el);
    } else if (obj.type === "image") {
      const el = document.createElement("img");
      el.className = "photo";
      el.src = obj.src;
      el.alt = obj.alt || "Imagen";
      el.draggable = false;
      el.style.left = `${obj.x}px`;
      el.style.top = `${obj.y}px`;
      el.style.width = `${obj.w}px`;
      el.style.height = `${obj.h}px`;
      el.dataset.id = obj.id;
      objects.appendChild(el);
    }
  }
}

function snapshot() {
  state.undo.push({
    strokes: structuredClone(state.strokes),
    objects: structuredClone(state.objects),
  });
  if (state.undo.length > 40) state.undo.shift();
}

function save() {
  localStorage.setItem(
    "libreta-note",
    JSON.stringify({
      title: document.getElementById("noteTitle").value,
      strokes: state.strokes,
      objects: state.objects,
    })
  );
}

function load() {
  const raw = localStorage.getItem("libreta-note");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    document.getElementById("noteTitle").value = data.title || "Nota nueva";
    state.strokes = data.strokes || [];
    state.objects = data.objects || [];
    renderObjects();
    redraw();
  } catch {
    /* ignore corrupt save */
  }
}

function strokeBounds(strokes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const pad = 10;
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

function strokesToImage(strokes) {
  const bounds = strokeBounds(strokes);
  if (!bounds) return null;
  const scale = 3;
  const off = document.createElement("canvas");
  off.width = Math.max(8, Math.round(bounds.w * scale));
  off.height = Math.max(8, Math.round(bounds.h * scale));
  const c = off.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, off.width, off.height);
  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = "#000000";
  for (const stroke of strokes) {
    if (stroke.tool === "eraser" || stroke.points.length < 2) continue;
    c.lineWidth = Math.max(4, stroke.size * scale * 1.4);
    c.beginPath();
    c.moveTo((stroke.points[0].x - bounds.x) * scale, (stroke.points[0].y - bounds.y) * scale);
    for (let i = 1; i < stroke.points.length; i += 1) {
      c.lineTo((stroke.points[i].x - bounds.x) * scale, (stroke.points[i].y - bounds.y) * scale);
    }
    c.stroke();
  }
  return { bounds, dataUrl: off.toDataURL("image/png") };
}

async function recognizeChrome(strokes) {
  if (!("createHandwritingRecognizer" in navigator)) return "";
  const recognizer = await navigator.createHandwritingRecognizer({ languages: ["es", "en"] });
  const drawing = recognizer.startDrawing({ recognitionType: "text" });
  for (const stroke of strokes) {
    const inkStroke = drawing.addStroke();
    for (const p of stroke.points) {
      inkStroke.addPoint({ x: p.x, y: p.y, t: p.t || 0 });
    }
  }
  const predictions = await drawing.getPrediction();
  recognizer.finish();
  return predictions?.[0]?.text?.trim() || "";
}

async function recognizeTesseract(strokes) {
  if (!window.Tesseract) return "";
  const image = strokesToImage(strokes);
  if (!image) return "";
  const result = await window.Tesseract.recognize(image.dataUrl, "spa+eng", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        setStatus(`Leyendo letra… ${Math.round((m.progress || 0) * 100)}%`);
      }
    },
  });
  return (result.data.text || "").replace(/\s+/g, " ").trim();
}

async function convertInk() {
  const inkStrokes = state.strokes.filter((s) => s.tool !== "eraser" && s.points.length > 1);
  if (!inkStrokes.length) {
    setStatus("No hay letra manuscrita para convertir.");
    return;
  }
  setStatus("Convirtiendo tu letra a fuente…");
  snapshot();
  let text = "";
  try {
    text = await recognizeChrome(inkStrokes);
  } catch {
    text = "";
  }
  if (!text) {
    try {
      text = await recognizeTesseract(inkStrokes);
    } catch (err) {
      setStatus("No pude leer la letra. Intenta más despacio y más grande.");
      console.error(err);
      return;
    }
  }
  if (!text) {
    setStatus("No reconocí la letra. Escríbela un poco más grande y clara.");
    return;
  }
  const bounds = strokeBounds(inkStrokes);
  state.objects.push({
    id: crypto.randomUUID(),
    type: "text",
    text,
    x: bounds.x,
    y: Math.max(0, bounds.y - 8),
    w: Math.max(bounds.w, text.length * 14),
    h: Math.max(40, bounds.h),
    size: 28,
  });
  state.strokes = [];
  renderObjects();
  redraw();
  save();
  setStatus(`Listo: “${text}”`);
}

function scheduleConvert() {
  clearTimeout(state.convertTimer);
  if (!document.getElementById("autoConvert").checked) return;
  state.convertTimer = setTimeout(() => {
    convertInk();
  }, 1100);
}

canvas.addEventListener("pointerdown", (e) => {
  if (shouldIgnorePointer(e)) return;
  canvas.setPointerCapture(e.pointerId);
  const p = pointerOnPaper(e);
  if (state.tool === "select") {
    const hit = hitObject(p.x, p.y);
    if (hit) {
      state.dragging = { id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y };
      snapshot();
    }
    return;
  }
  state.current = {
    tool: state.tool,
    color: document.getElementById("inkColor").value,
    size: Number(document.getElementById("inkSize").value),
    points: [p],
  };
  clearTimeout(state.convertTimer);
});

canvas.addEventListener("pointermove", (e) => {
  if (shouldIgnorePointer(e)) return;
  const p = pointerOnPaper(e);
  if (state.dragging) {
    const obj = state.objects.find((o) => o.id === state.dragging.id);
    if (obj) {
      obj.x = p.x - state.dragging.dx;
      obj.y = p.y - state.dragging.dy;
      renderObjects();
    }
    return;
  }
  if (!state.current) return;
  state.current.points.push(p);
  redraw();
});

function endStroke() {
  if (state.dragging) {
    state.dragging = null;
    save();
    return;
  }
  if (!state.current) return;
  snapshot();
  state.strokes.push(state.current);
  state.current = null;
  redraw();
  save();
  if (state.tool === "pen") scheduleConvert();
}

canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

document.querySelectorAll("[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-tool]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.tool = btn.dataset.tool;
    canvas.style.pointerEvents = "auto";
    objects.style.pointerEvents = state.tool === "select" ? "none" : "none";
  });
});

document.getElementById("convertBtn").addEventListener("click", convertInk);
document.getElementById("undoBtn").addEventListener("click", () => {
  const prev = state.undo.pop();
  if (!prev) return;
  state.strokes = prev.strokes;
  state.objects = prev.objects;
  renderObjects();
  redraw();
  save();
});
document.getElementById("clearInkBtn").addEventListener("click", () => {
  snapshot();
  state.strokes = [];
  redraw();
  save();
});
document.getElementById("textFont").addEventListener("change", () => {
  renderObjects();
  save();
});
document.getElementById("noteTitle").addEventListener("input", save);

document.getElementById("imagesBtn").addEventListener("click", () => {
  drawer.hidden = false;
  document.getElementById("searchQuery").focus();
});
document.getElementById("closeDrawer").addEventListener("click", () => {
  drawer.hidden = true;
});

async function searchImages(query) {
  results.innerHTML = "<p>Buscando…</p>";
  const url =
    "https://commons.wikimedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: "24",
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "640",
      format: "json",
      origin: "*",
    });
  const res = await fetch(url);
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {});
  results.innerHTML = "";
  if (!pages.length) {
    results.innerHTML = "<p>No encontré fotos. Prueba otra palabra o ábrelas en Google y arrástralas.</p>";
    return;
  }
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl && !info?.url) continue;
    if (info.mime && !info.mime.startsWith("image/")) continue;
    const img = document.createElement("img");
    img.src = info.thumburl || info.url;
    img.alt = page.title.replace("File:", "");
    img.draggable = true;
    img.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/uri-list", info.url);
      e.dataTransfer.setData("text/plain", info.url);
    });
    img.addEventListener("click", () => addImage(info.url, 80, 120, img.alt));
    results.appendChild(img);
  }
}

function addImage(src, x, y, alt = "") {
  snapshot();
  state.objects.push({
    id: crypto.randomUUID(),
    type: "image",
    src,
    alt,
    x,
    y,
    w: 280,
    h: 200,
  });
  renderObjects();
  save();
  setStatus("Imagen puesta en la hoja. Usa Mover para acomodarla.");
}

document.getElementById("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.getElementById("searchQuery").value.trim();
  if (!q) return;
  searchImages(q);
});

document.getElementById("openGoogle").addEventListener("click", () => {
  const q = document.getElementById("searchQuery").value.trim() || "fotos";
  window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, "_blank", "noopener");
});

document.getElementById("pickFile").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});
document.getElementById("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const src = await fileToDataUrl(file);
  addImage(src, 90, 140, file.name);
});

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function extractDropUrl(event) {
  const html = event.dataTransfer.getData("text/html");
  if (html) {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match?.[1]) return match[1];
  }
  const uri = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
  return uri || "";
}

async function onDrop(e) {
  e.preventDefault();
  const p = pointerOnPaper(e);
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (file) {
    addImage(await fileToDataUrl(file), p.x - 80, p.y - 40, file.name);
    return;
  }
  const url = extractDropUrl(e);
  if (url && /^https?:|^data:/.test(url)) addImage(url, p.x - 80, p.y - 40);
}

paper.addEventListener("dragover", (e) => e.preventDefault());
canvas.addEventListener("dragover", (e) => e.preventDefault());
paper.addEventListener("drop", onDrop);
canvas.addEventListener("drop", onDrop);

window.addEventListener("paste", async (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (!item) return;
  const file = item.getAsFile();
  if (!file) return;
  addImage(await fileToDataUrl(file), 100, 160);
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("load", () => {
  resizeCanvas();
  load();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
