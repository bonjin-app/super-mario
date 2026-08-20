/* ============================================================
   PIPO JUMP — original character platformer (web)
   original art / music / characters, smooth 60fps
   ============================================================ */
'use strict';

/* ---------- canvas ----------
   Logical resolution is 256x240. The CSS box fills as much of the window as the
   aspect ratio allows (a strict integer scale used to throw away up to half the
   available height), while the backing store stays an integer multiple so every
   logical pixel is a whole block of device pixels. `image-rendering: pixelated`
   handles the final fractional step without blurring. */
const TILE = 16;
/* FIXED playfield: 320x240 logical, always, on every screen.
   How far ahead you can see is a gameplay variable, not a layout one. A view that
   grew with the window handed a wide monitor 26 tiles of lookahead and a narrow
   one 16, which changes reaction time, changes how a gap or a pipe reads, and
   makes the high score table meaningless across window sizes. The level geometry
   audits in this file were all run against one view, too. So the presentation is
   responsive -- the canvas scales and the page chrome reflows -- and the game is
   not. Leftover space in extreme aspect ratios is honest letterboxing.
   Everything view-dependent is derived here so the size can be retuned in one
   place without hunting for magic numbers. */
const LOGICAL_W = 320, LOGICAL_H = 240;
const VIEW_TILES = Math.ceil(LOGICAL_W / TILE) + 2;  // columns drawTiles must cover
const WAKE_AHEAD = LOGICAL_W + 16;                   // enemies stay asleep past this
const CAM_LEAD = Math.round(LOGICAL_W * 0.34);       // player sits ~1/3 from the left
const DRAW_MARGIN = 28;                              // sprite cull slack, both sides
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('wrap');
/* Measure the container the layout actually gives us, not the window. The page
   chrome (title bar, key legend, touch pad) is real DOM with media queries, so
   only the box it leaves behind can tell us how big the playfield may be. */
function fit() {
  /* Measure the CONTENT box, not the border box. getBoundingClientRect() includes
     #wrap's padding, but the canvas is laid out inside that padding, so using the
     outer size made the canvas ~20px too large in each axis. With overflow:hidden
     on the container that silently clipped the far edge -- on a height-limited
     layout it ate the bottom of the playfield, which is the ground row. */
  let availW = window.innerWidth, availH = window.innerHeight;
  if (wrap && wrap.clientWidth > 1) {
    const cs = getComputedStyle(wrap);
    availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  }
  // A zero-sized container (hidden tab/iframe, or a layout that has not settled)
  // would otherwise collapse the canvas and leave it collapsed until a resize.
  if (availW < 1 || availH < 1) return;
  const fill = Math.max(0.5, Math.min(availW / LOGICAL_W, availH / LOGICAL_H));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bs = Math.max(2, Math.min(6, Math.ceil(fill * dpr))); // integer backing scale
  canvas.style.width = Math.floor(LOGICAL_W * fill) + 'px';
  canvas.style.height = Math.floor(LOGICAL_H * fill) + 'px';
  if (canvas.width !== LOGICAL_W * bs || canvas.height !== LOGICAL_H * bs) {
    canvas.width = LOGICAL_W * bs;
    canvas.height = LOGICAL_H * bs;
  }
  ctx.setTransform(bs, 0, 0, bs, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
/* Events are a hint, not a guarantee. A resize notification can arrive before the
   grid has recomputed, in which case fit() measures the old box and nothing tells
   it to try again -- the canvas then stays the wrong size and gets clipped by the
   container. The loop therefore compares the container's client size every frame
   and re-fits when it actually changed, so the playfield is correct within one
   frame no matter which events fired. clientWidth/Height are cheap reads here
   because nothing mutates the DOM during play. */
let lastBoxW = -1, lastBoxH = -1;
function fitIfNeeded() {
  if (!wrap) return;
  const cw = wrap.clientWidth, ch = wrap.clientHeight;
  if (cw === lastBoxW && ch === lastBoxH) return;
  lastBoxW = cw; lastBoxH = ch;
  fit();
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
if (window.ResizeObserver && wrap) new ResizeObserver(fit).observe(wrap);
window.addEventListener('load', fit);
fit();


/* ---------- palette ---------- */
const PAL = {
  W: '#FFFFFF', Y: '#FFD84A', K: '#2A2A2A', G: '#43B025',
  O: '#C87830', F: '#C85A17', D: '#3A2410', T: '#43B025',
  S: '#B57A3B', s: '#8C5A2B', L: '#E8D8B0'
};

/* ---------- pixel-font (5x7) ----------
   Each row is a 5-bit mask, bit 4 (value 16) = leftmost column. */
const FONT = {
  '0':[14,19,21,21,21,25,14],'1':[4,12,4,4,4,4,14],'2':[14,17,1,6,8,16,31],
  '3':[14,17,1,6,1,17,14],'4':[2,6,10,18,31,2,2],'5':[31,16,30,1,1,17,14],
  '6':[6,8,16,30,17,17,14],'7':[31,1,2,4,8,8,8],'8':[14,17,17,14,17,17,14],
  '9':[14,17,17,15,1,2,12],
  A:[14,17,17,31,17,17,17],B:[30,17,17,30,17,17,30],C:[14,17,16,16,16,17,14],
  D:[28,18,17,17,17,18,28],E:[31,16,16,30,16,16,31],F:[31,16,16,30,16,16,16],
  G:[14,17,16,23,17,17,14],H:[17,17,17,31,17,17,17],I:[14,4,4,4,4,4,14],
  J:[7,2,2,2,2,18,12],K:[17,18,20,24,20,18,17],L:[16,16,16,16,16,16,31],
  M:[17,27,21,21,17,17,17],N:[17,25,21,19,17,17,17],O:[14,17,17,17,17,17,14],
  P:[30,17,17,30,16,16,16],Q:[14,17,17,17,21,18,13],R:[30,17,17,30,20,18,17],
  S:[15,16,16,14,1,1,30],T:[31,4,4,4,4,4,4],U:[17,17,17,17,17,17,14],
  V:[17,17,17,17,17,10,4],W:[17,17,17,21,21,27,17],X:[17,17,10,4,10,17,17],
  Y:[17,17,10,4,4,4,4],Z:[31,1,2,4,8,16,31],
  '.':[0,0,0,0,0,6,6],'!':[4,4,4,4,4,0,4],'-':[0,0,0,31,0,0,0],'/':[1,2,4,8,16,0,0],
  '?':[14,17,1,2,4,0,4],'©':[14,17,22,20,22,17,14],':':[0,6,6,0,6,6,0],
  ' ':new Array(7).fill(0)
};
const GLYPH_W = 6;
function textWidth(s) { return s.length * GLYPH_W - 1; }

/* Text was by far the most expensive thing on screen: one fillRect per lit
   pixel, doubled for the shadow pass, meant ~2800 fillRect calls per frame just
   for the HUD -- 96% of the whole frame budget. Each colour now gets a glyph
   sheet rendered once, and drawing a string is one drawImage per character.
   The sheet stride is 6px so a 5px source rect can never sample the next glyph.
   Cache size is bounded by the handful of colours the UI actually uses. */
const GLYPH_STRIDE = 6;
const GLYPH_CHARS = Object.keys(FONT);
const GLYPH_INDEX = new Map(GLYPH_CHARS.map((ch, i) => [ch, i]));
const glyphSheets = new Map();
function glyphSheet(color) {
  let sheet = glyphSheets.get(color);
  if (sheet) return sheet;
  sheet = document.createElement('canvas');
  sheet.width = GLYPH_CHARS.length * GLYPH_STRIDE;
  sheet.height = 7;
  const g = sheet.getContext('2d');
  g.fillStyle = color;
  GLYPH_CHARS.forEach((ch, i) => {
    const rows = FONT[ch];
    const ox = i * GLYPH_STRIDE;
    for (let r = 0; r < 7; r++) {
      const bits = rows[r];
      if (!bits) continue;
      for (let c = 0; c < 5; c++) if (bits & (16 >> c)) g.fillRect(ox + c, r, 1, 1);
    }
  });
  glyphSheets.set(color, sheet);
  return sheet;
}
function blitTextTo(g, s, x, y, color) {
  const sheet = glyphSheet(color);
  let cx = x;
  for (let i = 0; i < s.length; i++) {
    const gi = GLYPH_INDEX.get(s[i]);
    if (gi !== undefined) g.drawImage(sheet, gi * GLYPH_STRIDE, 0, 5, 7, cx, y, 5, 7);
    cx += GLYPH_W;
  }
}
/* Second stage: whole rendered strings are cached too, so the HUD costs one
   drawImage per readout instead of two per character. Most strings on screen are
   static labels; only the score, timer and coin count ever change, so churn is
   low. The cache is a bounded FIFO, which keeps a level of score popups from
   growing it without limit. */
const TEXT_CACHE_MAX = 128;
const textCache = new Map();
function textSprite(s, color, shadow) {
  // separator + shadow flag in the key: a shadowed and a plain render of the
  // same string must not collide
  const key = s + '\u0000' + color + (shadow ? '1' : '0');
  let spr = textCache.get(key);
  if (spr) return spr;
  const off = shadow ? 1 : 0;
  spr = document.createElement('canvas');
  spr.width = Math.max(1, textWidth(s) + off);
  spr.height = 7 + off;
  const g = spr.getContext('2d');
  // shadow first at +1,+1 so the layout matches the original two-pass draw
  if (shadow) blitTextTo(g, s, 1, 1, 'rgba(0,0,0,0.55)');
  blitTextTo(g, s, 0, 0, color);
  if (textCache.size >= TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value);
  textCache.set(key, spr);
  return spr;
}
/* `volatile` skips the string cache and blits per glyph instead. The score and
   the timer produce a brand-new string constantly, so caching them meant building
   a fresh canvas mid-frame roughly once a second -- a small but real hitch during
   play. Static labels still take the one-drawImage path. */
function drawText(s, x, y, color, alpha, shadow, volatile) {
  if (!s) return;
  const fade = alpha !== undefined && alpha < 1;
  if (fade) ctx.globalAlpha = alpha;
  if (volatile) {
    if (shadow) blitTextTo(ctx, s, x + 1, y + 1, 'rgba(0,0,0,0.55)');
    blitTextTo(ctx, s, x, y, color);
  } else {
    ctx.drawImage(textSprite(s, color, !!shadow), x, y);
  }
  if (fade) ctx.globalAlpha = 1;
}
/* ---------- headline type ----------
   The 5x7 font is right for a readout and wrong for a title. The old logo was a
   flat plate with body text on it, which read as placeholder next to the curve-art
   cast. These build a real headline from the same font by using the glyph bitmap as
   a stencil: cast shadow, dilated outline, vertical gradient body, top gloss. Built
   at HEAD_SS x the on-screen size and downscaled with smoothing on, so the letter
   edges are as clean as the sprites; cached per (text, scale, palette). */
const HEAD_SS = 3;
const bigTextCache = new Map();
/* paint through a mask: whatever `paint` fills is clipped to the lit glyph pixels */
function stencil(mask, paint) {
  const t = document.createElement('canvas');
  t.width = mask.width; t.height = mask.height;
  const g = t.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-in';
  paint(g, t);
  return t;
}
function makeBigText(text, scale, style) {
  const key = text + '|' + scale + '|' + style.top + style.bot + style.line;
  const hit = bigTextCache.get(key);
  if (hit) return hit;

  const SS = HEAD_SS;
  const px = scale * SS;                              // one font pixel, in build px
  const ow = Math.max(1, Math.round(scale / 2)) * SS;  // outline, ~half a font pixel
  const sh = Math.max(1, Math.round(scale / 2)) * SS;  // shadow offset
  const pad = ow + sh;

  // the glyph bitmap, blown up nearest-neighbour so the letterforms stay square
  const mask = document.createElement('canvas');
  mask.width = textWidth(text) * px;
  mask.height = 7 * px;
  const mg = mask.getContext('2d');
  mg.imageSmoothingEnabled = false;
  mg.scale(px, px);
  blitTextTo(mg, text, 0, 0, '#FFFFFF');

  const out = document.createElement('canvas');
  out.width = mask.width + pad * 2;
  out.height = mask.height + pad * 2;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;

  const shadow = stencil(mask, (gg, t) => {
    gg.fillStyle = 'rgba(0,0,0,0.42)'; gg.fillRect(0, 0, t.width, t.height);
  });
  const edge = stencil(mask, (gg, t) => {
    gg.fillStyle = style.line; gg.fillRect(0, 0, t.width, t.height);
  });
  const body = stencil(mask, (gg, t) => {
    const grad = gg.createLinearGradient(0, 0, 0, t.height);
    grad.addColorStop(0, style.top);
    grad.addColorStop(0.62, style.bot);
    grad.addColorStop(1, style.bot);
    gg.fillStyle = grad; gg.fillRect(0, 0, t.width, t.height);
  });
  const gloss = stencil(mask, (gg, t) => {
    const h = t.height * 0.42;
    const grad = gg.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0.72)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gg.fillStyle = grad; gg.fillRect(0, 0, t.width, h);
  });

  g.drawImage(shadow, pad + sh, pad + sh);
  // 8-direction dilation: cheaper than a real stroke and gives an even ring
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue;
    g.drawImage(edge, pad + dx * ow, pad + dy * ow);
  }
  g.drawImage(body, pad, pad);
  g.drawImage(gloss, pad, pad);

  out.lw = out.width / SS;
  out.lh = out.height / SS;
  bigTextCache.set(key, out);
  return out;
}
/* draw a headline centred in the view; y is its top edge, returns its height */
function bigHeadline(text, y, scale, style) {
  const spr = makeBigText(text, scale, style);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(spr, Math.round((LOGICAL_W - spr.lw) / 2), y, spr.lw, spr.lh);
  ctx.imageSmoothingEnabled = smooth;
  return spr.lh;
}
const HEAD_GOLD = { top: '#FFEE7A', bot: '#EE8C10', line: '#3A1E04' };
const HEAD_TEAL = { top: '#CFFFF6', bot: '#22968F', line: '#07262A' };
const HEAD_RED  = { top: '#FFA894', bot: '#BE221A', line: '#2A0604' };

/* Build every sheet and every fixed string up front so nothing allocates during
   play. Score popups are the ones that used to appear for the first time exactly
   when the action happened. */
function warmTextCaches() {
  const colors = ['#FFF', '#FFFFFF', '#FFD84A', '#9FB6E8', '#DDE8FF', '#CFE0FF',
                  '#BFEDE8', '#FF6A6A', '#6BD048', '#4AC8FF', 'rgba(0,0,0,0.55)'];
  for (const c of colors) glyphSheet(c);
  const popups = ['1UP', '100', '200', '400', '800', '1000', '2000', '4000', '5000', '8000'];
  for (const p of popups) textSprite(p, '#FFF', true);
  for (const l of ['LIVES', 'WORLD', 'TIME', 'PIP', 'MOCHI', 'BOLT']) textSprite(l, '#FFF', true);
  // the headlines too: building one mid-transition would hitch the fade
  makeBigText('PIPO JUMP', 4, HEAD_GOLD);
  makeBigText('GAME OVER', 3, HEAD_RED);
  makeBigText('COURSE CLEAR', 3, HEAD_TEAL);
  makeBigText('FORTRESS FALLS', 3, HEAD_RED);
}

/* ---------- sprites ----------
   Art is authored left-to-right facing right; the left-facing view is mirrored
   at draw time rather than stored, the way the PPU's flip attribute worked.
   Ragged row widths silently shift pixels, so we assert. */
function makeSprite(rows, pal, name) {
  const h = rows.length, w = rows[0].length;
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) {
      throw new Error(`sprite ${name || '?'}: row ${y} is ${rows[y].length}px, expected ${w}px`);
    }
  }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  rows.forEach((row, y) => { for (let x = 0; x < w; x++) {
    const col = pal[row[x]]; if (!col) continue;
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  }});
  return c;
}


/* ---------- monsters ----------
   Drawn from curves at FOE_SS times the on-screen size, like the heroes, so the
   whole cast shares one visual language. Hand-plotted 12px grids next to
   curve-drawn heroes read as two different games. Hitboxes are unchanged, so the
   shapes stay inside the same 12x12 / 12x14 / 12x16 / 12x10 footprints they
   always had. */
const FOE_SS = 4;
const FOES = {
  puff:   { body: '#D8883C', lit: '#F2B478', shade: '#9C5A1E', foot: '#4A2A0C' },
  spiko:  { body: '#9A5AC8', lit: '#C494E8', shade: '#66348E', foot: '#2A1442' },
  flappy: { body: '#E85A8A', lit: '#FF96B6', shade: '#A8305C', foot: '#5A1230' },
  chomp:  { body: '#43B025', lit: '#78DA50', shade: '#26761A', foot: '#124808' },
  glider: { body: '#C85AC0', lit: '#EE94E6', shade: '#8C2A86', foot: '#4A0E46' },
  fish:   { body: '#E8544A', lit: '#FF9A80', shade: '#A82C24', foot: '#5E1008' },
  blaze:  { body: '#E85410', lit: '#FFC24A', shade: '#A82808', foot: '#5E1204' },
  cannon: { body: '#3A3A46', lit: '#6A6A7C', shade: '#1E1E28', foot: '#101018' },
  bolt:   { body: '#2A2A34', lit: '#5E5E70', shade: '#141419', foot: '#0A0A0E' },
  shell:  { body: '#C08A48', lit: '#E8BC80', shade: '#7E521E', foot: '#3E2408',
            skin: '#5CC03A', skinLit: '#8FE070', skinShade: '#2E7A14' }
};
const FOE_OUTLINE = 'rgba(22,14,10,0.92)';

function foeBlob(g, x, y, rx, ry, fill, lw) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (lw) { g.lineWidth = lw; g.strokeStyle = FOE_OUTLINE; g.stroke(); }
  g.fillStyle = fill; g.fill();
}
/* two dark eyes with a glint; `slant` tilts them into a scowl */
function foeEyes(g, cx, y, dx, r, slant) {
  for (const s of [-1, 1]) {
    const ex = cx + s * dx;
    g.save();
    g.translate(ex, y); g.rotate(s * slant);
    foeBlob(g, 0, 0, r, r * 1.15, '#231A20', 0);
    g.fillStyle = '#FFFFFF';
    g.beginPath(); g.ellipse(r * 0.3, -r * 0.42, r * 0.4, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

function paintFoe(g, kind, frame) {
  const lw = 0.75;
  /* Feet alternate in both axes: swapping only the spread barely showed at 12px,
     so one foot also lifts. That is the whole walk cycle. */
  const stepA = frame ? -0.9 : 0.9, stepB = frame ? 0.9 : -0.9;
  const liftA = frame ? 0.0 : -0.8, liftB = frame ? -0.8 : 0.0;

  if (kind === 'puff' || kind === 'spiko') {
    const c = FOES[kind];
    const H = kind === 'spiko' ? 14 : 12;
    const cy = kind === 'spiko' ? 7.6 : 5.6;
    const ry = kind === 'spiko' ? 4.0 : 4.3;
    foeBlob(g, 6 - 2.5 + stepA, H - 1.0 + liftA, 1.7, 1.1, c.foot, lw);
    foeBlob(g, 6 + 2.5 + stepB, H - 1.0 + liftB, 1.7, 1.1, c.foot, lw);
    foeBlob(g, 6, cy, 5.1, ry, c.body, lw);
    foeBlob(g, 6, cy - ry * 0.42, 4.0, ry * 0.44, c.lit, 0);
    foeBlob(g, 6, cy + ry * 0.62, 4.2, ry * 0.3, c.shade, 0);
    if (kind === 'spiko') {
      /* Narrow, near-black spines. The first pass drew four wide body-coloured
         triangles, which read as a crown rather than "do not step here". */
      g.fillStyle = c.foot; g.strokeStyle = FOE_OUTLINE; g.lineWidth = lw * 0.8;
      for (const sx of [1.9, 4.0, 6.0, 8.0, 10.1]) {
        g.beginPath();
        g.moveTo(sx - 1.0, cy - ry * 0.86);
        g.lineTo(sx, cy - ry * 1.42);
        g.lineTo(sx + 1.0, cy - ry * 0.86);
        g.closePath(); g.fill(); g.stroke();
      }
    }
    foeEyes(g, 6, cy - 0.2, 2.0, 1.05, kind === 'spiko' ? 0.45 : 0);
    g.strokeStyle = '#3A2018'; g.lineWidth = 0.6; g.lineCap = 'round';
    g.beginPath();
    if (kind === 'spiko') { g.moveTo(4.4, cy + 2.2); g.lineTo(7.6, cy + 2.2); }
    else g.arc(6, cy + 1.3, 1.7, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    return;
  }

  if (kind === 'flappy') {
    const c = FOES.flappy, cy = 7.0;
    /* Wings in the body's own light tone and shaped as a swept feather. White
       wings read as loose paper stuck to the sides. */
    for (const sd of [-1, 1]) {
      g.save();
      g.translate(6 + sd * 4.2, cy - (frame ? 1.6 : 0.1));
      g.rotate(sd * (frame ? -1.05 : -0.2));
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(sd * 2.6, -1.6, sd * (frame ? 4.4 : 3.0), frame ? -0.2 : 0.6);
      g.quadraticCurveTo(sd * 2.4, 1.5, 0, 1.3);
      g.closePath();
      g.lineWidth = lw; g.strokeStyle = FOE_OUTLINE; g.stroke();
      g.fillStyle = frame ? c.lit : c.shade; g.fill();
      g.restore();
    }
    foeBlob(g, 6 - 2.2 + stepA * 0.7, 13.0 + liftA * 0.6, 1.5, 1.0, c.foot, lw);
    foeBlob(g, 6 + 2.2 + stepB * 0.7, 13.0 + liftB * 0.6, 1.5, 1.0, c.foot, lw);
    foeBlob(g, 6, cy, 4.7, 4.6, c.body, lw);
    foeBlob(g, 6, cy - 2.0, 3.7, 2.0, c.lit, 0);
    foeBlob(g, 6, cy + 2.9, 3.8, 1.3, c.shade, 0);
    foeEyes(g, 6, cy - 0.4, 1.9, 1.1, 0);
    g.strokeStyle = '#4A1830'; g.lineWidth = 0.6; g.lineCap = 'round';
    g.beginPath(); g.arc(6, cy + 1.2, 1.6, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    return;
  }

  if (kind === 'blaze') {
    /* A teardrop of fire: bright core, hot rim, and a tail that trails the direction
       of travel. `frame` swaps the tail so it flickers rather than sliding. */
    const c = FOES.blaze;
    g.lineWidth = lw; g.strokeStyle = FOE_OUTLINE;
    g.beginPath();
    g.moveTo(7, frame ? 0.6 : 1.4);
    g.quadraticCurveTo(13.4, 7, 7, 15.4);
    g.quadraticCurveTo(0.6, 7, 7, frame ? 0.6 : 1.4);
    g.closePath();
    g.fillStyle = c.body; g.fill();
    foeBlob(g, 7, 9.4, 3.4, 4.0, c.lit, 0);
    foeBlob(g, 7, 10.4, 1.8, 2.2, '#FFF3C0', 0);
    return;
  }
  if (kind === 'fish') {
    /* A blunt little fish: body, tail fin that flicks between frames, one eye. Reads at
       14px because the tail is the only thing that moves. */
    const c = FOES.fish;
    g.lineWidth = lw; g.strokeStyle = FOE_OUTLINE;
    g.beginPath();                                  // tail, behind the body
    g.moveTo(13.4, 6);
    g.lineTo(frame ? 9.6 : 10.4, frame ? 2.6 : 4.0);
    g.lineTo(frame ? 9.6 : 10.4, frame ? 9.4 : 8.0);
    g.closePath(); g.stroke(); g.fillStyle = c.shade; g.fill();
    foeBlob(g, 6.4, 6, 5.6, 4.4, c.body, lw);
    foeBlob(g, 5.4, 4.6, 3.4, 2.0, c.lit, 0);
    foeBlob(g, 3.0, 5.4, 1.5, 1.5, '#FFFFFF', 0.7);
    foeBlob(g, 2.6, 5.6, 0.8, 0.9, '#1A1208', 0);
    g.beginPath();                                  // lower fin
    g.moveTo(6.0, 9.6); g.lineTo(8.6, 11.6); g.lineTo(9.0, 9.2);
    g.closePath(); g.stroke(); g.fillStyle = c.shade; g.fill();
    return;
  }
  if (kind === 'glider') {
    /* A round body with two wings that beat between frames. The wings are what makes
       it read as airborne at 14px -- the body alone looked like a floating walker. */
    const c = FOES.glider;
    const up = frame ? -2.2 : 0.6;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(7 + sx * 3.4, 6.5);
      g.quadraticCurveTo(7 + sx * 9.5, 6.5 + up, 7 + sx * 6.2, 10.5 + up * 0.4);
      g.closePath();
      g.lineWidth = lw; g.strokeStyle = FOE_OUTLINE; g.stroke();
      g.fillStyle = frame ? c.lit : '#FFFFFF'; g.fill();
    }
    foeBlob(g, 7, 7, 4.6, 4.2, c.body, lw);
    foeBlob(g, 7, 5.4, 3.2, 2.2, c.lit, 0);
    foeEyes(g, 7, 6.4, 1.7, 1.05, 0);
    foeBlob(g, 7, 10.2, 2.0, 1.3, c.shade, lw);
    return;
  }
  if (kind === 'cannon') {
    const c = FOES.cannon;
    g.lineWidth = lw; g.strokeStyle = FOE_OUTLINE;
    foeBlob(g, 8, 11, 7.2, 4.4, c.body, lw);          // base
    g.beginPath();                                     // barrel, pointing left
    g.moveTo(1.2, 4.2); g.lineTo(12.5, 3.0); g.lineTo(12.5, 9.4); g.lineTo(1.2, 9.0);
    g.closePath(); g.stroke(); g.fillStyle = c.lit; g.fill();
    g.fillStyle = '#0A0A0E'; g.fillRect(0.8, 5.0, 2.6, 3.2);   // muzzle
    foeBlob(g, 9.5, 6.2, 1.4, 1.0, c.shade, 0);
    return;
  }
  if (kind === 'bolt') {
    const c = FOES.bolt;
    g.lineWidth = lw; g.strokeStyle = FOE_OUTLINE;
    g.beginPath();
    g.moveTo(0.8, 5.0); g.quadraticCurveTo(-1.2, 2.4, 3.0, 1.2);
    g.lineTo(10.6, 1.2); g.quadraticCurveTo(12.4, 5.0, 10.6, 8.8);
    g.lineTo(3.0, 8.8); g.quadraticCurveTo(-1.2, 7.6, 0.8, 5.0);
    g.closePath(); g.stroke(); g.fillStyle = c.body; g.fill();
    foeBlob(g, 7.4, 3.4, 2.6, 1.1, c.lit, 0);
    for (const sy of [3.4, 6.6]) foeBlob(g, 3.0, sy, 1.0, 0.8, '#FFFFFF', 0);
    return;
  }
  if (kind === 'boss') {
    /* Painted in the same curve language as the cast, at twice the size: shell, four
       spikes along the back, heavy jaw, one eye per side. */
    const c = { body: '#4A7A2A', lit: '#7CB44A', shade: '#2A4E14', foot: '#123008' };
    const bob = frame ? 0.6 : 0;
    g.lineWidth = 1.1; g.strokeStyle = FOE_OUTLINE;
    // legs
    foeBlob(g, 8, 26 - bob, 3.4, 3.0, c.shade, 1.1);
    foeBlob(g, 20, 26 + bob, 3.4, 3.0, c.shade, 1.1);
    // shell
    foeBlob(g, 15, 16, 11.5, 9.0, c.body, 1.2);
    foeBlob(g, 15, 14.5, 8.5, 6.2, c.lit, 0.9);
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(8 + i * 4.4, 8.4); g.lineTo(10.2 + i * 4.4, 3.6); g.lineTo(12.4 + i * 4.4, 8.4);
      g.closePath(); g.lineWidth = 0.9; g.strokeStyle = FOE_OUTLINE; g.stroke();
      g.fillStyle = '#E8E0C8'; g.fill();
    }
    // head
    foeBlob(g, 6.5, 12.5, 6.2, 5.2, c.body, 1.1);
    foeBlob(g, 4.6, 14.6, 4.4, 3.0, '#E8E0C8', 0.9);      // jaw
    foeBlob(g, 6.2, 10.4, 1.5, 1.5, '#FFFFFF', 0.8);
    foeBlob(g, 5.8, 10.6, 0.8, 0.9, '#1A1208', 0);
    foeBlob(g, 9.6, 9.0, 1.2, 1.6, '#E8E0C8', 0.8);       // horn
    return;
  }
  if (kind === 'chomp') {
    /* Authored top-down: head in the first rows, stem to the bottom, so the draw
       can clip to however much has risen out of the pipe. */
    const c = FOES.chomp;
    g.lineWidth = lw + 0.3; g.strokeStyle = FOE_OUTLINE;
    g.beginPath(); g.moveTo(4.4, 7.6); g.lineTo(4.4, 16); g.lineTo(7.6, 16); g.lineTo(7.6, 7.6);
    g.closePath(); g.stroke();
    g.fillStyle = c.body; g.fill();
    g.fillStyle = c.shade; g.fillRect(6.5, 7.6, 1.1, 8.4);
    g.fillStyle = c.lit; g.fillRect(4.7, 7.6, 0.8, 8.4);
    foeBlob(g, 6, 4.6, 5.2, 4.4, c.body, lw + 0.2);
    foeBlob(g, 6, 2.6, 4.0, 2.0, c.lit, 0);
    g.fillStyle = '#7A1830';
    g.beginPath(); g.ellipse(6, 5.4, 4.0, 1.9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFFFFF';
    for (const tx of [2.9, 4.6, 6.3, 8.0]) { g.beginPath(); g.moveTo(tx, 3.6); g.lineTo(tx + 1.2, 3.6); g.lineTo(tx + 0.6, 5.0); g.closePath(); g.fill(); }
    for (const tx of [3.5, 5.2, 6.9]) { g.beginPath(); g.moveTo(tx, 7.2); g.lineTo(tx + 1.2, 7.2); g.lineTo(tx + 0.6, 5.9); g.closePath(); g.fill(); }
    foeEyes(g, 6, 1.9, 1.9, 0.85, 0.3);
    return;
  }

  if (kind === 'shelly' || kind === 'shell') {
    const c = FOES.shell;
    const shellCY = kind === 'shelly' ? 10.4 : 5.0;
    if (kind === 'shelly') {
      /* Head beside the shell at shell height, not perched on top of it: a small
         ball above the dome read as a separate object. It walks left, so the head
         leads on the left. */
      foeBlob(g, 6 - 2.6 + stepA, 15.0 + liftA * 0.7, 1.6, 1.0, c.skinShade, lw);
      foeBlob(g, 6 + 2.6 + stepB, 15.0 + liftB * 0.7, 1.6, 1.0, c.skinShade, lw);
      foeBlob(g, 2.2, 7.6, 3.1, 3.0, c.skin, lw);
      foeBlob(g, 2.2, 6.4, 2.4, 1.5, c.skinLit, 0);
      foeEyes(g, 1.9, 7.3, 1.25, 0.8, 0);
    }
    foeBlob(g, 6, shellCY, 5.6, kind === 'shelly' ? 4.4 : 4.4, c.body, lw + 0.2);
    foeBlob(g, 6, shellCY - 2.0, 4.4, 1.8, c.lit, 0);
    foeBlob(g, 6, shellCY + 2.7, 4.6, 1.3, c.shade, 0);
    g.strokeStyle = c.shade; g.lineWidth = 0.55;
    for (const px of [3.4, 6.0, 8.6]) {
      g.beginPath(); g.ellipse(px, shellCY + 0.2, 1.15, 1.5, 0, 0, Math.PI * 2); g.stroke();
    }
    return;
  }

  if (kind === 'flat') {
    const c = FOES.puff;
    foeBlob(g, 6, 9.6, 5.4, 2.2, c.body, lw);
    foeBlob(g, 6, 8.6, 4.4, 1.1, c.lit, 0);
    foeEyes(g, 6, 9.5, 2.1, 0.8, 0.5);
    foeBlob(g, 3.0, 11.4, 1.5, 0.8, c.foot, lw);
    foeBlob(g, 9.0, 11.4, 1.5, 0.8, c.foot, lw);
  }
}

const ITEM_OUTLINE = 'rgba(70,36,10,0.9)';
function itemBlob(g, x, y, rx, ry, fill, lw) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (lw) { g.lineWidth = lw; g.strokeStyle = ITEM_OUTLINE; g.stroke(); }
  g.fillStyle = fill; g.fill();
}
function itemSprite(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w * FOE_SS; c.height = h * FOE_SS;
  const g = c.getContext('2d');
  g.scale(FOE_SS, FOE_SS);
  g.lineJoin = 'round';
  paint(g);
  c.lw = w; c.lh = h;
  return c;
}
function foeSprite(kind, frame, w, h) {
  const c = document.createElement('canvas');
  c.width = w * FOE_SS; c.height = h * FOE_SS;
  const g = c.getContext('2d');
  g.scale(FOE_SS, FOE_SS);
  g.lineJoin = 'round';
  paintFoe(g, kind, frame);
  c.lw = w; c.lh = h;
  return c;
}

const SPR = {};
function buildSprites() {
  SPR.puff = [foeSprite('puff', 0, 12, 12), foeSprite('puff', 1, 12, 12)];
  SPR.puffFlat = foeSprite('flat', 0, 12, 12);
  SPR.shelly = [foeSprite('shelly', 0, 12, 16), foeSprite('shelly', 1, 12, 16)];
  SPR.shell = foeSprite('shell', 0, 12, 10);
  SPR.spiko = [foeSprite('spiko', 0, 12, 14), foeSprite('spiko', 1, 12, 14)];
  SPR.flappy = [foeSprite('flappy', 0, 12, 14), foeSprite('flappy', 1, 12, 14)];
  SPR.chomp = foeSprite('chomp', 0, 12, 16);
  SPR.glider = [0, 1].map(f => foeSprite('glider', f, 14, 12));
  SPR.blaze = [0, 1].map(f => foeSprite('blaze', f, 14, 16));
  SPR.fish = [0, 1].map(f => foeSprite('fish', f, 14, 12));
  SPR.cannon = foeSprite('cannon', 0, 16, 16);
  SPR.bolt = [0, 1].map(f => foeSprite('bolt', f, 12, 10));
  /* Powerups and coins are curve art too, so the things you chase match the
     cast that chases you. Same footprints as before: 12x12 items, 10x9 coin. */
  SPR.mushroom = itemSprite(12, 12, (g) => {
    // stubby stalk with a spotted cap
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(3.4, 7.0); g.quadraticCurveTo(3.0, 11.4, 4.2, 11.4);
    g.lineTo(7.8, 11.4); g.quadraticCurveTo(9.0, 11.4, 8.6, 7.0);
    g.closePath();
    g.lineWidth = 0.8; g.strokeStyle = ITEM_OUTLINE; g.stroke();
    g.fillStyle = '#FFE3C0'; g.fill();
    g.fillStyle = '#E0B992'; g.fillRect(7.4, 7.4, 1.1, 3.6);
    itemBlob(g, 6, 5.0, 5.4, 4.0, '#E7551F', 0.9);
    itemBlob(g, 6, 3.4, 4.2, 2.0, '#FF7A46', 0);
    for (const [sx, sy, r] of [[3.0, 4.6, 1.35], [9.0, 4.6, 1.35], [6.0, 2.3, 1.15]])
      itemBlob(g, sx, sy, r, r * 0.86, '#FFFFFF', 0);
    // eyes so it reads as alive, like the cast
    itemBlob(g, 4.6, 9.0, 0.62, 0.8, '#4A2A18', 0);
    itemBlob(g, 7.4, 9.0, 0.62, 0.8, '#4A2A18', 0);
  });
  SPR.flower = itemSprite(12, 12, (g) => {
    g.lineWidth = 1.0; g.strokeStyle = '#2A6410';
    g.beginPath(); g.moveTo(6, 11.6); g.lineTo(6, 6.4); g.stroke();
    itemBlob(g, 3.4, 9.2, 2.1, 1.2, '#43B025', 0.7);
    itemBlob(g, 8.6, 10.2, 1.9, 1.1, '#2E8B1C', 0.7);
    for (let i = 0; i < 6; i++) {          // petals
      const a = i * Math.PI / 3;
      itemBlob(g, 6 + Math.cos(a) * 2.9, 4.6 + Math.sin(a) * 2.6, 2.0, 1.9, '#FF7A20', 0.8);
    }
    itemBlob(g, 6, 4.6, 2.2, 2.1, '#FFD84A', 0.8);
    itemBlob(g, 5.3, 3.9, 0.8, 0.8, '#FFF6C8', 0);
  });
  SPR.star = itemSprite(12, 12, (g) => {
    // five-point star, outlined, with a soft inner glow
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 ? 2.3 : 5.5;
      pts.push([6 + Math.cos(a) * r, 6 + Math.sin(a) * r]);
    }
    g.beginPath();
    pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py));
    g.closePath();
    g.lineWidth = 0.9; g.strokeStyle = ITEM_OUTLINE; g.stroke();
    g.fillStyle = '#FFD84A'; g.fill();
    itemBlob(g, 6, 5.2, 2.2, 1.8, '#FFF2A8', 0);
    itemBlob(g, 4.6, 6.2, 0.62, 0.8, '#5A3A08', 0);
    itemBlob(g, 7.4, 6.2, 0.62, 0.8, '#5A3A08', 0);
  });
  /* coin spins: face-on to edge-on and back, all 10x9 so the draw never moves */
  SPR.coin = [0.95, 0.55, 0.16, 0.55].map((squash, i) => itemSprite(10, 9, (g) => {
    const rx = 4.1 * squash;
    itemBlob(g, 5, 4.5, Math.max(0.6, rx), 4.0, '#FFC830', 0.8);
    if (squash > 0.35) {
      itemBlob(g, 5, 4.5, Math.max(0.3, rx - 1.1), 2.9, '#FFE694', 0);
      g.fillStyle = '#C08010';
      g.fillRect(5 - 0.45, 2.4, 0.9, 4.2);      // the notch that shows it turning
    }
    if (i === 3) { g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(5 - rx * 0.7, 1.6, 0.8, 5.8); }
  }));
  // fireball: 4 rotation frames so it visibly spins
  const FB_PAL = { O: '#FF7A20', Y: '#FFD84A', W: '#FFF6D0', k: '#B03000' };
  const fb = (rows, n) => makeSprite(rows, FB_PAL, 'fireball' + n);
  SPR.fireball = [
    fb(['.kOOOk..','kOYYYOk.','OYWWYYO.','OYWWYYO.','kOYYYOk.','.kOOOk..','........','........'], 0),
    fb(['..kOk...','.kOYOk..','kOYWYOk.','OYWWYYO.','kOYYYOk.','.kOOOk..','..kOk...','........'], 1),
    fb(['..kOOk..','.OYYYO..','kOWWYOk.','kOWWYOk.','.OYYYO..','..kOOk..','........','........'], 2),
    fb(['...kOk..','..kOYOk.','.kOYWYOk','.OYWWYYO','.kOYYYOk','..kOOOk.','...kOk..','........'], 3)
  ];
  /* The goal is the payoff of every course and it was the crudest art in the
     game: a 7x4 white blob on a bare pole and a two-tone block for a castle. */
  SPR.finial = itemSprite(8, 8, (g) => {
    itemBlob(g, 4, 4, 3.4, 3.4, '#FFE45A', 0.8);
    itemBlob(g, 3.1, 3.0, 1.5, 1.4, '#FFF6C0', 0);
    itemBlob(g, 4, 5.6, 2.4, 1.0, '#C79A0E', 0);
  });
  // course banner that rides down the pole with the player
  SPR.banner = itemSprite(14, 10, (g) => {
    g.beginPath();
    g.moveTo(0.8, 0.8); g.lineTo(13.2, 2.6);
    g.quadraticCurveTo(10.6, 5.0, 13.2, 7.4); g.lineTo(0.8, 9.2);
    g.closePath();
    g.lineWidth = 0.9; g.strokeStyle = ITEM_OUTLINE; g.stroke();
    g.fillStyle = '#E8443C'; g.fill();
    g.fillStyle = '#FF7A66';
    g.beginPath(); g.moveTo(1.6, 1.9); g.lineTo(11.4, 3.3); g.lineTo(11.4, 4.6); g.lineTo(1.6, 3.4); g.closePath(); g.fill();
    itemBlob(g, 5.2, 5.0, 1.9, 1.9, '#FFE45A', 0.7);
  });
  /* Checkpoint pennant. Two states: limp and grey before it is passed, flying
     and lit after. A single sprite that only changed colour read as a palette
     bug rather than a state change, so the silhouette changes too. */
  SPR.checkLimp = itemSprite(9, 11, (g) => {
    g.beginPath();
    g.moveTo(0.8, 0.8); g.quadraticCurveTo(4.4, 2.4, 3.0, 5.2);
    g.quadraticCurveTo(2.2, 7.8, 4.0, 10.2); g.lineTo(0.8, 9.6);
    g.closePath();
    g.lineWidth = 0.8; g.strokeStyle = ITEM_OUTLINE; g.stroke();
    g.fillStyle = '#8C9BC4'; g.fill();
  });
  SPR.checkFlag = itemSprite(14, 10, (g) => {
    g.beginPath();
    g.moveTo(0.8, 0.8); g.lineTo(13.2, 2.4);
    g.quadraticCurveTo(10.4, 4.8, 13.2, 7.2); g.lineTo(0.8, 9.2);
    g.closePath();
    g.lineWidth = 0.9; g.strokeStyle = ITEM_OUTLINE; g.stroke();
    g.fillStyle = '#4AC8FF'; g.fill();
    g.fillStyle = '#B4EBFF';
    g.beginPath(); g.moveTo(1.6, 1.9); g.lineTo(11.0, 3.1); g.lineTo(11.0, 4.4); g.lineTo(1.6, 3.4); g.closePath(); g.fill();
    itemBlob(g, 5.0, 5.0, 1.8, 1.8, '#FFFFFF', 0.8);
  });
  /* The axe on the far side of the bridge. Small, bright, and the only gold thing in
     a fortress, so it reads as the objective without a label. */
  SPR.axe = itemSprite(14, 14, (g) => {
    g.lineWidth = 0.9; g.strokeStyle = ITEM_OUTLINE;
    g.beginPath(); g.moveTo(7.4, 3.2); g.lineTo(8.6, 12.6); g.lineTo(6.2, 12.6); g.lineTo(6.6, 3.2);
    g.closePath(); g.stroke(); g.fillStyle = '#6B4A2A'; g.fill();
    g.beginPath();
    g.moveTo(6.6, 2.6); g.quadraticCurveTo(12.6, 2.0, 12.2, 6.2);
    g.quadraticCurveTo(9.4, 5.4, 6.8, 6.6);
    g.closePath(); g.stroke(); g.fillStyle = '#E8E4EE'; g.fill();
    itemBlob(g, 9.0, 4.0, 1.5, 0.9, '#FFFFFF', 0.85);
  });
  /* The boss: a squat armoured thing, twice the hero's height. Deliberately not
     cute -- every other face in the game is, so this one reads as the exception. */
  SPR.boss = [0, 1].map(ph => foeSprite('boss', ph, 28, 30));
  /* A fire bar link. One sprite, drawn repeatedly along the bar's angle. */
  SPR.fireLink = itemSprite(8, 8, (g) => {
    itemBlob(g, 4, 4, 3.4, 3.4, '#FF7A18', 0.95);
    itemBlob(g, 4, 4, 2.2, 2.2, '#FFD24A', 0.95);
    itemBlob(g, 3.4, 3.4, 1.1, 1.1, '#FFFFFF', 0.9);
  });
  // small banner raised on the keep once the hero is inside
  SPR.castleFlag = itemSprite(12, 8, (g) => {
    g.beginPath();
    g.moveTo(0.8, 0.8); g.lineTo(11.2, 3.0); g.lineTo(0.8, 6.4);
    g.closePath();
    g.lineWidth = 0.8; g.strokeStyle = ITEM_OUTLINE; g.stroke();
    g.fillStyle = '#4FD8CE'; g.fill();
    g.fillStyle = '#9AF0E8';
    g.beginPath(); g.moveTo(1.6, 1.9); g.lineTo(7.4, 3.1); g.lineTo(1.6, 3.6); g.closePath(); g.fill();
  });
  {
    /* 32x32 keep. Mortar courses (m) break the flat slab, s shades the right
       face, W is lamplight behind the windows and the gate gets an arch. */
    const rows = [
      '........Bs..Bs..Bs..Bs..........',
      '........LLLLLLLLLLLLLLLs........',
      '........BBBBBBBBBBBBBBBs........',
      '........mmmmmmmmmmmmmmms........',
      '........BBBBWWBBWWBBBBBs........',
      '........BBBBWWBBWWBBBBBs........',
      '........mmmmmmmmmmmmmmms........',
      '........BBBBBBBBBBBBBBBs........',
      'Bs..Bs..Bs..Bs..Bs..Bs..Bs..Bs..',
      'LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLs',
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBs',
      'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmms',
      'BBBBWWWWBBBBBBBBBBBBBBBBWWWWBBBs',
      'BBBBWWWWBBBBBBBBBBBBBBBBWWWWBBBs',
      'mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmms',
      'BBBBBBBBBBBBBmDDDDmBBBBBBBBBBBBs'
    ];
    for (let i = 0; i < 8; i++) rows.push('BBBBBBBBBBBBmDDDDDDmBBBBBBBBBBBBs'.slice(0, 32));
    for (let i = 0; i < 8; i++) rows.push('mmmmBBBBBBBBmDDDDDDmBBBBBBBBmmmBs'.slice(0, 32));
    SPR.castle = makeSprite(rows,
      { B: '#3A5AC8', L: '#7A96E8', s: '#25397F', m: '#2C4499', D: '#140C1E', W: '#FFD86A' },
      'castle');
  }
}
buildSprites();

/* ---------- level themes ----------
   The three rotating courses used to share one palette, so 1-2 and 1-3 looked
   identical to 1-1. Terrain and scenery are now built once per theme; ? blocks
   stay gold in every theme because they are the one tile the player must be
   able to spot instantly. */
const CLOUD_ART = [
  '....WWWWWW....','..WWWWWWWWWW..','.WWWWWWWWWWWW.','WWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWW','.wwwwwwwwwwww.'
];
const CLOUD_BIG_ART = [
  '.......WWWWWW.......','....WWWWWWWWWWWW....','..WWWWWWWWWWWWWWWW..','.WWWWWWWWWWWWWWWWWW.',
  'WWWWWWWWWWWWWWWWWWWW','WWWWWWWWWWWWWWWWWWWW','.WWWWWWWWWWWWWWWWWW.','..wwwwwwwwwwwwwwww..'
];
const HILL_ART = [
  '......tttt......','....tttttttt....','...TTTTTTTTTT...','..TTTTTTTTTTTT..',
  '.TTTTTTTTTTTTTT.','TTTTTTTTTTTTTTTT','TTTTdddTTTdddTTT','TTTTdddTTTdddTTT',
  'TTTTTTTTTTTTTTTT','TTTTTTTTTTTTTTTT'
];
const HILL_BIG_ART = [
  '..........tttt..........','........tttttttt........','......tttttttttttt......','....TTTTTTTTTTTTTTTT....',
  '...TTTTTTTTTTTTTTTTTT...','..TTTTTTTTTTTTTTTTTTTT..','.TTTTTTTTTTTTTTTTTTTTTT.','TTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTdddTTTTTTdddTTTTTT','TTTTTTdddTTTTTTdddTTTTTT','TTTTTTTTTTTTTTTTTTTTTTTT','TTTTTTTTTTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTTTTTTTTTT','TTTTTTTTTTTTTTTTTTTTTTTT'
];
const MTN_ART = [
  '..............MM..............',
  '.............MmmM.............',
  '............MmmmmM............',
  '...........MmmmmmmM...........',
  '..........MmmmmmmmmM..........',
  '.........MMMMMMMMMMMM.........',
  '........MMMMMMMMMMMMMM........',
  '.......MMMMMMMMMMMMMMMM.......',
  '......MMMMMMMMMMMMMMMMMM......',
  '.....MMMMMMMMMMMMMMMMMMMM.....',
  '....MMMMMMMMMMMMMMMMMMMMMM....',
  '...MMMMMMMMMMMMMMMMMMMMMMMM...',
  '..MMMMMMMMMMMMMMMMMMMMMMMMMM..',
  '.MMMMMMMMMMMMMMMMMMMMMMMMMMMM.',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM'
];
const BUSH_ART = [
  '...tttt..tttt...','..tttttt.ttttt..','.TTTTTTTTTTTTTT.','TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT','.dddddddddddddd.'
];
const BUSH_BIG_ART = [
  '....tttt....tttt....','...tttttt..tttttt...','..tttttttttttttttt..','.TTTTTTTTTTTTTTTTTT.',
  'TTTTTTTTTTTTTTTTTTTT','TTTTTTTTTTTTTTTTTTTT','.dddddddddddddddddd.'
];

const THEMES = [
  { name: 'MEADOW', sky: ['#4A82F0', '#5C94FC', '#93C0FF'], stars: 0,
    ground: { base: '#C87A38', hi: '#F0A860', lo: '#8C4A18', seam: '#4A2410' },
    brick:  { base: '#A83A14', hi: '#DC6A2C', lo: '#6A2008', seam: '#340E02' },
    used:   { base: '#8C5A2B', hi: '#B57A3B', lo: '#6B410F' },
    pipe:   { base: '#43B025', hi: '#8FE070', lo: '#1E7A14' },
    cloud:  { W: '#FFFFFF', w: '#D8E8FF' },
    hill:   { T: '#2E8B1C', t: '#43B025', d: '#1E6B12' },
    mtn:    { M: '#3E7AB8', m: '#5A94CC' },
    bush:   { T: '#43B025', t: '#6BD048', d: '#2E8B1C' },
    scrim: 'rgba(4,10,26,0.34)' },
  /* Sunset keeps the sky far brighter than the terrain: the first pass had the
     horizon and the sand at nearly the same value, so ground, bushes and sky
     all merged into one band. */
  { name: 'SUNSET', sky: ['#7E2464', '#E0543C', '#F7A649'], stars: 0,
    ground: { base: '#A0693A', hi: '#CE9A5E', lo: '#5E3A14', seam: '#33200A' },
    brick:  { base: '#7A3418', hi: '#AA5A2C', lo: '#48180A', seam: '#280C04' },
    used:   { base: '#66442A', hi: '#8E6440', lo: '#3E2612' },
    pipe:   { base: '#2E9A86', hi: '#68D2BC', lo: '#146052' },
    cloud:  { W: '#FFE8D8', w: '#EFA98C' },
    hill:   { T: '#5A2C6C', t: '#7C4288', d: '#3A1A48' },
    mtn:    { M: '#7A3E66', m: '#96567E' },
    bush:   { T: '#2E7A5A', t: '#48A87C', d: '#18513A' },
    scrim: 'rgba(30,6,20,0.42)' },
  { name: 'MIDNIGHT', sky: ['#070C24', '#131E48', '#2A3C74'], stars: 1,
    ground: { base: '#46587C', hi: '#6E86AE', lo: '#26324E', seam: '#0E1428' },
    brick:  { base: '#2A3A66', hi: '#4A5E9A', lo: '#141C38', seam: '#070A1A' },
    used:   { base: '#2E3A52', hi: '#4A5A76', lo: '#1A2234', seam: '#0C1224' },
    pipe:   { base: '#1E7A52', hi: '#46B484', lo: '#0E4A30' },
    cloud:  { W: '#8E9CC4', w: '#66739A' },
    hill:   { T: '#1C2C48', t: '#2A3E5E', d: '#121E34' },
    mtn:    { M: '#111A32', m: '#1C2A48' },
    bush:   { T: '#1E4432', t: '#2E5E46', d: '#122E20' },
    scrim: 'rgba(0,0,0,0.42)' }
];

/* mix a hex colour toward black (t<0) or white (t>0) */
function shade(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v =>
    Math.max(0, Math.min(255, Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t))));
  return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
}
function buildThemeSprites(th) {
  const S = { theme: th };
  const tile = (fn) => { const c = document.createElement('canvas'); c.width = 16; c.height = 16; fn(c.getContext('2d')); return c; };
  const G = th.ground, B = th.brick, U = th.used, P = th.pipe;
  /* Running-bond masonry: two 8px courses per tile with the vertical joints
     offset between them, so the pattern interlocks and tiles seamlessly.
     The previous tile put a bevel on all four edges of every tile, which drew
     bright horizontal lines through the middle of any large mass -- a staircase
     read as a stack of separate crates instead of one structure. The bevel now
     only goes on tiles whose top is actually exposed (`cap`). */
  const masonry = (g, C, cap) => {
    g.fillStyle = C.base; g.fillRect(0, 0, 16, 16);
    g.fillStyle = C.seam;
    g.fillRect(0, 0, 16, 1); g.fillRect(0, 8, 16, 1);       // course lines
    g.fillRect(0, 1, 1, 7);  g.fillRect(8, 1, 1, 7);        // upper joints
    g.fillRect(4, 9, 1, 7);  g.fillRect(12, 9, 1, 7);       // lower joints, offset
    g.fillStyle = C.hi;                                      // face lit edge
    g.fillRect(1, 1, 7, 1); g.fillRect(9, 1, 7, 1);
    g.fillRect(0, 9, 4, 1); g.fillRect(5, 9, 7, 1); g.fillRect(13, 9, 3, 1);
    g.fillStyle = C.lo;                                      // face shaded edge
    g.fillRect(1, 7, 7, 1); g.fillRect(9, 7, 7, 1);
    g.fillRect(0, 15, 4, 1); g.fillRect(5, 15, 7, 1); g.fillRect(13, 15, 3, 1);
    if (cap) { g.fillStyle = C.hi; g.fillRect(0, 0, 16, 2); g.fillStyle = C.base; g.fillRect(0, 2, 16, 1); }
  };
  /* Lift deck: 32x8, read as a machined platform rather than terrain so the player
     can tell at a glance that it moves. Rivets at both ends, lit top edge, dark
     underside, and the theme's pipe palette (the one metallic-looking family). */
  S.platS = (() => {
    const c = document.createElement('canvas'); c.width = 16; c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = P.base; g.fillRect(0, 0, 16, 8);
    g.fillStyle = P.hi; g.fillRect(0, 0, 16, 2);
    g.fillStyle = P.lo; g.fillRect(0, 6, 16, 2);
    g.fillStyle = 'rgba(0,0,0,0.30)'; g.fillRect(7, 3, 2, 2);
    g.fillStyle = P.hi; g.fillRect(0, 2, 1, 4); g.fillRect(15, 2, 1, 4);
    return c;
  })();
  S.plat = (() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = P.base; g.fillRect(0, 0, 32, 8);
    g.fillStyle = P.hi; g.fillRect(0, 0, 32, 2);
    g.fillStyle = P.lo; g.fillRect(0, 6, 32, 2);
    g.fillStyle = 'rgba(0,0,0,0.30)';
    for (let x = 4; x < 32; x += 8) g.fillRect(x, 3, 2, 2);
    g.fillStyle = P.hi;
    g.fillRect(0, 2, 1, 4); g.fillRect(31, 2, 1, 4);
    return c;
  })();
  /* An enterable pipe has to say so without a tutorial. Same pipe, with the mouth
     opened out: a dark shaft with a lit lip, so it reads as a hole rather than a lid.
     Every other pipe in the game is closed, which is what makes this one legible. */
  const mouth = (side) => tile(g => {
    g.fillStyle = P.base; g.fillRect(0, 0, 16, 16);
    g.fillStyle = P.hi; g.fillRect(0, 0, 16, 2);
    g.fillStyle = P.lo; g.fillRect(0, 14, 16, 2);
    // the opening runs to the tile edge on the joining side, so the pair reads as
    // one hole instead of two -- two separate squares looked like a texture, not a way in
    const x0 = side === 'L' ? 3 : 0, w = side === 'L' ? 13 : 13;
    g.fillStyle = '#0A0E1C'; g.fillRect(x0, 2, w, 12);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x0 + (side === 'L' ? 1 : 0), 3, w - 1, 10);
    g.fillStyle = P.hi; g.fillRect(x0, 2, w, 1);            // lit lip along the top
    if (side === 'L') { g.fillStyle = P.lo; g.fillRect(x0 - 1, 2, 1, 12); }
    else { g.fillStyle = P.lo; g.fillRect(13, 2, 1, 12); }
  });
  S.pipeEnterL = mouth('L');
  S.pipeEnterR = mouth('R');
  S.pipeEnter = S.pipeEnterL;   // kept for any single-tile use
  /* Lava: two bands with a lit crest, animated by swapping the pair. Drawn as a
     tile rather than a sprite so it composes with the terrain pass. */
  S.lava = [0, 1].map(ph => tile(g => {
    g.fillStyle = '#B01808'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#E85410'; g.fillRect(0, 0, 16, 6);
    g.fillStyle = '#FFA028';
    for (let x = 0; x < 16; x += 4) g.fillRect(x, ph ? 1 : 2, 2, 2);
    g.fillStyle = '#FFD86A'; g.fillRect(0, 0, 16, 1);
    g.fillStyle = '#7A0C04'; g.fillRect(0, 12, 16, 4);
  }));
  /* Interior wall: the same running bond as the terrain, several shades darker and
     without the lit top edge, so it sits clearly BEHIND everything. Two variants,
     picked per tile from a position hash, keeps a 128-tile wall from looking like
     wallpaper. */
  /* -0.62 measured as near-black against the fortress sky: the texture was there and
     invisible. The wall has to be dark enough to sit behind the terrain and light
     enough to be a wall. */
  const wallC = {
    base: shade(G.base, -0.40), hi: shade(G.base, -0.24),
    lo: shade(G.base, -0.56), seam: shade(G.seam, -0.15)
  };
  S.wall = [0, 1].map(v => tile(g => {
    g.fillStyle = wallC.base; g.fillRect(0, 0, 16, 16);
    g.fillStyle = wallC.seam;
    g.fillRect(0, v ? 0 : 8, 16, 1);
    g.fillRect(v ? 4 : 0, v ? 1 : 9, 1, 7);
    g.fillRect(v ? 12 : 8, v ? 1 : 9, 1, 7);
    g.fillStyle = wallC.hi; g.fillRect(1, v ? 1 : 9, 6, 1);
    g.fillStyle = wallC.lo; g.fillRect(1, v ? 7 : 15, 6, 1);
  }));
  /* A pillar and a lit window, both background only: they give the interior depth
     without adding a single tile of collision. A hazard the player cannot read is
     bad; scenery they cannot touch is free. */
  S.pillar = (() => {
    /* Wider and lighter than the first cut, which read as a seam in the wall rather
       than a rib standing in front of it: a lit left face, a shaded right face and a
       capital at each end. */
    /* Ceiling to floor: 176px, which is row 2 down to the floor at row 13. At 96 it
       stopped in mid-air and read as a hanging stub rather than a pillar. */
    const c = document.createElement('canvas'); c.width = 20; c.height = 176;
    const g = c.getContext('2d');
    g.fillStyle = shade(G.base, -0.22); g.fillRect(3, 0, 14, 176);
    g.fillStyle = shade(G.base, -0.06); g.fillRect(4, 0, 4, 176);
    g.fillStyle = shade(G.base, -0.44); g.fillRect(13, 0, 4, 176);
    g.fillStyle = shade(G.seam, -0.1);
    for (let y = 6; y < 176; y += 12) g.fillRect(3, y, 14, 1);
    g.fillStyle = shade(G.base, 0.06);
    g.fillRect(1, 0, 18, 5); g.fillRect(2, 170, 16, 6);
    return c;
  })();
  S.window = (() => {
    const c = document.createElement('canvas'); c.width = 16; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = shade(G.base, -0.7); g.fillRect(2, 0, 12, 32);
    const grad = g.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, 'rgba(255,206,120,0.92)');
    grad.addColorStop(0.55, 'rgba(255,150,50,0.66)');
    grad.addColorStop(1, 'rgba(220,90,20,0.24)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(4, 30); g.lineTo(4, 10); g.quadraticCurveTo(8, 2, 12, 10); g.lineTo(12, 30);
    g.closePath(); g.fill();
    g.fillStyle = shade(G.base, -0.35); g.fillRect(3, 28, 10, 2);
    return c;
  })();
  S.ground = tile(g => masonry(g, G, true));       // exposed top surface
  S.groundFill = tile(g => masonry(g, G, false));  // buried interior
  /* Bricks are breakable and must never be mistaken for terrain, so they get the
     same coursing in a distinctly darker, redder palette plus a hard bottom
     edge. Before this they were within a few percent of the ground colour. */
  S.brick = tile(g => {
    masonry(g, B, false);
    g.fillStyle = B.lo; g.fillRect(0, 15, 16, 1);
  });
  S.qblock = tile(g => {
    g.fillStyle = '#F8B800'; g.fillRect(0,0,16,16);
    g.fillStyle = '#F8D878'; g.fillRect(1,1,14,2); g.fillRect(1,1,2,14);
    g.fillStyle = '#8C5A0F'; g.fillRect(14,1,2,14); g.fillRect(1,14,14,2);
    // "?" drawn twice: dark offset first, then light, so the glyph reads at 16px
    g.fillStyle = '#8C5A0F';
    g.fillRect(6,4,6,2); g.fillRect(5,6,2,2); g.fillRect(11,6,2,3);
    g.fillRect(9,9,2,2); g.fillRect(8,11,2,1); g.fillRect(8,13,2,2);
    g.fillStyle = '#FFF';
    g.fillRect(5,3,6,2); g.fillRect(4,5,2,2); g.fillRect(10,5,2,3);
    g.fillRect(8,8,2,2); g.fillRect(7,10,2,2); g.fillRect(7,12,2,2);
    g.fillStyle = '#FFF3C0';
    g.fillRect(2,2,2,2); g.fillRect(12,2,2,2); g.fillRect(2,12,2,2); g.fillRect(12,12,2,2);
  });
  S.used = tile(g => {
    g.fillStyle = U.base; g.fillRect(0,0,16,16);
    g.fillStyle = U.lo;   g.fillRect(1,1,14,2); g.fillRect(1,1,2,14); g.fillRect(14,1,2,14); g.fillRect(1,14,14,2);
    g.fillStyle = U.hi;   g.fillRect(3,4,10,2); g.fillRect(3,10,10,2);
  });
  S.pipeTop = tile(g => {
    g.fillStyle = P.base; g.fillRect(0,0,16,16);
    g.fillStyle = P.hi;   g.fillRect(1,0,2,16); g.fillRect(0,0,16,2);
    g.fillStyle = P.lo;   g.fillRect(13,0,3,16); g.fillRect(0,14,16,2); g.fillRect(15,0,1,16);
  });
  S.pipeBody = tile(g => {
    g.fillStyle = P.base; g.fillRect(0,0,16,16);
    g.fillStyle = P.hi;   g.fillRect(1,0,2,16);
    g.fillStyle = P.lo;   g.fillRect(13,0,3,16); g.fillRect(15,0,1,16);
  });
  S.pole = tile(g => {
    g.fillStyle = P.lo;   g.fillRect(6, 0, 4, 16);
    g.fillStyle = P.base; g.fillRect(7, 0, 2, 16);
    g.fillStyle = P.hi;   g.fillRect(7, 0, 1, 16);
  });
  S.cloud    = makeSprite(CLOUD_ART, th.cloud, 'cloud');
  S.cloudBig = makeSprite(CLOUD_BIG_ART, th.cloud, 'cloudBig');
  S.hill     = makeSprite(HILL_ART, th.hill, 'hill');
  S.hillBig  = makeSprite(HILL_BIG_ART, th.hill, 'hillBig');
  S.mountain = makeSprite(MTN_ART, th.mtn, 'mountain');
  S.bush     = makeSprite(BUSH_ART, th.bush, 'bush');
  S.bushBig  = makeSprite(BUSH_BIG_ART, th.bush, 'bushBig');
  return S;
}
/* CAVERN is the bonus-room palette, not a course theme: course themes rotate over
   `(lv - 1) % 3` and only ever reach index 2, so appending a fourth entry adds a
   sprite set without touching the rotation. The blue-on-black is the original's
   underground read -- the point of a bonus room is that it looks nothing like the
   surface, so the player knows instantly where they are. */
THEMES.push({
  name: 'CAVERN', sky: ['#03050C', '#080E20', '#0E1734'], stars: 0,
  ground: { base: '#3A5AA8', hi: '#6E92E0', lo: '#1C2C62', seam: '#0A1030' },
  brick:  { base: '#2A46A0', hi: '#4E74D0', lo: '#141F5E', seam: '#070C24' },
  used:   { base: '#2A3050', hi: '#454E78', lo: '#161A30' },
  pipe:   { base: '#2E9A86', hi: '#68D2BC', lo: '#146052' },
  cloud:  { W: '#FFFFFF', w: '#D8E8FF' },
  hill:   { T: '#1E3A7A', t: '#2A4E9E', d: '#12245A' },
  mtn:    { M: '#16224E', m: '#22306A' },
  bush:   { T: '#1E3A7A', t: '#2A4E9E', d: '#12245A' },
  scrim: 'rgba(2,6,18,0.46)'
});
THEMES.push({
  name: 'FORTRESS', sky: ['#0A0608', '#160C10', '#241218'], stars: 0,
  ground: { base: '#5A5560', hi: '#8C8794', lo: '#332F3A', seam: '#171419' },
  brick:  { base: '#6E4A3A', hi: '#9C6E56', lo: '#3E2820', seam: '#1E120C' },
  used:   { base: '#3A3640', hi: '#565160', lo: '#221F28' },
  pipe:   { base: '#7A6A4A', hi: '#B4A074', lo: '#463A26' },
  cloud:  { W: '#FFFFFF', w: '#D8E8FF' },
  hill:   { T: '#2A1E24', t: '#3A2A32', d: '#1A1216' },
  mtn:    { M: '#1E1620', m: '#2A1F2C' },
  bush:   { T: '#2A1E24', t: '#3A2A32', d: '#1A1216' },
  scrim: 'rgba(10,4,8,0.5)'
});
/* Looked up by name, not by `THEMES.length - 1`. Both constants used that form, and
   when the fortress palette was appended after the cavern one they silently became the
   same index -- every bonus room rendered and played the fortress instead. A palette
   whose identity depends on declaration order is a bug waiting for the next append. */
THEMES.push({
  name: 'LAGOON', sky: ['#04283E', '#0A4A6E', '#12729E'], stars: 0,
  ground: { base: '#3E7A6A', hi: '#6EB49E', lo: '#1E4A40', seam: '#0C2620' },
  brick:  { base: '#2A6A8A', hi: '#4E9CC0', lo: '#143E56', seam: '#08202E' },
  used:   { base: '#2A4450', hi: '#456470', lo: '#162630' },
  pipe:   { base: '#2E9A86', hi: '#68D2BC', lo: '#146052' },
  cloud:  { W: '#CFF0FF', w: '#9FD0EE' },
  hill:   { T: '#1E5A54', t: '#2A7A70', d: '#123E3A' },
  mtn:    { M: '#123A52', m: '#1C5272' },
  bush:   { T: '#1E5A54', t: '#2A7A70', d: '#123E3A' },
  scrim: 'rgba(2,14,26,0.42)'
});
const COURSE_THEMES = 3;                  // MEADOW / SUNSET / MIDNIGHT rotate over courses
const CAVERN_THEME = THEMES.findIndex(t => t.name === 'CAVERN');
const LAGOON_THEME = THEMES.findIndex(t => t.name === 'LAGOON');
const FORTRESS_THEME = THEMES.findIndex(t => t.name === 'FORTRESS');
const TSPR = THEMES.map(buildThemeSprites);
function theme() { return TSPR[GAME.theme || 0]; }

/* ---------- heroes ----------
   The heroes used to be hand-plotted pixel grids, which capped them at a coarse
   dot look no amount of shading could soften. They are now drawn from curves at
   HERO_SS times the on-screen size and blitted with smoothing on, so the cast
   reads as rounded, cute characters while the terrain stays true pixel art.
   A hero is a colour config plus a body kind, and a pose is a set of limb
   offsets -- no per-frame art to keep in sync. */
const HERO_SS = 4;
const PLAYER_STATES = ['stand', 'walk1', 'walk2', 'jump', 'skid'];
/* a -> b -> c -> b scissor cycle reads as a run */
const WALK_CYCLE = ['stand', 'walk1', 'walk2', 'walk1'];

const CHARS = [
  { name: 'PIP', speed: 1.00, jump: 1.00, kind: 'boy',
    blurb: 'CAP BOY',
    skin: '#FFD8B4', skinShade: '#E8B78C', hair: '#4A3120',
    top: '#2BA8A0', topShade: '#1B7C76', bottom: '#E86A28', bottomShade: '#B84A14',
    shoe: '#3A2A20', accent: '#FFD84A' },
  { name: 'MOCHI', speed: 1.12, jump: 0.96, kind: 'girl',
    blurb: 'TWIN TAIL',
    skin: '#FFE2C6', skinShade: '#EEBF9C', hair: '#F58BB4',
    top: '#FFF4F8', topShade: '#E0CAD4', bottom: '#E8558E', bottomShade: '#B62F65',
    shoe: '#B03A66', accent: '#FFD84A' },
  { name: 'BOLT', speed: 0.94, jump: 1.05, kind: 'cat',
    blurb: 'CAT HOOD',
    skin: '#FFD8B4', skinShade: '#E8B78C', hair: '#FFC24A',
    top: '#7C5AD0', topShade: '#54388F', bottom: '#3A2878', bottomShade: '#241653',
    shoe: '#1E1442', accent: '#FF6A6A' }
];

/* limb offsets per pose, in logical px */
const POSES = {
  stand: { front: 0.0, back: 0.0, armF: 0.0, armB: 0.0, bob: 0.0, lean: 0.0 },
  walk1: { front: -0.8, back: 0.8, armF: -0.7, armB: 0.7, bob: 0.5, lean: 0.0 },
  walk2: { front: 1.7, back: -1.5, armF: 1.0, armB: -1.0, bob: 0.0, lean: 0.1 },
  jump: { front: 1.3, back: -1.7, armF: -1.9, armB: -1.6, bob: -0.4, lean: 0.15 },
  skid: { front: 2.2, back: -1.4, armF: 1.7, armB: 1.3, bob: 0.0, lean: -0.5 }
};

const OUTLINE = 'rgba(24,16,30,0.92)';

function heroColors(h, variant) {
  if (variant === 'fire') {
    return { skin: h.skin, skinShade: h.skinShade, hair: '#FFF2E2',
             top: '#FFFFFF', topShade: '#D8D8DC', bottom: '#E03A18', bottomShade: '#9C2008',
             shoe: '#5A1206', accent: '#FFD84A' };
  }
  if (variant && variant.star !== undefined) {
    const s = variant.star;
    return { skin: h.skin, skinShade: h.skinShade, hair: s.hair,
             top: s.top, topShade: s.topShade, bottom: s.bottom, bottomShade: s.bottomShade,
             shoe: s.shoe, accent: s.accent };
  }
  return h;
}

const STAR_LOOKS = [
  { hair: '#FFE36A', top: '#FFD84A', topShade: '#C79A0E', bottom: '#FF5AA0', bottomShade: '#C22A6C', shoe: '#8A1C4C', accent: '#FFFFFF' },
  { hair: '#FFB0D0', top: '#FF5AA0', topShade: '#C22A6C', bottom: '#FFD84A', bottomShade: '#C79A0E', shoe: '#8A6A0A', accent: '#FFFFFF' },
  { hair: '#B0E6FF', top: '#4AC8FF', topShade: '#1A80B8', bottom: '#FFD84A', bottomShade: '#C79A0E', shoe: '#0E5478', accent: '#FFFFFF' }
];

/* one blob helper: filled ellipse with an outline, the shape everything is made of */
function blob(g, x, y, rx, ry, fill, lw) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (lw) { g.lineWidth = lw; g.strokeStyle = OUTLINE; g.stroke(); }
  g.fillStyle = fill; g.fill();
}
function limb(g, x0, y0, x1, y1, w, fill, lw) {
  g.lineCap = 'round';
  g.lineWidth = w + lw * 1.8; g.strokeStyle = OUTLINE;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.lineWidth = w; g.strokeStyle = fill;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}

function paintHero(g, h, big, poseName, variant) {
  const P = POSES[poseName] || POSES.stand;
  const c = heroColors(h, variant);
  const H = big ? 30 : 16;
  const cx = big ? 8 : 7;      // centre of the frame, which is 2px wider when big
  /* Every measurement is size-aware, and the big form grows all over rather than
     only downward. Holding the head near its small radius while the frame went
     16 -> 30 tall produced a stretched stick: the mushroom looked like it pulled
     the torso and legs like taffy instead of making the hero bigger. The head,
     torso and limbs now all scale, and the legs take a smaller share of the extra
     height than the body does. */
  /* Proportions were retuned against a measured contact sheet. The head now takes
     36% of the big frame instead of 31%, the torso 37% instead of 41%, so a grown
     hero is the same character at a larger size rather than a different, older
     one. Arms reach the hip line again after the shoulders moved down. */
  const headR = big ? 5.3 : 3.4;
  const lw = big ? 0.95 : 0.7;          // outline weight
  const armW = big ? 2.5 : 1.7;
  const legW = big ? 2.9 : 1.9;
  const torsoRX = big ? 4.2 : 2.9;
  const headCY = headR + 0.7 + P.bob * 0.5;
  const shoulderY = headCY + headR * 0.92;
  const hipY = big ? 21.7 : 11.9;
  const footY = H - 0.9;
  const armLen = big ? 7.6 : 3.6;

  g.save();
  /* The skid pose leans the whole figure back by half a pixel. On the big frame
     that was enough to push MOCHI's ponytail through the left edge, so the lean is
     scaled to the room the frame actually has. */
  g.translate(P.lean * (big ? 0.5 : 1), 0);

  // ---- trailing leg and arm first, so they read as the far side ----
  limb(g, cx - 1.5, hipY, cx - 1.5 + P.back, footY - 1.0, legW, c.bottomShade, lw);
  blob(g, cx - 1.5 + P.back - 0.3, footY - 0.4, big ? 2.0 : 1.7, big ? 1.15 : 1.0, c.shoe, lw);
  limb(g, cx - torsoRX + 0.3, shoulderY + 0.5,
       cx - torsoRX - 0.6 + P.armB * 0.5, shoulderY + armLen + P.armB, armW, c.topShade, lw);

  // ---- leading leg ----
  limb(g, cx + 1.5, hipY, cx + 1.5 + P.front, footY - 1.0, legW, c.bottom, lw);
  blob(g, cx + 1.5 + P.front + 0.3, footY - 0.4, big ? 2.1 : 1.8, big ? 1.2 : 1.05, c.shoe, lw);

  // ---- torso ----
  const torsoTop = shoulderY - 0.5, torsoBot = hipY + 0.5;
  blob(g, cx, (torsoTop + torsoBot) / 2, torsoRX, (torsoBot - torsoTop) / 2, c.top, lw);
  if (h.kind === 'girl') {
    const skirtTop = hipY - (big ? 4.6 : 2.6);
    g.beginPath();
    g.moveTo(cx - torsoRX + 0.4, skirtTop);
    g.lineTo(cx + torsoRX - 0.4, skirtTop);
    g.lineTo(cx + torsoRX + 1.5, hipY + 1.0);
    g.lineTo(cx - torsoRX - 1.5, hipY + 1.0);
    g.closePath();
    g.lineWidth = lw; g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = c.bottom; g.fill();
  } else {
    g.fillStyle = c.accent;
    g.fillRect(cx - 1.2, hipY - (big ? 3.2 : 1.7), 2.4, big ? 1.4 : 1.0);
  }

  // ---- leading arm, outside the torso outline so it stays visible ----
  limb(g, cx + torsoRX - 0.3, shoulderY + 0.5,
       cx + torsoRX + 0.6 + P.armF * 0.5, shoulderY + armLen + P.armF, armW, c.top, lw);

  // ---- head ----
  blob(g, cx, headCY, headR, headR * 0.95, c.skin, lw + 0.15);

  // hair or headgear, always heavier on the trailing side so the silhouette
  // itself says which way the hero faces
  if (h.kind === 'boy') {
    g.beginPath();
    g.ellipse(cx - 0.2, headCY - headR * 0.36, headR * 1.03, headR * 0.72, 0, Math.PI, Math.PI * 2);
    g.closePath();
    g.lineWidth = lw; g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = c.top; g.fill();
    /* Headgear offsets are a share of headR, so a bigger head pushed them past the
       frame edge. The big form uses tighter shares -- the silhouette still reads
       the same, and nothing gets sliced off by the canvas. */
    blob(g, cx + headR * (big ? 0.76 : 0.9), headCY - headR * 0.28,
         headR * (big ? 0.5 : 0.6), headR * 0.22, c.topShade, lw);
    blob(g, cx - headR * 0.78, headCY + headR * 0.3, headR * 0.36, headR * 0.44, c.hair, lw);
  } else if (h.kind === 'girl') {
    // one full side ponytail trailing behind, plus a bow on the leading side
    blob(g, cx - headR * (big ? 0.84 : 1.05), headCY + headR * 0.45,
         headR * (big ? 0.45 : 0.52), headR * 0.9, c.hair, lw);
    g.beginPath();
    g.ellipse(cx, headCY - headR * 0.28, headR * 1.02, headR * 0.68, 0, Math.PI, Math.PI * 2);
    g.closePath();
    g.lineWidth = lw; g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = c.hair; g.fill();
    blob(g, cx + headR * (big ? 0.56 : 0.62), headCY - headR * 0.66,
         headR * (big ? 0.3 : 0.34), headR * 0.3, c.accent, lw);
  } else {
    blob(g, cx - headR * 0.52, headCY - headR * 0.9, headR * 0.4, headR * 0.5, c.top, lw);
    blob(g, cx + headR * 0.54, headCY - headR * 0.9, headR * 0.4, headR * 0.5, c.top, lw);
    g.beginPath();
    g.ellipse(cx, headCY - headR * 0.26, headR * 1.03, headR * 0.7, 0, Math.PI, Math.PI * 2);
    g.closePath();
    g.lineWidth = lw; g.strokeStyle = OUTLINE; g.stroke();
    g.fillStyle = c.top; g.fill();
    blob(g, cx + headR * 0.22, headCY - headR * 0.08, headR * 0.66, headR * 0.26, c.hair, 0);
  }

  // ---- face ----
  const eyeY = headCY + headR * 0.26;
  const eR = headR * (big ? 0.3 : 0.32);
  for (const ex of [cx - headR * 0.42, cx + headR * 0.46]) {
    blob(g, ex, eyeY, eR, eR * 1.12, '#241C2E', 0);
    g.fillStyle = '#FFFFFF';
    g.beginPath(); g.ellipse(ex + eR * 0.32, eyeY - eR * 0.44, eR * 0.44, eR * 0.44, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(255,120,150,0.55)';
  g.beginPath(); g.ellipse(cx + headR * 0.95, eyeY + eR * 1.15, headR * 0.24, headR * 0.15, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3A2434'; g.lineWidth = lw * 0.8; g.lineCap = 'round';
  g.beginPath();
  g.arc(cx + headR * 0.05, eyeY + headR * 0.42, headR * 0.26, 0.18 * Math.PI, 0.82 * Math.PI);
  g.stroke();

  g.restore();
}

function heroSprite(h, big, pose, variant) {
  /* The big frame is 2px wider than the small one. drawPlayerSprite centres the
     sprite on the hero's collision box, so a wider canvas costs nothing in
     gameplay terms -- and 14px was clipping MOCHI's ponytail against the left edge
     (its outer edge sits at cx - 1.29 * headR). 16 is the ceiling, not a free
     choice: the sprite overhangs the 12px collision box by half its excess, so an
     18px frame would visibly push 3px into a wall the hero is standing against. */
  const W = big ? 16 : 14, H = big ? 30 : 16, S = HERO_SS;
  const c = document.createElement('canvas');
  c.width = W * S; c.height = H * S;
  const g = c.getContext('2d');
  g.scale(S, S);
  g.lineJoin = 'round';
  paintHero(g, h, big, pose, variant);
  c.lw = W; c.lh = H;      // logical footprint; the canvas itself is supersampled
  return c;
}
function buildHeroSet(h, variant) {
  const s = {};
  for (const st of PLAYER_STATES) {
    s[st] = { small: heroSprite(h, false, st, variant), big: heroSprite(h, true, st, variant) };
  }
  return s;
}
const CHAR_SPR = CHARS.map(h => buildHeroSet(h, null));
const FIRE_SPR = CHARS.map(h => buildHeroSet(h, 'fire'));
/* star mode: same shapes, cycling outfit; built off the first hero's skin so all
   three read identically while invincible, as in the original */
const STAR_SPR = STAR_LOOKS.map(look => buildHeroSet(CHARS[0], { star: look }));


/* ---------- sound ---------- */
/* ---------- audio ----------
   Every tone used to connect straight to the destination with an instant gain
   jump: no master level, so overlapping voices clipped, and no attack ramp, so
   each note started with a click. There is now a master bus with separate music
   and sfx gains (which lets a jingle duck the music), a short attack/release on
   every voice, and a real noise channel for percussion -- a sawtooth is a poor
   stand-in for a brick shattering. */
const Sound = {
  ctx: null, muted: false, master: null, musicBus: null, sfxBus: null, noiseBuf: null,
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = 1;
      this.sfxBus = this.ctx.createGain(); this.sfxBus.gain.value = 1;
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      // one second of white noise, reused by every percussive hit
      const sr = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, sr, sr);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    // browsers start the context suspended until a real gesture unlocks it
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'square', vol = 0.12, delay = 0, slide = 0, bus) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + Math.max(0, delay);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    // 4ms attack kills the click, then an exponential tail
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  },
  /* filtered noise burst: the percussive half of the NES palette */
  noise(dur, vol = 0.12, delay = 0, cutoff = 1800, sweepTo = 0, bus) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + Math.max(0, delay);
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.setValueAtTime(cutoff, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    f.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus || this.sfxBus);
    src.start(t); src.stop(t + dur + 0.02);
  },
  /* pull the music down while a jingle plays, then bring it back */
  duck(seconds) {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime, g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.12, t + 0.04);
    g.linearRampToValueAtTime(1, t + seconds);
  },

  jump()     { this.tone(320, 0.18, 'square', 0.10, 0, 380); },
  land()     { this.noise(0.07, 0.07, 0, 420, 180); },
  coin()     { this.tone(988, 0.07, 'square', 0.11); this.tone(1319, 0.32, 'square', 0.12, 0.07); },
  stomp()    { this.noise(0.09, 0.15, 0, 900, 220); this.tone(200, 0.09, 'triangle', 0.13, 0, -110); },
  bump()     { this.tone(110, 0.07, 'square', 0.13); this.noise(0.05, 0.06, 0, 300, 140); },
  breakB()   { this.noise(0.20, 0.20, 0, 2600, 260); this.tone(150, 0.14, 'square', 0.09, 0.01, -80); },
  emerge()   { this.tone(392, 0.10, 'triangle', 0.09, 0, 260); },
  // time up: two falling notes, so running out is heard before it is seen
  timeUp()   { this.duck(1.0); [523, 330].forEach((f, i) => this.tone(f, 0.22, 'square', 0.11, i * 0.16)); },
  // world complete: a longer flourish than a course fanfare
  worldDone() {
    this.duck(2.2);
    [523, 659, 784, 1047, 988, 1047, 1319].forEach((f, i) => this.tone(f, 0.16, 'square', 0.11, i * 0.13));
    [131, 165, 196, 262].forEach((f, i) => this.tone(f, 0.24, 'triangle', 0.08, i * 0.22));
  },
  // the boss: a low growl on sight, a heavier one when it lands
  roar()     { this.tone(78, 0.42, 'sawtooth', 0.12, 0, -22); this.noise(0.3, 0.10, 0, 340, 120); },
  // the bridge going out from under it
  collapse() { this.duck(2.0); this.noise(0.7, 0.20, 0, 900, 90);
               [196, 165, 131, 98, 78].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.10, i * 0.12)); },
  // checkpoint: a short rising pair, distinct from the coin and the powerup
  checkpoint() { [659, 988].forEach((f, i) => this.tone(f, 0.13, 'triangle', 0.11, i * 0.09));
                 this.noise(0.06, 0.05, 0, 2400, 900); },
  power()    { [523,659,784,1047,1319].forEach((f,i)=>this.tone(f,0.09,'square',0.10,i*0.06)); },
  grow()     { [392,523,659,784].forEach((f,i)=>this.tone(f,0.10,'square',0.10,i*0.08)); },
  pipe()     { [784,659,523,392].forEach((f,i)=>this.tone(f,0.12,'square',0.10,i*0.09)); },
  kick()     { this.tone(300, 0.08, 'square', 0.11, 0, 200); this.noise(0.05, 0.07, 0, 1400, 500); },
  fireball() { this.tone(700, 0.12, 'square', 0.10, 0, -400); this.noise(0.08, 0.05, 0, 2200, 900); },
  shrink()   { [784,659,523,392].forEach((f,i)=>this.tone(f,0.12,'square',0.10,i*0.09)); },
  flag()     { [392,494,587,784,988,1175,1568,1976].forEach((f,i)=>this.tone(f,0.09,'square',0.10,i*0.07)); },
  oneUp()    { this.duck(1.1); [988,1319,1568,1175,1319,1568].forEach((f,i)=>this.tone(f,0.11,'square',0.11,i*0.08)); },
  die()      { this.duck(1.6); [660,622,587,494,392,330,262,196].forEach((f,i)=>this.tone(f,0.14,'square',0.11,i*0.11)); },
  /* Course clear needed its own cadence: the flag chime already plays when you
     touch the pole, so reaching the castle had no musical resolution at all. */
  fanfare()  {
    this.duck(1.4);
    [[523,0],[659,0.10],[784,0.20],[1047,0.30],[1319,0.42],[1047,0.56],[1319,0.66],[1568,0.78]]
      .forEach(([f,d]) => { this.tone(f, 0.20, 'square', 0.10, d); this.tone(f/2, 0.20, 'triangle', 0.07, d); });
  },
  /* the run out of time deserves a warning; there was none */
  hurry()    {
    this.duck(0.9);
    [[1047,0],[1047,0.12],[1319,0.24],[1047,0.40],[784,0.52]]
      .forEach(([f,d]) => this.tone(f, 0.11, 'square', 0.11, d));
  },
  gameOver() {
    [[523,0],[494,0.16],[440,0.32],[392,0.48],[262,0.68]]
      .forEach(([f,d]) => { this.tone(f, 0.28, 'triangle', 0.12, d); this.tone(f/2, 0.28, 'square', 0.06, d); });
  },
  /* The card already turns the top row gold and blinks NEW RECORD; the descending
     gameOver() motif that plays first has nothing to say about that. A short bright
     triad, delayed 1s so it lands after the descent finishes instead of fighting it --
     not oneUp's run (that means a life) and not fanfare's full length (that is the
     course-clear reward, a bigger moment than any one run's placement). */
  record() {
    [[784,0],[988,0.09],[1319,0.18]].forEach(([f,d]) => this.tone(f, 0.16, 'square', 0.11, 1.0 + d));
  }
};
/* ---------- original chiptune tracks ----------
   One loop used to play on every course, so all three themes sounded the same.
   Each theme now has its own 32-step track with its own key, tempo and voices. */
const TRACKS = [
  { // MEADOW -- A minor pentatonic, bright square lead. A section then a lift to the 5th.
    name: 'MEADOW', tempo: 0.20, leadWave: 'square', bassWave: 'triangle',
    lead: [440,0,523,587,659,0,587,523, 587,0,659,784,659,587,523,0,
           440,0,523,587,659,784,880,784, 659,587,523,880,784,659,523,0,
           659,0,784,880,988,0,880,784, 880,0,988,1175,988,880,784,0,
           659,0,784,880,988,1175,1319,1175, 988,880,784,659,587,523,440,0],
    bass: [110,0,110,0,110,0,110,0, 87,0,87,0,87,0,87,0,
           131,0,131,0,131,0,131,0, 98,0,98,0,98,0,98,0,
           165,0,165,0,165,0,165,0, 131,0,131,0,131,0,131,0,
           196,0,196,0,147,0,147,0, 110,0,110,0,110,0,110,0],
    drum: [1,0,2,0,3,0,2,0, 1,0,2,0,3,0,2,2,
           1,0,2,0,3,0,2,0, 1,0,2,0,3,2,2,2,
           1,0,2,0,3,0,2,0, 1,0,2,0,3,0,2,2,
           1,0,2,0,3,0,2,0, 1,1,2,0,3,2,2,2]
  },
  { // SUNSET -- slower, D dorian, warmer triangle lead; the B section drops an octave
    name: 'SUNSET', tempo: 0.24, leadWave: 'triangle', bassWave: 'triangle',
    lead: [587,0,698,0,784,880,784,698, 659,0,587,0,523,587,659,0,
           784,0,880,0,988,880,784,698, 659,587,523,0,587,659,587,0,
           392,0,440,0,523,587,523,440, 392,0,349,0,392,440,523,0,
           587,0,523,0,494,440,392,349, 392,0,440,523,587,0,0,0],
    bass: [ 73,0, 73,0, 98,0, 98,0, 110,0,110,0, 87,0, 87,0,
           73,0, 73,0, 98,0, 98,0, 65,0, 65,0, 73,0, 73,0,
           49,0, 49,0, 65,0, 65,0, 73,0, 73,0, 58,0, 58,0,
           49,0, 49,0, 65,0, 73,0, 98,0, 98,0, 73,0, 73,0],
    drum: [1,0,0,0,3,0,0,0, 1,0,0,2,3,0,0,0,
           1,0,0,0,3,0,0,0, 1,0,0,2,3,0,2,0,
           1,0,0,0,3,0,0,0, 1,0,0,0,3,0,0,0,
           1,0,0,0,3,0,2,0, 1,0,2,0,3,0,0,0]
  },
  { // MIDNIGHT -- sparse, E natural minor, low sawtooth pulse; B section doubles the pulse
    name: 'MIDNIGHT', tempo: 0.22, leadWave: 'square', bassWave: 'sawtooth',
    lead: [659,0,0,784,659,0,587,0, 494,0,0,587,494,0,440,0,
           659,0,784,988,880,0,784,0, 659,0,587,494,440,0,494,0,
           988,0,0,880,988,0,1175,0, 988,0,0,880,784,0,659,0,
           587,0,659,784,880,0,988,0, 1175,0,988,880,784,0,659,0],
    bass: [ 82,0, 0,0, 82,0, 0,0, 65,0, 0,0, 65,0, 0,0,
            98,0, 0,0, 98,0, 0,0, 73,0, 0,0, 73,0, 0,0,
            82,0,82,0, 82,0,82,0, 65,0,65,0, 65,0,65,0,
            98,0,98,0, 98,0,98,0, 73,0,73,0, 73,73,73,0],
    drum: [1,0,0,0,0,0,3,0, 1,0,0,0,0,0,3,0,
           1,0,0,0,0,0,3,0, 1,0,0,2,0,0,3,2,
           1,0,2,0,3,0,2,0, 1,0,2,0,3,0,2,0,
           1,0,2,0,3,0,2,0, 1,1,2,0,3,2,2,2]
  },
  { /* CAVERN -- the bonus room. Fast, tight, and short: it is a place you are in for
       fifteen seconds, so the B section is just the A section a fourth higher. */
    name: 'CAVERN', tempo: 0.14, leadWave: 'square', bassWave: 'triangle',
    lead: [523,0,523,0,392,0,392,0, 330,0,330,392,523,0,392,0,
           587,0,587,0,440,0,440,0, 349,0,349,440,587,0,440,0,
           698,0,698,0,523,0,523,0, 440,0,440,523,698,0,523,0,
           784,0,784,0,587,0,587,0, 466,0,466,587,784,0,587,0],
    bass: [131,0,131,0,131,0,131,0, 98,0,98,0,98,0,98,0,
           147,0,147,0,147,0,147,0, 110,0,110,0,110,0,110,0,
           175,0,175,0,175,0,175,0, 131,0,131,0,131,0,131,0,
           196,0,196,0,196,0,196,0, 147,0,147,0,147,0,147,0],
    drum: [1,2,2,2,1,2,2,2, 1,2,2,2,1,2,2,2,
           1,2,2,2,1,2,2,2, 1,2,2,2,1,2,2,2,
           1,2,2,2,1,2,2,2, 1,2,2,2,1,2,2,2,
           1,2,2,2,1,2,2,2, 1,2,2,2,1,2,3,3]
  },
  { /* FORTRESS -- minor second in the bass, no resolution in the lead. The B section
       climbs and still refuses to land. */
    name: 'FORTRESS', tempo: 0.19, leadWave: 'square', bassWave: 'sawtooth',
    lead: [415,0,392,0,311,0,0,0, 415,0,392,0,311,0,262,0,
           466,0,415,0,349,0,0,0, 466,0,415,0,349,0,311,0,
           523,0,466,0,415,0,0,0, 523,0,466,0,415,0,392,0,
           622,0,554,0,466,0,415,0, 392,0,349,0,311,0,0,0],
    bass: [ 52,0, 55,0, 52,0, 55,0, 52,0, 55,0, 52,0, 55,0,
            58,0, 62,0, 58,0, 62,0, 58,0, 62,0, 58,0, 62,0,
            65,0, 69,0, 65,0, 69,0, 65,0, 69,0, 65,0, 69,0,
            78,0, 82,0, 78,0, 82,0, 52,0, 55,0, 52,0, 55,0],
    drum: [1,0,0,0,1,0,0,0, 1,0,0,0,1,0,3,0,
           1,0,0,0,1,0,0,0, 1,0,0,0,1,0,3,3,
           1,0,3,0,1,0,3,0, 1,0,3,0,1,0,3,0,
           1,1,3,0,1,1,3,0, 1,1,3,3,1,1,3,3]
  },
  { /* LAGOON -- slow, wide intervals, triangle everywhere. The B section sinks a third
       and the percussion thins to a heartbeat: nothing down here is urgent. */
    name: 'LAGOON', tempo: 0.28, leadWave: 'triangle', bassWave: 'triangle',
    lead: [392,0,0,0,523,0,0,0, 587,0,0,659,523,0,0,0,
           440,0,0,0,587,0,0,0, 659,0,0,784,587,0,0,0,
           349,0,0,0,440,0,0,0, 523,0,0,587,440,0,0,0,
           392,0,0,0,523,0,0,0, 587,0,659,784,880,0,0,0],
    bass: [ 98,0, 0,0, 98,0, 0,0, 131,0, 0,0, 131,0, 0,0,
           110,0, 0,0, 110,0, 0,0, 147,0, 0,0, 147,0, 0,0,
            87,0, 0,0, 87,0, 0,0, 110,0, 0,0, 110,0, 0,0,
            98,0, 0,0, 98,0, 0,0, 131,0, 0,0, 147,0, 0,0],
    drum: [1,0,0,0,0,0,0,0, 1,0,0,0,0,0,2,0,
           1,0,0,0,0,0,0,0, 1,0,0,0,0,0,2,0,
           1,0,0,0,0,0,0,0, 1,0,0,0,0,0,0,0,
           1,0,0,0,0,0,2,0, 1,0,0,0,3,0,2,0]
  }
];

const BGM = {
  playing: false, timer: null, step: 0, nextTime: 0, trackIdx: 0,
  track() { return TRACKS[this.trackIdx] || TRACKS[0]; },
  /* Switching tracks mid-level would cut a note off, so a change only takes
     effect the next time the loop is started. */
  select(i) {
    if (i === this.trackIdx) return;
    this.trackIdx = i;
    if (this.playing) { this.stop(); this.start(); }
  },
  start() {
    if (this.playing || !Sound.ctx) return;
    this.playing = true; this.step = 0;
    this.nextTime = Sound.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.tick(), 40);
  },
  stop() { this.playing = false; if (this.timer) clearInterval(this.timer); this.timer = null; },
  tick() {
    if (!Sound.ctx) return;
    const t = this.track();
    /* A throttled or backgrounded tab leaves nextTime far in the past, and the
       catch-up loop below then schedules every missed step at once: measured 197
       notes in a single tick after 30 seconds away, against 2 in a healthy one.
       That lands as one clipped blast the moment the player comes back. Too far
       behind to be music, so drop the debt and start the phrase again -- the same
       discipline the fixed-timestep loop uses for its own catch-up. */
    const now = Sound.ctx.currentTime;
    if (this.nextTime < now - 0.5) { this.nextTime = now + 0.06; this.step = 0; }
    while (this.nextTime < Sound.ctx.currentTime + 0.16) {
      const s = this.step % t.lead.length;      // the track decides how long its loop is
      const d = this.nextTime - Sound.ctx.currentTime;
      if (t.lead[s]) Sound.tone(t.lead[s], 0.16, t.leadWave, 0.04, d, 0, Sound.musicBus);
      if (t.bass[s]) Sound.tone(t.bass[s], 0.3, t.bassWave, 0.11, d, 0, Sound.musicBus);
      /* Percussion on the music bus, so a jingle ducks the drums with everything else.
         1 = kick (low, short sweep down), 2 = hat (bright and clipped), 3 = snare. */
      const dr = t.drum && t.drum[s];
      if (dr === 1) Sound.noise(0.085, 0.085, d, 190, 90, Sound.musicBus);
      else if (dr === 2) Sound.noise(0.035, 0.030, d, 6200, 4200, Sound.musicBus);
      else if (dr === 3) Sound.noise(0.075, 0.055, d, 1500, 700, Sound.musicBus);
      this.nextTime += t.tempo;
      this.step++;
    }
  }
};

/* ---------- input ---------- */
const keys = {};
window.addEventListener('keydown', e => {
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
  const k = normKey(e); keys[k] = true;
  if (e.repeat) return;
  Sound.init();
  onKeyPress(k);
});
window.addEventListener('keyup', e => { keys[normKey(e)] = false; });
function normKey(e) {
  switch (e.key) {
    case 'ArrowLeft': case 'a': case 'A': return 'left';
    case 'ArrowRight': case 'd': case 'D': return 'right';
    case 'ArrowUp': case 'w': case 'W': case 'x': case 'X': case ' ': return 'jump';
    case 'z': case 'Z': case 'Shift': return 'run';
    case 'f': case 'F': case 'k': case 'K': return 'fire';
    case 'Enter': return 'start';
    case 'm': case 'M': return 'mute';
    case 'b': case 'B': return 'bgm';
    case 'p': case 'P': case 'Escape': return 'pause';
    default: return e.key.toLowerCase();
  }
}

/* ---------- level building (3 rotating layouts) ---------- */
function buildLevel(lv) {
  const variant = (lv - 1) % 3;
  const W = 224, H = 15;
  const map = Array.from({ length: H }, () => Array(W).fill(' '));
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) map[y][x] = c; };
  for (let x = 0; x < W; x++) { map[13][x] = 'X'; map[14][x] = 'X'; }
  const gap = (a, b) => { for (let x=a; x<=b; x++) { map[13][x]=' '; map[14][x]=' '; } };
  const blk = (x,y,c='?') => set(x,y,c);
  const pipe = (x,h) => { set(x,13-h,'T'); set(x+1,13-h,'T'); for (let y=14-h;y<=12;y++){ set(x,y,'P'); set(x+1,y,'P'); } };
  const enemies = [];
  const P = (x) => enemies.push({ type:'puff', x: x*TILE, y: 13*TILE - 12, w:12, h:12, vx:-0.45, vy:0, t:0 });
  const S = (x) => enemies.push({ type:'shelly', x: x*TILE, y: 13*TILE - 16, w:12, h:16, vx:-0.35, vy:0, t:0 });

  if (variant === 0) {
    gap(69,70); gap(86,88); gap(153,155);
    blk(16,9);
    blk(20,9,'B'); blk(21,9,'M'); blk(22,9); blk(23,9,'B'); blk(24,9);
    blk(20,5,'B'); blk(21,5); blk(22,5,'B'); blk(23,5); blk(24,5,'B');
    pipe(28,2); pipe(38,3); pipe(46,4); pipe(57,4);
    blk(77,9,'B'); blk(78,9,'M'); blk(79,9,'B');
    blk(80,5); blk(83,5);
    blk(84,9,'B'); blk(85,9,'F'); blk(86,9,'B'); blk(87,9,'B');
    blk(91,5,'B'); blk(92,5); blk(93,5,'B'); blk(94,5);
    blk(92,9,'B'); blk(93,9); blk(94,9,'B');
    blk(95,9); blk(96,9); blk(98,5);
    blk(100,9,'B'); blk(101,9);
    blk(106,9,'B'); blk(107,9,'B'); blk(108,9,'B'); blk(109,9,'B'); blk(110,9,'B');
    blk(109,5);
    blk(118,9,'B'); blk(119,9); blk(120,9,'B');
    blk(121,5);
    blk(122,9); blk(123,9,'B'); blk(124,9,'B'); blk(125,9,'B');
    blk(128,9,'B'); blk(129,9,'B'); blk(130,9,'B'); blk(131,9,'B');
    blk(131,5);
    blk(140,9,'B'); blk(141,9,'B'); blk(142,9,'B'); blk(143,9,'B');
    blk(148,9); blk(151,9,'B'); blk(159,9,'B'); blk(162,9,'B');
    blk(169,9,'B'); blk(172,9,'B');
    P(22); P(30); P(31); P(40); P(41);
    P(51); P(52); P(53); P(59); P(61); P(70); P(71);
    S(78); P(88); P(89);
    P(97); P(98); P(107); P(108); P(109); P(110);
    P(114); P(115); P(124); P(125);
    S(134); P(143); P(144); P(145); P(146);
    P(157); P(158); P(159); P(160); P(165); P(166);
    S(168); P(169); P(170);
  } else if (variant === 1) {
    gap(40,41); gap(74,76); gap(120,121);
    blk(12,9,'M'); blk(14,9); blk(15,9,'B'); blk(16,9);
    blk(20,9,'B'); blk(21,9); blk(22,9,'B');
    blk(21,5);
    pipe(26,3); pipe(34,4);
    blk(48,9); blk(49,9,'B'); blk(50,9,'M'); blk(51,9,'B'); blk(52,9);
    blk(50,5);
    pipe(58,2); pipe(64,4);
    blk(70,9,'B'); blk(71,9,'F'); blk(72,9,'B');
    blk(80,9); blk(81,9); blk(82,9);
    blk(81,5,'B');
    blk(90,9,'B'); blk(91,9,'B'); blk(92,9,'B');
    blk(91,5);
    blk(100,9,'M'); blk(102,9,'B'); blk(103,9); blk(104,9,'B');
    pipe(108,3); pipe(116,4);
    blk(126,9); blk(127,9,'B'); blk(128,9);
    blk(127,5,'F');
    blk(136,9,'B'); blk(137,9); blk(138,9,'B');
    pipe(144,2);
    P(15); P(24); P(25); P(38); P(39);
    P(50); P(51); S(56); P(66); P(67);
    P(80); P(81); P(90); P(91); P(92);
    P(101); P(102); S(112);
    P(126); P(127); P(128); P(136); P(137);
  } else {
    gap(30,32); gap(60,62); gap(90,92); gap(130,131);
    blk(14,5,'B'); blk(15,5); blk(16,5,'B');
    blk(14,9,'M'); blk(15,9); blk(16,9,'B');
    pipe(20,2);
    blk(26,5,'B'); blk(27,5); blk(28,5,'B');
    blk(27,9,'S');
    blk(34,9); blk(35,9,'B'); blk(36,9,'M'); blk(37,9,'B'); blk(38,9);
    blk(36,5);
    pipe(44,4);
    blk(52,5,'B'); blk(53,5); blk(54,5,'B'); blk(55,5);
    blk(53,9,'F');
    blk(64,9); blk(65,9,'B'); blk(66,9);
    pipe(70,3);
    blk(78,5,'B'); blk(79,5,'S'); blk(80,5,'B');
    blk(78,9,'B'); blk(79,9); blk(80,9,'B');
    blk(88,9); blk(89,9,'B'); blk(90,9); blk(91,9,'B'); blk(92,9);
    blk(89,5); blk(91,5);
    pipe(98,4);
    blk(106,9,'B'); blk(107,9); blk(108,9,'B');
    blk(116,9); blk(117,9,'B'); blk(118,9);
    pipe(124,2);
    blk(134,9,'B'); blk(135,9,'B'); blk(136,9,'B');
    blk(144,9); blk(147,9,'B');
    P(16); P(22); P(23); S(28); P(36); P(37);
    P(48); P(49); S(56); P(65); P(66);
    P(74); P(75); S(82);
    P(88); P(89); P(90); P(91); P(92);
    P(100); P(101); P(108); S(114); P(117); P(118);
    P(135); P(136);
  }

  // shared: stairs, flag, castle
  for (let i=0;i<8;i++) for (let j=0;j<=i;j++) set(181+i, 12-j, 'X');
  for (let i=0;i<8;i++) for (let j=0;j<7-i;j++) set(190+i, 12-j, 'X');
  for (let y=3;y<=12;y++) set(198,y,'f');
  set(198,2,'b');

  const decos = [];
  for (let x = 8; x < W; x += 48) decos.push({ type:'cloud', x: x*TILE, y: 36 });
  for (let x = 32; x < W; x += 48) decos.push({ type:'bush', x: x*TILE, y: 13*TILE - 12 });
  [0, 10, 60, 100, 150].forEach(x => decos.push({ type:'hill', x: x*TILE, y: 13*TILE - 16 }));

  return { map, W, H, enemies, decos, flagX: 198, castleX: 201, timeLimit: 400 };
}

/* ---------- game state ---------- */
const GAME = {
  state: 'title',
  score: 0, coins: 0, lives: 3,
  world: 1, lv: 1,
  time: 400, timeF: 0, frame: 0,
  mario: null, camera: 0, level: null,
  items: [], particles: [], popups: [],
  flagSlide: false, walkDone: false, clearTimer: 0,
  readyTimer: 0, combo: 0, paused: false,
  charIdx: 0, bgmOn: true, shake: 0,
  balls: [], high: 0
};
const COMBO_PTS = [100,200,400,800,1000,2000,4000,5000,8000];
function loadHigh() { try { return parseInt(localStorage.getItem('pipoHigh') || '0', 10) || 0; } catch (e) { return 0; } }
function saveHigh(v) { try { localStorage.setItem('pipoHigh', String(v)); } catch (e) {} }
GAME.high = loadHigh();

function resetMario() {
  const ch = CHARS[GAME.charIdx];
  GAME.mario = {
    x: 3*TILE, y: 13*TILE - 16, w: 12, h: 16,
    vx: 0, vy: 0, onGround: true, facing: 1,
    big: false, fire: false, invuln: 0, growT: 0,
    dead: false, deathTimer: 0, star: 0,
    jumpHeld: false, jumpBuf: 0, coyote: 0,
    state: 'idle', animT: 0, sq: 1
  };
}
function startGame() {
  GAME.score = 0; GAME.coins = 0; GAME.lives = 3; GAME.world = 1; GAME.lv = 1;
  BGM.stop();
  startLevel();
}
function startLevel() {
  GAME.level = buildLevel(GAME.lv);
  GAME.items = []; GAME.particles = []; GAME.popups = [];
  GAME.balls = [];
  GAME.time = GAME.level.timeLimit; GAME.timeF = 0; GAME.combo = 0;
  resetMario();
  GAME.camera = 0;
  GAME.flagSlide = false; GAME.walkDone = false; GAME.clearTimer = 0;
  GAME.readyTimer = 0;
  GAME.state = 'ready';
  if (GAME.bgmOn) BGM.start();
}
function nextLevel() {
  GAME.lv += 1;
  if (GAME.lv > 4) { GAME.lv = 1; GAME.world += 1; }
  startLevel();
}

function onKeyPress(k) {
  if (k === 'mute') { Sound.muted = !Sound.muted; return; }
  if (k === 'bgm') {
    GAME.bgmOn = !GAME.bgmOn;
    if (GAME.bgmOn && (GAME.state === 'play' || GAME.state === 'ready' || GAME.state === 'clear')) BGM.start();
    else BGM.stop();
    return;
  }
  if (GAME.state === 'title') {
    if (k === 'left') GAME.charIdx = (GAME.charIdx + CHARS.length - 1) % CHARS.length;
    else if (k === 'right') GAME.charIdx = (GAME.charIdx + 1) % CHARS.length;
    if (k === 'start' || k === 'jump') startGame();
    return;
  }
  if (GAME.state === 'gameover') { if (k === 'start') { BGM.stop(); GAME.state = 'title'; } return; }
  if (k === 'pause' && GAME.state === 'play') GAME.paused = !GAME.paused;
  if (k === 'jump' && GAME.mario && !GAME.mario.dead) GAME.mario.jumpBuf = 8;
  if (k === 'fire' && GAME.state === 'play' && GAME.mario && !GAME.mario.dead) {
    const m = GAME.mario;
    if (m.fire && GAME.balls.length < 2) {
      GAME.balls.push({
        x: m.facing === 1 ? m.x + m.w : m.x - 8,
        y: m.y + (m.big ? 10 : 5), w: 8, h: 8,
        vx: m.facing * 4.5, vy: 0, spin: 0
      });
      Sound.fireball();
    }
  }
}

/* ---------- tile physics ---------- */
function solid(c) { return c === 'X' || c === 'B' || c === 'M' || c === 'F' || c === 'S' || c === 'U' || c === 'T' || c === 'P' || c === 'f' || c === '?'; }
function cellAt(tx, ty) {
  const L = GAME.level;
  if (tx < 0 || tx >= L.W) return 'X';
  if (ty < 0 || ty >= L.H) return ' ';
  return L.map[ty][tx];
}
function collideAxis(ent, dx, dy) {
  ent.x += dx;
  let hitX = false;
  {
    const top = ent.y + 1, bot = ent.y + ent.h - 1;
    for (let ty = Math.floor(top / TILE); ty <= Math.floor(bot / TILE); ty++) {
      for (let tx = Math.floor(ent.x / TILE); tx <= Math.floor((ent.x + ent.w) / TILE); tx++) {
        if (!solid(cellAt(tx, ty))) continue;
        if (dx > 0) ent.x = tx * TILE - ent.w - 0.01;
        else if (dx < 0) ent.x = (tx + 1) * TILE + 0.01;
        hitX = true;
      }
    }
  }
  ent.y += dy;
  let hitY = false, ceil = false, floor = false;
  {
    for (let tx = Math.floor((ent.x + 1) / TILE); tx <= Math.floor((ent.x + ent.w - 1) / TILE); tx++) {
      for (let ty = Math.floor(ent.y / TILE); ty <= Math.floor((ent.y + ent.h) / TILE); ty++) {
        if (!solid(cellAt(tx, ty))) continue;
        if (dy > 0) { ent.y = ty * TILE - ent.h - 0.01; floor = true; }
        else if (dy < 0) { ent.y = (ty + 1) * TILE + 0.01; ceil = true; }
        hitY = true;
      }
    }
  }
  return { hitX, hitY, ceil, floor };
}

/* ---------- block interaction ---------- */
function hitBlock(tx, ty) {
  const L = GAME.level;
  const c = L.map[ty][tx];
  if (c === '?' || c === 'M' || c === 'F' || c === 'S') {
    L.map[ty][tx] = 'U';
    if (c === 'M') spawnItem('mushroom', tx, ty);
    else if (c === 'F') spawnItem('flower', tx, ty);
    else if (c === 'S') spawnItem('star', tx, ty);
    else coinBurst(tx, ty);
    Sound.bump();
  } else if (c === 'B') {
    if (GAME.mario.big) {
      L.map[ty][tx] = ' ';
      Sound.breakB();
      GAME.score += 50;
      GAME.shake = 3;
      for (let i = 0; i < 4; i++) {
        GAME.particles.push({
          kind: 'debris',
          x: tx*TILE + (i % 2 ? 10 : 2), y: ty*TILE + 2,
          vx: (i % 2 ? 1.6 : -1.6), vy: -3.8 - (i < 2 ? 0.5 : 0),
          t: 0
        });
      }
    } else Sound.bump();
  }
}
function coinBurst(tx, ty) {
  GAME.coins++;
  if (GAME.coins >= 100) {
    GAME.coins -= 100;
    GAME.lives++;
    Sound.oneUp();
    GAME.popups.push({ x: tx*TILE, y: ty*TILE - 26, text: '1UP', t: 0 });
  }
  GAME.score += 200;
  Sound.coin();
  GAME.items.push({ type:'coinAnim', x: tx*TILE + 2, y: ty*TILE - 8, t: 0 });
  GAME.popups.push({ x: tx*TILE, y: ty*TILE - 10, text:'200', t: 0 });
  for (let i = 0; i < 5; i++) GAME.particles.push({
    kind: 'spark', x: tx*TILE + 8, y: ty*TILE - 4,
    vx: (Math.random()-0.5)*2.4, vy: -Math.random()*2 - 0.5, t: 0
  });
}
function spawnItem(kind, tx, ty) {
  GAME.items.push({
    type: kind, x: tx*TILE + 2, y: ty*TILE, w: 12, h: 12,
    vx: kind === 'mushroom' ? 1 : 0, vy: 0, rising: true
  });
}
function dust(x, y, n) {
  for (let i = 0; i < n; i++) GAME.particles.push({
    kind: 'dust', x: x + (Math.random()-0.5)*8, y: y - 2,
    vx: (Math.random()-0.5)*1.6, vy: -Math.random()*0.8, t: 0
  });
}

/* ---------- items ---------- */
function updateItems() {
  const m = GAME.mario;
  for (const it of GAME.items) {
    if (it.type === 'coinAnim') { it.t++; it.y -= 1.4; if (it.t > 26) it.dead = true; continue; }
    if (it.rising) {
      it.y -= 1;
      if (it.y <= 13*TILE - it.h - 2) { it.y = 13*TILE - it.h - 2; it.rising = false; }
      continue;
    }
    it.vy += 0.4;
    let r = collideAxis(it, it.vx, 0);
    if (r.hitX) it.vx = -it.vx * 0.9;
    r = collideAxis(it, 0, it.vy);
    if (r.floor) { if (it.type === 'star' && it.vy > 1) it.vy = -3.2; else it.vy = 0; }
    if (r.ceil && it.type === 'star') it.vy = 0.5;
  }
  for (const it of GAME.items) {
    if (it.dead || it.rising || it.type === 'coinAnim' || m.dead) continue;
    if (rects(m, it)) {
      it.dead = true;
      if (it.type === 'mushroom') {
        if (!m.big) growBig();
        GAME.score += 1000;
        Sound.grow();
      } else if (it.type === 'flower') {
        if (!m.big) growBig();
        m.fire = true;
        Sound.power();
      } else if (it.type === 'star') {
        m.star = 600;
        Sound.oneUp();
      }
      m.growT = 40;
    }
  }
  GAME.items = GAME.items.filter(i => !i.dead);
}
function growBig() {
  const m = GAME.mario;
  const bottom = m.y + m.h;
  m.big = true; m.h = 30; m.y = bottom - m.h;
}

/* ---------- fireballs ---------- */
function updateBalls() {
  for (const b of GAME.balls) {
    b.spin++;
    b.vy += 0.3;
    let r = collideAxis(b, b.vx, 0);
    if (r.hitX) { b.dead = true; continue; }
    r = collideAxis(b, 0, b.vy);
    if (r.floor) b.vy = -3;
    if (b.y > 260) { b.dead = true; continue; }
    for (const e of GAME.level.enemies) {
      if (e.dead || e.flat || e.gone || e.x > GAME.camera + 270) continue;
      if (rects(b, e)) {
        b.dead = true;
        if (e.type === 'shelly' || e.type === 'shellMove') { e.type = 'shell'; e.vx = 0; if (e.h === 16) { e.h = 10; e.y += 6; } }
        else { e.flat = true; e.deadT = 30; }
        addScore(200, e);
        Sound.stomp();
        break;
      }
    }
  }
  GAME.balls = GAME.balls.filter(b => !b.dead);
}

/* ---------- enemies ---------- */
function rects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function bumpCombo() {
  const i = Math.min(GAME.combo, COMBO_PTS.length - 1);
  GAME.combo = Math.min(GAME.combo + 1, COMBO_PTS.length);
  return COMBO_PTS[i];
}
function addScore(pts, e) {
  GAME.score += pts;
  if (e) GAME.popups.push({ x: e.x, y: e.y - 6, text: String(pts), t: 0 });
}
function killMario(force) {
  const m = GAME.mario;
  if (m.dead || (!force && m.star > 0)) return;
  m.dead = true; m.vy = -5.5; m.vx = 0; m.deathTimer = 0;
  GAME.combo = 0;
  Sound.die();
}
function updateEnemies() {
  const m = GAME.mario;
  for (const e of GAME.level.enemies) {
    if (e.gone) continue;
    if (e.flat) { e.deadT--; if (e.deadT <= 0) e.gone = true; continue; }
    if (e.x > GAME.camera + 270) continue;
    e.t++;
    let r = collideAxis(e, e.vx, 0);
    if (r.hitX) { if (e.type === 'shellMove') e.vx = -e.vx * 0.7; else e.vx = -e.vx; }
    e.vy += 0.4;
    r = collideAxis(e, 0, e.vy);
    if (r.floor) { if (e.type === 'star' && e.vy > 1) e.vy = -3.2; else e.vy = 0; }
    if (e.y > 260) { e.dead = true; continue; }

    if (m.dead) continue;
    if (rects(m, e)) {
      const stomping = m.vy > 0.5 && (m.y + m.h) < (e.y + e.h * 0.7);
      if (m.star > 0) {
        e.flat = true; e.deadT = 30;
        addScore(200, e); Sound.stomp();
      } else if (stomping) {
        m.y = e.y - m.h; m.vy = keys.jump ? -4.5 : -3;
        m.sq = 1.15;
        if (e.type === 'puff') {
          e.flat = true; e.deadT = 30;
          addScore(bumpCombo(), e); Sound.stomp();
          dust(e.x + 6, e.y + e.h, 4);
        } else if (e.type === 'shelly') {
          e.type = 'shell'; e.vx = 0; e.h = 10; e.y += 6;
          addScore(bumpCombo(), e); Sound.stomp();
        } else if (e.type === 'shell') {
          e.type = 'shellMove'; e.vx = (m.x < e.x ? 1 : -1) * 4;
          addScore(200, e); Sound.kick();
        } else if (e.type === 'shellMove') {
          e.vx = (m.x < e.x ? 1 : -1) * 4;
          addScore(100, e); Sound.kick();
        }
      } else {
        if (m.big) {
          // classic damage: shrink (fire -> normal, big -> small)
          if (m.fire) m.fire = false;
          else { const bottom = m.y + m.h; m.big = false; m.h = 16; m.y = bottom - m.h; }
          m.invuln = 90;
          GAME.balls.length = 0;
          Sound.shrink();
        } else {
          killMario();
        }
      }
    }
    if (e.type === 'shellMove' && Math.abs(e.vx) > 2) {
      for (const o of GAME.level.enemies) {
        if (o === e || o.dead || o.flat || o.gone) continue;
        if (rects(e, o)) { o.flat = true; o.deadT = 30; addScore(200, o); Sound.stomp(); }
      }
    }
  }
}

/* ---------- mario (player) ---------- */
function updateMario() {
  const m = GAME.mario;
  const ch = CHARS[GAME.charIdx];
  if (m.dead) {
    m.vy += 0.4; m.y += m.vy; m.deathTimer++;
    if (m.deathTimer > 150) {
      GAME.lives--;
      if (GAME.lives <= 0) {
        GAME.state = 'gameover'; BGM.stop();
        if (GAME.score > GAME.high) { GAME.high = GAME.score; saveHigh(GAME.high); }
      } else startLevel();
    }
    return;
  }
  if (m.invuln > 0) m.invuln--;
  if (m.growT > 0) m.growT--;
  if (m.star > 0) m.star--;
  m.sq += (1 - m.sq) * 0.25;

  // original SMB feel: slow build-up to speed, gentle glide
  const maxV = (keys.run ? 2.7 : 1.4) * ch.speed;
  const acc = (m.onGround ? (keys.run ? 0.07 : 0.05) : 0.03) * ch.speed;
  if (keys.left && !keys.right) { m.vx -= acc; m.facing = -1; }
  else if (keys.right && !keys.left) { m.vx += acc; m.facing = 1; }
  else if (m.onGround) m.vx *= 0.93;
  m.vx = Math.max(-maxV, Math.min(maxV, m.vx));
  if (Math.abs(m.vx) < 0.05 && m.onGround) m.vx = 0;

  // coyote time + jump buffer for a forgiving, smooth feel
  if (m.onGround) m.coyote = 6; else if (m.coyote > 0) m.coyote--;
  if (m.jumpBuf > 0) m.jumpBuf--;
  if (m.jumpBuf > 0 && (m.onGround || m.coyote > 0)) {
    m.jumpBuf = 0; m.coyote = 0;
    m.vy = (m.big ? -7.4 : -7.0) * ch.jump;
    m.onGround = false;
    m.sq = 1.18;
    Sound.jump();
  }
  if (keys.jump) m.jumpHeld = true;
  if (!keys.jump) { m.jumpHeld = false; if (m.vy < -2) m.vy = -2; }
  m.vy += 0.38;
  if (m.vy > 5.5) m.vy = 5.5;

  const wasAir = !m.onGround;
  const fallSpeed = m.vy;
  m.onGround = false;
  collideAxis(m, m.vx, 0);
  const r2 = collideAxis(m, 0, m.vy);
  if (r2.floor) {
    m.vy = 0; m.onGround = true;
    if (wasAir && fallSpeed > 2.5) { m.sq = 0.72; dust(m.x + 6, m.y + m.h, 3); }
  }
  if (r2.ceil) {
    const ty = Math.floor((m.y - 1) / TILE);
    const cands = [Math.floor((m.x + 2) / TILE), Math.floor((m.x + m.w - 2) / TILE)];
    let best = null;
    for (const tx of cands) {
      const c = cellAt(tx, ty);
      if (c === '?' || c === 'M' || c === 'F' || c === 'S' || c === 'B') {
        if (!best || Math.abs(tx*TILE + 8 - (m.x + m.w/2)) < Math.abs(best.tx*TILE + 8 - (m.x + m.w/2))) best = { tx, ty };
      }
    }
    if (best) hitBlock(best.tx, best.ty);
    m.vy = 0.5;
  }

  // running dust
  if (m.onGround && Math.abs(m.vx) > 2 && GAME.frame % 10 === 0) dust(m.x + 6 - m.facing*4, m.y + m.h, 1);

  if (m.y > 250) { killMario(true); return; }

  const L = GAME.level;
  if (!GAME.flagSlide && !GAME.walkDone && m.x + m.w > L.flagX * TILE - 4) {
    GAME.flagSlide = true;
    const y = m.y;
    let pts = 100;
    if (y < 6*TILE) pts = 5000; else if (y < 8*TILE) pts = 2000; else if (y < 10*TILE) pts = 800;
    addScore(pts, m);
    Sound.flag();
    m.x = L.flagX * TILE + 10; m.vx = 0; m.vy = 0; m.facing = 1;
    GAME.state = 'clear';
  }

  m.animT += Math.abs(m.vx);
  m.state = !m.onGround ? 'jump' : (Math.abs(m.vx) > 0.1 ? 'run' : 'idle');
}

/* ---------- fx ---------- */
function updateFx() {
  for (const p of GAME.particles) {
    p.t++;
    p.x += p.vx; p.y += p.vy;
    if (p.kind === 'debris') p.vy += 0.3;
    if (p.kind === 'spark') p.vy += 0.1;
    if (p.kind === 'dust') p.vy -= 0.02;
    if (p.t > (p.kind === 'dust' ? 14 : 60)) p.gone = true;
  }
  GAME.particles = GAME.particles.filter(p => !p.gone);
  for (const p of GAME.popups) { p.t++; p.y -= 0.6; if (p.t > 50) p.gone = true; }
  GAME.popups = GAME.popups.filter(p => !p.gone);
  if (GAME.shake > 0) GAME.shake--;
}
function updateTimer() {
  if (GAME.state !== 'play') return;
  GAME.timeF++;
  if (GAME.timeF >= 36) {
    GAME.timeF = 0; GAME.time--;
    if (GAME.time <= 0) { GAME.time = 0; killMario(true); }
  }
}

/* ---------- clear sequence ---------- */
function updateClear() {
  const m = GAME.mario, L = GAME.level;
  if (GAME.flagSlide) {
    m.y += 1;
    if (m.y >= 13*TILE - m.h - 2) { m.y = 13*TILE - m.h - 2; GAME.flagSlide = false; Sound.pipe(); }
  } else if (!GAME.walkDone) {
    m.x += 1.2; m.facing = 1; m.animT += 1.2;
    if (m.x >= (L.castleX + 1) * TILE) GAME.walkDone = true;
  } else {
    GAME.clearTimer++;
    if (GAME.clearTimer > 150) nextLevel();
  }
}

/* ---------- rendering ---------- */
function camQ() { return Math.round(GAME.camera * 2) / 2; }
function drawBackground() {
  ctx.fillStyle = '#5C94FC'; ctx.fillRect(0, 0, 256, 240);
  const cam = camQ();
  for (const d of (GAME.level && GAME.level.decos) || []) {
    const px = (d.type === 'cloud') ? 0.5 : 1; // parallax
    const x = d.x - cam * px + (d.type === 'cloud' ? Math.sin((GAME.frame + d.x) * 0.004) * 3 : 0);
    if (x < -80 || x > 340) continue;
    if (d.type === 'cloud') ctx.drawImage(SPR.cloud, x, d.y);
    else if (d.type === 'hill') ctx.drawImage(SPR.hill, x, d.y);
    else if (d.type === 'bush') ctx.drawImage(SPR.bush, x, d.y);
  }
}
function drawTiles() {
  const L = GAME.level;
  const cam = camQ();
  const x0 = Math.floor((cam - 8) / TILE);
  for (let ty = 0; ty < L.H; ty++) {
    for (let tx = x0; tx <= x0 + 18; tx++) {
      const c = cellAt(tx, ty);
      const x = tx * TILE - cam, y = ty * TILE;
      if (c === 'X') ctx.drawImage(SPR.ground, x, y);
      else if (c === 'B') ctx.drawImage(SPR.brick, x, y);
      else if (c === '?' || c === 'M' || c === 'F' || c === 'S') ctx.drawImage(SPR.qblock, x, y);
      else if (c === 'U') ctx.drawImage(SPR.used, x, y);
      else if (c === 'T') ctx.drawImage(SPR.pipeTop, x, y);
      else if (c === 'P') ctx.drawImage(SPR.pipeBody, x, y);
      else if (c === 'f') ctx.drawImage(SPR.pole, x, y);
      else if (c === 'b') ctx.drawImage(SPR.flagBall, x + 2, y + 4);
    }
  }
  const cx = L.castleX * TILE - cam;
  if (cx > -64 && cx < 340) ctx.drawImage(SPR.castle, cx, 13*TILE - 32);
}
function drawPlayerSprite(spr, x, y, w, h, sq) {
  const sx = 1 + (1 - sq) * 0.6;
  const sw = spr.width * sx, sh = spr.height * sq;
  ctx.drawImage(spr, x + (w - sw) / 2 - 1, y + h - sh, sw, sh);
}
function drawSprites() {
  const m = GAME.mario, cam = GAME.camera; // subpixel: no rounding
  const sprSet = CHAR_SPR[GAME.charIdx];
  for (const it of GAME.items) {
    const x = it.x - cam, y = it.y;
    if (x < -24 || x > 280) continue;
    if (it.type === 'coinAnim') { if (it.t % 8 < 4) ctx.drawImage(SPR.coin, x + 2, y); }
    else if (it.type === 'mushroom') ctx.drawImage(SPR.mushroom, x, y);
    else if (it.type === 'flower') ctx.drawImage(SPR.flower, x, y);
    else if (it.type === 'star') ctx.drawImage(SPR.star, x, y);
  }
  for (const b of GAME.balls) {
    const x = b.x - cam, y = b.y;
    const a = b.spin % 8 < 4;
    ctx.fillStyle = a ? '#FF7A20' : '#E7551F'; ctx.fillRect(x, y, 8, 8);
    ctx.fillStyle = a ? '#FFD84A' : '#FFFFFF'; ctx.fillRect(x + 2, y + 2, 4, 4);
  }
  for (const e of GAME.level.enemies) {
    if (e.gone) continue;
    const x = e.x - cam, y = e.y + (e.type === 'puff' && !e.flat ? (e.t % 30 < 15 ? 0 : 1) : 0);
    if (x < -24 || x > 280) continue;
    if (e.flat) { ctx.drawImage(e.type === 'puff' ? SPR.puffFlat : SPR.shell, x, y + (e.type === 'puff' ? 4 : 6)); continue; }
    if (e.type === 'puff') ctx.drawImage(SPR.puff, x, y);
    else if (e.type === 'shelly') ctx.drawImage(SPR.shelly, x, y);
    else if (e.type === 'shell' || e.type === 'shellMove') ctx.drawImage(SPR.shell, x, y);
  }
  for (const p of GAME.particles) {
    const x = p.x - cam, y = p.y;
    if (p.kind === 'debris') {
      ctx.save(); ctx.beginPath(); ctx.rect(x-1, y-1, 9, 9); ctx.clip();
      ctx.drawImage(SPR.brick, x - 1, y - 1); ctx.restore();
    } else if (p.kind === 'spark') {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 20);
      ctx.fillStyle = '#FFD84A'; ctx.fillRect(x, y, 2, 2);
      ctx.globalAlpha = 1;
    } else if (p.kind === 'dust') {
      ctx.globalAlpha = Math.max(0, 0.7 * (1 - p.t / 14));
      ctx.fillStyle = '#E8E0D0'; ctx.fillRect(x, y, 2, 2);
      ctx.globalAlpha = 1;
    }
  }
  if (m) {
    const x = m.x - cam - 1, y = m.y;
    let spr, sprL;
    if (m.star > 0) {
      spr = [SPR.star, SPR.flower, SPR.mushroom][Math.floor(GAME.frame / 4) % 3];
    } else if (m.big) {
      spr = m.state === 'jump' ? sprSet.bigJump : sprSet.bigIdle;
      sprL = m.state === 'jump' ? sprSet.bigJumpL : sprSet.bigIdleL;
    } else {
      spr = m.state === 'jump' ? sprSet.smallJump : sprSet.smallIdle;
      sprL = m.state === 'jump' ? sprSet.smallJumpL : sprSet.smallIdleL;
    }
    const blink = m.invuln > 0 && GAME.frame % 4 < 2;
    if (m.dead) {
      if (m.deathTimer % 10 < 5) ctx.drawImage(spr, x, y);
    } else if (blink) {
      // invincibility blink (hidden)
    } else if (m.facing === -1) {
      ctx.drawImage(sprL, x, y);
    } else {
      drawPlayerSprite(spr, x, y, m.w, m.h, m.sq);
    }
  }
  for (const p of GAME.popups) {
    const alpha = p.t > 30 ? Math.max(0, 1 - (p.t - 30) / 20) : 1;
    drawText(p.text, p.x - cam, p.y, '#FFF', alpha);
  }
}
function drawHud() {
  const nm = CHARS[GAME.charIdx].name;
  drawText(nm, 8, 8, '#FFF');
  drawText(String(GAME.score).padStart(6, '0'), 8, 16, '#FFF');
  drawText('COINS', 96, 8, '#FFF');
  ctx.drawImage(SPR.coin, 132, 12);
  drawText(String(GAME.coins).padStart(2, '0'), 148, 16, '#FFF');
  drawText('WORLD', 156, 8, '#FFF');
  drawText(GAME.world + '-' + GAME.lv, 156, 16, '#FFF');
  drawText('TIME', 220, 8, '#FFF');
  drawText(String(GAME.time).padStart(3, '0'), 220, 16, '#FFF');
  drawText('LIVES', 8, 226, '#FFF');
  drawText(String(GAME.lives).padStart(2, '0'), 46, 226, '#FFF');
}
function drawTitle() {
  ctx.fillStyle = '#5C94FC'; ctx.fillRect(0, 0, 256, 240);
  // parallax clouds on title too
  const t = GAME.frame * 0.15;
  for (let i = 0; i < 4; i++) {
    const x = ((i * 80 + t) % 320) - 40;
    ctx.drawImage(SPR.cloud, x, 20 + (i % 2) * 18);
  }
  ctx.fillStyle = '#43B025';
  ctx.beginPath(); ctx.moveTo(0, 208); ctx.lineTo(60, 148); ctx.lineTo(120, 208); ctx.fill();
  for (let y = 208; y < 240; y += 8) for (let x = 0; x < 256; x += 16) {
    ctx.fillStyle = ((x / 16) + (y / 8)) % 2 ? '#C85A17' : '#B5561A';
    ctx.fillRect(x, y, 16, 8);
  }
  ctx.drawImage(SPR.bush, 20, 188);
  ctx.drawImage(SPR.bush, 204, 188);
  // logo
  ctx.fillStyle = '#2BA8A0'; ctx.fillRect(28, 36, 200, 52);
  ctx.fillStyle = '#1E7A74'; ctx.fillRect(28, 80, 200, 8);
  drawText('PIPO JUMP!', 70, 48, '#FFF');
  drawText('©2026 PIXEL STUDIO', 72, 74, '#EAF6F2');
  // character select
  drawText('CHOOSE YOUR HERO', 84, 100, '#FFF');
  const bob = Math.floor(GAME.frame / 20) % 2;
  CHARS.forEach((c, i) => {
    const x = 62 + i * 46;
    const y = 116 + (i === GAME.charIdx ? 0 : bob);
    const s = CHAR_SPR[i].smallIdle;
    if (i === GAME.charIdx) {
      ctx.drawImage(s, x - 7, y - 10, s.width * 2, s.height * 2); // 2x showcase
      ctx.fillStyle = '#FFD84A';
      ctx.beginPath(); ctx.moveTo(x, 98); ctx.lineTo(x - 4, 92); ctx.lineTo(x + 4, 92); ctx.fill();
      drawText(c.name, x - 11, 162, '#FFD84A');
    } else {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(s, x - 7, y - 2);
      ctx.globalAlpha = 1;
      drawText(c.name, x - 13, 134, '#DDE8FF');
    }
  });
  // stats hint
  drawText('SPEED/JUMP VARY BY HERO', 64, 174, '#BFD4FF');
  drawText('TOP: ' + String(GAME.high).padStart(6, '0'), 84, 188, '#FFD84A');
  if (Math.floor(Date.now() / 500) % 2 === 0) drawText('PRESS ENTER', 84, 204, '#FFF');
  drawText('ARROWS:SELECT M:SOUND B:MUSIC F:FIRE', 30, 226, '#DDE8FF');
}
function drawWorld() {
  const shx = GAME.shake > 0 ? (Math.random() - 0.5) * 2 : 0;
  ctx.save();
  ctx.translate(shx, 0);
  drawBackground();
  drawTiles();
  drawSprites();
  ctx.restore();
  drawHud();
}
function draw() {
  switch (GAME.state) {
    case 'title': drawTitle(); break;
    case 'gameover':
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 240);
      drawText('GAME OVER', 84, 96, '#FFF');
      drawText('SCORE ' + GAME.score, 84, 116, '#FFF');
      if (Math.floor(Date.now() / 500) % 2 === 0) drawText('PRESS ENTER', 84, 148, '#FFF');
      break;
    case 'ready':
      drawWorld();
      drawText(GAME.world + '-' + GAME.lv, 104, 96, '#FFF');
      drawText('READY!', 104, 112, '#FFF');
      break;
    case 'clear':
      drawWorld();
      drawText('COURSE CLEAR!', 64, 92, '#FFF');
      drawText('1UP', 116, 112, '#FFF');
      break;
    default: drawWorld();
  }
  if (GAME.paused) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 240);
    ctx.globalAlpha = 1;
    drawText('PAUSED', 100, 110, '#FFF');
  }
}

/* ---------- main loop ---------- */
function update() {
  GAME.frame++;
  if (GAME.paused) return;
  switch (GAME.state) {
    case 'ready':
      GAME.readyTimer++;
      if (GAME.readyTimer > 80) GAME.state = 'play';
      break;
    case 'play':
      updateMario();
      updateItems();
      updateBalls();
      updateEnemies();
      updateFx();
      updateTimer();
      if (GAME.state === 'play') {
        // smooth camera (never scrolls backward, eased)
        const maxCam = GAME.level.W * TILE - 256;
        const target = Math.max(GAME.camera, GAME.mario.x - 90);
        GAME.camera += (Math.min(target, maxCam) - GAME.camera) * 0.18;
        if (GAME.camera > maxCam) GAME.camera = maxCam;
      }
      break;
    case 'clear':
      updateClear();
      updateFx();
      break;
  }
}
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}
loop();
