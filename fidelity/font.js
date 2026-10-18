// BLACK DECADE — renders text with the game's own bitmap font.
// Glyphs were extracted from Catalog/0009. CDSFont.img (CDSFont0/1.png):
//   IMAGE_ASCII<code>   small grey set   (~11 px)
//   IMAGE_ASCII<code>L  large white set  (~20 px) — tinted here per call.
// Exposes window.GF:  GF.load(base) -> Promise,  GF.text(str, opts) -> canvas
window.GF = (() => {
  let man = null;
  const imgs = {};
  let readyP = null;

  function load(base) {
    base = base || 'textures/ui/font/';
    if (readyP) return readyP;
    readyP = fetch(base + 'manifest.json').then(r => r.json()).then(m => {
      man = m;
      const ps = Object.keys(m).map(k => new Promise(res => {
        const im = new Image();
        im.onload = () => { imgs[k] = im; res(); };
        im.onerror = () => res();
        im.src = base + m[k].file;
      }));
      return Promise.all(ps);
    }).catch(() => { man = {}; });
    return readyP;
  }

  const tintCache = {};
  function tinted(img, color) {
    const key = color + '|' + img.src.slice(-24);
    if (tintCache[key]) return tintCache[key];
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    tintCache[key] = c;
    return c;
  }

  // opts: { size: 'L'|'S', color, spacing (px), scale }
  function text(str, opts) {
    opts = opts || {};
    const size = opts.size || 'L';
    const color = opts.color || '#f2ecd8';
    const spacing = opts.spacing !== undefined ? opts.spacing : 1;
    const scale = opts.scale || 1;
    str = String(str).toUpperCase();
    const glyphs = [];
    let w = 0, h = 0;
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      let img = null, gw = size === 'L' ? 9 : 7;
      if (ch !== ' ') {
        img = imgs['IMAGE_ASCII' + code + (size === 'L' ? 'L' : '')] ||
              imgs['IMAGE_ASCII' + code] || null;
        if (img) gw = img.width;
      }
      glyphs.push({ img, gw });
      w += gw + spacing;
      if (img) h = Math.max(h, img.height);
    }
    if (!h) h = size === 'L' ? 20 : 11;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    let cx = 0;
    for (const g of glyphs) {
      if (g.img) {
        const src = size === 'L' ? tinted(g.img, color) : g.img;
        x.drawImage(src, Math.round(cx * scale), Math.round((h - g.img.height) * scale),
          Math.round(g.img.width * scale), Math.round(g.img.height * scale));
      }
      cx += g.gw + spacing;
    }
    return c;
  }

  return { load, text, ready: () => readyP };
})();
