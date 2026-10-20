/* CDSFont — renders text with the original game's font (Catalog 0009 CDSFont.img,
   extracted to assets/ui/cdsfont). Glyphs are white-on-alpha; we tint per draw. */
const GLYPHS = new Map();   // code -> {img, w, h}
let fontReady = null;

export function loadFont(base = 'assets/ui/cdsfont/') {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    const index = await (await fetch(base + 'index.json')).json();
    const jobs = [];
    for (let c = 32; c <= 126; c++) {
      for (const suffix of ['L', '']) {
        const name = 'IMAGE_ASCII' + c + suffix;
        const rec = index[name];
        if (!rec) continue;
        const img = new Image();
        img.src = base + rec.file;
        jobs.push(new Promise(res => { img.onload = () => { GLYPHS.set(c + suffix, { img, w: rec.w, h: rec.h }); res(); }; img.onerror = () => res(); }));
        break; // prefer the large cut when both exist
      }
    }
    await Promise.all(jobs);
    return GLYPHS.size;
  })();
  return fontReady;
}

function glyphFor(ch) {
  const c = ch.charCodeAt(0);
  return GLYPHS.get(c + 'L') || GLYPHS.get(c + '') ||
         GLYPHS.get(ch.toUpperCase().charCodeAt(0) + 'L') || GLYPHS.get(ch.toUpperCase().charCodeAt(0) + '') ||
         GLYPHS.get(63 + 'L') || GLYPHS.get(63 + '');
}

/* Draw `text` into a fresh canvas at the given scale/tint. Returns the canvas. */
export function cdsText(text, { scale = 2, color = '#ffd75e', spacing = 1 } = {}) {
  const cv = document.createElement('canvas');
  const chars = [...String(text)];
  let w = 0, h = 0;
  const gs = chars.map(ch => {
    if (ch === ' ') { w += 8 * scale * 0.6; return null; }
    const g = glyphFor(ch);
    if (!g) { w += 8 * scale * 0.6; return null; }
    w += g.w * scale + spacing * scale; h = Math.max(h, g.h * scale);
    return g;
  });
  cv.width = Math.max(2, w); cv.height = Math.max(2, h);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let x = 0;
  chars.forEach((ch, i) => {
    const g = gs[i];
    if (!g) { x += 8 * scale * 0.6; return; }
    // tint: paint the glyph through a colour mask
    const t = document.createElement('canvas'); t.width = g.w; t.height = g.h;
    const tc = t.getContext('2d');
    tc.drawImage(g.img, 0, 0);
    tc.globalCompositeOperation = 'source-in';
    tc.fillStyle = color; tc.fillRect(0, 0, g.w, g.h);
    ctx.drawImage(t, x, 0, g.w * scale, g.h * scale);
    x += g.w * scale + spacing * scale;
  });
  return cv;
}

/* Replace an element's content with CDSFont-rendered text. */
export function setCdsText(el, text, opts) {
  el.textContent = '';
  el.appendChild(cdsText(text, opts));
}
