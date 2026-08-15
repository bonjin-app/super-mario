/* ============================================================
   PIPO JUMP — original character platformer (web)
   original art / music / characters, smooth 60fps
   ============================================================ */
'use strict';

/* ---------- canvas (2x supersampled for smooth subpixel motion) ---------- */
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
canvas.width = 512; canvas.height = 480;
ctx.setTransform(2, 0, 0, 2, 0, 0);
ctx.imageSmoothingEnabled = false;
function fit() {
  const s = Math.max(1, Math.floor(Math.min(window.innerWidth / 512, window.innerHeight / 480)));
  canvas.style.width = (512 * s) + 'px';
  canvas.style.height = (480 * s) + 'px';
}
window.addEventListener('resize', fit); fit();

const TILE = 16;

/* ---------- palette ---------- */
const PAL = {
  W: '#FFFFFF', Y: '#FFD84A', K: '#2A2A2A', G: '#43B025',
  O: '#C87830', F: '#C85A17', D: '#3A2410', T: '#43B025',
  S: '#B57A3B', s: '#8C5A2B', L: '#E8D8B0'
};

/* ---------- pixel-font (5x7) ---------- */
const FONT = {
  '0':[14,17,19,21,25,17,14],'1':[4,12,4,4,4,4,14],'2':[14,17,1,6,9,17,31],
  '3':[14,17,1,6,1,17,14],'4':[2,6,10,18,31,2,2],'5':[31,17,30,1,1,17,14],
  '6':[6,9,17,30,17,17,14],'7':[31,1,2,4,8,8,8],'8':[14,17,17,14,17,17,14],
  '9':[14,17,17,15,1,17,14],
  A:[14,17,17,31,17,17,17],B:[30,17,17,30,17,17,30],C:[14,17,17,1,1,17,14],
  D:[28,18,17,17,17,18,28],E:[31,17,17,30,17,17,31],F:[31,17,17,30,17,17,17],
  G:[14,17,17,11,17,17,15],H:[17,17,17,31,17,17,17],I:[14,4,4,4,4,4,14],
  J:[7,2,2,2,2,18,12],K:[17,18,20,24,20,18,17],L:[17,17,17,17,17,17,31],
  M:[17,27,21,21,17,17,17],N:[17,25,21,19,17,17,17],O:[14,17,17,17,17,17,14],
  P:[30,17,17,30,17,17,17],Q:[14,17,17,17,21,18,13],R:[30,17,17,30,20,18,17],
  S:[15,17,17,14,1,1,30],T:[31,4,4,4,4,4,4],U:[17,17,17,17,17,17,14],
  V:[17,17,17,17,17,10,4],W:[17,17,17,21,21,27,17],X:[17,17,10,4,10,17,17],
  Y:[17,17,10,4,4,4,14],Z:[31,1,2,4,8,16,31],
  '.':[0,0,0,0,0,0,12],'!':[4,4,4,4,4,0,4],'-':[0,0,0,31,0,0,0],
  '©':[14,17,17,17,17,17,14],':':[0,12,0,0,12,0,0],
  ' ':new Array(7).fill(0)
};
function drawText(s, x, y, color, alpha) {
  if (alpha !== undefined && alpha < 1) ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch];
    if (g) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++)
      if (g[r] & (16 >> c)) ctx.fillRect(cx + c, y + r, 1, 1);
    cx += 6;
  }
  if (alpha !== undefined && alpha < 1) ctx.globalAlpha = 1;
}

/* ---------- sprites ---------- */
function makeSprite(rows, pal) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) {
    const col = pal[row[x]]; if (!col) continue;
    g.fillStyle = col;
    g.fillRect(w - 1 - x, y, 1, 1); // pre-mirrored to face right
  }});
  return c;
}
function makeFlipped(spr) {
  const f = document.createElement('canvas'); f.width = spr.width; f.height = spr.height;
  const g = f.getContext('2d');
  g.translate(spr.width, 0); g.scale(-1, 1); g.drawImage(spr, 0, 0);
  return f;
}

/* original character art (14px wide) */
const CHAR_ART = {
  small: [
    '......WW......','......A.......','...AAAAAA.....','..AAAAAAAA....','..AWWWWWWWWWA..','..AWKWWWWKWA..',
    '..AWWWWWWWWWA..','..AAAAAAAA....','...BBBBBB.....','..BBBBBBBB....','..BBYYYYBB....','..BBBBBBBB....',
    '...AA..AA.....','...AA..AA.....','..AAA..AAA....','..AAA..AAA....'
  ],
  smallJump: [
    '......WW......','......A.......','...AAAAAA.....','..AAAAAAAA....','..AWWWWWWWWWA..','..AWKWWWWKWA..',
    '..AWWWWWWWWWA..','..AAAAAAAA....','...BBBBBB.....','..BBBBBBBB....','..BBYYYYBB....','..BBBBBBBB....',
    '..AA....AA....','..AA....AA....','.AAA....AAA...','.AAA....AAA...'
  ],
  bigHead: [
    '......WW......','......A.......','...AAAAAA.....','..AAAAAAAA....','..AAAAAAAA....','..AWWWWWWWWWA..',
    '..AWKWWWWKWA..','..AWWWWWWWWWA..','..AAAAAAAA....'
  ],
  bigBody: [
    '...BBBBBB.....','..BBBBBBBB....','..BBBBBBBB....','..BBYYYYBB....','..BBYYYYBB....','..BBBBBBBB....',
    '..BBBBBBBB....','...BBBBBB.....','...BBBBBB.....','...AA..AA.....','...AA..AA.....','...AA..AA.....',
    '...AA..AA.....','...AA..AA.....','...AA..AA.....','..AAA..AAA....','..AAA..AAA....','..AAA..AAA....',
    '...AA..AA.....','...AA..AA.....','...AA..AA.....','..AAA..AAA....','..AAA..AAA....'
  ],
  bigJumpBody: [
    '...BBBBBB.....','..BBBBBBBB....','..BBBBBBBB....','..BBYYYYBB....','..BBYYYYBB....','..BBBBBBBB....',
    '..BBBBBBBB....','...BBBBBB.....','...BBBBBB.....','...AA..AA.....','...AA..AA.....','...AA..AA.....',
    '...AA..AA.....','...AA..AA.....','...AA..AA.....','...AA....AA...','...AA....AA...','..AAA....AAA..',
    '...AA....AA...','...AA....AA...','..AAA....AAA..','..AAA....AAA..','..AAA....AAA..'
  ]
};
/* original enemies */
const PUFF_ART = [
  '..KK.KK.KK..','..KKKKKKKK..','.OOOOOOOOOO.','.OOOOOOOOOO.','.OWWKKKKWWO.','.OWWKKKKWWO.',
  '.OOOOOOOOOO.','..OOOOOOOO..','..OOOOOOOO..','..KKKKKKKK..','..KKK..KKK..','............'
];
const PUFF_FLAT = [
  '............','............','............','............','............','............',
  '............','..OOOOOOOO..','..OWWWWWWO..','..KKKKKKKK..','..KKK..KKK..','............'
];
const SHELLY_ART = [
  '...K...K....','...G...G....','.GGGGGGGGG..','.GKGGGGGGG..','.GGGGGGGGG..','..GGGGGGGG..',
  '.SSSSSSSSSS.','SSSSSSSSSSSS','SSWSSWSSWSSS','SSSSSSSSSSSS','SSSSSSSSSSSS','.SSSSSSSSSS.',
  '...KKKKKKK..','...KKKKKKK..','............','............'
];
const SHELL_ART = [
  '............','............','............','.SSSSSSSSSS.','SSSSSSSSSSSS','SSWSSWSSWSSS',
  'SSSSSSSSSSSS','.SSSSSSSSSS.','...KKKKKKK..','...KKKKKKK..'
];

const SPR = {};
function buildSprites() {
  SPR.puff = makeSprite(PUFF_ART, PAL);
  SPR.puffFlat = makeSprite(PUFF_FLAT, PAL);
  SPR.shelly = makeSprite(SHELLY_ART, PAL);
  SPR.shell = makeSprite(SHELL_ART, PAL);
  // powerups
  SPR.mushroom = makeSprite([
    '...RRRRRR...','..RWWRRRWW..','.RWWRRRRWWR.','.RWRRRRRRWR.','.RWWRRRRWWR.','..RWWRRWWR..',
    '.WWWWWWWWWW.','..SSSSSSSS..','..SSKKSSKK..','..SSKKSSKK..','..SSSSSSSS..','...SSSSSS...'],
    { R: '#E7551F', W: '#FFFFFF', S: '#FFD8B0', K: '#2A2A2A' });
  SPR.flower = makeSprite([
    '....FFFF....','..FFYYYYFF..','.FFYYYYYYFF.','.FYWWYYWWYF.','.FYWWYYWWYF.','.FFYYYYYYFF.',
    '..FFYYYYFF..','....YYYY....','....GGGG....','....GGGG....','....GGGG....','....GGGG....'],
    { F: '#C85A17', Y: '#FFD84A', W: '#FFFFFF', G: '#43B025' });
  SPR.star = makeSprite([
    '....YYYY....','....YYYY....','...YYYYYY...','...YYYYYY...','YYYYYYYYYYYY','YWWYYYYYYWYY',
    '..YYYYYYYY..','..YYYYYYYY..','..YYYYYYYY..','..YYYYYYYY..','..YYYYYYYY..','..YY..YY..YY'],
    { Y: '#FFD84A', W: '#FFFFFF' });
  SPR.coin = makeSprite([
    '..YYYYYY..','.YWWYYYYY.','.YWYYYYYY.','.YYYYYYYY.','.YYYYYYYY.','.YYYYYYYY.',
    '.YYYYYYY.','.YWWWYYY..','..YYYYYY..'],
    { Y: '#FFC830', W: '#FFF2B0' });
  // tiles
  const tile = (fn) => { const c = document.createElement('canvas'); c.width = 16; c.height = 16; fn(c.getContext('2d')); return c; };
  SPR.ground = tile(g => {
    g.fillStyle = '#C85A17'; g.fillRect(0,0,16,16);
    g.fillStyle = '#F08030'; g.fillRect(0,0,16,2); g.fillRect(0,0,2,16);
    g.fillStyle = '#8C3A0F'; g.fillRect(14,0,2,16); g.fillRect(0,14,16,2);
    g.fillStyle = '#000'; g.fillRect(8,2,1,12); g.fillRect(0,8,16,1);
    g.fillStyle = '#F08030'; g.fillRect(3,3,1,4); g.fillRect(11,9,1,4);
  });
  SPR.brick = tile(g => {
    g.fillStyle = '#B5561A'; g.fillRect(0,0,16,16);
    g.fillStyle = '#F08030'; g.fillRect(0,0,16,1); g.fillRect(0,8,16,1);
    g.fillStyle = '#8C3A0F'; g.fillRect(7,0,1,8); g.fillRect(3,8,1,8); g.fillRect(11,8,1,8); g.fillRect(0,15,16,1);
  });
  SPR.qblock = tile(g => {
    g.fillStyle = '#F8B800'; g.fillRect(0,0,16,16);
    g.fillStyle = '#F8D878'; g.fillRect(1,1,14,2); g.fillRect(1,1,2,14);
    g.fillStyle = '#8C5A0F'; g.fillRect(14,1,2,14); g.fillRect(1,14,14,2);
    g.fillStyle = '#E7551F';
    g.fillRect(6,2,4,3); g.fillRect(7,5,2,3); g.fillRect(6,8,4,2); g.fillRect(6,10,2,4); g.fillRect(9,10,2,3);
    g.fillStyle = '#FFF'; g.fillRect(4,4,2,2); g.fillRect(10,4,2,2); g.fillRect(4,10,2,2); g.fillRect(10,10,2,2);
  });
  SPR.used = tile(g => {
    g.fillStyle = '#8C5A2B'; g.fillRect(0,0,16,16);
    g.fillStyle = '#6B410F'; g.fillRect(1,1,14,2); g.fillRect(1,1,2,14); g.fillRect(14,1,2,14); g.fillRect(1,14,14,2);
    g.fillStyle = '#B57A3B'; g.fillRect(3,4,10,2); g.fillRect(3,10,10,2);
  });
  SPR.pipeTop = tile(g => {
    g.fillStyle = '#43B025'; g.fillRect(0,0,16,16);
    g.fillStyle = '#8FE070'; g.fillRect(1,0,2,16); g.fillRect(0,0,16,2);
    g.fillStyle = '#1E7A14'; g.fillRect(13,0,3,16); g.fillRect(0,14,16,2); g.fillRect(15,0,1,16);
  });
  SPR.pipeBody = tile(g => {
    g.fillStyle = '#43B025'; g.fillRect(0,0,16,16);
    g.fillStyle = '#8FE070'; g.fillRect(1,0,2,16);
    g.fillStyle = '#1E7A14'; g.fillRect(13,0,3,16); g.fillRect(15,0,1,16);
  });
  SPR.flagBall = makeSprite(['.WWWWW.','WWWWWWW','WWWWWWW','.WWWWW.'], PAL);
  SPR.pole = tile(g => { g.fillStyle = '#43B025'; g.fillRect(7,0,2,16); g.fillStyle = '#8FE070'; g.fillRect(7,0,1,16); });
  SPR.cloud = makeSprite([
    '....WWWWWW....','..WWWWWWWWWW..','.WWWWWWWWWWWW.','.WWWWWWWWWWWW.','.WWWWWWWWWWWW.','.WWWWWWWWWWWW.',
    '..WWWWWWWWWW..','...WWWWWWWW...'], PAL);
  SPR.hill = makeSprite([
    '......TTTT......','....TTTTTTTT....','...TTTTTTTTTT...','..TTTTTTTTTTTT..','.TTTTTTTTTTTTTT.','.TTTTTTTTTTTTTT.',
    '.TTTTTTTTTTTTTT.','.TTTTTTTTTTTTTT.','.TTTTTTTTTTTTTT.','.TTTTTTTTTTTTTT.'], PAL);
  SPR.bush = makeSprite([
    '...TTTT..TTTT...','..TTTTTT.TTTTT..','.TTTTTTTTTTTTTT.','.TTTTTTTTTTTTTT.',
    '.TTTTTTTTTTTTTT.','..TTTTTTTTTTTT..'], PAL);
  {
    const rows = [];
    rows.push('BWWBWWBWWBWWBWWBWWBWWBWWBWWB');
    rows.push('BBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    for (let i = 0; i < 22; i++) rows.push('BBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    for (let i = 0; i < 8; i++) rows.push('BBBBBBBBBBBBDDDDDDDDBBBBBBBBBBBB');
    SPR.castle = makeSprite(rows, { B: '#3A5AC8', W: '#E8E8F8', D: '#2A1A0A' });
  }
}
buildSprites();

/* ---------- characters (original) ---------- */
const CHARS = [
  { name: 'PIP',   speed: 1.00, jump: 1.00,
    pal: { A: '#2BA8A0', B: '#F07830', W: '#EAF6F2', K: '#1E3030', Y: '#FFD84A' } },
  { name: 'MOCHI', speed: 1.12, jump: 0.94,
    pal: { A: '#F2A0BC', B: '#FFF0F6', W: '#FFFFFF', K: '#5A2A44', Y: '#FFD84A' } },
  { name: 'BOLT',  speed: 0.94, jump: 1.10,
    pal: { A: '#FFB830', B: '#FFF6E0', W: '#FFFFFF', K: '#5A3A10', Y: '#FF5A5A' } }
];
function charSprites(i) {
  const pal = CHARS[i].pal;
  return {
    smallIdle: makeSprite(CHAR_ART.small, pal),
    smallJump: makeSprite(CHAR_ART.smallJump, pal),
    bigIdle: makeSprite(CHAR_ART.bigHead.concat(CHAR_ART.bigBody), pal),
    bigJump: makeSprite(CHAR_ART.bigHead.concat(CHAR_ART.bigJumpBody), pal),
    smallIdleL: null, smallJumpL: null, bigIdleL: null, bigJumpL: null
  };
}
const CHAR_SPR = CHARS.map((c, i) => {
  const s = charSprites(i);
  s.smallIdleL = makeFlipped(s.smallIdle);
  s.smallJumpL = makeFlipped(s.smallJump);
  s.bigIdleL = makeFlipped(s.bigIdle);
  s.bigJumpL = makeFlipped(s.bigJump);
  return s;
});

/* ---------- sound ---------- */
const Sound = {
  ctx: null, muted: false,
  init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
  tone(freq, dur, type='square', vol=0.12, delay=0, slide=0) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + Math.max(0, delay);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  jump()     { this.tone(320, 0.18, 'square', 0.1, 0, 380); },
  coin()     { this.tone(988, 0.08); this.tone(1319, 0.35, 'square', 0.12, 0.08); },
  stomp()    { this.tone(220, 0.1, 'triangle', 0.2, 0, -120); },
  bump()     { this.tone(110, 0.08, 'square', 0.15); },
  breakB()   { this.tone(180, 0.12, 'sawtooth', 0.12, 0, -100); this.tone(90, 0.15, 'square', 0.1, 0.02); },
  power()    { [523,659,784,1047,1319].forEach((f,i)=>this.tone(f,0.09,'square',0.1,i*0.06)); },
  grow()     { [392,523,659,784].forEach((f,i)=>this.tone(f,0.1,'square',0.1,i*0.08)); },
  pipe()     { [784,659,523,392].forEach((f,i)=>this.tone(f,0.12,'square',0.1,i*0.09)); },
  die()      { [660,622,587,494,392,330,262,196].forEach((f,i)=>this.tone(f,0.14,'square',0.1,i*0.11)); },
  flag()     { [392,494,587,784,988,1175,1568,1976].forEach((f,i)=>this.tone(f,0.09,'square',0.1,i*0.07)); },
  oneUp()    { [988,1319,1568,1175,1319,1568].forEach((f,i)=>this.tone(f,0.11,'square',0.1,i*0.08)); },
  kick()     { this.tone(300, 0.08, 'square', 0.12, 0, 200); },
  fireball() { this.tone(700, 0.12, 'square', 0.1, 0, -400); },
  shrink()   { [784, 659, 523, 392].forEach((f,i)=>this.tone(f,0.12,'square',0.1,i*0.09)); }
};
/* original chiptune loop (A pentatonic, Am-F-C-G) */
const BGM = {
  playing: false, timer: null, step: 0, nextTime: 0,
  tempo: 0.2,
  lead:  [440,0,523,587,659,0,587,523, 587,0,659,784,659,587,523,0,
          440,0,523,587,659,784,880,784, 659,587,523,880,784,659,523,0],
  bass:  [110,0,110,0,110,0,110,0, 87,0,87,0,87,0,87,0,
          131,0,131,0,131,0,131,0, 98,0,98,0,98,0,98,0],
  start() {
    if (this.playing || !Sound.ctx) return;
    this.playing = true; this.step = 0;
    this.nextTime = Sound.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.tick(), 40);
  },
  stop() { this.playing = false; if (this.timer) clearInterval(this.timer); this.timer = null; },
  tick() {
    if (!Sound.ctx) return;
    while (this.nextTime < Sound.ctx.currentTime + 0.16) {
      const s = this.step % 32;
      const d = this.nextTime - Sound.ctx.currentTime;
      if (this.lead[s]) Sound.tone(this.lead[s], 0.16, 'square', 0.04, d);
      if (this.bass[s]) Sound.tone(this.bass[s], 0.3, 'triangle', 0.11, d);
      this.nextTime += this.tempo;
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
