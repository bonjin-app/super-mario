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
  /* Rebind mode reads the physical key, not the action it currently maps to -- otherwise
     pressing the key you want to reassign would trigger the thing it already does. */
  /* Opening the rebind screen is checked on the physical key, not on the action it maps
     to: the first version used 'k', which is a default binding for fire, so normKey
     returned 'fire' and the hotkey silently did nothing. A hotkey that any binding can
     shadow is not a hotkey. */
  if (GAME.rebind < 0 && keyId(e) === 'r' && GAME.paused && GAME.state === 'play' && !TOUCH) {
    e.preventDefault();
    if (e.repeat) return;
    Sound.init();
    /* Snapshotted so CANCEL can mean cancel: bindKey() commits and saves each step the
       moment a key is pressed, so without this, escaping out of a 6-step walk after
       step 1 or 2 left those rebinds in place -- "CANCEL" quietly kept whatever you had
       already changed and only skipped the steps you hadn't reached yet. */
    GAME.rebindSnapshot = ACTIONS.reduce((m, a) => { m[a] = KEYS_MAP[a].slice(); return m; }, {});
    GAME.rebind = 0; GAME.rebindMsg = ''; GAME.rebindT = 0;
    return;
  }
  if (GAME.rebind >= 0) {
    e.preventDefault();
    if (e.repeat) return;
    Sound.init();
    const id = keyId(e);
    if (id === 'escape') {
      if (GAME.rebindSnapshot) { KEYS_MAP = GAME.rebindSnapshot; GAME.rebindSnapshot = null; saveSettings(); syncKeyLegend(); }
      GAME.rebind = -1; GAME.rebindMsg = 'CANCELLED'; GAME.rebindT = 90;
      return;
    }
    if (id === 'enter') {                      // skip this one, keep what it had
      GAME.rebind++;
      if (GAME.rebind >= REBINDABLE.length) { GAME.rebind = -1; GAME.rebindMsg = 'SAVED'; GAME.rebindT = 90; }
      return;
    }
    const action = REBINDABLE[GAME.rebind];
    if (bindKey(action, id)) {
      Sound.coin();
      GAME.rebind++;
      if (GAME.rebind >= REBINDABLE.length) { GAME.rebind = -1; GAME.rebindMsg = 'SAVED'; GAME.rebindT = 90; }
    } else {
      Sound.bump();
      GAME.rebindMsg = 'RESERVED - PICK ANOTHER'; GAME.rebindT = 70;
    }
    return;
  }
  const k = normKey(e); keys[k] = true;
  if (e.repeat) return;
  Sound.init();
  onKeyPress(k);
});
window.addEventListener('keyup', e => { keys[normKey(e)] = false; });
/* Switching away from the tab used to leave the game live AND leave every held
   key stuck down: keyup is never delivered to a blurred window, so a player who
   Cmd-Tabbed mid-run came back to a hero that had been walking right the whole
   time. The clock kept running too. Blur clears the key state and pauses a live
   course; the player unpauses when they are actually looking at it. */
function releaseAllKeys() { for (const k in keys) keys[k] = false; }
function autoPause() {
  releaseAllKeys();
  /* releaseAllKeys() only clears the input state -- on touch, a finger already down on
     a pad button when the tab loses focus leaves that button's `.held` highlight on
     screen with nothing left to clear it, since its own pointerup/cancel/leave never
     fires while the tab is backgrounded. Same bug this function exists to fix in the
     first place (stuck keys after blur), just the visual half of it. */
  if (TOUCH) {
    const pad = document.getElementById('pad');
    if (pad) for (const btn of pad.querySelectorAll('.pad-btn.held')) btn.classList.remove('held');
  }
  if (GAME.state === 'play' && !GAME.paused) { GAME.paused = true; BGM.stop(); }
}
window.addEventListener('blur', autoPause);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
/* Keys are stored lower-case, and named ones keep their DOM spelling ('ArrowLeft',
   ' ', 'Enter', 'Shift'). The action order here is also the order the rebind screen
   walks through. */
const ACTIONS = ['left', 'right', 'jump', 'run', 'fire', 'down', 'pause', 'quit', 'mute', 'bgm', 'start'];
const DEFAULT_KEYS = {
  left:  ['arrowleft', 'a'],
  right: ['arrowright', 'd'],
  jump:  ['arrowup', 'w', 'x', ' '],
  run:   ['z', 'shift'],
  fire:  ['f', 'k'],
  down:  ['arrowdown', 's'],
  pause: ['p', 'escape'],
  quit:  ['q'],
  mute:  ['m'],
  bgm:   ['b'],
  start: ['enter']
};
/* Rebindable from the pause screen; the rest are either menu plumbing or reserved. */
const REBINDABLE = ['left', 'right', 'jump', 'run', 'fire', 'down'];
let KEYS_MAP = {};
function resetKeys() { KEYS_MAP = {}; for (const a of ACTIONS) KEYS_MAP[a] = DEFAULT_KEYS[a].slice(); }
resetKeys();
function keyId(e) { return String(e.key).toLowerCase(); }
function normKey(e) {
  const id = keyId(e);
  for (const a of ACTIONS) if (KEYS_MAP[a].includes(id)) return a;
  return id;
}
/* Give `id` to `action`, taking it from whoever else holds it -- but never leave an
   action with nothing, or the player could unbind their only way to move. */
function bindKey(action, id) {
  if (!REBINDABLE.includes(action)) return false;
  if (id === 'escape') return false;                 // the way out of the menu is reserved
  for (const a of ACTIONS) {
    if (a === action) continue;
    const i = KEYS_MAP[a].indexOf(id);
    if (i < 0) continue;
    if (KEYS_MAP[a].length === 1) return false;      // that action would be left with none
    KEYS_MAP[a].splice(i, 1);
  }
  KEYS_MAP[action] = [id];
  saveSettings();
  syncKeyLegend();
  return true;
}
/* How a binding is spelled on screen. */
const KEY_LABEL = {
  'arrowleft': 'LEFT', 'arrowright': 'RIGHT', 'arrowup': 'UP', 'arrowdown': 'DOWN',
  ' ': 'SPACE', 'escape': 'ESC', 'enter': 'ENTER', 'shift': 'SHIFT'
};
function keyName(id) { return (KEY_LABEL[id] || id).toUpperCase(); }
function bindingText(action) { return KEYS_MAP[action].map(keyName).join(' / '); }

/* ---------- touch pad ----------
   The page has always declared a mobile viewport but shipped keyboard-only
   input, so it could not be played on a phone at all. The buttons feed the same
   `keys` map and onKeyPress() the keyboard does, so no game code special-cases
   touch. On the title screen the d-pad doubles as hero select, which is why
   press (not hold) also has to fire onKeyPress. */
/* Live, not read once: a player can flip the system setting while the tab is open, and
   the next frame should already respect it. */
var REDUCED = false;
try {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  REDUCED = mq.matches;
  const onChange = (e) => { REDUCED = e.matches; };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
} catch (e) { REDUCED = false; }

var TOUCH = false; // read by fit(), which runs at load before setupTouch()
function setupTouch() {
  const pad = document.getElementById('pad');
  if (!pad) return;
  const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!coarse) return;
  TOUCH = true;
  pad.hidden = false;
  document.body.classList.add('touch');
  for (const btn of pad.querySelectorAll('.pad-btn')) {
    const k = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      if (keys[k]) return;
      keys[k] = true;
      btn.classList.add('held');
      Sound.init();
      onKeyPress(k);
      // a tap on the d-pad also starts the game from the title / game over
      if (k === 'jump' && (GAME.state === 'gameover')) onKeyPress('start');
    };
    const release = (e) => { e.preventDefault(); keys[k] = false; btn.classList.remove('held'); };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }
}

/* ---------- page chrome ----------
   The top bar carries what the playfield HUD does not: the saved best score, the
   chosen hero and the audio state. Written only when a value actually changes --
   touching the DOM every frame would cost a layout flush on a canvas game that
   otherwise never dirties layout. */
const chromeEls = {};
let chromeCache = '';
/* The page chrome lists the keys too, and it was a hand-written copy of the defaults.
   After a rebind it would have been simply wrong, so it is generated. */
function syncKeyLegend() {
  if (typeof document === 'undefined') return;
  const kb = (id) => '<kbd>' + keyName(id) + '</kbd>';
  /* One control on the panel: its keycaps and the function silkscreened under them.
     The function name is in the same English caps the game's own canvas UI uses
     (PRESS ENTER TO START, COURSE CLEAR), so the panel and the screen speak one
     language.
     No explanatory notes here, deliberately. They only applied to three of the five
     controls, so every control sat at a different height and the panel lost the one
     thing a silkscreen has: a single baseline. The game already teaches each of them
     in play ("HOLD Z TO RUN", "PRESS F TO SHOOT") and the pause screen carries the
     full table with the details. */
  const ctl = (ids, silk) =>
    '<span class="ctl"><span class="caps">' + ids.map(kb).join('') + '</span>' +
    '<span class="silk">' + silk + '</span></span>';

  /* Split by what the control acts on. These move the hero. */
  const play = document.getElementById('keys');
  if (play) {
    play.innerHTML = [
      ctl(KEYS_MAP.left.slice(0, 1).concat(KEYS_MAP.right.slice(0, 1)), 'MOVE'),
      ctl(KEYS_MAP.jump.slice(0, 1), 'JUMP'),
      ctl(KEYS_MAP.run.slice(0, 1),  'RUN'),
      ctl(KEYS_MAP.fire.slice(0, 1), 'SHOOT'),
      ctl(KEYS_MAP.down.slice(0, 1), 'PIPE')
    ].join('');
  }
  /* And these run the cabinet. */
  const sys = document.getElementById('sys');
  if (sys) {
    sys.innerHTML = [
      ctl(KEYS_MAP.pause.slice(0, 1), 'PAUSE'),
      ctl(['r'], 'REBIND'),
      ctl(KEYS_MAP.quit.slice(0, 1), 'TITLE'),
      ctl(KEYS_MAP.mute.slice(0, 1), 'SOUND'),
      ctl(KEYS_MAP.bgm.slice(0, 1),  'MUSIC')
    ].join('');
  }
  /* No touch tip to write. The canvas already prints "A JUMP  HOLD B TO RUN  F SHOOT"
     and "P PAUSE FOR FULL CONTROLS" itself on touch, and the pad on screen is the
     control reference, so an HTML copy was the third statement of one thing. */
}
function syncChrome() {
  if (!chromeEls.best) {
    chromeEls.hero = document.getElementById('stHero');
    chromeEls.best = document.getElementById('stBest');
    chromeEls.audio = document.getElementById('stAudio');
    if (!chromeEls.best) return;
  }
  const hero = 'HERO ' + CHARS[GAME.charIdx].name;
  const best = 'BEST ' + String(Math.max(GAME.high, GAME.score)).padStart(6, '0');
  const audio = 'SOUND ' + (Sound.muted ? 'OFF' : 'ON') + ' · MUSIC ' + (GAME.bgmOn ? 'ON' : 'OFF');
  const key = hero + best + audio;
  if (key === chromeCache) return;
  chromeCache = key;
  chromeEls.hero.textContent = hero;
  chromeEls.best.textContent = best;
  chromeEls.audio.textContent = audio;
}

/* ---------- settings persistence ---------- */
const SETTINGS_KEY = 'pipoSettings';
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof s.charIdx === 'number' && s.charIdx >= 0 && s.charIdx < CHARS.length) GAME.charIdx = s.charIdx;
    if (typeof s.muted === 'boolean') Sound.muted = s.muted;
    if (typeof s.bgmOn === 'boolean') GAME.bgmOn = s.bgmOn;
    /* Stored bindings are merged action by action and validated: a corrupt or partial
       entry falls back to that action's default rather than leaving it unbound. */
    if (s.keys && typeof s.keys === 'object') {
      for (const a of ACTIONS) {
        const v = s.keys[a];
        if (Array.isArray(v) && v.length && v.every(k => typeof k === 'string' && k.length)) {
          KEYS_MAP[a] = v.map(k => k.toLowerCase());
        }
      }
      if (!KEYS_MAP.pause.includes('escape')) KEYS_MAP.pause.push('escape');
    }
  } catch (e) { /* corrupt or blocked storage: fall back to defaults */ }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      charIdx: GAME.charIdx, muted: Sound.muted, bgmOn: GAME.bgmOn, keys: KEYS_MAP
    }));
  } catch (e) { /* private mode: settings just do not persist */ }
}

/* ---------- level building (3 rotating layouts) ---------- */
function buildLevel(lv, world = 1) {
  /* Four layouts over three field courses, shifted by world: 1 runs 0/1/2, world 2
     runs 1/2/3, world 3 runs 2/3/0. Nobody sees the same three in the same order twice
     in a row, and the layout/palette pairing changes every lap. */
  const LAYOUTS = 5;
  const variant = (lv - 1 + (world - 1)) % LAYOUTS;
  /* Enemies get modestly faster each world so a revisited layout still plays
     differently. Capped so the 3rd lap does not become unreadable. */
  const pace = 1 + Math.min(world - 1, 5) * 0.09;
  const W = 224, H = 15;
  const map = Array.from({ length: H }, () => Array(W).fill(' '));
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) map[y][x] = c; };
  for (let x = 0; x < W; x++) { map[13][x] = 'X'; map[14][x] = 'X'; }
  /* Water courses set these; everything else leaves them alone. `waterTo` is where the
     water ends, so the physics switch is a position test rather than a level-wide mode
     -- the last stretch of a lagoon is dry land and behaves like one. */
  let water = false, waterTo = 0;
  const gapCols = new Set();
  const gap = (a, b) => { for (let x=a; x<=b; x++) { map[13][x]=' '; map[14][x]=' '; gapCols.add(x); } };
  const blk = (x,y,c='?') => set(x,y,c);
  const pipe = (x,h) => { set(x,13-h,'T'); set(x+1,13-h,'T'); for (let y=14-h;y<=12;y++){ set(x,y,'P'); set(x+1,y,'P'); } };
  /* An enterable pipe. `E` is a pipe top the player can drop into; the exit is a
     different pipe further along the course, so the detour also buys progress --
     the same trade the original makes. */
  const entries = [];
  const pipeIn = (x, h, exitTx, room = 0) => {
    pipe(x, h);
    set(x, 13 - h, 'E'); set(x + 1, 13 - h, 'E');
    /* `room` is authored, not derived: the first version keyed the layout off the
       entrance column modulo three, so two of the four entrances collided and one of
       the three rooms was unreachable in the shipped game. */
    entries.push({ tx: x, ty: 13 - h, exitTx, room });
  };
  /* Loose coins live in the map as non-solid 'c' cells. Rewards used to come
     only out of ? blocks, which left long stretches with nothing to collect and
     no visual hint about where to go. */
  /* Coins only ever fill blank cells. set() clobbers unconditionally, so a coin
     placed on a brick, ? block or pipe would silently delete level geometry --
     exactly how an unreachable ledge or a broken pipe gets introduced. Skipping
     occupied cells makes that class of mistake impossible by construction. */
  const coinAt = (x, y) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    if (map[y][x] !== ' ') return;
    map[y][x] = 'c';
  };
  const coinRow = (x0, x1, y) => { for (let x = x0; x <= x1; x++) coinAt(x, y); };
  // an arc of coins over a gap: doubles as a read of the jump you need to make
  const coinArc = (cx, y, span) => {
    for (let i = -span; i <= span; i++) {
      const dy = Math.round((i * i) / Math.max(1, span) * 0.8);
      coinAt(cx + i, y + dy);
    }
  };
  /* Lifts. `plat(tile, row, kind, travelTiles)` shuttles between two points on a
     cosine, so it eases at both ends and never needs a random seed to stay in sync
     across a respawn. Coins are placed along the path, not under it: the reward is
     the ride. */
  const plats = [];
  const plat = (tx, ty, kind, travel) => plats.push({
    kind, w: 32, h: 8,
    x: tx * TILE, y: ty * TILE,
    x0: tx * TILE, y0: ty * TILE,
    from: kind === 'h' ? tx * TILE : ty * TILE,
    to: kind === 'h' ? (tx + travel) * TILE : (ty + travel) * TILE,
    speed: 0.016, t: 0, dx: 0, dy: 0
  });
  /* The topmost solid row in a column, i.e. the surface something standing here would
     rest on. Every spawner used a hardcoded row 13, which is only correct while the
     ground is one flat plane -- a terraced layout would bury its own patrols. */
  const surfaceRow = (x) => {
    /* Only terrain rows count. Scanning from row 5 put 409 walkers on top of floating
       brick rows -- a ? block two tiles over a walkway is not the ground. Terraces live
       at rows 11-12, the plain floor at 13. */
    for (let y = 11; y <= 14; y++) if (solid(map[y][x])) return y;
    return 15;
  };
  const surfaceY = (x, h) => surfaceRow(x) * TILE - h;

  const enemies = [];
  const P = (x) => enemies.push({ type:'puff', x: x*TILE, y: surfaceY(x, 12), w:12, h:12, vx:-0.45*pace, vy:0, t:0 });
  const S = (x) => enemies.push({ type:'shelly', x: x*TILE, y: surfaceY(x, 16), w:12, h:16, vx:-0.35*pace, vy:0, t:0 });
  // SPIKO: spined walker. Stomping it hurts you; fire, star or a kicked shell kills it.
  const SPK = (x) => enemies.push({ type:'spiko', spiky:true, x: x*TILE, y: surfaceY(x, 14), w:12, h:14, vx:-0.55*pace, vy:0, t:0 });
  // FLAPPY: hops on a timer, so it threatens the airspace a walker never does
  const FLP = (x) => enemies.push({ type:'flappy', x: x*TILE, y: surfaceY(x, 14), w:12, h:14, vx:-0.5*pace, vy:0, t:0, hop:0 });
  /* GLIDER: sine path through the air, no gravity. `baseY` is the centre of its lane
     and it never dips into the ground, so it cannot be walked into by accident. */
  /* FISH: the same sine path a glider flies, in water. Kept as its own type so the
     art and the "cannot be stomped here" rule can differ without touching motion. */
  const FSH = (x, row, amp) => enemies.push({
    type: 'fish', x: x*TILE, y: row*TILE, w: 14, h: 12,
    vx: -0.62*pace, vy: 0, t: (x * 31) % 360, baseY: row*TILE, amp: amp || 22, freq: 0.024, air: true
  });
  const GLD = (x, row, amp) => enemies.push({
    type: 'glider', x: x*TILE, y: row*TILE, w: 14, h: 12,
    vx: -0.7*pace, vy: 0, t: (x * 23) % 360, baseY: row*TILE, amp: amp || 18, freq: 0.028, air: true
  });
  /* CANNON: static, harmless in itself, fires a BOLT on a timer. It stands on its own
     plinth of used blocks, which is real terrain -- the entity is only the barrel. */
  const CAN = (x, row) => {
    for (let y = row + 1; y <= 12; y++) set(x, y, 'U');
    enemies.push({ type: 'cannon', x: x*TILE, y: row*TILE, w: 16, h: 16,
                   vx: 0, vy: 0, t: (x * 17) % 120, cool: Math.max(70, 130 - world * 6), air: true });
  };
  // CHOMP: rises out of a pipe mouth and retracts. Never stompable, killable by fire.
  const CHP = (x, ph) => enemies.push({ type:'chomp', x: x*TILE + 2, y: (13-ph)*TILE, w:12, h:16,
    baseY: (13-ph)*TILE, vx:0, vy:0, t:0, phase: (x * 37) % 150 });

  if (variant === 0) {
    gap(69,70); gap(86,88); gap(153,155);
    blk(16,9);
    blk(20,9,'B'); blk(21,9,'M'); blk(22,9); blk(23,9,'B'); blk(24,9);
    blk(20,5,'B'); blk(21,5); blk(22,5,'B'); blk(23,5); blk(24,5,'B');
    pipe(28,2); pipe(38,3); pipeIn(46,4, 57, 0); pipe(57,4);
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
    coinRow(21, 23, 8); coinRow(33, 36, 12); coinArc(69, 9, 3);
    coinRow(48, 52, 12); coinArc(87, 9, 3); coinRow(107, 110, 8);
    coinRow(118, 120, 8); coinRow(140, 143, 8); coinArc(154, 9, 3);
    coinRow(174, 178, 12);
    P(22); P(30); P(31); P(40); P(41);
    P(51); P(52); P(53); P(59); P(61); P(70); P(71);
    S(78); P(88); P(89);
    P(97); P(98); P(107); P(108); P(109); P(110);
    P(114); P(115); P(124); P(125);
    S(134); P(143); P(144); P(145); P(146);
    P(157); P(158); P(159); P(160); P(165); P(166);
    S(168); P(169); P(170);
    SPK(64); SPK(103); SPK(137); FLP(93); FLP(148); CHP(38, 3); CHP(57, 4);
    GLD(96, 7, 20); GLD(132, 6, 24); CAN(120, 11);
    // a shuttle over the long flat run, and a lift to the high coin row
    plat(112, 8, 'h', 6); coinRow(115, 119, 5);
    plat(180, 11, 'v', -5); coinRow(182, 185, 6);
  } else if (variant === 1) {
    /* Dropping off a pipe at run speed carries ~3 tiles, so a gap set right
       after one leaves no room to land and re-jump: running forward was
       unavoidable death and the only escape was a slow approach onto the pipe
       roof. Every gap now has >=6 flat tiles of runway after the obstacle
       before it (was 2 for the third gap, 4 for the first). */
    gap(42,43); gap(74,76); gap(124,125);
    blk(12,9,'M'); blk(14,9); blk(15,9,'B'); blk(16,9);
    blk(20,9,'B'); blk(21,9); blk(22,9,'B');
    blk(21,5);
    pipe(26,3); pipe(34,4);
    blk(48,9); blk(49,9,'B'); blk(50,9,'M'); blk(51,9,'B'); blk(52,9);
    blk(50,5);
    pipeIn(58,2, 64, 1); pipe(64,4);
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
    coinRow(14, 16, 8); coinArc(42, 9, 3); coinRow(48, 52, 8);
    coinRow(66, 69, 12); coinArc(75, 9, 4); coinRow(90, 92, 8);
    coinRow(100, 104, 12); coinArc(124, 9, 3); coinRow(136, 138, 8);
    coinRow(160, 166, 12);
    P(15); P(24); P(25); P(38); P(39);
    P(50); P(51); S(56); P(66); P(67);
    P(80); P(81); P(90); P(91); P(92);
    P(101); P(102); S(112);
    P(126); P(127); P(128); P(136); P(137);
    SPK(46); SPK(85); SPK(120); SPK(152); FLP(32); FLP(96); FLP(140); CHP(26, 3); CHP(108, 3);
    GLD(78, 7, 22); GLD(130, 6, 18); CAN(102, 11);
    plat(56, 8, 'h', 7); coinRow(59, 63, 5);
    plat(170, 11, 'v', -5); coinRow(172, 176, 6);
  } else if (variant === 2) {
    // gap(130,131) sat 4 tiles past pipe(124,2); moved for a 6-tile runway
    gap(30,32); gap(60,62); gap(90,92); gap(132,133);
    blk(14,5,'B'); blk(15,5); blk(16,5,'B');
    blk(14,9,'M'); blk(15,9); blk(16,9,'B');
    pipe(20,2);
    blk(26,5,'B'); blk(27,5); blk(28,5,'B');
    blk(27,9,'S');
    blk(34,9); blk(35,9,'B'); blk(36,9,'M'); blk(37,9,'B'); blk(38,9);
    blk(36,5);
    pipeIn(44,4, 70, 2);
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
    coinRow(14, 16, 8); coinArc(31, 9, 4); coinRow(34, 38, 8);
    coinArc(61, 9, 4); coinRow(64, 66, 8); coinArc(91, 9, 4);
    coinRow(106, 108, 8); coinRow(116, 118, 8); coinArc(132, 9, 3);
    coinRow(155, 162, 12);
    P(16); P(22); P(23); S(28); P(36); P(37);
    P(48); P(49); S(56); P(65); P(66);
    P(74); P(75); S(82);
    P(88); P(89); P(90); P(91); P(92);
    P(100); P(101); P(108); S(114); P(117); P(118);
    P(135); P(136);
    SPK(40); SPK(72); SPK(112); SPK(150); FLP(50); FLP(104); FLP(128); CHP(20, 2); CHP(70, 3); CHP(98, 4);
    GLD(84, 7, 20); GLD(142, 6, 22); CAN(112, 11);   // 126 sat six tiles from the pit at 132
    plat(122, 8, 'h', 6); coinRow(125, 129, 5);
    plat(160, 11, 'v', -5); coinRow(162, 166, 6);
  } else if (variant === 3) {
    /* ---------- layout 3: terraces ----------
       The ground itself moves. Two step-up plateaus (surface row 11) and one high shelf
       (row 9, reached in two steps), with the coin rows and the ? blocks on the upper
       route. Drops off a terrace are safe -- you land on the floor below -- so the risk
       here is being caught at the wrong height rather than falling into a hole; there
       are only two real pits, both on flat ground with a long run-up. */
    const terrace = (a, b, row) => {
      for (let x = a; x <= b; x++) for (let y = row; y <= 12; y++) set(x, y, 'X');
    };
    const stepUp = (x, row) => { for (let y = row; y <= 12; y++) set(x, y, 'X'); };

    /* Pit placement here is measured against a jump that starts high, not one that
       starts on the floor. From a row-9 block (feet 144) the whole arc spans about
       8 tiles before it crosses the floor plane again; off a terrace (feet 176) about
       7. Both pits originally sat exactly that far past an elevated takeoff, so a hero
       who jumped from the shelf came down inside the hole with no input that could
       help. 14 tiles of plain floor now separate each pit from anything raised. */
    gap(58, 60); gap(154, 156);

    // first rise: one step, then a plateau carrying a coin row and a mushroom
    stepUp(24, 12); terrace(25, 40, 11);
    blk(28, 7, 'B'); blk(29, 7, 'M'); blk(30, 7, 'B');
    coinRow(26, 32, 8); coinRow(34, 39, 9);
    pipe(36, 2);

    // back down to the floor, a pit, then a pipe you can enter
    blk(42, 9, 'B'); blk(43, 9, '?'); blk(44, 9, 'B');
    coinArc(59, 9, 4);
    pipeIn(66, 3, 104, 0);   // 96 holds no pipe in this layout; the audit below snapped it

    // second rise, taller: two steps to a high shelf with the flower on it
    stepUp(76, 12); stepUp(77, 11); terrace(78, 96, 10);
    blk(82, 6, 'B'); blk(83, 6, 'F'); blk(84, 6, 'B');
    coinRow(79, 86, 7); coinRow(88, 95, 7);
    blk(90, 6, '?');

    // a long flat middle with the game's usual furniture, then the last terrace
    pipe(104, 4);
    blk(112, 9, 'B'); blk(113, 9, 'M'); blk(114, 9, 'B');
    coinRow(112, 114, 8);
    stepUp(124, 12); terrace(125, 140, 11);
    blk(129, 7, 'B'); blk(130, 7, '?'); blk(131, 7, 'B');
    coinRow(126, 138, 8);
    pipe(136, 2);
    coinArc(155, 9, 4);
    blk(158, 9, 'B'); blk(159, 9, 'S'); blk(160, 9, 'B');
    coinRow(168, 174, 12);

    // patrols on both levels: the upper route is not a free ride
    P(20); P(28); P(29); S(34); P(38); P(39);
    P(50); P(51); S(64); P(70); P(71);
    P(80); P(81); P(88); P(89); S(92);
    P(108); P(109); P(118); P(126); P(127); S(134);
    P(142); P(143); P(156); P(157);
    SPK(52); SPK(86); SPK(120); SPK(162);
    FLP(44); FLP(100); FLP(144);
    CHP(36, 2); CHP(104, 4);
    GLD(56, 6, 22); GLD(116, 7, 18); GLD(152, 6, 20);
    CAN(110, 11);
    plat(98, 8, 'h', 5); coinRow(100, 103, 4);
    plat(178, 11, 'v', -5); coinRow(180, 184, 6);
  } else {
    /* ---------- layout 4: the lagoon ----------
       Water from the start to column 172, then a dry shore that runs into the usual
       stairs and flagpole, so the goal sequence is untouched. Underwater the hero
       strokes instead of jumping and cannot stomp, so the obstacles are shaped for
       swimming: coral pillars to weave through, no pits (there is a floor everywhere),
       and coin trails that reward taking the tighter line. */
    water = true;
    waterTo = 172;
    // coral: pillars from the floor and stalactites from the ceiling, never facing each
    // other closely enough to close the channel -- 4 tiles of clear water always remain
    const coral = (x, h) => { for (let y = 12; y > 12 - h; y--) set(x, y, 'B'); };
    const spike = (x, h) => { for (let y = 2; y < 2 + h; y++) set(x, y, 'B'); };
    const pairs = [[14, 4, 0], [26, 0, 4], [38, 5, 0], [52, 0, 5], [66, 4, 0],
                   [80, 0, 4], [92, 5, 0], [106, 0, 5], [118, 4, 0], [132, 0, 4],
                   [146, 5, 0], [158, 0, 4]];
    for (const [x, up, down] of pairs) {
      if (up) { coral(x, up); coral(x + 1, up - 1); }
      if (down) { spike(x, down); spike(x + 1, down - 1); }
    }
    // a ceiling, so the water reads as enclosed rather than as sky
    for (let x = 0; x <= waterTo; x++) { set(x, 0, 'X'); set(x, 1, 'X'); }
    // coin trails through the gaps
    for (const [x, up] of [[16, 7], [28, 9], [40, 6], [54, 9], [68, 7], [82, 9],
                           [94, 6], [108, 9], [120, 7], [134, 9], [148, 6], [160, 9]])
      coinRow(x, x + 3, up);
    blk(46, 7, '?'); blk(74, 7, 'M'); blk(112, 7, '?'); blk(140, 7, 'F');
    // the shore: three steps out of the water into the run-up to the flag
    for (let x = waterTo + 1; x <= waterTo + 3; x++) for (let y = 12; y <= 12; y++) set(x, y, 'X');
    FSH(20, 8, 24); FSH(34, 6, 20); FSH(48, 9, 18); FSH(62, 7, 26);
    FSH(76, 8, 22); FSH(90, 6, 20); FSH(104, 9, 24); FSH(116, 7, 18);
    FSH(130, 8, 22); FSH(144, 6, 20); FSH(156, 9, 20);
    P(176); P(177); S(180);
  }

  // shared: stairs, flag, castle
  // The descent must start at 189, immediately after the 8-tile peak at 188.
  // Starting it at 190 left column 189 as a one-tile slot walled by 128px and
  // 112px of stairs -- higher than any hero can jump, so falling in was an
  // inescapable pit that only the timer could end.
  for (let i=0;i<8;i++) for (let j=0;j<=i;j++) set(181+i, 12-j, 'X');
  for (let i=0;i<7;i++) for (let j=0;j<7-i;j++) set(189+i, 12-j, 'X');
  for (let y=3;y<=12;y++) set(198,y,'f');
  set(198,2,'b');

  /* One layered prop list, back to front. Each prop carries its own parallax
     factor; drawBackground just walks the list in order. (There used to be a
     second `parallax` layer set drawn over these, which double-stamped hills
     and clouds and washed the whole sky out.)
     Placement is derived from a seeded LCG so a level looks identical every
     time it is rebuilt after a death. */
  // world is folded into the seed so scenery is re-arranged on each lap
  let seed = ((lv * 2654435761) ^ (world * 40503)) % 2147483647;
  if (seed <= 0) seed += 2147483646;
  const rnd = () => (seed = seed * 48271 % 2147483647) / 2147483647;
  const GROUND_Y = 13 * TILE;
  const decos = [];
  /* Parallax changes how fast a layer scrolls, not how far apart its props sit
     on screen, so `gap` is a plain world-pixel spacing. What it does change is
     how much world a layer ever reveals: at px=0.2 the camera only uncovers a
     fifth of the level's width, so a slow layer needs props over a short span
     -- generating them across the whole level would leave the sky empty. */
  const maxCam = W * TILE - LOGICAL_W;
  const layer = (px, gap, jitter, place) => {
    const end = maxCam * px + LOGICAL_W + 64;
    for (let wx = -64; wx < end; wx += gap * (0.7 + rnd() * jitter)) place(Math.round(wx), px);
  };
  layer(0.2, 80, 0.5, (x, px) => decos.push({ spr: 'mountain', x, y: GROUND_Y - 18, px }));
  layer(0.4, 96, 0.7, (x, px) => {
    const big = rnd() < 0.45;
    decos.push({ spr: big ? 'hillBig' : 'hill', x, y: GROUND_Y - (big ? 14 : 10), px });
  });
  layer(0.6, 112, 0.9, (x, px) => {
    const big = rnd() < 0.4;
    decos.push({ spr: big ? 'cloudBig' : 'cloud', x, y: 38 + Math.floor(rnd() * 44), px, drift: true });
  });
  layer(1, 96, 0.9, (x, px) => {
    if (x < 5 * TILE || x > (W - 22) * TILE) return;
    const big = rnd() < 0.35;
    decos.push({ spr: big ? 'bushBig' : 'bush', x, y: GROUND_Y - (big ? 7 : 6), px });
  });

  const AIR_ROWS = [7, 8, 9, 10, 11, 12];
  /* Open sky means open over the RUN-UP, not just over the spike. Same lesson the pit
     roofing rule just had to learn: takeoff happens 2-3 tiles early and the head keeps
     rising for ~2.8 tiles after that, so a block behind the spike caps the jump that was
     supposed to clear it. The comment below always described this failure ("every approach
     that took off before the ? group bonked and came down on the spines") -- it was just
     enforced over the spike's own column instead of the approach.
     Measured across 24 courses, sweeping the approach width:
       back=2 (old): 94 spikes, 66 of them with a roofed approach, avg 2.97/6 forgiveness
       back=3:       96 spikes, 65 roofed
       back=4:       77 spikes, 39 roofed
       back=5:       64 spikes,  0 roofed, avg 4.21/6, and no spike below 2/6
     5 it is. The cost is 30 spikes that no longer fit and degrade to plain walkers via
     the path below, which is the trade this file already chose to make: a fair enemy in
     a tight spot beats an unfair one. */
  const airClear = (cx) => {
    for (let x = cx - 5; x <= cx + 2; x++) {
      if (x < 0 || x >= W) return false;
      if (!solid(map[13][x])) return false;
      for (const y of AIR_ROWS) if (solid(map[y][x])) return false;
    }
    return true;
  };

  /* ---------- per-world variation ----------
     Deterministic from (world, lv): the same course is identical every visit, and
     different from the same course one lap earlier. It only ADDS, and only things the
     correction passes below can vet -- walkers (grounded, de-overlapped), spikes
     (given open sky), block clusters (airspace over pits cleared) and lifts (optional
     routes). Nothing here can create an unreachable ledge or an unfair pit, because
     nothing here touches the ground row or the jump geometry. */
  const lap = Math.min(world - 1, 7);
  if (lap > 0 && water) {
    /* The lagoon varies with its own vocabulary. Everything the dry-land branch adds is
       either meaningless underwater (a hopper, a lift) or actively wrong (a walker
       patrolling the seabed, a brick shelf floating in mid-channel). What scales here is
       traffic and terrain: more fish, deeper coral, longer stalactites, and the coin
       trails that mark the tighter line through them. */
    let vs = ((world * 2246822519) ^ (lv * 3266489917) ^ 0x2f6b1d07) % 2147483647;
    if (vs <= 0) vs += 2147483646;
    const vrnd = () => (vs = vs * 48271 % 2147483647) / 2147483647;
    const pick = (a, b) => a + Math.floor(vrnd() * (b - a + 1));

    for (let i = 0; i < Math.min(6, 1 + lap); i++)
      FSH(pick(18, waterTo - 14), pick(5, 10), 18 + Math.floor(vrnd() * 10));

    /* Coral and stalactites keep the authored rhythm: the hand-placed pairs stand 12 to
       14 columns apart, one from the floor then one from the ceiling, so the swimmer
       weaves. Growth needs a buffer from anything already there, or the always-big bot's
       original failure repeats: a variation stalactite landing four columns before an
       authored coral left only rows 6-7 as common water, a 32px needle for a 30px hero.
       A buffer of 8 clear columns closed that -- and also closed the growth loop itself:
       18 contiguous columns never exist between pairs spaced 12-14 apart, so this ran for
       every lap of every water world and placed nothing. Coral stayed frozen at world 1's
       count while the fish count climbed, which is a balance bug hiding as a safety fix.
       4 columns is enough buffer that one placement never sits close enough to an existing
       obstacle to recreate the needle by itself (each piece is at most 4 rows tall, so it
       cannot pinch the ~13-row channel alone), it fits the actual gaps, and the passage
       invariant below still floods and trims anything that manages to pinch regardless --
       this buffer only has to be reasonable, not airtight. */
    const clearAround = (x, n) => {
      for (let cx = x - n; cx <= x + 1 + n; cx++) {
        if (cx < 2 || cx > waterTo) return false;
        for (let y = 2; y <= 12; y++) if (map[y][cx] !== ' ' && map[y][cx] !== 'c') return false;
      }
      return true;
    };
    for (let i = 0, tries = 0; i < Math.min(4, 1 + Math.floor(lap / 2)) && tries < 60; tries++) {
      const x = pick(22, waterTo - 18), h = pick(3, 4);
      if (!clearAround(x, 4)) continue;
      if (vrnd() < 0.5) { for (let y = 12; y > 12 - h; y--) { map[y][x] = 'B'; map[y][x + 1] = 'B'; } }
      else { for (let y = 2; y < 2 + h; y++) { map[y][x] = 'B'; map[y][x + 1] = 'B'; } }
      i++;
    }
    // extra trails, on the rows a swimmer actually cruises
    for (let i = 0; i < 2 + lap; i++) {
      const x = pick(16, waterTo - 10);
      coinRow(x, x + 3, pick(4, 10));
    }
  } else if (lap > 0) {
    let vs = ((world * 2246822519) ^ (lv * 3266489917) ^ 0x5bf03635) % 2147483647;
    if (vs <= 0) vs += 2147483646;
    const vrnd = () => (vs = vs * 48271 % 2147483647) / 2147483647;
    const pick = (a, b) => a + Math.floor(vrnd() * (b - a + 1));

    const noPitNear = (x, n) => {
      /* Row 5 is out of reach of a jump from the ground -- but not of a jump from a
         block or a pipe top, and the run-up to a pit often includes one. Measured:
         three courses where a row-5 cluster capped a crossing that started from the
         shelf beside the hole, and the hero fell in. So every cluster, at any height,
         keeps clear of a pit's approach. */
      /* Nine tiles, because that is what the measurements say: a running jump spans
         about six tiles, the takeoff can be a tile or two before the lip, and BOLT's
         91px jump puts its head at y=101 -- row 6, one row under a row-5 cluster. A
         narrower window (four tiles) still lost one course in 126. */
      /* 9 tiles covers a running jump that starts on the floor. A cluster is itself a
         raised takeoff, and an arc that starts on top of one travels about 8 tiles
         before it crosses the floor again -- so the window has to be wider than the
         jump it enables. Measured on the terraced layout: a pit 10 tiles past a row-9
         shelf still caught the hero every time. */
      for (let cx = x - 14; cx <= x + n + 13; cx++) {
        if (cx < 4 || cx >= W - 10) return false;
        if (!solid(map[13][cx])) return false;
      }
      return true;
    };

    // extra walkers, thickening the course as the laps go on
    const extraWalkers = Math.min(7, Math.round(lap * 1.1));
    for (let i = 0; i < extraWalkers; i++) {
      const x = pick(22, 188);
      if (vrnd() < 0.75) P(x); else S(x);
    }
    // spiked walkers only from the third lap, and never more than three
    /* Spiked walkers are only added where the sky is ALREADY clear. The placement
       pass below can relocate one, but it is allowed to fall back to plain ground
       when nothing suitable is near -- and with the extra clusters in play that
       fallback started firing, which is exactly the unfair spot the rule exists to
       prevent. Rejection sampling here means the pass never has to compromise. */
    const extraSpikes = Math.min(3, Math.floor(lap / 2));
    for (let i = 0, tries = 0; i < extraSpikes && tries < 60; tries++) {
      const x = pick(30, 180);
      if (!airClear(x)) continue;
      SPK(x); i++;
    }
    // one hopper per two laps, for airspace pressure
    for (let i = 0; i < Math.min(2, Math.floor(lap / 3)); i++) FLP(pick(40, 170));
    // gliders own the air; a second cannon from the fourth lap owns the approach
    for (let i = 0; i < Math.min(3, 1 + Math.floor(lap / 3)); i++) GLD(pick(30, 180), 6 + (vrnd() < 0.5 ? 0 : 1), 16 + Math.floor(vrnd() * 10));
    if (lap >= 3) {
      /* A cannon stands on a two-tile plinth, which is a wall in the run-up to a
         pit: measured as one lost course (BOLT, world 5-1, dropped into the hole at
         column 87). Same nine-tile clearance the clusters use. */
      for (let tries = 0; tries < 30; tries++) {
        const x = pick(40, 170);
        if (!solid(map[13][x]) || map[12][x] !== ' ' || map[11][x] !== ' ') continue;
        if (!noPitNear(x, 1)) continue;
        CAN(x, 11);
        break;
      }
    }

    /* A block cluster, but only over open ground. The first cut placed them anywhere,
       and three of ten worlds became impassable: a cluster at row 9 landing beside a
       4-tile pipe caps the jump that climbs it, and one landing over a pit's run-up
       caps the jump that crosses it. Same failure the pit and spike rules already
       cover, so the cluster answers the same question before it is placed -- is the
       ground under and around me clear, is there a pipe in reach, is anything below
       me. Rejection sampling, so a crowded course simply gets fewer clusters. */
    /* Where a cluster may go depends on which row it is on, and the difference is
       measured, not guessed. A jump from the ground tops out with the hero's head at
       y=117 (row 7), so:
         row 9 (y=144) is inside every jump the course requires -- next to a pipe it
           caps the climb, over a pit's run-up it caps the crossing. Three of ten
           worlds became impassable before this check existed, so row 9 keeps the
           strict test: clear ground for the whole run-up, no pipe in reach, nothing
           underneath.
         row 5 (y=80..96) is above that ceiling and cannot be bonked from the ground
           at all, so it only has to avoid overwriting what is already there.
       The first version applied the strict test to both, which rejected nearly every
       candidate: world 2's terrain came out byte-identical to world 1's. */
    const spanClear = (x, n, from) => {
      for (let cx = x - 1; cx <= x + n; cx++) {
        if (cx < 4 || cx >= W - 10) return false;
        for (let y = from; y <= 12; y++) if (map[y][cx] !== ' ' && map[y][cx] !== 'c') return false;
      }
      return true;
    };
    const clusterOk = (x, n, row) => {
      if (row === 5) return noPitNear(x, n) && spanClear(x, n, 5);
      if (!noPitNear(x, n)) return false;
      for (let cx = x - 3; cx <= x + n + 2; cx++) {
        for (let y = 0; y < H - 2; y++) {
          const c = map[y][cx];
          if (c === 'T' || c === 'E' || c === 'P') return false;   // a pipe to climb
        }
      }
      return spanClear(x, n, row);
    };
    const clusters = 2 + Math.floor(lap / 2);
    for (let i = 0, tries = 0; i < clusters && tries < 80; tries++) {
      const x = pick(24, 176), n = pick(2, 4), row = vrnd() < 0.45 ? 9 : 5;
      if (!clusterOk(x, n, row)) continue;
      for (let k = 0; k < n; k++) set(x + k, row, k === 1 && vrnd() < 0.35 ? '?' : 'B');
      // coins where they can actually be collected: on top of a row-9 shelf, or at
      // head height under a row-5 one
      coinRow(x, x + n - 1, row === 9 ? 5 : 7);
      i++;
    }
    /* And from the third lap, one more lift -- over solid ground only. A lift is
       one-way solid from above, so one hanging over a pit is a trap for anyone who
       crosses by running: they land on the deck mid-jump, walk off the far end and
       drop into the hole. Found exactly that way, in world 14's third course. */
    if (lap >= 2) {
      for (let tries = 0; tries < 30; tries++) {
        const x = pick(60, 150);
        const kind = vrnd() < 0.6 ? 'h' : 'v';
        const travel = kind === 'h' ? 6 : -5;
        const span = kind === 'h' ? travel + 2 : 2;
        if (!noPitNear(x, span)) continue;
        plat(x, kind === 'h' ? 8 : 7, kind, travel);
        coinRow(x + 1, x + 4, 4);
        break;
      }
    }
  }

  /* ---------- a water course must stay swimmable ----------
     A swimmer is 30px tall and cannot place itself to the pixel, so the channel needs
     three clear rows, not two. The check is a flood fill over "places a hero can be":
     cell (x,y) counts when rows y, y+1 and y+2 are all clear, and the fill moves up,
     down, left and right from the spawn. If the shore is not in the flooded set the
     channel is pinched somewhere, and stalactite tips are trimmed -- from the bottom
     up, so the shape stays a stalactite -- until it opens.
     This is the same trade the pit and spike passes make: authoring stays free to be
     wrong, and the build refuses to ship the consequence. */
  if (water) {
    const FIT = 3;                                     // rows a 30px swimmer needs
    const fits = (x, y) => {
      for (let k = 0; k < FIT; k++) {
        const c = (y + k < 0 || y + k >= H) ? 'X' : map[y + k][x];
        if (solid(c)) return false;
      }
      return true;
    };
    const flood = () => {
      const seen = new Set();
      const key = (x, y) => y * W + x;
      const start = [];
      for (let y = 0; y <= 12; y++) if (fits(3, y)) start.push([3, y]);
      const q = start.slice();
      for (const [x, y] of start) seen.add(key(x, y));
      while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny > 12) continue;
          if (seen.has(key(nx, ny)) || !fits(nx, ny)) continue;
          seen.add(key(nx, ny)); q.push([nx, ny]);
        }
      }
      return seen;
    };
    const shoreReached = (seen) => {
      for (let y = 0; y <= 12; y++) if (seen.has(y * W + waterTo)) return true;
      return false;
    };
    let seen = flood(), trims = 0;
    while (!shoreReached(seen) && trims < 200) {
      /* The pinch is the first column the fill never reached; open it by taking the
         lowest ceiling tile in that column and its neighbour, which is what is
         actually in the way. */
      let px = -1;
      for (let x = 4; x <= waterTo && px < 0; x++) {
        let any = false;
        for (let y = 0; y <= 12; y++) if (seen.has(y * W + x)) any = true;
        if (!any) px = x;
      }
      if (px < 0) break;
      /* Trim the TIP, not whatever brick comes first: a stalactite hangs from the
         ceiling, so its tip is its lowest tile, and a coral pillar grows off the floor,
         so its tip is its highest. Cutting the wrong end leaves a pillar floating in
         mid-water, which reads as a bug rather than as terrain. */
      let cut = false;
      for (const x of [px, px - 1, px + 1]) {
        if (x < 0 || x >= W || cut) continue;
        let top = 1;                              // last row of the ceiling run
        while (top + 1 <= 12 && map[top + 1][x] === 'B') top++;
        let bot = 13;                             // first row of the floor run
        while (bot - 1 >= 2 && map[bot - 1][x] === 'B') bot--;
        if (top > 1) { map[top][x] = ' '; cut = true; }
        else if (bot < 13) { map[bot][x] = ' '; cut = true; }
      }
      if (!cut) break;
      trims++;
      seen = flood();
    }
  }

  /* ---------- no gap may be roofed ----------
     A brick row at row 9 sits four tiles above the floor, which is inside the arc
     of a running jump: crossing a pit under one, the hero bonks its head halfway
     across, loses the rest of the jump and drops in. Measured on the 3-tile pit at
     column 86 of course 1: clearing it needed a pixel-perfect takeoff, and being
     10px early was fatal -- an unfair death that looked like a physics bug.
     The airspace over every pit is therefore cleared after authoring, including
     the lip on each side, where takeoff and landing happen. Doing it here rather
     than by editing each collision means a later edit cannot reintroduce the trap.
     A ? or powerup block is not deleted but walked left to the nearest free cell,
     so the reward survives and the row still reads as one group. */
  /* The approach side needs THREE tiles, not one. The original window assumed takeoff
     happens on the lip, but a hero at full run speed leaves the ground 2-3 tiles before
     it, and its head is still rising through these rows for the next ~2.8 tiles
     (measured: ascent sweep 1.90 tiles for BOLT, 2.19 for PIP, 2.83 for MOCHI at run
     speeds 2.54 / 2.70 / 3.02 px per frame).
     Found by the adaptive traversal bot on layout 2, which recurs at world 1-3, 2-2,
     3-1, 6-3, 7-2, 8-1, 11-3, 12-2 and every fifth course after: a ? group sat at row 9
     over columns 86-88 with a 3-tile pit at 90-92, so the lip-1 window cleared 89-93 and
     left the block at 88 -- exactly the takeoff point. MOCHI (lowest jump, highest speed,
     so it leaves earliest and has the least height to spare) bonked that block mid-ascent,
     vy went -6.81 -> 0.5 in one frame, and it dropped into the pit pressed against the far
     lip. Proven by deleting those three cells and re-running: far 93 (dead) -> 100 (alive).
     This is the same unfair-death shape the rule was written for, one tile outside the
     window it was given. */
  const airCols = new Set();
  for (const x of gapCols) {
    for (let d = -3; d <= 1; d++) airCols.add(x + d);
  }
  for (const x of airCols) {
    if (x < 0 || x >= W) continue;
    for (const y of AIR_ROWS) {
      const c = map[y][x];
      if (c === ' ' || c === 'c') continue;   // coins are not solid: they stay
      map[y][x] = ' ';
      if (c === 'B' || c === 'X') continue;   // plain brick: just gone
      for (let d = 2; d <= 14; d++) {         // reward block: relocate, do not lose
        const nx = x - d;
        if (nx < 1 || airCols.has(nx)) continue;
        if (map[y][nx] === ' ') { map[y][nx] = c; break; }
      }
    }
  }

  /* ---------- one placement pass for every ground enemy ----------
     Two rules apply to where a walker may start, and they were enforced in two
     separate passes that each undid part of the other's work (a relocated spike
     landed on a walker's column; a walker moved off a pit onto a column another
     walker already held). One ordered pass, one column each:

       1. It must stand on solid ground. Five walkers per layout were authored on
          top of the holes they were meant to guard (P(70) over gap(69,70), P(88)
          over gap(86,88), P(90..92) over gap(90,92)). A spawner over a hole wakes
          when the camera arrives, drops straight in and is culled -- the encounter
          the course was built around never happens, and what the player sees is an
          enemy appearing and falling into a hole for no reason.
       2. A SPIKO additionally needs open sky. It cannot be stomped, so the only
          answer to one on flat ground is to jump over it, and a brick row overhead
          caps the jump at 32px -- measured on course 2's spike at column 85, every
          approach that took off before the ? group bonked and came down on the
          spines. Where no such column exists nearby, plain ground still beats a
          pit, so the search relaxes rather than giving up.

     Pipe plants are exempt: they belong to a pipe mouth, which is solid by
     definition and never shared. */
  const usedCols = new Set();
  for (const e of enemies) {
    // pipe plants own a pipe mouth; gliders fly and cannons stand on their own plinth
    if (e.type === 'chomp' || e.air) continue;
    const cx0 = Math.round(e.x / TILE);
    const inBounds = (x) => x > 1 && x < W - 6;
    /* "Grounded" now means there is a surface here that a walker can stand on with room
       above it -- not merely that row 13 is solid. Under a terrace, row 13 is solid and
       the walker would be inside the rock. */
    const grounded = (x) => {
      if (!inBounds(x) || usedCols.has(x)) return false;
      const sr = surfaceRow(x);
      if (sr > 13) return false;                       // a pit
      return !solid(map[sr - 1][x]) && !solid(map[sr - 2][x]);
    };
    const ideal = (x) => grounded(x) && (!e.spiky || airClear(x));
    let cx = cx0;
    if (!ideal(cx)) {
      cx = -1;
      for (let d = 1; d <= 26 && cx < 0; d++) {          // best fit first
        if (ideal(cx0 + d)) cx = cx0 + d;
        else if (ideal(cx0 - d)) cx = cx0 - d;
      }
      for (let d = 0; d <= 26 && cx < 0; d++) {          // then merely on ground
        if (grounded(cx0 + d)) cx = cx0 + d;
        else if (grounded(cx0 - d)) cx = cx0 - d;
        /* A spike that had to settle for plain ground is standing under a ceiling,
           which is the unfair spot this whole rule exists to prevent -- measured once
           in 36 courses, on the densest late world. Rather than ship it, the hazard
           degrades: it becomes an ordinary walker, which a capped jump can still
           answer by stomping. A fair enemy in a tight spot beats an unfair one. */
        if (cx >= 0 && e.spiky) {
          e.spiky = false; e.type = 'puff';
          e.h = 12; e.y = 13 * TILE - 12; e.py = e.y;
          e.vx = -0.45 * pace;
        }
      }
      if (cx < 0) cx = cx0;                              // nothing free: leave it
    }
    usedCols.add(cx);
    e.x = cx * TILE;
    e.y = surfaceY(cx, e.h);      // the surface here may not be the one it was authored on
    e.py = e.y;
  }

  /* ---------- bonus-room exits must be real pipes ----------
     The exit column is authored by hand, and three of the three were wrong on the
     first pass (60, 68 and 56 hold no pipe at all), which sent every trip down the
     fallback path: the player came back out of the pipe they went in, so the detour
     bought nothing and looked like a bug. The column is now checked and, if it is
     not a pipe top, snapped to the nearest one ahead of the entrance. */
  for (const e of entries) {
    const isTop = (x) => {
      if (x < 0 || x >= W) return false;
      for (let y = 0; y < H; y++) if (map[y][x] === 'T' || map[y][x] === 'E') return true;
      return false;
    };
    if (isTop(e.exitTx) && e.exitTx > e.tx) continue;
    let best = -1;
    for (let x = e.tx + 4; x < W - 8 && best < 0; x++) if (isTop(x)) best = x;
    if (best >= 0) e.exitTx = best;
  }

  /* ---------- checkpoint ----------
     A course is 198 tiles. Losing a life sent the player back to tile 3, which
     turns one mistake near the flag into three minutes of replay -- the single
     biggest source of tedium left in the game. The halfway marker needs the same
     footing the player will respawn onto: ground below, open sky above (so the
     respawn cannot drop them onto a brick or inside a pipe), and clear of any
     pit, so the search walks outward from the midpoint until it finds one. */
  const spawnable = (cx) => {
    for (let x = cx - 1; x <= cx + 2; x++) {
      if (x < 4 || x >= W - 8) return false;
      if (!solid(map[13][x])) return false;
      for (let y = 6; y <= 12; y++) if (solid(map[y][x])) return false;
    }
    /* And no enemy may start within three tiles. Courses 2 and 3 put a walker
       0-16px from the midpoint, so respawning would have dropped the player
       straight into it -- a checkpoint that costs a life is worse than none. */
    for (const e of enemies) if (!e.air && Math.abs(e.x - cx * TILE) < 3 * TILE) return false;
    return true;
  };
  let checkX = 0;
  for (let d = 0; d < 70 && !checkX; d++) {
    if (spawnable(99 + d)) checkX = 99 + d;
    else if (spawnable(99 - d)) checkX = 99 - d;
  }
  /* Last resort: with the extra walkers a later world adds, two courses had no column
     that satisfied every condition, and the checkpoint silently did not exist. A
     checkpoint is worth more than one walker, so the search relaxes to "ground and
     open sky" and any enemy standing too close is retired. */
  if (!checkX) {
    const footing = (cx) => {
      for (let x = cx - 1; x <= cx + 2; x++) {
        if (x < 4 || x >= W - 8) return false;
        if (!solid(map[13][x])) return false;
        for (let y = 6; y <= 12; y++) if (solid(map[y][x])) return false;
      }
      return true;
    };
    for (let d = 0; d < 70 && !checkX; d++) {
      if (footing(99 + d)) checkX = 99 + d;
      else if (footing(99 - d)) checkX = 99 - d;
    }
    if (checkX) {
      for (let i = enemies.length - 1; i >= 0; i--)
        if (Math.abs(enemies[i].x - checkX * TILE) < 3 * TILE) enemies.splice(i, 1);
    }
  }

  return { map, W, H, enemies, plats, decos, entries, water, waterTo,
           flagX: 198, castleX: 201, timeLimit: water ? 500 : 400, checkX };
}

/* ---------- fortress ----------
   The last course of every world. Shorter than a field course (128 tiles against
   198) and built from three beats: a lava crossing, a fire-bar corridor, then the
   bridge. It returns the same object shape a field course does, with the extra
   pieces a fortress needs (`bars`, `boss`, `bridge`, `axeX`) and the field-only ones
   empty, so every system that reads a level keeps working untouched. */
function buildFortress(world) {
  const W = 128, H = 15;
  const map = Array.from({ length: H }, () => Array(W).fill(' '));
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) map[y][x] = c; };
  const lap = Math.min(world - 1, 7);
  let fs = ((world * 2654435761) ^ 0x1f2e3d4c) % 2147483647;
  if (fs <= 0) fs += 2147483646;
  const rnd = () => (fs = fs * 48271 % 2147483647) / 2147483647;
  const pick = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  for (let x = 0; x < W; x++) { map[13][x] = 'X'; map[14][x] = 'X'; }
  for (let x = 0; x < W; x++) { map[0][x] = 'X'; }          // fortress has a roof

  /* Lava pools. Each is 2-3 wide with the floor cut away, and every pool gets a
     block bridge above it: the crossing is a jump, not a coin flip, and a player who
     misses the jump lands in lava rather than in an unreachable pit. */
  const pools = [];
  const poolAt = (x, w) => {
    for (let i = 0; i < w; i++) { set(x + i, 13, 'L'); set(x + i, 14, 'L'); }
    pools.push({ x, w });
  };
  /* Pools are 3 and 4 wide, not 2 and 3. A narrow pool with a small stone in it is
     the worst of both: the stone is a 16px target that a walking jump overshoots by a
     fraction (measured: the hero passed the deck's right edge 0.2px before its feet
     reached the deck's height), and the pool is too narrow to read as a hazard. Wider
     pools with a 2-tile deck give an 8-16px hop on each side -- inside the 29px a
     standing jump reaches -- and look like something worth being careful about. */
  poolAt(20, 3); poolAt(34, 4); poolAt(52, 3);
  if (lap >= 2) poolAt(66, 4);
  if (lap >= 4) poolAt(78, 3);

  /* Reward shelves at row 9 only. The first cut also put block pairs at row 5, and
     they were pure trap: a big hero standing on a row-9 shelf and jumping bonks a row-5
     pair 48px above it, loses the jump and lands in the pool four tiles ahead -- traced
     exactly that, MOCHI in the big form, worlds 3 through 5. Row 5 is unreachable
     decoration in a fortress anyway; the vertical interest here comes from the pillars
     and the bars. The shelves themselves also keep six tiles clear of every pool, so a
     hop off the end of one cannot carry into lava. */
  for (const x of [14, 28, 45, 58, 88]) { set(x, 9, 'B'); set(x + 1, 9, '?'); set(x + 2, 9, 'B'); }
  set(45, 5, 'F');                                          // one flower, the fortress answer

  /* Fire bars: a chain of links pivoting on a block. Placed on the corridor between
     the last pool and the bridge, never over lava -- a hazard you cannot retreat from
     is the kind of thing this game keeps deciding not to ship. */
  /* One blaze per pool, offset so they never leap together, and a patrol between the
     pools. The fortress had no enemies at all: three hazards and 10-14 tile gaps of
     nothing between them. */
  const enemies = [];
  pools.forEach((p, i) => {
    enemies.push({
      type: 'blaze', x: (p.x + Math.floor(p.w / 2)) * TILE - 1, y: 14 * TILE,
      w: 12, h: 16, vx: 0, vy: 0, t: (i * 47) % 200, air: true,
      /* Airtime is 2*power/0.30 frames, so period has to stay well above it or the pool
         is blocked more often than it is open. Measured: at lap 7 the first numbers
         (period 94, power 8.7) put the flame in the air 62% of the time. Capped, the
         duty cycle stays between 33% and 41% at every lap -- it gets faster, it never
         gets closed. */
      homeY: 14 * TILE, period: Math.max(132, 150 - lap * 4),
      power: 7.4 + lap * 0.1, up: false
    });
  });
  for (const x of [26, 44, 62, 82, 96]) {
    if (map[13][x] !== 'X' || map[12][x] !== ' ') continue;
    enemies.push({ type: 'shelly', x: x * TILE, y: 13 * TILE - 16, w: 12, h: 16,
                   vx: -0.4 * (1 + lap * 0.06), vy: 0, t: 0 });
  }

  /* A stepping stone over every pool. Measured: a jump from a standstill reaches
     29-31px and rises 76-91px, while a 2-tile pool needs 36px and a 3-tile pool 52px
     -- so a player who stopped at the lip (which is exactly what the flame in the pool
     asks them to do) could not cross at all. A one-tile deck 32px up splits the
     crossing into two hops of 8-16px, both inside the standing reach, and keeps the
     hazard: you still have to land on a stone over lava. */
  const plats = [];
  for (const p of pools) {
    const cx = Math.round(p.x * TILE + (p.w * TILE) / 2 - 16);
    plats.push({ kind: 'h', w: 32, h: 8, x: cx, y: 11 * TILE, x0: cx, y0: 11 * TILE,
                 from: cx, to: cx, speed: 0, t: 0, dx: 0, dy: 0, deckWas: 11 * TILE });
  }

  const bars = [];
  const barCount = 2 + Math.floor(lap / 2);
  const barSpots = [40, 58, 72, 84, 94].slice(0, barCount);
  for (const bx of barSpots) {
    set(bx, 9, 'U');                                        // the pivot block
    bars.push({ x: bx * TILE + 8, y: 9 * TILE + 8, len: 4 + (lap >= 3 ? 1 : 0),
                a: rnd() * Math.PI * 2, spin: (rnd() < 0.5 ? 1 : -1) * 0.022 });
  }

  /* The bridge, the boss and the axe. The bridge is ordinary ground until the axe is
     struck, at which point its tiles are removed and the boss falls with them. */
  const bridgeX = 104, bridgeW = 10;
  for (let i = 0; i < bridgeW; i++) { set(bridgeX + i, 13, 'X'); set(bridgeX + i, 14, 'L'); }
  for (let x = bridgeX - 3; x < bridgeX; x++) { set(x, 13, 'X'); set(x, 14, 'X'); }
  const axeX = bridgeX + bridgeW + 2;
  set(axeX, 12, 'A');
  const boss = {
    x: (bridgeX + 4) * TILE, y: 13 * TILE - 30, w: 24, h: 30,
    vx: -0.5 - lap * 0.05, vy: 0, t: 0, dead: false, hp: 5,
    homeA: (bridgeX - 1) * TILE, homeB: (bridgeX + bridgeW - 2) * TILE,
    fire: 90 - lap * 6
  };
  /* Pillars and lit windows, background only -- they never collide. Placed away from the
     bars and the bridge so they never sit behind a hazard the player is reading. */
  const decos = [];
  let bay = 0;                       // x/11 is never an integer, so alternate on a counter
  for (let x = 6; x < bridgeX - 6; x += 11, bay++) {
    if (barSpots.some(b => Math.abs(b - x) < 3)) continue;
    if (bay % 2 === 0) decos.push({ spr: 'pillar', x: x * TILE, y: 32, px: 0.72 });
    else decos.push({ spr: 'window', x: x * TILE, y: 40, px: 0.72 });
  }
  return {
    map, W, H, enemies, plats, decos, entries: [],
    bars, boss, bridgeX, bridgeW, axeX,
    fortress: true, flagX: 9999, castleX: 9999, checkX: 0, timeLimit: 300
  };
}

/* ---------- bonus rooms ----------
   A small closed cavern reached through a pipe: coins, one power-up, and an exit pipe
   that puts the player further along the course than they went in. No enemies and no
   pit in any of them, because the trade the player accepted was "leave the course for a
   moment", not "take a second risk".

   Three rooms, chosen by the entrance (`entry.room`), each with a different verb --
   walk the gallery, climb the shaft, crawl the tunnel.

   The geometry all comes from two numbers: the hero is 30px tall when big and jumps
   75px. So a reward block sits FOUR rows above the surface you hit it from (three rows
   leaves 2px of headroom -- the big hero cannot even start the jump), a climb of three
   rows is comfortable, and a coin four to five rows up is collected in flight rather
   than from a standing position. Every number below is one of those cases.

   The two rows above the exit pipe's lip are cleared unconditionally at the end, because
   a big hero standing on that lip occupies them: an early draft put a ? block directly
   over the exit and the collision shoved the hero onto the block instead, so the exit
   could not be stood on at all. Cheaper to enforce than to remember.
*/
function roomShell(W, H) {
  const map = Array.from({ length: H }, () => Array(W).fill(' '));
  for (let x = 0; x < W; x++) { map[13][x] = 'X'; map[14][x] = 'X'; map[0][x] = 'X'; map[1][x] = 'X'; }
  for (let y = 0; y < H; y++) { map[y][0] = 'X'; map[y][W - 1] = 'X'; }
  return map;
}
function roomFor(entry, world) {
  const H = 15;
  const which = ((entry && entry.room) | 0) % 3;
  let W, map, exitTx, exitTy, exitBase = 13;
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) map[y][x] = c; };
  const coins = (x0, x1, y) => { for (let x = x0; x <= x1; x++) if (map[y][x] === ' ') set(x, y, 'c'); };
  const shelf = (x0, x1, y, c) => { for (let x = x0; x <= x1; x++) set(x, y, c || 'B'); };

  if (which === 1) {
    /* ---------- CHIMNEY ----------
       Narrow and tall, and the exit is at the top: the room is a climb, so the coins sit
       over every step rather than only over the last one -- the player is paid the whole
       way up. The pipe stands on the top step, which is what `exitBase` is for; without
       it the body would be extruded down to the floor and wall off the shaft.

       Steps, not floating ledges. The first draft hung two shelves in the shaft, and the
       small hero -- 16px in a 16px gap -- simply walked underneath the first one and ran
       out of shaft, while the big hero was blocked by it and climbed. A room that only
       the big form can leave is a trap, and the timer is still running.
       So every step is solid from its top row down to the floor: there is no overhang to
       walk under, in either form, and no jump in here needs to be aimed. */
    W = 14; map = roomShell(W, H);
    for (let y = 12; y <= 12; y++) shelf(3, 4, y, 'X');
    for (let y = 10; y <= 12; y++) shelf(5, 6, y, 'X');
    for (let y = 8; y <= 12; y++) shelf(7, 12, y, 'X');
    exitTx = 11; exitTy = 6; exitBase = 8;
    coins(1, 2, 11); coins(1, 2, 12);      // the floor
    coins(3, 4, 10); coins(3, 4, 11);      // over the first step
    coins(5, 6, 8); coins(5, 6, 9);        // over the second
    coins(7, 10, 6); coins(7, 10, 7);      // over the third, clear of the pipe
    /* One row up here, not two: the body sweep over a step is a trail, but four stacked
       rows in the same four columns stops reading as a trail and starts reading as a
       coin curtain. Checked on screen, not in the numbers. */
    coins(7, 10, 4);                       // and a high row, taken in flight from the top
    set(2, 9, '?');                        // four rows over the floor
    set(5, 6, 'M');                        // four rows over the second step
  } else if (which === 2) {
    /* ---------- TUNNEL ----------
       A stone mass with a two-tile crawlway under it. The big hero clears a 32px opening
       by 2px and cannot jump while inside, so the room is a held breath rather than a
       playground; the trail runs on row 12, the row a running hero of either size
       already sweeps, so the crawl pays by the tile.
       The power-ups are in the chamber at the far end and never in the tunnel. Growing
       inside a 32px crawlway is a fine way to build a room the player cannot leave. */
    W = 26; map = roomShell(W, H);
    for (let y = 2; y <= 10; y++) shelf(4, 18, y, 'X');
    exitTx = 22; exitTy = 11;
    coins(5, 17, 12);                      // the crawl
    coins(1, 3, 11); coins(1, 3, 12);      // the mouth
    /* The column right of the tunnel mouth stays clear overhead. The first cut put the ?
       block there, four rows up, and 18px of headroom is not enough to clear a 32px pipe
       lip: the big hero came out of the crawl and was sealed into the chamber. */
    set(20, 9, '?'); set(24, 9, 'M');
    coins(22, 23, 8); coins(20, 24, 6);    // taken in flight, not from a standstill
  } else {
    /* ---------- VAULT ----------
       Two galleries with a brick shelf under each. The high coin row is out of reach
       from the floor (75px of jump against 128px of height), so the shelf is the way up
       and the reward is a route rather than a handout.
       The blocks used to be part of the shelves at row 10 -- three rows over the floor,
       which is exactly the 2px case: a big hero standing under one could not jump into
       it at all. They hang over the middle aisle now. */
    W = 22; map = roomShell(W, H);
    exitTx = 18; exitTy = 11;
    for (const y of [5, 8]) { coins(3, 8, y); coins(12, 16, y); }
    shelf(4, 7, 10); shelf(12, 15, 10);
    set(9, 9, 'M'); set(10, 9, '?');
  }

  set(exitTx, exitTy, 'E'); set(exitTx + 1, exitTy, 'E');
  for (let y = exitTy + 1; y < exitBase; y++) { set(exitTx, y, 'P'); set(exitTx + 1, y, 'P'); }
  for (const y of [exitTy - 1, exitTy - 2]) {
    if (map[y][exitTx] !== 'X') set(exitTx, y, ' ');
    if (map[y][exitTx + 1] !== 'X') set(exitTx + 1, y, ' ');
  }
  return {
    map, W, H, enemies: [], plats: [], decos: [], entries: [],
    flagX: 9999, castleX: 9999, checkX: 0, timeLimit: 400,
    room: true, roomId: which, exitTx, exitTy, exitTo: entry.exitTx
  };
}

/* ---------- game state ---------- */
const GAME = {
  state: 'title',
  score: 0, coins: 0, lives: 3,
  world: 1, lv: 1,
  time: 400, timeF: 0, frame: 0,
  mario: null, camera: 0, level: null,
  items: [], particles: [], popups: [], bumps: [],
  /* What the run was, not just what it scored. Reset with the run, never with a
     course: dying halfway through world 3 should not erase the coins from world 1. */
  run: { coins: 0, foes: 0, chain: 0, courses: 0 },
  scores: [], scoreAt: -1,
  flagSlide: false, walkDone: false, clearTimer: 0,
  readyTimer: 0, combo: 0, paused: false,
  charIdx: 0, bgmOn: true, shake: 0,
  balls: [], high: 0, theme: 0, fade: 0, fadeDir: 0,
  camPrev: 0, alpha: 1,
  hint: null, hintT: 0, taughtRun: false, taughtFire: false, taughtSpike: false,
  bannerY: 0, castleFlagY: 0, warnedTime: false, afterDeath: false,
  checkArmed: false, checkT: 0,
  timeUp: false, overSel: 0, worldDone: false,
  maxWorld: 1, startWorld: 1,
  rebind: -1,          // index into REBINDABLE while the rebind screen is up
  rebindMsg: '', rebindT: 0,
  room: null, pipeAnim: null, taughtPipe: false,
  collapse: 0, bossDown: false, taughtAxe: false
};
const COMBO_PTS = [100,200,400,800,1000,2000,4000,5000,8000];
/* Furthest world reached, and the world the title screen is currently offering. The
   score is deliberately NOT saved: unlocking a starting point is progress, carrying a
   score across sessions would make the high score meaningless. */
function loadProgress() {
  try { return Math.max(1, Math.min(99, parseInt(localStorage.getItem('pipoWorld') || '1', 10) || 1)); }
  catch (e) { return 1; }
}
function saveProgress(w) {
  try { localStorage.setItem('pipoWorld', String(Math.max(1, Math.min(99, w)))); } catch (e) {}
}
function loadHigh() { try { return parseInt(localStorage.getItem('pipoHigh') || '0', 10) || 0; } catch (e) { return 0; } }
function saveHigh(v) { try { localStorage.setItem('pipoHigh', String(v)); } catch (e) {} }
/* ---------- the top five ----------
   `pipoHigh` stays as it is -- an old install keeps its number, and the top bar keeps
   reading it. The table is additive: score, where the run ended, which hero ran it, and
   the two counts that say how the run was played. Every field is validated on load,
   because a hand-edited or half-written entry should cost the table one row, not the
   whole screen. */
const SCORES_KEY = 'pipoScores', SCORES_MAX = 5;
function loadScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORES_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(e => e && typeof e.s === 'number' && isFinite(e.s) && e.s >= 0)
      .map(e => ({
        s: Math.max(0, Math.min(9999999, Math.round(e.s))),
        w: Math.max(1, Math.min(99, e.w | 0)) || 1,
        lv: Math.max(1, Math.min(4, e.lv | 0)) || 1,
        hero: typeof e.hero === 'string' ? e.hero.slice(0, 6) : '',
        coins: Math.max(0, Math.min(9999, e.coins | 0)),
        foes: Math.max(0, Math.min(9999, e.foes | 0))
      }))
      .sort((a, b) => b.s - a.s)
      .slice(0, SCORES_MAX);
  } catch (e) { return []; }
}
function saveScores(list) {
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(list)); } catch (e) {}
}
/* Insert this run and report where it landed, or -1 if it did not place. A zero never
   places: an accidental Enter on the title screen should not push a real run off the
   bottom of the table. */
function submitScore() {
  if (GAME.score <= 0) return -1;
  const entry = {
    s: GAME.score, w: GAME.world, lv: GAME.lv, hero: CHARS[GAME.charIdx].name,
    coins: GAME.run.coins, foes: GAME.run.foes
  };
  const list = GAME.scores.slice();
  list.push(entry);
  list.sort((a, b) => b.s - a.s);
  const at = list.indexOf(entry);
  GAME.scores = list.slice(0, SCORES_MAX);
  saveScores(GAME.scores);
  return at < SCORES_MAX ? at : -1;
}
GAME.high = loadHigh();
GAME.scores = loadScores();
GAME.maxWorld = loadProgress();
GAME.startWorld = GAME.maxWorld;

function resetMario() {
  const ch = CHARS[GAME.charIdx];
  const spawnTile = (GAME.checkArmed && GAME.level && GAME.level.checkX) ? GAME.level.checkX : 3;
  GAME.mario = {
    x: spawnTile*TILE, y: 13*TILE - 16, w: 12, h: 16,
    vx: 0, vy: 0, onGround: true, facing: 1,
    big: false, fire: false, invuln: 0,
    dead: false, deathTimer: 0, star: 0,
    jumpBuf: 0, coyote: 0,
    plat: null,          // the lift being ridden, if any
    state: 'stand', animT: 0, sq: 1
  };
  snapMario();   // no interpolation across a spawn
}
function snapAll(list) {
  for (let i = 0; i < list.length; i++) { const e = list[i]; e.px = e.x; e.py = e.y; }
}
/* collapse the interpolation gap: use after any deliberate teleport */
function snapMario() {
  const m = GAME.mario;
  if (m) { m.px = m.x; m.py = m.y; }
  GAME.camPrev = GAME.camera;
}
/* Continue: same world, fresh lives, score back to zero. The high score has
   already been banked by the game-over transition, so a continued run cannot
   inflate it. */
function continueGame() {
  GAME.score = 0; GAME.coins = 0; GAME.lives = 3; GAME.lv = 1;
  GAME.run = { coins: 0, foes: 0, chain: 0, courses: 0 };
  GAME.afterDeath = false; GAME.overSel = 0;
  startLevel();
}
function startGame() {
  GAME.score = 0; GAME.coins = 0; GAME.lives = 3;
  GAME.run = { coins: 0, foes: 0, chain: 0, courses: 0 };
  GAME.scoreAt = -1;
  GAME.world = Math.max(1, Math.min(GAME.maxWorld, GAME.startWorld)); GAME.lv = 1;
  GAME.afterDeath = false; GAME.overSel = 0; GAME.worldDone = false;
  BGM.stop();
  saveSettings(); // remember the hero the player just picked
  GAME.taughtRun = false; GAME.taughtFire = false; GAME.taughtSpike = false;
  GAME.taughtPipe = false; GAME.taughtAxe = false;
  startLevel();
}
function startLevel(keepCheckpoint) {
  /* Course 4 of every world is its fortress. buildFortress returns the same shape a
     field course does, so nothing downstream needs to know which it got. */
  GAME.level = GAME.lv === 4 ? buildFortress(GAME.world) : buildLevel(GAME.lv, GAME.world);
  // a death returns to the marker; a new course always starts at the beginning
  if (!keepCheckpoint) { GAME.checkArmed = false; GAME.checkT = 0; }
  /* A death inside a bonus room rebuilds the course, so the room state has to go
     with it -- otherwise the next life starts holding a reference to a cavern. */
  GAME.room = null; GAME.pipeAnim = null;
  GAME.collapse = 0; GAME.bossDown = false;
  /* The rotation is over the three COURSE palettes. It used to read
     `% THEMES.length`, which happened to give the same answer only because lv never
     exceeds 3 -- appending the cavern palette made that a coincidence rather than a
     rule, so the bound is now explicit. */
  /* Offset by world as well as course: world 1 runs MEADOW/SUNSET/MIDNIGHT, world 2
     opens on SUNSET, world 3 on MIDNIGHT. Three layouts times three palettes reads
     as far more variety than three layouts always dressed the same way. */
  /* A course type that has its own palette uses it; only the three field palettes
     rotate. The lagoon palette was written and then never selected -- the water course
     came out looking like an ordinary sunset field. */
  GAME.theme = GAME.lv === 4 ? FORTRESS_THEME
             : GAME.level.water ? LAGOON_THEME
             : (GAME.lv - 1 + (GAME.world - 1)) % COURSE_THEMES;
  GAME.items = []; GAME.particles = []; GAME.popups = []; GAME.bumps = [];
  GAME.balls = [];
  GAME.fade = 1; GAME.fadeDir = -1; // fade up from black into the new course
  GAME.time = GAME.level.timeLimit; GAME.timeF = 0; GAME.combo = 0;
  resetMario();
  // camera derived from the spawn instead of pinned to 0, which would have shown
  // the course start for a frame before snapping to a checkpoint respawn
  GAME.camera = Math.max(0, Math.min(GAME.mario.x - CAM_LEAD, GAME.level.W * TILE - LOGICAL_W));
  GAME.camPrev = GAME.camera; GAME.alpha = 1;
  GAME.flagSlide = false; GAME.walkDone = false; GAME.clearTimer = 0;
  GAME.bannerY = 0; GAME.castleFlagY = 0; GAME.warnedTime = false;
  GAME.readyTimer = 0;
  GAME.hint = null; GAME.hintT = 0;
  GAME.timeUp = false;
  /* A course never begins paused. No keyboard path reaches here with paused set --
     the toggle, quit and autoPause are all gated on state 'play', and update() makes
     no state transitions while paused, so `paused` implies 'play' today. But the
     combination is a hard lock if it ever happens: update() returns before the ready
     timer advances, so the state stays 'ready' forever, and the toggle below refuses
     to fire outside 'play'. Resetting here makes the invariant structural instead of
     a property of the paths that currently exist. */
  GAME.paused = false;
  GAME.state = 'ready';
  BGM.select(GAME.theme);   // each theme has its own track
  if (GAME.bgmOn) BGM.start();
}
function nextLevel() {
  // 3 courses per world, matching the 3 layouts and 3 themes. It used to run to
  // 1-4, which replayed 1-1's layout and theme, so x-3 -> x-4 -> (x+1)-1 gave
  // three identical-looking courses back to back.
  GAME.lv += 1;
  if (GAME.lv > 4) { GAME.lv = 1; GAME.world += 1; }
  GAME.worldDone = false;
  /* Bank the best score at every course boundary, not only on game over. A run
     that ends by closing the tab used to leave nothing behind. */
  GAME.run.courses++;
  if (GAME.score > GAME.high) { GAME.high = GAME.score; saveHigh(GAME.high); }
  // and the furthest world, so the next session can start from it
  if (GAME.world > GAME.maxWorld) {
    GAME.maxWorld = GAME.world;
    GAME.startWorld = GAME.world;
    saveProgress(GAME.maxWorld);
  }
  startLevel();
}

function onKeyPress(k) {
  /* While the rebind screen is up it swallows everything: the raw key is captured by the
     keydown handler before this point, so anything reaching here is the escape hatch. */
  if (GAME.rebind >= 0) return;
  if (k === 'mute') { Sound.muted = !Sound.muted; saveSettings(); return; }
  if (k === 'bgm') {
    GAME.bgmOn = !GAME.bgmOn;
    if (GAME.bgmOn && (GAME.state === 'play' || GAME.state === 'ready' || GAME.state === 'clear')) BGM.start();
    else BGM.stop();
    saveSettings();
    return;
  }
  if (GAME.state === 'title') {
    if (k === 'left') { GAME.charIdx = (GAME.charIdx + CHARS.length - 1) % CHARS.length; Sound.kick(); }
    else if (k === 'right') { GAME.charIdx = (GAME.charIdx + 1) % CHARS.length; Sound.kick(); }
    /* DOWN cycles the starting world through what has been unlocked. It is the one
       control the title screen had spare, and it already means "go in" on a pipe. */
    else if (k === 'down' && GAME.maxWorld > 1) {
      GAME.startWorld = GAME.startWorld >= GAME.maxWorld ? 1 : GAME.startWorld + 1;
      Sound.kick();
    }
    if (k === 'start' || k === 'jump') startGame();
    return;
  }
  if (GAME.state === 'gameover') {
    if (k === 'left' || k === 'right') {   // ArrowUp is 'jump', so it confirms
      GAME.overSel = 1 - GAME.overSel; Sound.kick();
    } else if (k === 'start' || k === 'jump') {
      BGM.stop();
      if (GAME.overSel === 0) continueGame(); else GAME.state = 'title';
    }
    return;
  }
  /* A course could only be left by dying three times. Quitting is gated behind
     the pause screen, where it is listed, so it cannot be hit by accident. */
  if (k === 'quit' && GAME.paused && GAME.state === 'play') {
    GAME.paused = false; BGM.stop();
    if (GAME.score > GAME.high) { GAME.high = GAME.score; saveHigh(GAME.high); }
    /* This used to only bank `pipoHigh`, which the title's corner reads, and never touch
       the ranking table -- a run good enough for the top five that ended by quitting
       instead of dying vanished from the table forever, while the corner kept the number
       with no context to back it (the title only prints the world/hero once the table's
       top row matches GAME.high). Quitting is one of exactly two ways a run ends, so it
       submits the same as death does; there is just no card to show it on. */
    submitScore();
    GAME.state = 'title';
    return;
  }
  /* Pausing still requires live play, but UN-pausing is allowed from any state, so a
     paused game is never a game you cannot get out of from the keyboard. */
  if (k === 'pause' && (GAME.state === 'play' || GAME.paused)) {
    GAME.paused = !GAME.paused;
    // music kept playing straight through a pause
    if (GAME.paused) BGM.stop(); else if (GAME.bgmOn) BGM.start();
    return;
  }
  /* Everything below is live-play input. It used to be reachable from every
     other state: jump buffered a hop during READY, the clear walk and the pause
     screen (so the hero leapt the instant control returned), and fire actually
     spawned a fireball while paused. `live` is the one gate. */
  const live = GAME.state === 'play' && !GAME.paused && GAME.mario && !GAME.mario.dead;
  if (!live) return;
  if (k === 'jump') GAME.mario.jumpBuf = 8;
  if (k === 'fire') {
    const m = GAME.mario;
    if (m.fire && GAME.balls.length < 2) {
      const by = m.y + (m.big ? 10 : 5);
      let bx = m.facing === 1 ? m.x + m.w : m.x - 8;
      // Firing while pressed against a wall used to spawn the ball inside solid
      // tiles, where it died on its first step: the shot and the sound were
      // spent for nothing. Fall back to Mario's own body, which is always clear.
      const inWall = (px, py) => solid(cellAt(Math.floor(px / TILE), Math.floor(py / TILE)));
      if (inWall(bx + 4, by + 4)) bx = m.x + m.w / 2 - 4;
      GAME.balls.push({
        x: bx, y: by, w: 8, h: 8,
        vx: m.facing * 4.5, vy: 0, spin: 0
      });
      Sound.fireball();
    }
  }
}

/* ---------- tile physics ---------- */
function solid(c) {
  return c === 'X' || c === 'B' || c === 'M' || c === 'F' || c === 'S' || c === 'U' ||
         c === 'T' || c === 'P' || c === 'f' || c === '?' || c === 'E';
}
/* Lava is not solid -- you fall into it -- but touching it kills outright, star or
   not, the same rule a pit follows. */
function deadly(c) { return c === 'L'; }
function lavaUnder(m) {
  const y0 = Math.floor((m.y + m.h - 2) / TILE), y1 = Math.floor((m.y + m.h + 1) / TILE);
  const x0 = Math.floor((m.x + 2) / TILE), x1 = Math.floor((m.x + m.w - 2) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (deadly(cellAt(tx, ty))) return true;
  return false;
}
function cellAt(tx, ty) {
  const L = GAME.level;
  if (tx < 0 || tx >= L.W) return 'X';
  if (ty < 0 || ty >= L.H) return ' ';
  return L.map[ty][tx];
}
const EPS = 0.01;
/* Resolve one axis of movement against the tile map.
   Two rules matter here and both used to be broken:
   1. The tile range is snapshotted BEFORE scanning. Previously the loop bound
      was `tx <= Math.floor((ent.x + ent.w - EPS) / TILE)`, recomputed every
      iteration from an `ent.x` the body itself reassigned. A left-moving body
      overlapping the ground row got pushed one tile right, which raised the
      bound, which matched the next ground tile, and so on -- and since cellAt()
      reports out-of-bounds columns as solid, the walk past the level edge never
      ended. Any enemy or item falling into a pit while drifting left could hang
      the whole game in a single frame.
   2. We resolve against the NEAREST blocking tile along the direction of
      travel. The old code kept overwriting the position with whatever tile the
      scan happened to visit last, which is not necessarily the one that was
      actually hit.
   EPS also keeps a body flush against a tile edge from claiming the next tile
   over, which otherwise snags entities on every tile seam. */
function collideAxis(ent, dx, dy) {
  ent.x += dx;
  let hitX = false;
  {
    const tyA = Math.floor((ent.y + 1) / TILE);
    const tyB = Math.floor((ent.y + ent.h - 1) / TILE);
    const txA = Math.floor(ent.x / TILE);
    const txB = Math.floor((ent.x + ent.w - EPS) / TILE);
    let blocker = null;
    for (let ty = tyA; ty <= tyB; ty++) {
      for (let tx = txA; tx <= txB; tx++) {
        if (!solid(cellAt(tx, ty))) continue;
        hitX = true;
        if (blocker === null || (dx > 0 ? tx < blocker : tx > blocker)) blocker = tx;
      }
    }
    if (blocker !== null) {
      if (dx > 0) ent.x = blocker * TILE - ent.w - EPS;
      else if (dx < 0) ent.x = (blocker + 1) * TILE + EPS;
    }
  }
  ent.y += dy;
  let hitY = false, ceil = false, floor = false;
  {
    const txA = Math.floor((ent.x + 1) / TILE);
    const txB = Math.floor((ent.x + ent.w - 1) / TILE);
    const tyA = Math.floor(ent.y / TILE);
    const tyB = Math.floor((ent.y + ent.h - EPS) / TILE);
    let blocker = null;
    for (let tx = txA; tx <= txB; tx++) {
      for (let ty = tyA; ty <= tyB; ty++) {
        if (!solid(cellAt(tx, ty))) continue;
        hitY = true;
        if (blocker === null || (dy > 0 ? ty < blocker : ty > blocker)) blocker = ty;
      }
    }
    if (blocker !== null) {
      if (dy > 0) { ent.y = blocker * TILE - ent.h - EPS; floor = true; }
      else if (dy < 0) { ent.y = (blocker + 1) * TILE + EPS; ceil = true; }
    }
  }
  return { hitX, hitY, ceil, floor };
}

/* ---------- block interaction ---------- */
function hitBlock(tx, ty) {
  const L = GAME.level;
  const c = L.map[ty][tx];
  // visible recoil on the tile that was punched
  if (c === '?' || c === 'M' || c === 'F' || c === 'S' || (c === 'B' && !GAME.mario.big)) {
    if (!GAME.bumps.some(b => b.tx === tx && b.ty === ty)) GAME.bumps.push({ tx, ty, t: 0 });
  }
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
      if (!REDUCED) GAME.shake = 3;
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
/* one coin's worth of score, coin count and the 100-coin 1UP */
function takeCoin(tx, ty) {
  GAME.coins++;
  GAME.run.coins++;      // the running total; GAME.coins wraps at 100 for the 1UP
  if (GAME.coins >= 100) {
    GAME.coins -= 100;
    GAME.lives++;
    Sound.oneUp();
    GAME.popups.push({ x: tx*TILE, y: ty*TILE - 26, text: '1UP', t: 0 });
  }
  GAME.score += 200;
  Sound.coin();
}
/* loose 'c' cells picked up by walking through them */
function collectCoins(m) {
  const tx0 = Math.floor(m.x / TILE), tx1 = Math.floor((m.x + m.w - EPS) / TILE);
  const ty0 = Math.floor(m.y / TILE), ty1 = Math.floor((m.y + m.h - EPS) / TILE);
  const L = GAME.level;
  for (let ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= L.H) continue;
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || tx >= L.W) continue;
      if (L.map[ty][tx] !== 'c') continue;
      L.map[ty][tx] = ' ';
      takeCoin(tx, ty);
      GAME.items.push({ type:'coinAnim', x: tx*TILE + 2, y: ty*TILE - 4, t: 0 });
      for (let i = 0; i < 3; i++) GAME.particles.push({
        kind: 'spark', x: tx*TILE + 8, y: ty*TILE + 6,
        vx: (Math.random()-0.5)*1.8, vy: -Math.random()*1.4 - 0.3, t: 0
      });
    }
  }
}
function coinBurst(tx, ty) {
  takeCoin(tx, ty);
  GAME.items.push({ type:'coinAnim', x: tx*TILE + 2, y: ty*TILE - 8, t: 0 });
  GAME.popups.push({ x: tx*TILE, y: ty*TILE - 10, text:'200', t: 0 });
  for (let i = 0; i < 5; i++) GAME.particles.push({
    kind: 'spark', x: tx*TILE + 8, y: ty*TILE - 4,
    vx: (Math.random()-0.5)*2.4, vy: -Math.random()*2 - 0.5, t: 0
  });
}
function spawnItem(kind, tx, ty) {
  Sound.emerge();
  GAME.items.push({
    type: kind, x: tx*TILE + 2, y: ty*TILE, w: 12, h: 12,
    vx: kind === 'flower' ? 0 : 1.2, vy: 0, rising: true,
    targetY: ty*TILE - 12 // rest just above the block it came from
  });
}
function dust(x, y, n) {
  for (let i = 0; i < n; i++) GAME.particles.push({
    kind: 'dust', x: x + (Math.random()-0.5)*8, y: y - 2,
    vx: (Math.random()-0.5)*1.6, vy: -Math.random()*0.8, t: 0
  });
}

/* ---------- entity retirement ----------
   The camera never scrolls backward and the player is clamped to its left edge,
   so anything this far behind it can never be seen or touched again. Without
   this, powerups and enemies left behind kept running full collision every
   frame for the rest of the course. */
const CULL_BEHIND = 72;
function offScreenLeft(e) { return e.x + (e.w || 12) < GAME.camera - CULL_BEHIND; }

/* in-place compaction: avoids allocating a replacement array every frame */
function compact(arr, dead) {
  let w = 0;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (!dead(v)) arr[w++] = v; }
  arr.length = w;
}

/* ---------- items ---------- */
const itemDead = it => it.dead;
function updateItems() {
  const m = GAME.mario;
  for (const it of GAME.items) {
    if (it.type === 'coinAnim') { it.t++; it.y -= 1.4; if (it.t > 26) it.dead = true; continue; }
    if (offScreenLeft(it)) { it.dead = true; continue; }
    if (it.rising) {
      it.y -= 1;
      if (it.y <= it.targetY) { it.y = it.targetY; it.rising = false; }
      continue;
    }
    it.vy += 0.4;
    let r = collideAxis(it, it.vx, 0);
    if (r.hitX) it.vx = -it.vx * 0.9;
    r = collideAxis(it, 0, it.vy);
    if (r.floor) { if (it.type === 'star' && it.vy > 1) it.vy = -3.2; else it.vy = 0; }
    if (r.ceil && it.type === 'star') it.vy = 0.5;
    if (it.y > 260) it.dead = true; // fell off the level
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
        if (!GAME.taughtFire) { GAME.taughtFire = true; hint(TOUCH ? 'TAP F TO SHOOT' : 'PRESS F TO SHOOT'); }
        Sound.power();
      } else if (it.type === 'star') {
        m.star = 600;
        Sound.oneUp();
      }
    }
  }
  compact(GAME.items, itemDead);
}
function growBig() {
  const m = GAME.mario;
  const bottom = m.y + m.h;
  m.big = true; m.h = 30; m.y = bottom - m.h;
}

/* ---------- fireballs ---------- */
function updateBalls() {
  const M = GAME.mario;
  for (const b of GAME.balls) {
    /* The boss breathes the same projectile the hero throws, so the one field that
       separates them decides who it can hit. Without this the boss's fire killed its
       own escort and never touched the player. */
    if (b.foe) {
      b.spin++;
      b.x += b.vx;
      if (GAME.frame % 2 === 0) GAME.particles.push({ kind: 'trail', x: b.x + 4, y: b.y + 4, vx: -b.vx * 0.15, vy: -0.2, t: 0, color: '#FF4A10' });
      if (collideAxis(b, 0, 0).hitX || offScreenLeft(b) || b.x > GAME.camera + LOGICAL_W + 24) { b.dead = true; continue; }
      if (!M.dead && rects(b, M)) { b.dead = true; hurtOrKill(M); }
      continue;
    }
    b.spin++;
    if (GAME.frame % 2 === 0) GAME.particles.push({ kind: 'trail', x: b.x + 4, y: b.y + 4, vx: -b.vx * 0.15, vy: -0.2, t: 0, color: '#FF7A20' });
    b.vy += 0.3;
    let r = collideAxis(b, b.vx, 0);
    if (r.hitX) { b.dead = true; continue; }
    r = collideAxis(b, 0, b.vy);
    if (r.floor) b.vy = -3;
    /* A ball only died on a wall, a pit or the left edge, so one fired down a long
       flat stretch kept bouncing off-screen to the right -- measured 118px past the
       view and 1.4s of life. With only two slots that is a shot the player cannot
       take, spent on something nobody can see. The original retires them at the
       screen edge; so does this. Items are deliberately NOT culled this way: a
       mushroom that outran the camera is a reward the player can still chase. */
    if (b.y > 260 || offScreenLeft(b) || b.x > GAME.camera + LOGICAL_W + 24) { b.dead = true; continue; }
    /* The boss is not in the enemy list, so fire went straight through it and nothing
       happened at all -- a player throwing fireballs got silence, which reads as a bug
       rather than as "not this way". It absorbs the shot with a flash and a clang: the
       answer is still the bridge, but the question gets an answer. */
    const BS = GAME.level.boss;
    if (BS && !BS.dead && rects(b, BS)) {
      b.dead = true;
      BS.hit = 10;
      Sound.bump();
      for (let i = 0; i < 5; i++) GAME.particles.push({
        kind: 'spark', x: b.x + 4, y: b.y + 4,
        vx: -1.6 - Math.random() * 1.2, vy: (Math.random() - 0.5) * 2.4, t: 0
      });
      continue;
    }
    for (const e of GAME.level.enemies) {
      if (e.dead || e.flat || e.gone || e.x > GAME.camera + WAKE_AHEAD) continue;
      if (e.type === 'blaze') continue;      // it is made of fire; fire is not an answer
      if (rects(b, e)) {
        b.dead = true;
        if (e.type === 'shelly' || e.type === 'shellMove') { e.type = 'shell'; e.vx = 0; if (e.h === 16) { e.h = 10; e.y += 6; e.py = e.y; } }
        else { e.flat = true; e.deadT = 30; }
        // fire is the answer to the enemies that cannot be stomped
        addScore(e.spiky || e.type === 'chomp' || e.type === 'bolt' ? 400 : 200, e);
        Sound.stomp();
        break;
      }
    }
  }
  compact(GAME.balls, itemDead);
}

/* ---------- enemies ---------- */
function rects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
/* The chain, and what it is worth. Past the end of the ladder it pays a life instead of
   repeating the top figure: eight without touching the ground is something the player
   did deliberately, and a life is the only currency here that changes what happens
   next. Points at that stage are a number going up on a screen they are not reading. */
function bumpCombo() {
  const prev = GAME.combo;
  const i = Math.min(prev, COMBO_PTS.length - 1);
  GAME.combo = Math.min(prev + 1, COMBO_PTS.length);
  GAME.run.chain = Math.max(GAME.run.chain, GAME.combo);
  /* The life is earned once -- on the single stomp that completes the ladder -- not on
     every stomp after it. The first version checked GAME.combo (the value AFTER
     incrementing), which stays >= COMBO_PTS.length for the rest of an unbroken chain, so
     riding a shell down a corridor of walkers turned into unlimited lives: 15 stomps in
     one chain granted 7. `prev` is the value BEFORE this stomp, and it equals
     COMBO_PTS.length - 1 on exactly one stomp per chain -- the one that pushes it over. */
  if (prev === COMBO_PTS.length - 1) {
    GAME.lives++;
    Sound.oneUp();
    const m = GAME.mario;
    GAME.popups.push({ x: m.x, y: m.y - 20, text: '1UP', t: 0 });
  }
  return COMBO_PTS[i];
}
function addScore(pts, e) {
  GAME.score += pts;
  /* An enemy is the only thing passed here that carries a `type` -- the flagpole bonus
     and the axe bonus pass a bare position. Counting in this one place means a new
     enemy is counted the day it is added, instead of on the day someone remembers the
     twelve call sites. */
  if (e && e.type) GAME.run.foes++;
  if (e) GAME.popups.push({ x: e.x, y: e.y - 6, text: String(pts), t: 0 });
}
function killMario(force) {
  const m = GAME.mario;
  if (m.dead || (!force && m.star > 0)) return;
  m.dead = true; m.vy = -5.5; m.vx = 0; m.deathTimer = 0;
  GAME.combo = 0;
  BGM.stop();   // the death jingle should not fight the course music
  Sound.die();
}
/* One damage path for every source of contact damage.
   The post-hit invulnerability window used to be set but never checked, so a
   single sustained touch damaged the player every frame: fire -> big -> small
   -> dead in three frames. Stomping stays allowed while invulnerable. */
function hurtOrKill(m) {
  if (m.invuln > 0 || m.star > 0 || m.dead) return;
  if (m.big) {
    if (m.fire) m.fire = false;
    else { const bottom = m.y + m.h; m.big = false; m.h = 16; m.y = bottom - m.h; }
    m.invuln = 90;
    GAME.balls.length = 0;
    Sound.shrink();
  } else {
    killMario();
  }
}
function updateEnemies() {
  const m = GAME.mario;
  for (const e of GAME.level.enemies) {
    if (e.gone) continue;
    if (e.flat) { e.deadT--; if (e.deadT <= 0) e.gone = true; continue; }
    if (e.x > GAME.camera + WAKE_AHEAD) continue; // not on screen yet: stays asleep
    /* Every other enemy in the game teaches itself: you jump on it and it dies.
       SPIKO teaches by killing you, and a player has no way to read "not this
       one" off a sprite they have never seen. It gets one line, once, the first
       time one is on screen -- the same treatment run and fire already get. */
    if (e.spiky && !GAME.taughtSpike && GAME.state === 'play' && e.x < GAME.camera + LOGICAL_W) {
      GAME.taughtSpike = true;
      hint('SPIKES! JUMP OVER - NEVER STOMP');
    }
    if (offScreenLeft(e)) { e.gone = true; continue; } // left behind for good
    e.t++;

    if (e.type === 'blaze') {
      /* Rises out of its pool, arcs, falls back. Timed from its own counter so two
         pools never fire in lockstep, and it sleeps below the floor between leaps so
         nothing off-screen is being simulated for no reason. */
      e.t++;
      const cycle = e.t % e.period;
      /* Two rules, both of which this game has already had to learn the hard way.
         1. It never launches into a hero who is already in the air over its pool. The
            pipe plant does the same thing for the same reason: a hazard that appears
            after you committed is not a hazard, it is a coin flip. Traced exactly that
            death -- the pool read clear at takeoff and the flame erupted underneath.
         2. Every launch is announced. Twenty frames of bubbling at the surface, so a
            player standing at the lip can see it coming and wait. */
      const overPool = !m.dead && !m.onGround &&
        m.x + m.w > e.x - 22 && m.x < e.x + e.w + 22;
      if (cycle === e.period - 20 && !overPool) e.warn = 20;
      if (e.warn > 0) {
        e.warn--;
        if (GAME.frame % 4 === 0) GAME.particles.push({
          kind: 'spark', x: e.x + 2 + Math.random() * 8, y: 13 * TILE + 2,
          vx: (Math.random() - 0.5) * 0.8, vy: -1.1 - Math.random(), t: 0
        });
        if (e.warn === 0) { e.vy = -e.power; e.up = true; Sound.noise(0.18, 0.07, 0, 700, 220); }
      }
      if (e.up) {
        e.vy += 0.30;
        e.y += e.vy;
        if (e.y > e.homeY) { e.y = e.homeY; e.up = false; e.vy = 0; }
      }
      if (!m.dead && e.up && rects(m, e)) hurtOrKill(m, e);
      continue;
    }
    if (e.type === 'glider' || e.type === 'fish') {
      /* Sine path, no gravity, no tile collision: it flies. Stomping it works and is
         worth the same as a walker; touching it from anywhere else hurts. */
      e.x += e.vx;
      e.y = e.baseY + Math.sin(e.t * e.freq) * e.amp;
      if (!m.dead && rects(m, e)) {
        const feet = m.y + m.h, wasFeet = (m.py === undefined ? m.y : m.py) + m.h;
        /* Fish and gliders share this branch, and it carries its own stomp test -- the
           water rule has to be repeated here or a fish in a lagoon is stompable while
           every other enemy in the same water is not. */
        const canStomp = !inWater(m) &&
          ((m.vy > 0.5 && wasFeet <= e.y + e.h * 0.7) || (feet < e.y + e.h * 0.7 && wasFeet <= e.y + 4));
        if (canStomp) {
          e.flat = true; e.deadT = 30;
          m.vy = keys.jump ? -4.5 : -3; m.sq = 1.15;
          addScore(bumpCombo(), e); Sound.stomp();
          dust(e.x + 7, e.y + e.h, 4);
        } else if (m.star > 0) { e.flat = true; e.deadT = 30; addScore(200, e); Sound.stomp(); }
        else hurtOrKill(m, e);
      }
      continue;
    }
    if (e.type === 'cannon') {
      /* The barrel itself never touches anyone. It fires when the player is within
         about a screen and a half, on the near side -- a cannon that shoots at your
         back after you pass it is noise, not a threat. */
      const dx = m.x - e.x;
      if (e.t % e.cool === 0 && dx < 30 && dx > -300 && !m.dead) {
        GAME.level.enemies.push({
          type: 'bolt', x: e.x - 10, y: e.y + 3, w: 12, h: 10,
          vx: -1.9, vy: 0, t: 0, air: true, px: e.x - 10, py: e.y + 3
        });
        Sound.kick();
      }
      continue;
    }
    if (e.type === 'bolt') {
      e.x += e.vx;
      if (e.x < GAME.camera - 40) { e.gone = true; continue; }
      if (!m.dead && rects(m, e)) {
        const feet = m.y + m.h, wasFeet = (m.py === undefined ? m.y : m.py) + m.h;
        if ((m.vy > 0.5 && wasFeet <= e.y + e.h * 0.7) || (feet < e.y + e.h * 0.7 && wasFeet <= e.y + 4)) {
          e.flat = true; e.deadT = 24;
          m.vy = keys.jump ? -4.5 : -3; m.sq = 1.15;
          addScore(bumpCombo(), e); Sound.stomp();
        } else if (m.star > 0) { e.flat = true; e.deadT = 24; addScore(200, e); Sound.stomp(); }
        else hurtOrKill(m, e);
      }
      continue;
    }
    if (e.type === 'chomp') {
      /* Pipe plant: rides up out of the mouth, waits, drops back in. It only
         emerges when the player is not standing right on top of the pipe, so it
         can never spawn straight into them. */
      const cycle = (e.t + e.phase) % 150;
      const overhead = Math.abs((m.x + m.w / 2) - (e.x + e.w / 2)) < 22 && m.y + m.h <= e.baseY + 2;
      const wantOut = cycle < 80 && !overhead;
      const targetY = wantOut ? e.baseY - e.h : e.baseY;
      e.y += Math.sign(targetY - e.y) * Math.min(0.8, Math.abs(targetY - e.y));
      if (!m.dead && e.y < e.baseY && rects(m, e)) hurtOrKill(m, e);
      continue;
    }

    let r = collideAxis(e, e.vx, 0);
    if (r.hitX) { if (e.type === 'shellMove') e.vx = -e.vx * 0.7; else e.vx = -e.vx; }
    if (e.type === 'flappy') {
      // hop on a timer; the horizontal drift is unchanged so it stays readable
      e.hop = (e.hop || 0) + 1;
      if (e.vy === 0 && e.hop > 44) { e.vy = -4.6; e.hop = 0; }
    }
    e.vy += 0.4;
    r = collideAxis(e, 0, e.vy);
    if (r.floor) e.vy = 0;
    // fell into a gap: retire it, or it keeps simulating forever below the level
    if (e.y > 260) { e.gone = true; continue; }

    if (m.dead) continue;
    if (rects(m, e)) {
      /* Whether this is a stomp used to be judged from the current frame alone --
         falling, and feet above the shoulders -- which lost two cases that the
         player reads as a clean landing:
           - a stomp bounces you upward, so a second enemy standing right next to
             the first was tested with an upward vy and scored as a side hit;
           - falling at terminal speed covers 5.5px per step, enough to end the
             step past the shoulder line of a 12px enemy it was clearly above.
         `py` is the position at the top of the step, so the test now asks where
         the feet came from rather than only where they are. */
      const feet = m.y + m.h, wasFeet = (m.py === undefined ? m.y : m.py) + m.h;
      const shoulders = e.y + e.h * 0.7;
      /* No stomping in water. There is no weight behind a stroke, and the original does
         not allow it either -- fire and the star are the answers down here. */
      const stomping = !inWater(m) && ((m.vy > 0.5 && wasFeet <= shoulders) ||
                       (feet < shoulders && wasFeet <= e.y + 4));
      if (m.star > 0) {
        e.flat = true; e.deadT = 30;
        addScore(200, e); Sound.stomp();
      } else if (stomping && e.spiky) {
        /* SPIKO cannot be stomped: landing on the spines hurts and bounces you
           off, so it has to be dealt with using fire, a star or a kicked shell. */
        m.vy = -3.4; m.sq = 1.1;
        hurtOrKill(m, e);
      } else if (stomping) {
        m.y = e.y - m.h; m.vy = keys.jump ? -4.5 : -3;
        m.sq = 1.15;
        if (e.type === 'puff' || e.type === 'flappy') {
          e.flat = true; e.deadT = 30;
          addScore(bumpCombo(), e); Sound.stomp();
          dust(e.x + 6, e.y + e.h, 4);
          /* No screen shake here. A stomp is the single most common action in the
             game, and two frames of randomly offset world (with a HUD that does
             not move) read as a stutter rather than an impact. The original
             shakes for nothing at all; breaking a brick still does. */
          for (let i = 0; i < 4; i++) GAME.particles.push({ kind: 'spark', x: e.x + 6, y: e.y + 4, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 1.5, t: 0 });
        } else if (e.type === 'shelly') {
          e.type = 'shell'; e.vx = 0; e.h = 10; e.y += 6; e.py = e.y;
          addScore(bumpCombo(), e); Sound.stomp();
        } else if (e.type === 'shell') {
          e.type = 'shellMove'; e.vx = (m.x < e.x ? 1 : -1) * 4;
          addScore(200, e); Sound.kick();
        } else if (e.type === 'shellMove') {
          e.vx = (m.x < e.x ? 1 : -1) * 4;
          addScore(100, e); Sound.kick();
        }
      } else {
        hurtOrKill(m, e);
      }
    }
    if (e.type === 'shellMove' && Math.abs(e.vx) > 2) {
      for (const o of GAME.level.enemies) {
        if (o === e || o.dead || o.flat || o.gone) continue;
        if (rects(e, o)) { o.flat = true; o.deadT = 30; addScore(200, o); Sound.stomp(); }
      }
    }
  }
  /* Retired enemies were only flagged, never removed -- items, fireballs,
     particles, popups and bumps are all compacted, but the enemy list grew to the
     course's full population and stayed there, so every frame walked 46 entries to
     skip most of them (and so did the draw pass, and every shell-vs-enemy check).
     `isGone` is set by the cull-behind and squash paths, so the same compaction
     applies here. */
  compact(GAME.level.enemies, isGone);
}

/* ---------- bonus rooms ----------
   Entry is a real descent, not a cut: the hero sinks into the mouth over 26 frames
   with the pipe redrawn over them, so the transition explains itself. The course is
   kept whole in GAME.room and restored on the way out -- rebuilding it would respawn
   every enemy the player already dealt with and reset the checkpoint pennant. */
const PIPE_FRAMES = 26;
function pipeEntryUnder(m) {
  const L = GAME.level;
  if (!L.entries || !m.onGround) return null;
  for (const e of L.entries) {
    const left = e.tx * TILE, right = left + 2 * TILE;
    const cx = m.x + m.w / 2;
    if (cx < left + 2 || cx > right - 2) continue;
    if (Math.abs((m.y + m.h) - e.ty * TILE) > 2) continue;
    return e;
  }
  return null;
}
function roomExitUnder(m) {
  const L = GAME.level;
  if (!L.room || !m.onGround) return false;
  const left = L.exitTx * TILE, right = left + 2 * TILE;
  const cx = m.x + m.w / 2;
  const ty = (L.exitTy === undefined ? 11 : L.exitTy);
  return cx > left + 2 && cx < right - 2 && Math.abs((m.y + m.h) - ty * TILE) <= 2;
}
function enterPipe(entry) {
  GAME.pipeAnim = { dir: 'in', t: 0, entry };
  Sound.pipe();
}
function leavePipe() {
  GAME.pipeAnim = { dir: 'out', t: 0 };
  Sound.pipe();
}
/* the swap itself, at the midpoint of the animation */
function swapToRoom(entry) {
  const m = GAME.mario;
  GAME.room = {
    level: GAME.level, x: m.x, y: m.y, camera: GAME.camera,
    theme: GAME.theme, exitTo: entry.exitTx
  };
  GAME.level = roomFor(entry, GAME.world);
  GAME.theme = CAVERN_THEME;
  GAME.items.length = 0; GAME.balls.length = 0; GAME.particles.length = 0;
  GAME.popups.length = 0; GAME.bumps.length = 0;
  m.x = 2 * TILE; m.y = 13 * TILE - m.h; m.vx = 0; m.vy = 0; m.plat = null;
  m.onGround = true; m.facing = 1;
  GAME.camera = 0; snapMario();
  BGM.stop(); BGM.select(CAVERN_THEME); if (GAME.bgmOn) BGM.start();
}
function swapToCourse() {
  const m = GAME.mario, save = GAME.room;
  const exitTx = GAME.level.exitTo;
  GAME.level = save.level;
  GAME.theme = save.theme;
  GAME.items.length = 0; GAME.balls.length = 0; GAME.particles.length = 0;
  GAME.popups.length = 0; GAME.bumps.length = 0;
  /* Out of the pipe the course authored as the exit, standing on its lip. If that
     column is not a pipe top (a later edit could move it), fall back to where the
     player went in, which is always valid. */
  let ty = -1;
  for (let y = 0; y < GAME.level.H; y++) {
    const c = GAME.level.map[y][exitTx];
    if (c === 'T' || c === 'E') { ty = y; break; }
  }
  if (ty < 0) { m.x = save.x; m.y = save.y; GAME.camera = save.camera; }
  else { m.x = exitTx * TILE + 2; m.y = ty * TILE - m.h; GAME.camera = Math.max(save.camera, m.x - CAM_LEAD); }
  m.vx = 0; m.vy = 0; m.onGround = true; m.plat = null;
  GAME.room = null;
  snapMario();
  BGM.stop(); BGM.select(GAME.theme); if (GAME.bgmOn) BGM.start();
}
/* Runs before the hero and swallows the step while a transition plays. Three beats:
   sink into the mouth, swap at black, then let the existing course fade bring the
   new place up. Coming back out runs the same beats in reverse, so the hero rises
   out of the exit pipe rather than appearing on top of it. */
const PIPE_SINK = 20, PIPE_HALF = 14;
function updatePipeAnim() {
  const a = GAME.pipeAnim, m = GAME.mario;
  if (!a) return false;
  a.t++;
  if (a.dir === 'in') {
    if (a.t <= PIPE_HALF) m.y += PIPE_SINK / PIPE_HALF;
    else if (a.t === PIPE_HALF + 1) { swapToRoom(a.entry); GAME.fade = 1; GAME.fadeDir = -1; }
    if (a.t >= PIPE_FRAMES) GAME.pipeAnim = null;
  } else {
    if (a.t === 1) {
      swapToCourse();
      a.lipY = m.y;                   // where the hero belongs when the rise finishes
      m.y += PIPE_SINK;               // start inside the pipe
      GAME.fade = 1; GAME.fadeDir = -1;
    } else if (m.y > a.lipY) {
      m.y = Math.max(a.lipY, m.y - PIPE_SINK / PIPE_HALF);
    }
    if (a.t >= PIPE_FRAMES) { GAME.pipeAnim = null; if (a.lipY !== undefined) m.y = a.lipY; }
  }
  m.state = 'stand';
  snapMario();                        // no interpolation across the swap
  return true;
}

/* ---------- fortress hazards ----------
   A fire bar is a pivot plus N links; only the links hurt, and only their centres are
   tested, so the hazard matches what is drawn. The bar spins at a fixed rate from a
   seeded starting angle, which keeps it deterministic across a respawn. */
function updateBars() {
  const L = GAME.level, m = GAME.mario;
  if (!L.bars) return;
  for (const b of L.bars) {
    b.a += b.spin;
    if (m.dead || m.star > 0 || m.invuln > 0) continue;
    for (let i = 1; i <= b.len; i++) {
      const lx = b.x + Math.cos(b.a) * i * 8, ly = b.y + Math.sin(b.a) * i * 8;
      if (lx > m.x - 4 && lx < m.x + m.w + 4 && ly > m.y - 4 && ly < m.y + m.h + 4) { hurtOrKill(m); return; }
    }
  }
}
/* The boss paces its bridge and spits fire. It cannot be stomped and it cannot be
   killed by fire alone -- five hits stagger it, but the bridge is the answer, the way
   the original made the axe the answer. Stomping it hurts you, like a spiked walker,
   so there is never an ambiguous "why did that not work". */
function updateBoss() {
  const L = GAME.level, m = GAME.mario, b = L.boss;
  if (!b || b.dead) return;
  b.t++;
  if (b.hit > 0) b.hit--;
  /* One roar the first time it is on screen, and one line naming the objective. A boss
     that can be neither stomped nor burned has to say what it wants from you, once. */
  if (!b.seen && b.x < GAME.camera + LOGICAL_W - 8) {
    b.seen = true;
    Sound.roar();
    if (!GAME.taughtAxe) { GAME.taughtAxe = true; hint('REACH THE AXE BEYOND IT'); }
  }
  if (GAME.collapse > 0) { b.vy += 0.5; b.y += b.vy; if (b.y > 260) b.dead = true; return; }
  b.x += b.vx;
  if (b.x < b.homeA) { b.x = b.homeA; b.vx = -b.vx; }
  if (b.x > b.homeB) { b.x = b.homeB; b.vx = -b.vx; }
  // a hop, so its silhouette is not a metronome
  if (b.onGround === undefined) b.onGround = true;
  if (b.onGround && b.t % 150 === 0) { b.vy = -5.2; b.onGround = false; Sound.roar(); }
  if (!b.onGround) {
    b.vy += 0.4; b.y += b.vy;
    const floor = 13 * TILE - b.h;
    if (b.y >= floor) { b.y = floor; b.vy = 0; b.onGround = true; }
  }
  // fire breath, aimed at the hero's side of the bridge
  if (b.t % b.fire === 0 && Math.abs(m.x - b.x) < 200) {
    const dir = m.x < b.x ? -1 : 1;
    GAME.balls.push({ x: b.x + (dir < 0 ? -8 : b.w), y: b.y + 10, w: 8, h: 8,
                      vx: dir * 2.6, vy: 0, spin: 0, foe: true });
    Sound.fireball();
  }
  if (!m.dead && rects(m, b)) hurtOrKill(m);
}
/* The axe. Touching it takes the bridge out: the tiles go, the boss falls with them,
   and the course clears through the same path a flagpole does. */
function checkAxe() {
  const L = GAME.level, m = GAME.mario;
  if (!L.fortress || GAME.collapse > 0) return;
  const tx = L.axeX;
  if (m.x + m.w < tx * TILE || m.x > tx * TILE + TILE) return;
  if (m.y + m.h < 12 * TILE || m.y > 13 * TILE) return;
  L.map[12][tx] = ' ';
  GAME.collapse = 1;
  addScore(5000, { x: m.x, y: m.y });
  BGM.stop();
  Sound.collapse();
}
/* The collapse runs as its own little sequence: a tile of bridge goes every three
   frames from the far end, then the course clears. */
function updateCollapse() {
  const L = GAME.level;
  GAME.collapse++;
  if (GAME.collapse % 3 === 0) {
    // the far end goes first: at collapse=3 this is bridgeW-1, at collapse=bridgeW*3 it
    // is 0. The first version started one tile in and always left the far plank behind.
    const i = L.bridgeW - Math.floor(GAME.collapse / 3);
    if (i >= 0) {
      const x = L.bridgeX + i;
      L.map[13][x] = ' ';
      for (let k = 0; k < 3; k++) GAME.particles.push({
        kind: 'debris', x: x * TILE + 4 + k * 3, y: 13 * TILE + 2,
        vx: (k - 1) * 1.4, vy: -2.4 - k * 0.3, t: 0
      });
    }
  }
  if (GAME.collapse > L.bridgeW * 3 + 90 && GAME.state === 'play') {
    GAME.bossDown = true;
    GAME.walkDone = true;                 // no castle walk in a fortress
    GAME.state = 'clear';
    GAME.worldDone = true;
    Sound.worldDone();
  }
}

/* ---------- moving platforms ----------
   A cosine shuttle: eased at both ends, and a pure function of the step counter, so
   two platforms can never drift apart and a respawn puts them exactly where the
   course expects. dx/dy are what the rider is carried by, so they are derived from
   the position the interpolation snapshot already took. */
function updatePlats() {
  const L = GAME.level;
  if (!L || !L.plats) return;
  for (const p of L.plats) {
    /* The step delta and the deck's previous position are recorded here rather than
       read from px/py. Those belong to the render interpolation, and physics that
       depends on a rendering detail breaks the moment anything calls the simulation
       without it -- which is exactly what happened while testing this. */
    const ox = p.x, oy = p.y;
    p.t++;
    const s = (1 - Math.cos(p.t * p.speed)) / 2;
    if (p.kind === 'h') { p.x = p.from + (p.to - p.from) * s; p.y = p.y0; }
    else { p.y = p.from + (p.to - p.from) * s; p.x = p.x0; }
    p.dx = p.x - ox; p.dy = p.y - oy;
    p.deckWas = oy;
  }
}
/* Land on a lift, or keep standing on one. Deliberately one-way: a lift is solid
   from above and passable everywhere else. Making it solid on all sides means a
   rising lift can crush the player into a ceiling and a moving edge can shove them
   into a wall, and neither failure is readable -- the player just dies. The test is
   swept (were my feet above its deck at the top of the step?) for the same reason
   the stomp test is: a 5.5px/frame fall must not tunnel through an 8px deck. */
function ridePlats(m, wasAir, fallSpeed) {
  const L = GAME.level;
  m.plat = null;
  if (!L.plats || m.vy < 0) return;
  for (const p of L.plats) {
    if (m.x + m.w <= p.x + 1 || m.x >= p.x + p.w - 1) continue;
    const feet = m.y + m.h;
    const wasFeet = (m.py === undefined ? m.y : m.py) + m.h;
    const deckWas = (p.deckWas === undefined ? p.y : p.deckWas);
    if (wasFeet > deckWas + 2 || feet < p.y) continue;
    m.y = p.y - m.h; m.vy = 0; m.onGround = true; m.plat = p;
    if (wasAir && fallSpeed > 2.5) { m.sq = 0.72; dust(m.x + 6, m.y + m.h, 3); Sound.land(); }
    if (wasAir) GAME.combo = 0;
    return;
  }
}

/* ---------- water ----------
   In water the jump becomes a stroke: a small impulse you can repeat, against a much
   weaker gravity and a low terminal speed. That is the whole change in feel, and it is
   why a lagoon cannot be walked the way a field course can. */
function inWater(m) {
  const L = GAME.level;
  return !!(L && L.water && (m.x + m.w) < L.waterTo * TILE);
}
const WATER = { grav: 0.115, maxFall: 1.65, stroke: -2.55, maxV: 1.55, accel: 0.045, drag: 0.965 };

/* ---------- mario (player) ---------- */
function updateMario() {
  const m = GAME.mario;
  const ch = CHARS[GAME.charIdx];
  if (m.dead) {
    m.vy += 0.4; m.y += m.vy; m.deathTimer++;
    if (m.deathTimer > 150) {
      GAME.lives--;
      if (GAME.lives <= 0) {
        GAME.state = 'gameover'; BGM.stop(); Sound.gameOver();
        if (GAME.score > GAME.high) { GAME.high = GAME.score; saveHigh(GAME.high); }
        GAME.scoreAt = submitScore();
        if (GAME.scoreAt === 0) Sound.record();
      } else {
        /* startLevel() clears the clock flag, but the interstitial that comes
           straight after is exactly where it has to be read, so carry it across
           the rebuild. It is cleared when that card ends. */
        const ranOut = GAME.timeUp;
        GAME.afterDeath = true; startLevel(true);
        GAME.timeUp = ranOut;
      }
    }
    return;
  }
  // passing the marker arms it: one line of feedback, once, like the other teaches
  const cX = GAME.level.checkX;
  if (cX && !GAME.checkArmed && m.x + m.w > cX * TILE + 6) {
    GAME.checkArmed = true; GAME.checkT = 1;
    hint('CHECKPOINT!');
    Sound.checkpoint();
    for (let i = 0; i < 10; i++) GAME.particles.push({
      kind: 'spark', x: cX * TILE + 2, y: 13 * TILE - 8 - i * 3,
      vx: (Math.random() - 0.5) * 1.4, vy: -Math.random() * 1.2, t: 0
    });
  }
  if (GAME.checkT > 0 && GAME.checkT < 40) GAME.checkT++;   // banner raise animation

  if (m.invuln > 0) m.invuln--;
  if (m.star > 0) {
    m.star--;
    /* Running out of star while standing inside an enemy was instant death: the
       next frame judged an overlap that the star had been holding harmless.
       The tail of the invincibility hands over to the ordinary hit window. */
    if (m.star === 0) m.invuln = Math.max(m.invuln, 30);
    // star sparkle trail
    if (GAME.frame % 3 === 0) GAME.particles.push({ kind: 'trail', x: m.x + Math.random() * m.w, y: m.y + Math.random() * m.h, vx: (Math.random() - 0.5) * 0.6, vy: -0.3, t: 0, color: ['#FFD84A', '#FF5AA0', '#4AC8FF'][Math.floor(GAME.frame / 6) % 3] });
  }
  m.sq += (1 - m.sq) * 0.25;

  const wet = inWater(m);
  // original SMB feel: slow build-up to speed, gentle glide
  const maxV = wet ? WATER.maxV * ch.speed : (keys.run ? 2.7 : 1.4) * ch.speed;
  const acc = wet ? WATER.accel * ch.speed : (m.onGround ? (keys.run ? 0.07 : 0.05) : 0.03) * ch.speed;
  /* `steering` records that this step actually applied acceleration, because the
     creep-killer below must not be allowed to undo it. */
  let steering = true;
  if (keys.left && !keys.right) { m.vx -= acc; m.facing = -1; }
  else if (keys.right && !keys.left) { m.vx += acc; m.facing = 1; }
  else {
    steering = false;
    if (m.onGround) m.vx *= 0.93;
    else if (wet) m.vx *= WATER.drag;    // water pushes back even in mid-stroke
  }
  m.vx = Math.max(-maxV, Math.min(maxV, m.vx));
  /* Kill the residue that friction leaves behind, so a hero who lets go stops dead
     instead of creeping for another second.
     This used to run unconditionally, and the threshold sits right in the middle of
     the accelerations it was judging, so it also erased the first step of a press --
     every step, forever, because vx never got to accumulate. BOLT walking on land
     (0.05 * 0.94 = 0.047) could not move AT ALL unless the run key was held. In
     water the acceleration is 0.045 * speed, so PIP (0.0450) and BOLT (0.0423) were
     both frozen on the seabed while MOCHI (0.0504) squeaked over the line and swam.
     PIP walking on land survived only because 0.05 is not < 0.05.
     Every bot in this project's test history held the run key, which is exactly why
     this lasted: the one input a new player uses -- the arrow key by itself -- was
     never the input under test. */
  if (!steering && Math.abs(m.vx) < 0.05 && m.onGround) m.vx = 0;

  // coyote time + jump buffer for a forgiving, smooth feel
  if (m.onGround) m.coyote = 6; else if (m.coyote > 0) m.coyote--;
  if (m.jumpBuf > 0) m.jumpBuf--;
  /* A stroke costs nothing but the impulse: no coyote time, no ground needed, no
     variable height. Holding the key does not swim higher, which is what stops water
     from becoming a flight level. */
  if (wet && m.jumpBuf > 0) {
    m.jumpBuf = 0;
    m.vy = WATER.stroke;
    m.onGround = false;
    m.sq = 1.1;
    Sound.tone(340, 0.10, 'triangle', 0.06, 0, 120);
    for (let i = 0; i < 3; i++) GAME.particles.push({
      kind: 'trail', x: m.x + 2 + Math.random() * 8, y: m.y + m.h - 2,
      vx: (Math.random() - 0.5) * 0.5, vy: 0.5 + Math.random() * 0.4, t: 0, color: '#BFE8FF'
    });
  }
  if (!wet && m.jumpBuf > 0 && (m.onGround || m.coyote > 0)) {
    m.jumpBuf = 0; m.coyote = 0;
    /* Jump strength is set by the tallest thing the level requires you to mount:
       the 4-tile pipes are a 64px climb, and gravity is integrated per frame so
       the real apex lands ~4px under the vy^2/2g figure. At the old -7.0 the
       baseline hero peaked at 61px and simply could not pass them. Every hero
       now clears 64px with >=11px of margin, which also matches the original's
       ~77px small jump.
       Like the original, running adds height. The bonus is strictly additive so
       the standing jump -- the figure the level geometry was checked against --
       never gets weaker. */
    const speedBonus = Math.min(Math.abs(m.vx) / 2.7, 1) * 0.55;
    m.vy = (m.big ? -8.45 : -8.1) * ch.jump - speedBonus;
    m.onGround = false;
    m.sq = 1.18;
    Sound.jump();
  }
  if (!wet && !keys.jump && m.vy < -2) m.vy = -2; // variable jump height
  m.vy += wet ? WATER.grav : 0.38;
  const term = wet ? WATER.maxFall : 5.5;
  if (m.vy > term) m.vy = term;

  const wasAir = !m.onGround;
  const fallSpeed = m.vy;
  /* Carried before the hero's own movement, the way the original moves its lifts
     first and then the rider. Both axes: leaving the descent to gravity looked right
     on paper (the deck falls at most 0.64px/frame, gravity accelerates at 0.38) but
     measured as contact breaking on 69 of 500 frames, because it takes ~2 frames to
     catch up each time -- and a flickering onGround costs the player their coyote
     time and their jump. Riding is glued; ridePlats re-seats the feet afterwards. */
  if (m.plat) {
    m.x += m.plat.dx;
    m.y += m.plat.dy;
  }
  m.onGround = false;
  collideAxis(m, m.vx, 0);
  const r2 = collideAxis(m, 0, m.vy);
  if (r2.floor) {
    m.vy = 0; m.onGround = true;
    if (wasAir && fallSpeed > 2.5) { m.sq = 0.72; dust(m.x + 6, m.y + m.h, 3); Sound.land(); }
    // The stomp chain is per airborne period. It used to persist across
    // landings, so stomping one enemy per jump walked the multiplier up to
    // 8000/enemy for the rest of the course.
    if (wasAir) GAME.combo = 0;
  }
  if (!m.onGround) ridePlats(m, wasAir, fallSpeed);
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
    /* Any solid ceiling has to answer back. hitBlock() only covers interactive
       tiles, so bonking a used block or the underside of terrain used to kill the
       jump in total silence -- the player reads that as the game hitching, not as
       a head bump. */
    if (best) hitBlock(best.tx, best.ty);
    else { Sound.bump(); dust(m.x + m.w / 2, m.y + 2, 2); }
    m.sq = 0.88;
    m.vy = 0.5;
  }

  /* Down on a pipe mouth. Checked after movement so the hero has actually settled
     on the lip, and gated on standing still-ish: pressing down mid-run used to be a
     jarring stop. */
  if (keys.down && m.onGround && !GAME.pipeAnim) {
    if (GAME.level.room) { if (roomExitUnder(m)) leavePipe(); }
    else { const e = pipeEntryUnder(m); if (e) enterPipe(e); }
  }
  /* And a one-time nudge the first time the player stands on one, because a pipe you
     can enter is invisible knowledge otherwise. */
  if (!GAME.taughtPipe && !GAME.level.room && pipeEntryUnder(m)) {
    GAME.taughtPipe = true;
    hint(TOUCH ? 'TAP DOWN TO ENTER' : 'PRESS DOWN TO ENTER');
  }

  /* Lava is a pit you can see. Same rule: it ignores the star, because a hazard that
     the invincibility cancels stops being a hazard at all. */
  if (GAME.level.fortress && !m.dead && lavaUnder(m)) { killMario(true); return; }

  collectCoins(m);

  // running dust, and a heavier puff while braking so the skid reads as friction
  if (m.onGround && Math.abs(m.vx) > 2 && GAME.frame % 10 === 0) dust(m.x + 6 - m.facing*4, m.y + m.h, 1);
  if (m.onGround && m.state === 'skid' && GAME.frame % 3 === 0) dust(m.x + 6 - m.facing*5, m.y + m.h, 2);

  // the camera never scrolls back, so without this the player can walk off the
  // left edge of the view and keep playing completely blind
  if (m.x < GAME.camera + 1) { m.x = GAME.camera + 1; if (m.vx < 0) m.vx = 0; }

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
    snapMario();
    GAME.state = 'clear';
  }

  // animation state -> sprite frame. animT advances with distance travelled, so
  // the leg cycle speeds up with the character instead of ticking on a timer.
  m.animT += Math.abs(m.vx);
  const braking = (keys.left && m.vx > 0.6) || (keys.right && m.vx < -0.6);
  if (!m.onGround) m.state = 'jump';
  else if (braking) m.state = 'skid';
  else if (Math.abs(m.vx) > 0.1) m.state = WALK_CYCLE[Math.floor(m.animT / 7) % WALK_CYCLE.length];
  else m.state = 'stand';
}

/* ---------- fx ---------- */
const isGone = p => p.gone;
const bumpExpired = b => b.t >= BUMP_OFFSET.length;
function updateFx() {
  for (const p of GAME.particles) {
    p.t++;
    p.x += p.vx; p.y += p.vy;
    if (p.kind === 'debris') { p.vy += 0.35; p.vx *= 0.98; p.rot = (p.rot || 0) + 0.25; }
    else if (p.kind === 'spark') { p.vy += 0.12; p.vx *= 0.96; }
    else if (p.kind === 'dust') { p.vy -= 0.02; p.vx *= 0.95; }
    else if (p.kind === 'trail') { p.vx *= 0.9; }
    const life = p.kind === 'dust' ? 14 : (p.kind === 'trail' ? 12 : 60);
    if (p.t > life) p.gone = true;
  }
  compact(GAME.particles, isGone);
  for (const p of GAME.popups) { p.t++; p.y -= 0.6; if (p.t > 50) p.gone = true; }
  compact(GAME.popups, isGone);
  if (GAME.bumps.length) {
    for (const b of GAME.bumps) b.t++;
    compact(GAME.bumps, bumpExpired);
  }
  if (GAME.shake > 0) GAME.shake--;
}
function updateTimer() {
  if (GAME.state !== 'play') return;
  GAME.timeF++;
  if (GAME.timeF >= 36) {
    GAME.timeF = 0; GAME.time--;
    if (GAME.time === 100 && !GAME.warnedTime) { GAME.warnedTime = true; Sound.hurry(); }
    if (GAME.time <= 0) {
      /* Running out used to kill the player with no explanation at all: the hero
         simply died mid-stride and the death card looked identical to a stomp.
         The clock gets its own cue and its own line on the card. */
      GAME.time = 0; GAME.timeUp = true;
      hint('TIME UP!');
      Sound.timeUp();
      killMario(true);
    }
  }
}

/* ---------- clear sequence ---------- */
function updateClear() {
  const m = GAME.mario, L = GAME.level;
  if (GAME.flagSlide) {
    m.y += 1;
    m.state = 'stand';
    // the banner tracks the slide, so the descent has something to read against
    const top = 3 * TILE, bottom = 12 * TILE;
    GAME.bannerY = Math.max(0, Math.min(bottom - top, m.y - top));
    if (m.y >= 13*TILE - m.h - 2) {
      m.y = 13*TILE - m.h - 2; GAME.flagSlide = false;
      GAME.bannerY = bottom - top;
      Sound.pipe();
    }
  } else if (!GAME.walkDone) {
    m.x += 1.2; m.facing = 1; m.animT += 1.2;
    m.state = WALK_CYCLE[Math.floor(m.animT / 7) % WALK_CYCLE.length];
    if (m.x >= (L.castleX + 1) * TILE) {
      GAME.walkDone = true; BGM.stop();
      // the third course of a world gets the longer flourish
      GAME.worldDone = false;      // the world ends at the fortress, not here
      Sound.fanfare();
    }
  } else {
    if (GAME.castleFlagY < 14) GAME.castleFlagY += 0.35;   // hoist the keep banner
    // classic time bonus: remaining seconds convert to score before the wipe
    GAME.clearTimer++;
    if (GAME.time > 0) {
      const step = Math.min(GAME.time, 3);
      GAME.time -= step; GAME.score += step * 50;
      if (GAME.clearTimer % 2 === 0) Sound.tone(1319, 0.05, 'square', 0.07);
    } else if (GAME.clearTimer > (GAME.worldDone ? 260 : 120)) nextLevel();
  }
}

/* ---------- rendering ---------- */
function lerp(a, b, t) { return a + (b - a) * t; }
function viewCam() { return lerp(GAME.camPrev, GAME.camera, GAME.alpha); }
/* Interpolated draw position for anything that records px/py. Interpolating only
   the camera and the player was worse than interpolating nothing: everything else
   still stepped at 60Hz, so enemies and items visibly juddered against a camera
   that was now moving every display frame. Either the whole scene interpolates or
   none of it does. Entities spawned mid-step have no previous position yet, so
   they fall back to their current one for that first frame. */
function ix(e) { return e.px === undefined ? e.x : lerp(e.px, e.x, GAME.alpha); }
function iy(e) { return e.py === undefined ? e.y : lerp(e.py, e.y, GAME.alpha); }
function camQ() { return Math.round(viewCam() * 2) / 2; }
/* gradients are immutable once built; making them per frame was pure waste */
function drawSky(th) {
  if (!th._grad) {
    const g = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.55, th.sky[1]);
    g.addColorStop(1, th.sky[2]);
    th._grad = g;
  }
  ctx.fillStyle = th._grad; ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
}
let hudScrim = null;
function hudScrimGrad() {
  if (!hudScrim) {
    hudScrim = ctx.createLinearGradient(0, 2, 0, 30);
    hudScrim.addColorStop(0, 'rgba(4,10,26,0.34)');
    hudScrim.addColorStop(1, 'rgba(4,10,26,0)');
  }
  return hudScrim;
}
/* star field for the night theme: positions come from a hash of the index, so
   they are stable frame to frame but not visibly gridded */
function drawStars(cam) {
  for (let i = 0; i < 70; i++) {
    const h = (i * 2654435761) % 100003;
    const wx = (h % 4096);
    const x = wx - (cam * 0.12) % 4096;
    const span = LOGICAL_W + 64;
    const sx = ((x % span) + span) % span - 32;
    if (sx < 0 || sx > LOGICAL_W) continue;
    const y = 6 + (Math.floor(h / 4096) % 150);
    const tw = (GAME.frame + i * 13) % 140;
    ctx.globalAlpha = tw < 10 ? 0.35 : (i % 5 === 0 ? 0.95 : 0.65);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(Math.round(sx), y, 1, 1);
    if (i % 9 === 0) ctx.fillRect(Math.round(sx) + 1, y, 1, 1);
  }
  ctx.globalAlpha = 1;
}
function drawBackground() {
  const T = theme(), th = T.theme;
  drawSky(th);
  const cam = camQ();
  const L = GAME.level;
  if (th.stars) drawStars(cam);
  /* An interior gets a wall instead of a sky. Drawn at a slight parallax so it reads
     as being behind the playfield rather than painted onto it. */
  if (L.fortress) {
    const pc = cam * 0.5;
    const x0 = Math.floor(pc / TILE) - 1;
    for (let ty = 0; ty < 15; ty++) {
      for (let i = 0; i <= VIEW_TILES; i++) {
        const tx = x0 + i;
        const v = (tx * 7 + ty * 3) % 5 < 2 ? 1 : 0;
        ctx.drawImage(T.wall[v], Math.round(tx * TILE - pc), ty * TILE);
      }
    }
  }
  if (!L) return;
  /* The lagoon's ceiling tiles were built specifically so "the water reads as
     enclosed rather than as sky" -- but the background layer never got the memo.
     Distant mountains, drifting clouds and bushes kept scrolling behind that
     ceiling for the whole swim, the same inconsistency the fortress already
     solved for itself with a wall. Land decor has nothing to attach to under a
     solid ceiling, so it waits until the shore is actually in view (the camera's
     right edge past the water's end) instead of showing through solid rock. */
  if (L.water && cam + LOGICAL_W < L.waterTo * TILE) return;
  // decos are pre-sorted back to front and each carries its own parallax factor
  for (const d of L.decos) {
    const x = d.x - cam * d.px + (d.drift ? Math.sin((GAME.frame + d.x) * 0.004) * 2 : 0);
    if (x < -40 || x > LOGICAL_W + 8) continue;
    ctx.drawImage(T[d.spr], Math.round(x), d.y);
  }
}
/* coin spin: hold the face-on frame, pass through the edge-on one quickly */
const COIN_CYCLE = [0, 0, 0, 1, 2, 3];
/* a punched block hops up and settles: BUMP_OFFSET[t] is its y offset in px */
const BUMP_OFFSET = [-1, -3, -5, -6, -6, -5, -3, -2, -1, 0];
function bumpAt(tx, ty) {
  for (const b of GAME.bumps) if (b.tx === tx && b.ty === ty) return BUMP_OFFSET[b.t] || 0;
  return 0;
}
function drawTiles() {
  const L = GAME.level;
  const T = theme();
  const cam = camQ();
  const x0 = Math.floor((cam - 8) / TILE);
  // A coin spends most of a real spin facing you. Cycling 0-1-2-3 evenly left it
  // edge-on half the time, which read as a gold stick rather than a coin.
  const coinFrame = COIN_CYCLE[Math.floor(GAME.frame / 5) % COIN_CYCLE.length];
  for (let ty = 0; ty < L.H; ty++) {
    for (let tx = x0; tx <= x0 + VIEW_TILES; tx++) {
      const c = cellAt(tx, ty);
      if (c === ' ') continue;
      const x = tx * TILE - cam, y = ty * TILE + (GAME.bumps.length ? bumpAt(tx, ty) : 0);
      // capped tile only where the top is actually exposed; buried tiles use the
      // flat interior so a mass reads as one structure
      if (c === 'X') ctx.drawImage(solid(cellAt(tx, ty - 1)) ? T.groundFill : T.ground, x, y);
      else if (c === 'B') ctx.drawImage(T.brick, x, y);
      else if (c === '?' || c === 'M' || c === 'F' || c === 'S') ctx.drawImage(T.qblock, x, y);
      else if (c === 'U') ctx.drawImage(T.used, x, y);
      else if (c === 'T') ctx.drawImage(T.pipeTop, x, y);
      else if (c === 'E') ctx.drawImage(cellAt(tx - 1, ty) === 'E' ? T.pipeEnterR : T.pipeEnterL, x, y);
      else if (c === 'L') ctx.drawImage(T.lava[Math.floor(GAME.frame / 12) % 2], x, y);
      else if (c === 'A') ctx.drawImage(SPR.axe, x, y);
      else if (c === 'P') ctx.drawImage(T.pipeBody, x, y);
      else if (c === 'f') ctx.drawImage(T.pole, x, y);
      else if (c === 'b') blitFoe(SPR.finial, x + 4, y + 5);
      // loose coins spin in sync: a per-tile phase offset made a row read as a
      // row of mismatched bars rather than a line of coins
      else if (c === 'c') blitFoe(SPR.coin[coinFrame], x + 3, y + 4);
    }
  }
  /* Fire bars and the boss. Bars are drawn from the pivot outward so the chain reads
     as one object; the boss is drawn here rather than with the enemies because it is
     the only thing in the game taller than two tiles. */
  if (L.bars) {
    for (const b of L.bars) {
      const px = b.x - cam;
      if (px < -80 || px > LOGICAL_W + 80) continue;
      for (let i = 1; i <= b.len; i++) {
        const lx = Math.round(px + Math.cos(b.a) * i * 8) - 4;
        const ly = Math.round(b.y + Math.sin(b.a) * i * 8) - 4;
        blitFoe(SPR.fireLink, lx, ly);
      }
    }
  }
  if (L.boss && !L.boss.dead) {
    const b = L.boss, px = Math.round(b.x - cam);
    if (px > -48 && px < LOGICAL_W + 48) {
      const spr = SPR.boss[Math.floor(GAME.frame / 10) % 2];
      const flip = b.vx > 0;
      if (flip) {
        ctx.save(); ctx.translate(px + spr.lw, Math.round(b.y)); ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = true; ctx.drawImage(spr, 0, 0, spr.lw, spr.lh);
        ctx.imageSmoothingEnabled = false; ctx.restore();
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(spr, px, Math.round(b.y), spr.lw, spr.lh);
        ctx.imageSmoothingEnabled = false;
      }
      // a struck boss flashes: the shot landed, it just did not matter
      if (b.hit > 0 && b.hit % 2) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#FFD86A';
        ctx.fillRect(px + 2, Math.round(b.y) + 2, spr.lw - 4, spr.lh - 4);
        ctx.globalAlpha = 1;
      }
    }
  }
  /* Lifts ride with the terrain, and interpolate like every other moving thing --
     a platform stepping at 60Hz under a smoothly interpolated hero reads as the
     hero sliding on ice. */
  if (L.plats) {
    for (const p of L.plats) {
      const x = Math.round(ix(p) - cam), y = Math.round(iy(p));
      if (x < -40 || x > LOGICAL_W + 40) continue;
      ctx.drawImage(p.w <= 16 ? T.platS : T.plat, x, y);
      // a short shadow line under the deck so it reads as floating, not painted on
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + 2, y + p.h, p.w - 4, 1);
    }
  }
  /* Checkpoint marker, drawn with the terrain so the hero passes in front. The
     pennant climbs the pole over 40 frames when armed -- an instant swap read as
     a glitch at 60Hz, and the climb is the same visual grammar as the goal. */
  if (L.checkX) {
    const px = L.checkX * TILE + 2 - cam;
    if (px > -20 && px < LOGICAL_W + 20) {
      const top = 13 * TILE - 44;
      ctx.fillStyle = 'rgba(22,18,34,0.92)'; ctx.fillRect(px, top, 2, 44);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(px, top, 1, 44);
      ctx.fillStyle = '#2A3352'; ctx.fillRect(px - 2, 13 * TILE - 3, 6, 3);
      if (GAME.checkArmed) {
        const t = Math.min(1, GAME.checkT / 40);
        const y = Math.round(top + 26 - 26 * t);
        blitFoe(SPR.checkFlag, px + 2, y);
      } else {
        // furled at the foot of the pole: arming *raises* it, so the resting
        // state has to be the bottom or the climb reads as a teleport
        blitFoe(SPR.checkLimp, px + 2, top + 25);
      }
    }
  }
  /* Course banner rides the pole down with the player; castle banner is hoisted
     once the hero is inside. Both are drawn with the terrain so the hero sprite
     passes in front of the pole. */
  const poleX = L.flagX * TILE - cam;
  if (poleX > -32 && poleX < LOGICAL_W + 32) {
    blitFoe(SPR.banner, poleX - 7, 3 * TILE + 6 + GAME.bannerY);
  }
  const cx = L.castleX * TILE - cam;
  if (cx > -64 && cx < LOGICAL_W + 64) {
    ctx.drawImage(SPR.castle, cx, 13*TILE - 32);
    if (GAME.castleFlagY > 0) {
      ctx.fillStyle = 'rgba(24,16,30,0.9)';
      ctx.fillRect(cx + 15, 13*TILE - 46, 1, 14);
      blitFoe(SPR.castleFlag, cx + 16, 13*TILE - 46 + (14 - GAME.castleFlagY));
    }
  }
}
/* Monsters are curve art on supersampled canvases too, so they need the logical
   footprint and smoothing for the blit. `visibleH` clips from the top, which is
   how the pipe plant appears to rise out of its pipe. */
function blitFoe(spr, x, y, visibleH) {
  const lw = spr.lw || spr.width, lh = spr.lh || spr.height;
  const h = visibleH === undefined ? lh : Math.min(lh, visibleH);
  if (h <= 0) return;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(spr, 0, 0, spr.width, h * FOE_SS, x, y, lw, h);
  ctx.imageSmoothingEnabled = smooth;
}
/* squash/stretch: sq<1 flattens and widens, sq>1 stretches and narrows.
   Anchored to the feet and centred on the hitbox. `flip` mirrors in place, into
   the exact same destination rect, so a left-facing draw lands on identical
   pixels to a pre-mirrored sprite. */
function drawPlayerSprite(spr, x, y, w, h, sq, flip) {
  /* Hero canvases are supersampled, so the destination has to come from their
     logical footprint, not their pixel size. Smoothing is enabled just for this
     blit: the heroes are drawn from curves and must stay smooth, while every
     tile and enemy keeps nearest-neighbour sampling. */
  const lw = spr.lw || spr.width, lh = spr.lh || spr.height;
  const sw = lw * (1 + (1 - sq) * 0.6), sh = lh * sq;
  const dx = x + (w - sw) / 2, dy = y + h - sh;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  if (flip) {
    ctx.save();
    ctx.translate(dx + sw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(spr, 0, 0, sw, sh);
    ctx.restore();
  } else {
    ctx.drawImage(spr, dx, dy, sw, sh);
  }
  ctx.imageSmoothingEnabled = smooth;
}
function drawSprites() {
  const m = GAME.mario, cam = viewCam(); // subpixel: no rounding
  for (const it of GAME.items) {
    const x = ix(it) - cam, y = iy(it);
    if (x < -24 || x > LOGICAL_W + DRAW_MARGIN) continue;
    if (it.type === 'coinAnim') { blitFoe(SPR.coin[Math.floor(it.t / 3) % 4], x + 2, y); }
    else if (it.type === 'mushroom') blitFoe(SPR.mushroom, x, y);
    else if (it.type === 'flower') blitFoe(SPR.flower, x, y);
    else if (it.type === 'star') blitFoe(SPR.star, x, y);
  }
  for (const b of GAME.balls) {
    // spin direction follows travel direction
    const f = b.vx > 0 ? Math.floor(b.spin / 3) % 4 : 3 - Math.floor(b.spin / 3) % 4;
    ctx.drawImage(SPR.fireball[f], ix(b) - cam, iy(b));
  }
  for (const e of GAME.level.enemies) {
    if (e.gone) continue;
    const x = ix(e) - cam, y = iy(e);
    if (x < -24 || x > LOGICAL_W + DRAW_MARGIN) continue;
    // walk cycle driven by distance travelled, so it matches the actual speed
    const step = Math.floor(Math.abs(e.x) / 6) % 2;
    if (e.flat) {
      // squashed pose for walkers, shell for the rest
      const usePuff = e.type === 'puff' || e.type === 'spiko' || e.type === 'flappy' || e.type === 'chomp';
      blitFoe(usePuff ? SPR.puffFlat : SPR.shell, x, y + (usePuff ? 0 : 6));
      continue;
    }
    if (e.type === 'puff') blitFoe(SPR.puff[step], x, y);
    else if (e.type === 'spiko') blitFoe(SPR.spiko[step], x, y);
    else if (e.type === 'flappy') blitFoe(SPR.flappy[e.vy < -0.5 ? 1 : 0], x, y);
    else if (e.type === 'blaze') {
      if (e.up) blitFoe(SPR.blaze[Math.floor(GAME.frame / 5) % 2], x, y);
    }
    else if (e.type === 'glider') {
      blitFoe(SPR.glider[Math.floor(GAME.frame / 6) % 2], x, y);
    }
    else if (e.type === 'fish') {
      blitFoe(SPR.fish[Math.floor(GAME.frame / 7) % 2], x, y);
    }
    else if (e.type === 'cannon') {
      blitFoe(SPR.cannon, x, y);
    }
    else if (e.type === 'bolt') {
      blitFoe(SPR.bolt[Math.floor(GAME.frame / 8) % 2], x, y);
    }
    else if (e.type === 'chomp') {
      // clip to the pipe mouth so it looks like it is coming out of the pipe
      const visible = Math.max(0, e.baseY + e.h - iy(e));
      if (visible > 0) blitFoe(SPR.chomp, x, y, visible);
    }
    else if (e.type === 'shelly') blitFoe(SPR.shelly[step], x, y);
    else if (e.type === 'shell' || e.type === 'shellMove') blitFoe(SPR.shell, x, y);
  }
  for (const p of GAME.particles) {
    const x = ix(p) - cam, y = iy(p);
    if (p.kind === 'debris') {
      ctx.save();
      ctx.translate(x + 2, y + 2);
      ctx.rotate(p.rot || 0);
      ctx.globalAlpha = Math.max(0, 1 - p.t / 60);
      ctx.drawImage(theme().brick, -2, -2, 5, 5);
      ctx.restore();
    } else if (p.kind === 'spark') {
      const tw = p.t % 6 < 3;
      ctx.globalAlpha = Math.max(0, 1 - p.t / 24);
      ctx.fillStyle = tw ? '#FFD84A' : '#FFFFFF';
      const s = tw ? 2 : 3;
      ctx.fillRect(x - (s >> 1), y - (s >> 1), s, s);
      ctx.globalAlpha = 1;
    } else if (p.kind === 'dust') {
      ctx.globalAlpha = Math.max(0, 0.7 * (1 - p.t / 14));
      ctx.fillStyle = '#E8E0D0'; ctx.fillRect(x, y, 2, 2);
      ctx.globalAlpha = 1;
    } else if (p.kind === 'trail') {
      ctx.globalAlpha = Math.max(0, 0.8 * (1 - p.t / 12));
      ctx.fillStyle = p.color || '#FFD84A';
      const s = Math.max(1, 3 - (p.t >> 2));
      ctx.fillRect(x, y, s, s);
      ctx.globalAlpha = 1;
    }
  }
  // once the walk finishes the hero is inside the keep, so stop drawing them:
  // leaving them parked in the open gateway undercut the whole arrival
  if (m && !(GAME.state === 'clear' && GAME.walkDone)) {
    const x = lerp(m.px, m.x, GAME.alpha) - cam, y = lerp(m.py, m.y, GAME.alpha);
    // star palette cycles at 4 frames, then speeds up to 2 over the last second
    // as the only warning that invincibility is about to run out
    // 4x slower under reduced motion; the end-of-star speed-up is kept, just gentler
    const starRate = REDUCED ? (m.star > 60 ? 16 : 8) : (m.star > 60 ? 4 : 2);
    const set = m.star > 0 ? STAR_SPR[Math.floor(GAME.frame / starRate) % STAR_SPR.length]
              : (m.fire ? FIRE_SPR[GAME.charIdx] : CHAR_SPR[GAME.charIdx]);
    const f = set[m.state] || set.stand;
    const spr = m.big ? f.big : f.small;
    const flip = m.facing === -1;
    if (m.dead) {
      if (m.deathTimer % 10 < 5) drawPlayerSprite(spr, x, y, m.w, m.h, 1, m.facing === -1);
    } else if (m.invuln > 0 && GAME.frame % 4 < 2) {
      // invincibility blink: skip this frame
    } else {
      drawPlayerSprite(spr, x, y, m.w, m.h, m.sq, flip);
    }
  }
  /* The hero is drawn after the terrain, so a descent would show them sliding down
     the front of the pipe. Redrawing the two mouth tiles over them puts the hero
     behind the pipe for the length of the transition. */
  if (GAME.pipeAnim) {
    const a = GAME.pipeAnim, T = theme(), tcam = camQ();  // tcam: the tiles' own camera
    const tx = a.dir === 'in' ? (a.entry ? a.entry.tx : -1)
                              : (GAME.level.room ? GAME.level.exitTx : -1);
    const ty = a.dir === 'in' ? (a.entry ? a.entry.ty : -1) : 11;
    if (tx >= 0) for (let i = 0; i < 2; i++) {
      const c = cellAt(tx + i, ty);
      const spr = c === 'E' ? (i === 1 ? T.pipeEnterR : T.pipeEnterL) : (c === 'T' ? T.pipeTop : null);
      if (spr) ctx.drawImage(spr, Math.round((tx + i) * TILE - tcam), ty * TILE);
    }
  }
  for (const p of GAME.popups) {
    const alpha = p.t > 30 ? Math.max(0, 1 - (p.t - 30) / 20) : 1;
    // round to whole pixels: 1px font glyphs look broken at subpixel positions
    drawText(p.text, Math.round(ix(p) - cam), Math.round(iy(p)), '#FFF', alpha, true);
  }
}
function drawHud() {
  // progress bar hugs the very top edge so it never crosses the readouts
  if (GAME.level && GAME.mario && !GAME.mario.dead && !GAME.level.room) {
    const prog = Math.max(0, Math.min(1, (GAME.mario.x - 3 * TILE) / ((GAME.level.flagX - 3) * TILE)));
    ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(0, 0, LOGICAL_W, 2);
    ctx.fillStyle = '#FFD84A'; ctx.fillRect(0, 0, Math.round(LOGICAL_W * prog), 2);
    // where the respawn point sits, so the bar answers "how much would I lose?"
    if (GAME.level.checkX) {
      const at = Math.round(LOGICAL_W * (GAME.level.checkX - 3) / (GAME.level.flagX - 3));
      ctx.fillStyle = GAME.checkArmed ? '#4AC8FF' : 'rgba(255,255,255,0.45)';
      ctx.fillRect(at, 0, 2, 2);
    }
  }
  // soft scrim: white text on bright sky is otherwise low contrast
  ctx.fillStyle = hudScrimGrad(); ctx.fillRect(0, 2, LOGICAL_W, 28);

  /* Five groups, each CENTRED inside its own fifth of the view. The previous
     layout stepped from a fixed left margin, which bunched everything toward the
     left and left a wide empty gap on the right. */
  const R1 = 6, R2 = 15;
  const mid = i => (i + 0.5) * LOGICAL_W / 5;
  const cen = (str, i, y, color, vol) =>
    drawText(str, Math.round(mid(i) - textWidth(str) / 2), y, color, 1, true, vol);

  cen(CHARS[GAME.charIdx].name, 0, R1, '#FFF');
  cen(String(GAME.score).padStart(6, '0'), 0, R2, '#FFF', true);

  const coinStr = 'X' + String(GAME.coins).padStart(2, '0');
  const coinGroup = 10 + 2 + textWidth(coinStr);        // icon + gap + text
  const coinX = Math.round(mid(1) - coinGroup / 2);
  blitFoe(SPR.coin[Math.floor(GAME.frame / 8) % 4], coinX, R1 - 1);
  drawText(coinStr, coinX + 12, R1, '#FFD84A', 1, true, true);
  cen('COINS', 1, R2, '#9FB6E8');

  cen('LIVES', 2, R1, '#FFF');
  cen('X' + GAME.lives, 2, R2, '#FFF', true);

  cen('WORLD', 3, R1, '#FFF');
  cen(GAME.world + '-' + GAME.lv, 3, R2, '#FFF', true);

  cen('TIME', 4, R1, '#FFF');
  const timeLow = GAME.time <= 100 && (GAME.frame % 36 < 18);
  cen(String(GAME.time).padStart(3, '0'), 4, R2, timeLow ? '#FF6A6A' : '#FFF', true);

  // combo feedback (pulses while chain stomping)
  if (GAME.combo >= 2 && GAME.state === 'play') {
    const txt = 'COMBO X' + GAME.combo;
    const pulse = 1 + Math.sin(GAME.frame * 0.3) * 0.08;
    ctx.save();
    ctx.translate(LOGICAL_W / 2, 40);
    ctx.scale(pulse, pulse);
    drawText(txt, -textWidth(txt) / 2, 0, '#FFD84A', 1, true);
    ctx.restore();
  }
}
function centerText(s, y, color, alpha) {
  drawText(s, Math.round((LOGICAL_W - textWidth(s)) / 2), y, color, alpha, true);
}
function drawTitle() {
  const T = TSPR[0]; // the title always shows the meadow theme
  drawSky(THEMES[0]);

  // clouds ride above the logo plate; scenery sits below the hero row. Nothing
  // in this screen is allowed to share a y-range with a line of text.
  const t = GAME.frame * 0.12;
  for (let i = 0; i < 5; i++) {
    const x = ((i * 72 + t) % (LOGICAL_W + 80)) - 40;
    ctx.drawImage(i % 2 ? T.cloud : T.cloudBig, Math.round(x), 6 + (i % 3) * 5);
  }
  ctx.drawImage(T.hillBig, 12, 194);
  ctx.drawImage(T.hill, 206, 198);
  for (let y = 208; y < LOGICAL_H; y += 16) for (let x = 0; x < LOGICAL_W; x += 16) {
    // same rule as in-game: only the top course is capped
    ctx.drawImage(y > 208 ? T.groundFill : T.ground, x, y);
  }
  ctx.drawImage(T.bushBig, 56, 201);
  ctx.drawImage(T.bush, 176, 202);

  /* Logo. The bob is a whole-pixel sine so the letterforms never land on a
     half pixel, which would soften the outline for a frame at a time. */
  const logoBob = Math.round(Math.sin(GAME.frame * 0.035) * 2);
  bigHeadline('PIPO JUMP', 24 + logoBob, 4, HEAD_GOLD);
  centerText('©2026 PIXEL STUDIO', 66 + logoBob, '#BFEDE8');

  centerText('CHOOSE YOUR HERO', 86, '#FFFFFF');
  ctx.imageSmoothingEnabled = true; // hero previews are curve art
  const bob = Math.floor(GAME.frame / 20) % 2;
  CHARS.forEach((c, i) => {
    const cx = Math.round(LOGICAL_W / 2 + (i - 1) * 74);
    const sel = i === GAME.charIdx;
    const s = CHAR_SPR[i].stand.small;
    if (sel) {
      ctx.fillStyle = 'rgba(255,216,74,0.18)'; ctx.fillRect(cx - 24, 98, 48, 68);
      ctx.fillStyle = '#FFD84A'; ctx.fillRect(cx - 24, 98, 48, 1); ctx.fillRect(cx - 24, 165, 48, 1);
      ctx.drawImage(s, cx - 14, 104 + bob, s.lw * 2, s.lh * 2); // 2x showcase
    } else {
      ctx.globalAlpha = 0.7;
      ctx.drawImage(s, cx - 7, 120 + bob, s.lw, s.lh); // feet aligned with the 2x sprite
      ctx.globalAlpha = 1;
    }
    drawText(c.name, cx - Math.round(textWidth(c.name) / 2), 140, sel ? '#FFD84A' : '#CFE0FF', 1, true);
    /* Each hero carries a two-word blurb (CAP BOY, TWIN TAIL, CAT HOOD) that was in
       the data from the start and had never been drawn anywhere. It only shows for the
       selected one -- three at once is noise, one is a caption. */
    if (sel) drawText(c.blurb, cx - Math.round(textWidth(c.blurb) / 2), 148, '#BFEDE8', 1, true);
    // per-hero stat bars make the speed/jump difference legible at a glance
    [[c.speed, '#6BD048', 156], [c.jump, '#4AC8FF', 161]].forEach(([val, col, y]) => {
      const filled = Math.max(1, Math.min(5, Math.round((val - 0.88) / 0.06)));
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = k < filled ? col : 'rgba(255,255,255,0.22)';
        ctx.fillRect(cx - 13 + k * 6, y, 4, 3);
      }
    });
  });
  ctx.imageSmoothingEnabled = false;
  // legend for the two stat bars
  const lgx = Math.round(LOGICAL_W / 2) - 58;
  ctx.fillStyle = '#6BD048'; ctx.fillRect(lgx, 174, 4, 3);
  drawText('SPEED', lgx + 8, 172, '#CFE0FF', 1, true);
  ctx.fillStyle = '#4AC8FF'; ctx.fillRect(lgx + 60, 174, 4, 3);
  drawText('JUMP', lgx + 68, 172, '#CFE0FF', 1, true);
  centerText(TOUCH ? 'TAP A TO START' : 'PRESS ENTER TO START', 189,
    REDUCED ? '#FFD84A' : (Math.floor(GAME.frame / 24) % 2 ? '#FFFFFF' : '#FFD84A'));

  /* Footer band. At 0.78 the brick coursing still showed through and the score sat in
     the texture; 0.9 plus a rule along the top reads as a panel rather than a wash. */
  ctx.fillStyle = 'rgba(6,10,26,0.90)'; ctx.fillRect(0, 206, LOGICAL_W, 34);
  ctx.fillStyle = 'rgba(255,216,74,0.55)'; ctx.fillRect(0, 206, LOGICAL_W, 1);
  /* The record gets its context when the table agrees with it. An install that
     predates the table has a `pipoHigh` and no rows, and inventing a world and a hero
     for it would be a lie printed in gold. */
  const rec = GAME.scores[0];
  centerText('TOP ' + String(GAME.high).padStart(6, '0') +
             (rec && rec.s === GAME.high ? '   W' + rec.w + '-' + rec.lv + '  ' + rec.hero : ''),
             211, '#FFD84A');
  /* Only once there is something to choose. On a first visit the line would be a
     control with one option, which is just noise. */
  if (GAME.maxWorld > 1) {
    centerText('START AT WORLD ' + GAME.startWorld + (TOUCH ? '  TAP DOWN' : '  DOWN TO CHANGE'), 220, '#DDE8FF');
  }
  /* On a desktop page the key legend already lives in the DOM chrome, so
     repeating it inside the playfield is pure duplication. On touch the chrome is
     hidden and this is the only reference, so it stays there. */
  if (TOUCH) {
    centerText('A JUMP   HOLD B TO RUN   F SHOOT', 224, '#DDE8FF');
    centerText('P PAUSE FOR FULL CONTROLS', 233, '#9FB6E8');
  } else {
    centerText('P PAUSE FOR FULL CONTROLS', 228, '#9FB6E8');
  }
}
function drawWorld() {
  /* Decaying alternating offset, not per-frame noise: random jitter reads as a
     dropped frame, a vertical thump reads as an impact. Whole pixels only, so
     the tile grid never lands on a half pixel. */
  let shy = 0;
  if (GAME.shake > 0) shy = (GAME.shake % 2 ? 1 : -1) * Math.min(2, Math.ceil(GAME.shake / 2));
  ctx.save();
  ctx.translate(0, shy);
  drawBackground();
  drawTiles();
  drawSprites();
  ctx.restore();
  drawHud();
}
function scrim(a) { ctx.fillStyle = `rgba(6,10,24,${a})`; ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H); }

/* hero portrait + remaining lives, measured and centred as a single group */
function drawLifeCounter(y) {
  const spr = CHAR_SPR[GAME.charIdx].stand.small;
  const txt = 'X ' + GAME.lives;
  const gap = 6;
  const total = spr.lw + gap + textWidth(txt);
  const x = Math.round((LOGICAL_W - total) / 2);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(spr, x, y - 2, spr.lw, spr.lh);
  ctx.imageSmoothingEnabled = smooth;
  drawText(txt, x + spr.lw + gap, y + 5, '#FFFFFF', 1, true, true);
}

/* One-off teaching banners. Nothing on screen used to say which key runs or how
   to use the flower, so both powers went unnoticed. Each hint fires once per run
   and phrases itself for whichever input the player is actually using. */
function hint(text) { GAME.hint = text; GAME.hintT = 170; }
function drawHint() {
  if (!GAME.hint || GAME.hintT <= 0) return;
  const a = GAME.hintT > 140 ? (170 - GAME.hintT) / 30 : Math.min(1, GAME.hintT / 40);
  const w = textWidth(GAME.hint) + 12;
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.fillStyle = 'rgba(8,14,32,0.82)';
  ctx.fillRect((LOGICAL_W - w) / 2, 52, w, 15);
  ctx.fillStyle = '#FFD84A';
  ctx.fillRect((LOGICAL_W - w) / 2, 52, w, 1);
  ctx.globalAlpha = 1;
  centerText(GAME.hint, 56, '#FFFFFF', Math.max(0, Math.min(1, a)));
}

/* The controls list lives on the pause screen: it is the one place a player
   already goes looking for answers, and it needs no extra key to discover. */
/* Built from KEYS_MAP so the table is the truth after a rebind rather than a copy of
   the defaults that quietly goes stale. */
const CONTROL_ROWS = () => TOUCH ? [
  ['MOVE', 'ARROWS'], ['JUMP', 'A  HOLD FOR HEIGHT'], ['RUN', 'HOLD B'],
  ['SHOOT', 'F  AFTER FLOWER'], ['PIPE', 'DOWN'], ['PAUSE', 'P']
] : [
  ['MOVE', bindingText('left') + '  ' + bindingText('right')],
  ['JUMP', bindingText('jump') + '  HOLD FOR HEIGHT'],
  ['RUN', 'HOLD ' + bindingText('run')],
  ['SHOOT', bindingText('fire') + '  AFTER FLOWER'],
  ['PIPE', bindingText('down')],
  ['PAUSE', bindingText('pause')],
  ['SOUND', bindingText('mute') + ' MUTE  ' + bindingText('bgm') + ' MUSIC']
];
/* The top five, as a block centred as one group rather than five centred lines --
   five independently centred rows of different lengths read as a ransom note. Columns
   are fixed so the scores line up under each other, which is the only reason a table
   beats a list. `mine` is the row this run just took, if it took one. */
function drawScoreTable(topY, mine) {
  const x0 = Math.round(LOGICAL_W / 2) - 78;
  centerText('TOP FIVE', topY, '#FFD84A');
  const list = GAME.scores;
  if (!list.length) {
    centerText('NO RUNS YET', topY + 14, '#8C9BC4');
    return;
  }
  list.forEach((e, i) => {
    const y = topY + 14 + i * 10;
    const on = i === mine;
    if (on) {
      ctx.fillStyle = 'rgba(255,216,74,0.16)';
      ctx.fillRect(x0 - 6, y - 2, 168, 10);
    }
    const col = on ? '#FFD84A' : (i === 0 ? '#FFFFFF' : '#9FB6E8');
    drawText(String(i + 1), x0, y, on ? '#FFD84A' : '#8C9BC4', 1, true);
    drawText(String(e.s).padStart(6, '0'), x0 + 16, y, col, 1, true);
    drawText('W' + e.w + '-' + e.lv, x0 + 66, y, col, 1, true);
    drawText(e.hero || '-', x0 + 104, y, col, 1, true);
  });
}
function drawControls(topY) {
  const rows = CONTROL_ROWS();
  centerText('CONTROLS', topY, '#FFD84A');
  const kx = Math.round(LOGICAL_W / 2) - 118;
  rows.forEach(([k, v], i) => {
    const y = topY + 14 + i * 11;
    drawText(k, kx, y, '#9FB6E8', 1, true);
    drawText(v, kx + 44, y, '#FFFFFF', 1, true);
  });
}
function draw() {
  switch (GAME.state) {
    case 'title': drawTitle(); break;
    case 'gameover':
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      bigHeadline('GAME OVER', 34, 3, HEAD_RED);
      /* What the run was. The score alone says nothing about how it was earned, and a
         player who took 84 coins the careful way and one who chained foes end to end
         used to get the identical card. */
      centerText('REACHED WORLD ' + GAME.world + '-' + GAME.lv, 70, '#9FB6E8');
      centerText(GAME.run.coins + ' COINS   ' + GAME.run.foes + ' FOES   BEST CHAIN ' + GAME.run.chain,
                 80, '#DDE8FF');
      centerText('SCORE ' + String(GAME.score).padStart(6, '0'), 94, '#FFFFFF');
      if (GAME.scoreAt === 0 && (REDUCED || Math.floor(GAME.frame / 20) % 2 === 0))
        centerText('NEW RECORD', 106, '#6BD048');
      drawScoreTable(120, GAME.scoreAt);
      /* A run used to end at a dead end: one key sent you to the title and the
         world you had reached was gone. Continuing restarts the world you died in
         with a fresh set of lives -- the score resets, so the leaderboard still
         means one clean run. */
      const opts = [['CONTINUE  WORLD ' + GAME.world + '-1', 190], ['END  BACK TO TITLE', 206]];
      opts.forEach(([label, y], i) => {
        const sel = GAME.overSel === i;
        const w = textWidth(label);
        const x = Math.round((LOGICAL_W - w) / 2);
        if (sel) {
          ctx.fillStyle = 'rgba(255,216,74,0.16)';
          ctx.fillRect(x - 10, y - 3, w + 20, 12);
          drawText('>', x - 9, y, '#FFD84A', 1, true);
        }
        drawText(label, x, y, sel ? '#FFD84A' : '#8C9BC4', 1, true);
      });
      if (REDUCED || Math.floor(GAME.frame / 26) % 2 === 0)
        centerText(TOUCH ? 'ARROWS TO PICK - A TO CONFIRM' : 'ARROWS TO PICK - ENTER TO CONFIRM', 224, '#DDE8FF');
      break;
    case 'ready':
      /* Losing a life used to cut straight back into the course with no
         acknowledgement at all, so there was nowhere the player could see how
         many they had left. A death now gets the classic interstitial -- hero
         portrait and the remaining count -- while a fresh course keeps the
         lighter READY! card over the level. */
      if (GAME.afterDeath) {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
        centerText(GAME.timeUp ? 'TIME UP!' : 'WORLD ' + GAME.world + '-' + GAME.lv, 84,
                   GAME.timeUp ? '#FF6A6A' : '#FFFFFF');
        if (GAME.timeUp) centerText('WORLD ' + GAME.world + '-' + GAME.lv, 96, '#9FB6E8');
        drawLifeCounter(GAME.timeUp ? 118 : 112);
        /* Say where the course will resume. A silent checkpoint is the same as no
           checkpoint: the player braces for the whole course again and only finds
           out afterwards. Blue matches the pennant they raised. */
        if (GAME.checkArmed && GAME.level && GAME.level.checkX) {
          centerText('FROM CHECKPOINT', 146, '#4AC8FF');
        }
      } else {
        drawWorld();
        scrim(0.45);
        centerText('WORLD ' + GAME.world + '-' + GAME.lv, 92, '#FFFFFF');
        centerText(THEMES[GAME.theme].name, 104, '#9FB6E8');
        drawLifeCounter(120);
        centerText('READY!', 148, '#FFD84A');
      }
      break;
    case 'clear':
      drawWorld();
      if (GAME.walkDone) {
        // let the flag slide + castle walk play, then present a clean result panel
        scrim(0.6);
        /* A fortress does not end with a flagpole, it ends with a bridge going out from
           under a boss. Calling that "course clear" undersells the one beat in the game
           that is supposed to feel like a win. */
        if (GAME.level.fortress) bigHeadline('FORTRESS FALLS', 76, 3, HEAD_RED);
        else bigHeadline('COURSE CLEAR', 76, 3, HEAD_TEAL);
        centerText('TIME BONUS ' + String(GAME.time * 50).padStart(5, '0'), 112, '#FFD84A');
        centerText('SCORE ' + String(GAME.score).padStart(6, '0'), 124, '#FFFFFF');
        /* Three courses make a world, and clearing one used to look exactly like
           clearing any other course -- the next card just said WORLD n+1. */
        if (GAME.worldDone) {
          centerText('WORLD ' + GAME.world + ' COMPLETE', 142, '#FFD84A');
          centerText('NEXT: WORLD ' + (GAME.world + 1) + '-1', 154, '#9FB6E8');
        }
      }
      break;
    default: drawWorld();
  }
  if (GAME.state === 'play' && !GAME.paused) drawHint();
  if (GAME.paused) {
    scrim(0.74);
    centerText('PAUSED', 30, '#FFFFFF');
    drawControls(52);
    if (GAME.rebind >= 0) {
      /* A panel over the pause screen, one action at a time. The prompt names the action
         and the key it holds now, so the player can see what they are replacing. */
      const a = REBINDABLE[GAME.rebind];
      ctx.fillStyle = 'rgba(6,10,26,0.92)'; ctx.fillRect(24, 150, LOGICAL_W - 48, 62);
      ctx.fillStyle = 'rgba(255,216,74,0.55)'; ctx.fillRect(24, 150, LOGICAL_W - 48, 1);
      centerText('PRESS A KEY FOR', 156, '#9FB6E8');
      centerText(a.toUpperCase() + '   (NOW ' + bindingText(a) + ')', 168, '#FFD84A');
      centerText('ENTER SKIP    ESC CANCEL', 182, '#DDE8FF');
      centerText((GAME.rebind + 1) + ' OF ' + REBINDABLE.length, 194, '#8C9BC4');
    } else {
      centerText(TOUCH ? 'TAP P TO RESUME' : 'PRESS ' + bindingText('pause') + ' TO RESUME', 198, '#9FB6E8');
      if (!TOUCH) centerText(bindingText('quit') + ' QUIT TO TITLE     R REBIND KEYS', 210, '#8C9BC4');
      if (GAME.rebindT > 0) centerText(GAME.rebindMsg, 186, '#6BD048');
    }
  }
  // course transitions fade through black instead of hard-cutting
  if (GAME.fade > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, GAME.fade)})`;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  }
}

/* ---------- main loop ---------- */
function update() {
  /* Snapshot the previous step so draw() can interpolate. The simulation is a
     fixed 60Hz -- that is required for determinism -- but the display often runs
     at 120Hz+, where showing each step twice reads as stepped motion. */
  GAME.camPrev = GAME.camera;
  if (GAME.mario) { GAME.mario.px = GAME.mario.x; GAME.mario.py = GAME.mario.y; }
  snapAll(GAME.items); snapAll(GAME.balls); snapAll(GAME.particles); snapAll(GAME.popups);
  if (GAME.level) { snapAll(GAME.level.enemies); if (GAME.level.plats) snapAll(GAME.level.plats); }
  GAME.frame++;
  if (GAME.fadeDir !== 0) {
    GAME.fade += GAME.fadeDir * 0.09;
    if (GAME.fade <= 0) { GAME.fade = 0; GAME.fadeDir = 0; }
    else if (GAME.fade >= 1) { GAME.fade = 1; GAME.fadeDir = 0; }
  }
  if (GAME.hintT > 0) GAME.hintT--;
  if (GAME.rebindT > 0) GAME.rebindT--;
  if (GAME.paused) return;
  switch (GAME.state) {
    case 'ready':
      GAME.readyTimer++;
      if (GAME.readyTimer > (GAME.afterDeath ? 120 : 80)) {
        GAME.afterDeath = false; GAME.timeUp = false;
        GAME.state = 'play';
        if (!GAME.taughtRun) { GAME.taughtRun = true; hint(TOUCH ? 'HOLD B TO RUN' : 'HOLD Z TO RUN'); }
      }
      break;
    case 'play':
      if (updatePipeAnim()) { updateTimer(); break; }   // a transition owns the step
      updatePlats();      // geometry moves first, then whatever is standing on it
      updateMario();
      if (GAME.level.fortress) {
        if (GAME.collapse > 0) updateCollapse();
        updateBars();
        updateBoss();
        checkAxe();
      }
      updateItems();
      updateBalls();
      updateEnemies();
      updateFx();
      updateTimer();
      if (GAME.state === 'play') {
        // smooth camera (never scrolls backward, eased)
        const maxCam = GAME.level.W * TILE - LOGICAL_W;
        const target = Math.max(GAME.camera, GAME.mario.x - CAM_LEAD);
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
/* Fixed 60Hz timestep. update() used to be called once per animation frame,
   which made the whole game run at double speed on 120Hz displays. */
const STEP_MS = 1000 / 60;
const MAX_CATCHUP = 5;
let acc = 0, lastTime = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  fitIfNeeded();
  syncChrome();
  let dt = now - lastTime;
  lastTime = now;
  if (dt > 250) dt = STEP_MS; // returning from a backgrounded tab: don't fast-forward
  acc += dt;
  let steps = 0;
  while (acc >= STEP_MS && steps < MAX_CATCHUP) { update(); acc -= STEP_MS; steps++; }
  if (steps === MAX_CATCHUP) acc = 0; // too far behind to catch up; drop the debt
  GAME.alpha = acc / STEP_MS;         // how far into the next step this frame sits
  draw();
}
loadSettings();
warmTextCaches();
syncKeyLegend();   // the page ships with the defaults written in; make it match the data
setupTouch();
fit(); // re-fit: setupTouch may have just reserved room for the pad
requestAnimationFrame(loop);
