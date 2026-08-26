/* ---------- PIPO JUMP regression suite ----------
   Every check here exists because something was once broken and the check would have
   caught it. Nothing is asserted from memory: the numbers are the ones measured in the
   browser and written into README.md.

   HOW IT WORKS
   The suite loads the real index.html in an iframe and drives the real engine inside
   it. There is no second copy of the markup to drift out of date, and no mock of the
   game to be faithful to. Two things make it deterministic:

     1. requestAnimationFrame in the frame is replaced with a no-op. The game's loop
        re-registers itself every frame, so the chain dies and the suite owns the clock.
        This matters more than it sounds: headless rAF runs at ~121Hz against a fixed
        60Hz accumulator, so anything timed in rAF ticks is half the length it looks.
     2. Steps are update() + draw() called directly, so a step is a step.

   Input goes in as real KeyboardEvents, never by poking the `keys` object, because
   jumpBuf, pause, quit and the rebind screen all live in the keydown handler. A jump is
   an EDGE (engine.js sets jumpBuf on keydown); holding keys.jump only sets jump HEIGHT.
   Poking `keys` produces a hero who never leaves the ground, which is exactly the blind
   spot that hid the walk bug for weeks.

   Each group gets a FRESH iframe. An earlier version of this harness reused one, and a
   single poisoned charIdx leaked into every later case: 12 of 14 reported failures were
   the harness contaminating itself.

   Bot outcomes are never used as evidence about level quality. What is asserted is
   either an invariant (no NaN, no negative counters, no unbounded arrays, nothing
   leaving the world) or a bot-policy-free measurement (the forgiveness window, which
   starts the hero at the takeoff point at full speed). */

(function (root) {
  'use strict';

  const TESTS = [];
  const test = (group, name, fn) => TESTS.push({ group, name, fn });

  /* ---------- helpers bound to one frame ---------- */
  function api(win) {
    const ev = (type, key) => win.dispatchEvent(new win.KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
    const g = (expr) => win.eval(expr);
    const A = {
      win,
      G: g('GAME'),
      K: g('keys'),
      T: g('TILE'),
      chars: g('CHARS'),
      actions: g('ACTIONS'),
      defaults: g('DEFAULT_KEYS'),
      keysMap: () => g('KEYS_MAP'),
      solid: g('solid'),
      cellAt: g('cellAt'),
      snap: g('snapMario'),
      startLevel: g('startLevel'),
      spawnItem: g('spawnItem'),
      update: g('update'),
      draw: g('draw'),
      crashed: () => { try { return g('crashed'); } catch (e) { return undefined; } },
      down: (k) => ev('keydown', k),
      up: (k) => ev('keyup', k),
      tap: (k) => { ev('keydown', k); ev('keyup', k); },
      step() { A.update(); A.draw(); },
      run(n) { for (let i = 0; i < n; i++) A.step(); },
      clearKeys() { const K = A.K; K.left = K.right = K.run = K.jump = K.down = false; },
      /* start a specific course, out of 'ready', with a full stock of lives */
      course(world, lv, charIdx) {
        const G = A.G;
        G.charIdx = charIdx === undefined ? 0 : charIdx;
        G.world = world; G.lv = lv; G.lives = 9;
        A.startLevel(false);
        A.clearKeys();
        A.run(100);
        return G.level;
      },
      leaveTitle() {
        for (let i = 0; i < 30 && A.G.state === 'title'; i++) { A.tap('Enter'); A.step(); }
      },
      /* the top of the GROUND stack at a column, so stairs count and a floating
         reward block overhead is never mistaken for footing */
      groundTop(L, tx) {
        if (tx < 0 || tx >= L.W) return -1;
        let ty = L.H - 1;
        if (!A.solid(L.map[ty][tx])) return -1;
        while (ty > 0 && A.solid(L.map[ty - 1][tx])) ty--;
        return ty;
      },
      pits(L) {
        const isPit = [];
        for (let tx = 0; tx < L.W; tx++) isPit.push(A.groundTop(L, tx) < 0);
        const out = []; let s = -1;
        for (let tx = 0; tx < L.W; tx++) {
          if (isPit[tx] && s < 0) s = tx;
          if (!isPit[tx] && s >= 0) { if (s > 8 && tx < L.W - 6) out.push({ a: s, b: tx - 1 }); s = -1; }
        }
        return out;
      },
      /* the invariants. None of these depend on how well anything plays. */
      violations() {
        const G = A.G, T = A.T, bad = [], m = G.mario;
        if (m) {
          for (const k of ['x', 'y', 'vx', 'vy']) if (!Number.isFinite(m[k])) bad.push('mario.' + k + '=' + m[k]);
          if (G.level && m.y > (G.level.H + 8) * T && !m.dead) bad.push('below the world, alive');
          if (m.x < -32) bad.push('left of the world');
          if (G.level && m.x > G.level.W * T + 32) bad.push('right of the world');
        }
        if (!Number.isFinite(G.camera) || G.camera < -1) bad.push('camera=' + G.camera);
        if (G.lives < 0) bad.push('lives<0');
        if (G.score < 0) bad.push('score<0');
        if (G.coins < 0) bad.push('coins<0');
        if (G.time < 0) bad.push('time<0');
        for (const [n, cap] of [['particles', 600], ['popups', 80], ['items', 80], ['balls', 40]]) {
          const arr = G[n]; if (arr && arr.length > cap) bad.push(n + '=' + arr.length + '>' + cap);
        }
        const es = G.level && G.level.enemies;
        if (es) {
          if (es.length > 400) bad.push('enemies=' + es.length);
          for (const e of es) if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) { bad.push('enemy NaN'); break; }
        }
        return bad;
      }
    };
    return A;
  }

  const fail = (msg) => { throw new Error(msg); };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  /* ================= locomotion (ISSUE-005) ================= */
  /* The creep-killer used to run on steps where a direction was held, erasing the
     acceleration as fast as it was applied. BOLT could not walk on dry land at all,
     and PIP and BOLT could not move along the seabed. MOCHI was fine by four decimal
     places, which is why it went unnoticed. Every bot in the project's history held
     the run key, and run acceleration always cleared the threshold. */
  test('locomotion', 'every hero walks, runs and swims, at the documented speeds', (A) => {
    const cases = [];
    for (let ci = 0; ci < A.chars.length; ci++) {
      const mul = A.chars[ci].speed;
      cases.push({ ci, world: 1, lv: 1, run: false, cap: 1.4 * mul, label: 'land walk' });
      cases.push({ ci, world: 1, lv: 1, run: true, cap: 2.7 * mul, label: 'land run' });
      cases.push({ ci, world: 3, lv: 3, run: false, cap: 1.55 * mul, label: 'water' });
    }
    const notes = [];
    for (const c of cases) {
      A.course(c.world, c.lv, c.ci);
      if (c.world === 3 && !A.G.level.water) fail('expected a water course at 3-3');
      if (A.G.level.enemies) A.G.level.enemies.length = 0;   // locomotion only
      const x0 = A.G.mario.x;
      A.K.right = true; A.K.run = c.run;
      let maxVx = 0;
      for (let i = 0; i < 240; i++) { A.step(); maxVx = Math.max(maxVx, Math.abs(A.G.mario.vx)); }
      const moved = A.G.mario.x - x0;
      A.clearKeys();
      const who = A.chars[c.ci].name + ' ' + c.label;
      if (moved <= 0) fail(who + ' did not move at all (' + moved.toFixed(1) + 'px)');
      if (!near(maxVx, c.cap, 0.02)) fail(who + ' top speed ' + maxVx.toFixed(3) + ', expected ' + c.cap.toFixed(3));
      notes.push(who + ' ' + moved.toFixed(0) + 'px @' + maxVx.toFixed(2));
    }
    return notes.join(' | ');
  });

  test('locomotion', 'releasing the key still stops the hero dead', (A) => {
    /* the creep-killer's actual job: it must survive the fix that stopped it from
       eating held input */
    A.course(1, 1, 0);
    if (A.G.level.enemies) A.G.level.enemies.length = 0;
    A.K.right = true; A.K.run = true;
    A.run(120);
    A.clearKeys();
    const x0 = A.G.mario.x;
    let stopStep = -1;
    for (let i = 0; i < 200; i++) { A.step(); if (stopStep < 0 && A.G.mario.vx === 0) stopStep = i; }
    const coast = A.G.mario.x - x0;
    if (stopStep < 0) fail('vx never reached exactly 0 after release');
    if (stopStep > 90) fail('took ' + stopStep + ' steps to stop');
    if (coast > 40) fail('coasted ' + coast.toFixed(1) + 'px after release');
    return 'stopped at step ' + stopStep + ' after ' + coast.toFixed(1) + 'px';
  });

  /* ================= scoring ================= */
  /* bumpCombo checked the combo value AFTER incrementing it, and that value sits at the
     top of the ladder for the rest of an unbroken chain -- so every stomp past the
     ladder handed out another life. 15 stomps gave 7. */
  test('scoring', 'a chain grants exactly one 1UP, however long it runs', (A) => {
    const G = A.G;
    /* a course has to be running: bumpCombo drops a 1UP popup at the hero's position,
       and GAME.mario is null on the title screen */
    A.course(1, 1, 0);
    const bump = A.win.eval('bumpCombo');
    const ladder = A.win.eval('COMBO_PTS').length;
    const trial = (n) => {
      G.combo = 0; G.lives = 3; G.popups.length = 0;
      for (let i = 0; i < n; i++) bump();
      return G.lives - 3;
    };
    const shortChain = trial(ladder - 1);
    const atLadder = trial(ladder);
    const longChain = trial(ladder * 4);
    if (shortChain !== 0) fail('a chain below the ladder granted ' + shortChain + ' lives');
    if (atLadder !== 1) fail('reaching the ladder granted ' + atLadder + ' lives, expected 1');
    if (longChain !== 1) fail('a chain of ' + (ladder * 4) + ' granted ' + longChain + ' lives, expected 1');
    // and a fresh chain is allowed its own
    G.combo = 0; G.lives = 3;
    for (let i = 0; i < ladder; i++) bump();
    G.combo = 0;
    for (let i = 0; i < ladder; i++) bump();
    if (G.lives - 3 !== 2) fail('two separate chains granted ' + (G.lives - 3) + ' lives, expected 2');
    return 'ladder=' + ladder + ', one per chain, two chains give two';
  });

  /* ================= pause hardening ================= */
  test('pause', 'a course never begins paused, and un-pausing always works', (A) => {
    const G = A.G;
    A.leaveTitle();
    A.run(120);
    if (G.state !== 'play') fail('expected play, got ' + G.state);
    A.tap('p');
    if (!G.paused) fail('p did not pause during play');
    A.startLevel(false);
    if (G.paused) fail('a course started while paused stayed paused');
    /* the hard lock: paused with a non-play state means update() never advances the
       ready timer, and the toggle used to refuse to fire outside 'play' */
    G.paused = true;
    const stateWhenForced = G.state;
    A.tap('p');
    if (G.paused) fail('could not un-pause from state ' + stateWhenForced);
    const t0 = G.readyTimer;
    A.run(30);
    if (!(G.readyTimer > t0)) fail('the ready timer did not resume');
    return 'un-paused from ' + stateWhenForced + ', timer resumed';
  });

  /* ================= level geometry ================= */
  /* The bot-policy-free measure. Takeoff happens AT the takeoff point at full run
     speed, so horizontal approach obstacles (a 4-tile pipe nine columns back) cannot be
     mistaken for an unjumpable pit -- a mistake this project made twice. The ascent
     still passes through the real airspace, which is what ISSUE-003/004 were about. */
  test('geometry', 'forgiveness window holds its documented baseline', (A) => {
    let pairs = 0, sum = 0, traps = 0, pits = 0, courses = 0;
    const trapList = [];
    for (let w = 1; w <= 5; w++) for (let lv = 1; lv <= 3; lv++) {
      A.course(w, lv, 0);
      if (A.G.level.water || A.G.level.fortress) continue;
      courses++;
      const list = A.pits(A.G.level);
      pits += list.length;
      for (const p of list) for (let ci = 0; ci < A.chars.length; ci++) {
        let ok = 0, valid = 0;
        for (let d = 0; d <= 5; d++) {
          const L = A.course(w, lv, ci);
          if (L.enemies) L.enemies.length = 0;
          const m = A.G.mario;
          const tx = (p.a - 1) - d, gt = A.groundTop(L, tx);
          if (gt < 0) continue;
          valid++;
          m.x = tx * A.T; m.y = gt * A.T - m.h; m.vy = 0;
          m.vx = 2.7 * A.chars[ci].speed;
          m.onGround = true; m.dead = false;
          A.snap();
          A.K.right = true; A.K.run = true;
          m.jumpBuf = 8;
          let jr = 20, cleared = false;
          for (let i = 0; i < 200; i++) {
            if (jr > 0 && m.vy <= 0) { A.K.jump = true; jr--; } else { A.K.jump = false; jr = 0; }
            A.step();
            if (m.dead || A.G.state !== 'play') break;
            if (m.onGround && m.x / A.T > p.b + 1) { cleared = true; break; }
          }
          A.clearKeys();
          if (cleared) ok++;
        }
        if (valid > 0) {
          pairs++; sum += (ok / valid) * 6;
          if (ok === 0) { traps++; if (trapList.length < 5) trapList.push(w + '-' + lv + ' pit' + p.a + ' ' + A.chars[ci].name); }
        }
      }
    }
    const avg = sum / pairs;
    if (traps > 0) fail(traps + ' pit/hero pairs cleared at no takeoff timing: ' + trapList.join(', '));
    if (pairs < 100) fail('only ' + pairs + ' pairs measured, expected ~108');
    if (avg < 4.6) fail('average forgiveness ' + avg.toFixed(3) + '/6, baseline is 4.75');
    return courses + ' courses, ' + pits + ' pits, ' + pairs + ' pairs, avg ' + avg.toFixed(3) + '/6, 0 traps';
  });

  /* ================= soak ================= */
  test('soak', 'every course survives a long run with the invariants intact', (A) => {
    let steps = 0, viol = [], jr = 0;
    const G = A.G, T = A.T;
    const bot = () => {
      const m = G.mario;
      A.K.right = true; A.K.left = false; A.K.run = true;
      if (!m || G.state !== 'play') { A.K.jump = false; jr = 0; return; }
      const ft = Math.floor((m.y + m.h + 2) / T), cx = Math.floor((m.x + m.w / 2) / T);
      let need = false;
      if (m.onGround) {
        for (let d = 1; d <= 3 && !need; d++) {
          let grounded = false;
          for (let ty = ft; ty <= ft + 2; ty++) if (A.solid(A.cellAt(cx + d, ty))) grounded = true;
          if (!grounded) need = true;
        }
        for (let d = 1; d <= 2; d++) for (let ty = ft - 1; ty >= ft - 2; ty--) if (A.solid(A.cellAt(cx + d, ty))) need = true;
        for (const e of ((G.level.enemies) || [])) if (!e.dead && e.x > m.x && e.x - m.x < 40 && Math.abs(e.y - m.y) < 26) need = true;
        if (need) { m.jumpBuf = 8; jr = 20; }
      }
      if (jr > 0 && m.vy <= 0) { A.K.jump = true; jr--; } else { A.K.jump = false; jr = 0; }
    };
    for (let w = 1; w <= 5; w++) for (let lv = 1; lv <= 4; lv++) {
      A.course(w, lv, (w + lv) % A.chars.length);
      // powerups through the real pickup path, so big / fire / star all run
      for (let i = 0; i < 1200; i++) {
        if (i === 200) A.spawnItem('mushroom', Math.floor(G.mario.x / T), Math.floor(G.mario.y / T) - 1);
        if (i === 600) A.spawnItem('flower', Math.floor(G.mario.x / T), Math.floor(G.mario.y / T) - 1);
        if (i === 900) A.spawnItem('star', Math.floor(G.mario.x / T), Math.floor(G.mario.y / T) - 1);
        bot(); A.step(); steps++;
        if (G.lives < 4) G.lives = 9;
        if (i % 4 === 0) {
          const bad = A.violations();
          if (bad.length && viol.length < 6) viol.push(w + '-' + lv + ' step' + i + ': ' + bad.join('; '));
        }
      }
      A.clearKeys();
    }
    if (viol.length) fail(viol.join(' || '));
    return steps + ' steps over 20 courses, 0 violations';
  });

  /* ================= inputs no directed bot presses ================= */
  test('soak', 'random input across every key leaves the invariants intact', (A) => {
    const G = A.G, T = A.T;
    const MOVE = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'z', 'f'];
    const SYS = ['p', 'm', 'b', 'Enter', 'Escape', 'q'];
    const held = new Set();
    let seed = 20260826;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let steps = 0, active = 0, viol = [], presses = 0, leftSteps = 0, balls = 0;
    for (let w = 1; w <= 5; w++) for (let lv = 1; lv <= 4; lv++) {
      A.course(w, lv, (w + lv) % A.chars.length);
      for (const k of Array.from(held)) { A.up(k); held.delete(k); }
      A.spawnItem('flower', Math.floor(G.mario.x / T), Math.floor(G.mario.y / T) - 1);
      let pausedRun = 0, prevBalls = 0;
      for (let i = 0; i < 900; i++) {
        if (rnd() < 0.16) {
          const k = MOVE[Math.floor(rnd() * MOVE.length)];
          if (held.has(k)) { A.up(k); held.delete(k); } else { A.down(k); held.add(k); }
          presses++;
        }
        if (rnd() < 0.004) { A.tap(SYS[Math.floor(rnd() * SYS.length)]); presses++; }
        /* a player does not sit on the pause screen for a minute; without this the
           fuzz spent 89% of its steps paused and tested nothing while reporting clean */
        if (G.paused) { if (++pausedRun > 40) { A.tap('p'); pausedRun = 0; } } else { pausedRun = 0; active++; }
        A.step(); steps++;
        if (G.lives < 4) G.lives = 9;
        if (G.mario && G.mario.vx < -0.2) leftSteps++;
        const nb = (G.balls || []).length;
        if (nb > prevBalls) balls += nb - prevBalls;
        prevBalls = nb;
        if (G.state === 'title') { A.course(w, lv, 0); }
        if (i % 4 === 0) {
          const bad = A.violations();
          if (bad.length && viol.length < 6) viol.push(w + '-' + lv + ' step' + i + ': ' + bad.join('; '));
        }
      }
      for (const k of Array.from(held)) { A.up(k); held.delete(k); }
    }
    if (viol.length) fail(viol.join(' || '));
    // coverage, so a green run cannot mean "nothing happened"
    const activePct = Math.round(100 * active / steps);
    if (activePct < 70) fail('only ' + activePct + '% of steps were live; the fuzz tested almost nothing');
    if (leftSteps < 500) fail('only ' + leftSteps + ' leftward steps; left movement barely exercised');
    if (balls < 20) fail('only ' + balls + ' fireballs; the fire path barely ran');
    return steps + ' steps, ' + presses + ' presses, ' + activePct + '% live, ' +
           leftSteps + ' left steps, ' + balls + ' fireballs, 0 violations';
  });

  /* ================= course transitions ================= */
  test('flow', 'flag, checkpoint, game over, fortress boss and rebind cancel', (A) => {
    const G = A.G, T = A.T, notes = [];

    // flag -> clear -> next course
    let L = A.course(1, 1, 0);
    let m = G.mario;
    m.x = (L.flagX - 3) * T; m.y = 12 * T - m.h; m.vx = 0; m.vy = 0; m.onGround = true; A.snap();
    A.K.right = true;
    let sawClear = false;
    for (let i = 0; i < 900; i++) { A.step(); if (G.state === 'clear') sawClear = true; if (sawClear && G.state === 'ready') break; }
    A.clearKeys();
    if (!sawClear) fail('touching the flag did not reach the clear state');
    if (!(G.world === 1 && G.lv === 2)) fail('after clearing 1-1 the game sat at ' + G.world + '-' + G.lv);
    notes.push('flag -> 1-2');

    // checkpoint: cross it, die, and come back to the marker
    L = A.course(1, 1, 0);
    m = G.mario;
    m.x = (L.checkX + 2) * T; m.y = 12 * T - m.h; m.onGround = true; A.snap();
    A.run(20);
    if (!G.checkArmed) fail('crossing the checkpoint did not arm it');
    m.dead = false; m.y = (L.H + 4) * T;
    for (let i = 0; i < 400 && G.state !== 'ready'; i++) A.step();
    A.run(140);
    const backAt = G.mario.x / T;
    if (Math.abs(backAt - L.checkX) > 3) fail('respawned at tx ' + backAt.toFixed(1) + ', checkpoint is ' + L.checkX);
    notes.push('checkpoint tx' + L.checkX);

    // last life -> game over -> continue
    A.course(2, 1, 0);
    G.lives = 1;
    G.mario.y = (G.level.H + 4) * T;
    for (let i = 0; i < 500 && G.state !== 'gameover'; i++) A.step();
    if (G.state !== 'gameover') fail('dying on the last life did not reach game over');
    A.tap('Enter');
    A.run(120);
    if (G.state === 'gameover') fail('continue did not leave the game over screen');
    notes.push('gameover -> ' + G.state);

    // fortress boss and the axe
    L = A.course(1, 4, 0);
    if (!L.fortress) fail('1-4 is not a fortress');
    m = G.mario;
    m.x = ((L.axeX === undefined ? L.W - 10 : L.axeX) - 6) * T;
    m.y = 12 * T - m.h; m.onGround = true; A.snap();
    A.K.right = true;
    let bossCleared = false;
    for (let i = 0; i < 700; i++) { A.step(); if (G.state === 'clear') { bossCleared = true; break; } }
    A.clearKeys();
    if (!bossCleared) fail('reaching the axe did not clear the fortress');
    if (!G.bossDown) fail('the fortress cleared without the boss going down');
    notes.push('fortress axe');

    // rebind, then cancel -- cancel used to keep every step already walked
    A.course(1, 1, 0);
    A.run(40);
    const before = JSON.stringify(A.keysMap());
    A.tap('p');
    if (!G.paused) fail('rebind is reached from the pause screen; p did not pause');
    A.tap('r');
    if (!(G.rebind >= 0)) fail('r did not open the rebind screen');
    A.tap('j'); A.step(); A.tap('k'); A.step();
    if (JSON.stringify(A.keysMap()) === before) fail('binding two keys changed nothing');
    A.tap('Escape');
    A.step();
    if (JSON.stringify(A.keysMap()) !== before) fail('cancel did not restore the bindings it started with');
    if (G.rebind >= 0) fail('the rebind screen stayed open after cancel');
    if (G.paused) A.tap('p');
    notes.push('rebind cancel restores');

    if (A.violations().length) fail('invariants broken: ' + A.violations().join('; '));
    return notes.join(' | ');
  });

  /* ================= performance ================= */
  /* JS command-submission cost only. Raster and composite happen off this thread and a
     wall clock around draw() cannot see them; forcing a flush needs getImageData, which
     is what poisoned an earlier measurement into reading 83.8ms/frame. Measured outside
     rAF, the browser's periodic compositor work lands on whichever draw() is running,
     so single-sample maxima are meaningless here -- the median is the signal. */
  test('perf', 'the heaviest course stays far inside the frame budget', (A) => {
    A.course(1, 4, 0);
    A.K.right = true; A.K.run = true;
    A.run(300);                                    // warm up the JIT
    const rows = [];
    for (const [w, lv] of [[1, 4], [3, 3], [1, 1]]) {
      A.course(w, lv, 0);
      A.K.right = true; A.K.run = true;
      const t = [];
      for (let i = 0; i < 600; i++) {
        if (A.G.lives < 4) A.G.lives = 9;
        A.update();
        const a = A.win.performance.now(); A.draw();
        t.push(A.win.performance.now() - a);
      }
      t.sort((x, y) => x - y);
      const med = t[Math.floor(t.length / 2)], p95 = t[Math.floor(t.length * 0.95)];
      rows.push(w + '-' + lv + ' med=' + med.toFixed(3) + ' p95=' + p95.toFixed(3));
      if (med > 4) fail(w + '-' + lv + ' median draw ' + med.toFixed(2) + 'ms, budget is 16.67');
      if (p95 > 8) fail(w + '-' + lv + ' p95 draw ' + p95.toFixed(2) + 'ms');
    }
    A.clearKeys();
    return rows.join(' | ');
  });

  /* ================= stored data is untrusted ================= */
  /* charIdx was validated with typeof/range only. 1.5 satisfies all of it, CHARS[1.5]
     is undefined, and every read of ch.speed throws -- once per frame, forever, from a
     black screen. loadHigh was the one stored number with no clamp, and 1e20 does not
     heal: no score can beat it, so NEW RECORD never fires again. */
  test('storage', 'no stored value can break the game', (A) => {
    const G = A.G;
    const ls = A.win.localStorage;
    const KEYS = ['pipoSettings', 'pipoHigh', 'pipoWorld', 'pipoScores'];
    const loadSettings = A.win.eval('loadSettings');
    const loadHigh = A.win.eval('loadHigh');
    const loadScores = A.win.eval('loadScores');
    const loadProgress = A.win.eval('loadProgress');
    const big = JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ s: i, w: 1, lv: 1, hero: 'X' })));
    const cases = [
      ['pipoHigh', '-999999'], ['pipoHigh', '99999999999999999999'], ['pipoHigh', 'abc'],
      ['pipoHigh', 'Infinity'], ['pipoHigh', '1e30'], ['pipoHigh', '-0'],
      ['pipoWorld', '0'], ['pipoWorld', '-3'], ['pipoWorld', '500'], ['pipoWorld', 'abc'],
      ['pipoSettings', '{'], ['pipoSettings', 'null'], ['pipoSettings', '[]'],
      ['pipoSettings', '{"charIdx":99}'], ['pipoSettings', '{"charIdx":-1}'],
      ['pipoSettings', '{"charIdx":1.5}'], ['pipoSettings', '{"charIdx":2.999999}'],
      ['pipoSettings', '{"charIdx":"1"}'], ['pipoSettings', '{"charIdx":null}'],
      ['pipoSettings', '{"charIdx":true}'], ['pipoSettings', '{"charIdx":[1]}'],
      ['pipoSettings', '{"keys":null}'],
      ['pipoSettings', '{"keys":{"left":[],"right":null,"jump":[""],"pause":["p"]}}'],
      ['pipoSettings', '{"keys":{"left":[1,2],"right":{"a":1},"jump":"x"}}'],
      ['pipoSettings', '{"keys":{"pause":["z"]}}'],
      ['pipoSettings', '{"muted":"yes","bgmOn":1}'],
      ['pipoScores', '"not an array"'], ['pipoScores', '[{}]'],
      ['pipoScores', '[{"s":"abc"},{"s":null}]'],
      ['pipoScores', '[{"s":-5,"w":-9,"lv":77,"hero":"AAAAAAAAAAAAAAAA","coins":-1,"foes":1e9}]'],
      ['pipoScores', 'garbage{{'], ['pipoScores', big]
    ];
    const bad = [];
    for (const [key, val] of cases) {
      for (const k of KEYS) ls.removeItem(k);
      const KM = A.keysMap();
      for (const a of A.actions) KM[a] = A.defaults[a].slice();
      G.charIdx = 0;
      ls.setItem(key, val);
      const label = key + '=' + (val.length > 30 ? val.slice(0, 26) + '…' : val);
      try {
        loadSettings();
        const high = loadHigh(), world = loadProgress(), sc = loadScores();
        const probs = [];
        if (!(Number.isFinite(high) && high >= 0 && high <= 9999999)) probs.push('high=' + high);
        if (!(Number.isInteger(world) && world >= 1 && world <= 99)) probs.push('world=' + world);
        if (!Array.isArray(sc)) probs.push('scores not an array');
        else if (sc.length > 5) probs.push('scores=' + sc.length);
        else if (!sc.every(e => Number.isFinite(e.s) && e.s >= 0 && e.w >= 1 && e.w <= 99 &&
          e.lv >= 1 && e.lv <= 4 && typeof e.hero === 'string' && e.hero.length <= 6 &&
          e.coins >= 0 && e.foes >= 0)) probs.push('a score row is out of range');
        if (!(Number.isInteger(G.charIdx) && G.charIdx >= 0 && G.charIdx < A.chars.length)) probs.push('charIdx=' + G.charIdx);
        if (!A.chars[G.charIdx]) probs.push('CHARS lookup undefined');
        for (const a of A.actions) {
          const v = A.keysMap()[a];
          if (!Array.isArray(v) || !v.length || !v.every(x => typeof x === 'string' && x.length)) probs.push('unbound ' + a);
        }
        // and the real question: does it still run?
        G.high = high;
        A.course(1, 1, G.charIdx);
        A.run(150);
        if (!Number.isFinite(G.mario.x)) probs.push('mario NaN');
        if (probs.length) bad.push(label + ' -> ' + probs.join(', '));
      } catch (e) {
        bad.push(label + ' -> THREW ' + e.message);
      }
    }
    for (const k of KEYS) ls.removeItem(k);
    const KM = A.keysMap();
    for (const a of A.actions) KM[a] = A.defaults[a].slice();
    G.charIdx = 0;
    if (bad.length) fail(bad.length + ' of ' + cases.length + ' hostile values broke something: ' + bad.slice(0, 4).join(' || '));
    return cases.length + ' hostile stored values, all survived';
  });

  /* ================= crash boundary ================= */
  /* Terminal by nature: once the boundary trips it stays tripped, so this runs in its
     own frame. Before the boundary existed, a throw repeated once per frame forever --
     the console filled and the player got a frozen frame with no explanation. */
  test('crash', 'a thrown frame shows a message instead of freezing silently', (A) => {
    const G = A.G;
    A.leaveTitle();
    A.run(120);
    // the loop's own try/catch is what is under test, so go through the real loop
    const errs = [];
    const realError = A.win.console.error;
    A.win.console.error = function () { errs.push(1); return realError.apply(this, arguments); };
    /* hand the clock back AND restart the chain: the loop stopped re-registering the
       moment rAF became a no-op, so restoring the function alone would leave nothing
       running to throw */
    A.win.requestAnimationFrame = A.win.__realRAF;
    A.win.__realRAF(A.win.loop);
    G.charIdx = 1.5;                                  // CHARS[1.5] is undefined
    const startFrame = G.frame;
    return new Promise((resolve, reject) => {
      A.win.setTimeout(() => {
        try {
          const crashed = A.crashed();
          if (!crashed) fail('a throwing frame did not trip the boundary');
          const frozen = G.frame;
          A.win.setTimeout(() => {
            try {
              if (G.frame !== frozen) fail('the simulation kept stepping after the crash');
              if (errs.length > 3) fail('logged ' + errs.length + ' times; the crash should report once');
              // the message must actually be on the canvas
              const cv = A.win.document.getElementById('screen');
              const c2 = A.win.document.createElement('canvas');
              c2.width = cv.width; c2.height = cv.height;
              const g2 = c2.getContext('2d');
              g2.drawImage(cv, 0, 0);
              const d = g2.getImageData(0, 0, cv.width, cv.height).data;
              let lit = 0, red = 0;
              for (let i = 0; i < d.length; i += 4 * 53) {
                if (d[i] + d[i + 1] + d[i + 2] > 40) lit++;
                if (d[i] > 150 && d[i + 1] < 130 && d[i + 2] < 130) red++;
              }
              if (lit < 100) fail('the crash screen is blank (' + lit + ' lit samples)');
              if (red < 10) fail('no headline on the crash screen (' + red + ' red samples)');
              A.win.console.error = realError;
              resolve('tripped after frame ' + startFrame + ', logged ' + errs.length + '×, ' +
                      lit + ' lit / ' + red + ' red samples, sim frozen');
            } catch (e) { A.win.console.error = realError; reject(e); }
          }, 250);
        } catch (e) { A.win.console.error = realError; reject(e); }
      }, 350);
    });
  });

  /* ================= layout ================= */
  /* Three real bugs came from here: a JUMP button clipped 41px off a 375px screen,
     powerup text under the pad, and a 9px canvas intrusion in landscape. The
     progressive fold is asserted as intent in both directions, because a checker that
     does not know the design reports its own ignorance as a defect -- this one did,
     three times, before it was written this way. */
  test('layout', 'nothing leaves the viewport at any size, in either input mode', (A, frame) => {
    const sizes = [
      [320, 568, 'SE portrait'], [375, 812, 'phone portrait'], [390, 844, 'phone portrait tall'],
      [768, 1024, 'tablet portrait'], [812, 375, 'phone landscape'],
      [700, 620, 'aspect 1.13, the case that regressed'], [560, 420, 'short'],
      [1024, 768, 'desktop 4:3'], [1280, 800, 'desktop wide']
    ];
    const problems = [];
    const rows = [];
    for (const [w, h, label] of sizes) {
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
      for (const touch of [false, true]) {
        const doc = A.win.document, pad = doc.getElementById('pad');
        if (touch) { doc.body.classList.add('touch'); pad.hidden = false; }
        else { doc.body.classList.remove('touch'); pad.hidden = true; }
        if (typeof A.win.fit === 'function') A.win.fit();
        void doc.documentElement.offsetHeight;
        const vw = A.win.innerWidth, vh = A.win.innerHeight;
        const R = (el) => el && el.getBoundingClientRect();
        const shown = (el) => {
          if (!el) return false;
          const s = A.win.getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && R(el).width > 0;
        };
        const over = (a, b) => a && b && !(a.right <= b.left + 0.5 || a.left >= b.right - 0.5 ||
                                           a.bottom <= b.top + 0.5 || a.top >= b.bottom - 0.5);
        const tag = label + (touch ? ' [touch]' : ' [pointer]');
        const scr = R(doc.getElementById('screen'));
        if (doc.documentElement.scrollWidth > vw + 1) problems.push(tag + ': page scrolls sideways');
        if (scr) {
          if (scr.left < -0.5 || scr.right > vw + 0.5 || scr.top < -0.5 || scr.bottom > vh + 0.5)
            problems.push(tag + ': the canvas is off screen');
          if (scr.width < 100) problems.push(tag + ': canvas only ' + Math.round(scr.width) + 'px wide');
        }
        const padShown = pad && !pad.hidden && shown(pad);
        if (padShown) for (const b of pad.querySelectorAll('.pad-btn')) {
          const r = R(b);
          if (r.width < 24 || r.height < 24) { problems.push(tag + ': ' + b.dataset.key + ' is ' + Math.round(r.width) + 'x' + Math.round(r.height)); continue; }
          if (r.left < -0.5 || r.right > vw + 0.5 || r.top < -0.5 || r.bottom > vh + 0.5)
            problems.push(tag + ': ' + b.dataset.key + ' is outside the viewport');
          if (over(r, scr)) problems.push(tag + ': ' + b.dataset.key + ' sits over the canvas');
        }
        const bot = doc.getElementById('botbar'), botShown = shown(bot);
        if (vh <= 460) {
          if (botShown) problems.push(tag + ': the reference panel should fold away under 460px of height');
        } else if (!touch) {
          if (!botShown) problems.push(tag + ': the reference panel is missing');
          const caps = doc.querySelectorAll('#keys kbd');
          if (!caps.length) problems.push(tag + ': no keycaps rendered');
          for (const k of caps) { const r = R(k); if (r.width < 6 || r.height < 6) { problems.push(tag + ': keycaps collapsed'); break; } }
          const sys = doc.querySelector('.sysbar');
          if (vh > 540 && !shown(sys)) problems.push(tag + ': the system line is missing');
          if (vh <= 540 && shown(sys)) problems.push(tag + ': the system line should fold away under 540px of height');
        }
        const pu = doc.getElementById('powerups');
        if (padShown && shown(pu)) for (const b of pad.querySelectorAll('.pad-btn'))
          if (over(R(b), R(pu))) { problems.push(tag + ': the powerup line is under the pad'); break; }
        rows.push(tag);
      }
    }
    frame.style.width = ''; frame.style.height = '';
    if (problems.length) fail(problems.slice(0, 6).join(' || '));
    return rows.length + ' size/mode combinations clean';
  });

  /* ================= chrome ================= */
  test('chrome', 'the page ships with no third-party requests and readable contrast', (A) => {
    const doc = A.win.document;
    const problems = [];
    // third-party requests: the control-panel font was once loaded from Google
    for (const el of doc.querySelectorAll('link[href], script[src], img[src]')) {
      const url = el.getAttribute('href') || el.getAttribute('src') || '';
      if (/^(https?:)?\/\//i.test(url)) problems.push('third-party asset: ' + url);
    }
    // contrast, on the elements as actually painted
    const parse = (c) => {
      const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const bgOf = (el) => {
      let n = el;
      while (n) {
        const c = parse(A.win.getComputedStyle(n).backgroundColor);
        if (c && c.a >= 0.95) return c;
        n = n.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    let checked = 0, worst = 99;
    for (const el of doc.querySelectorAll('#shell, #shell *')) {
      const txt = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('').trim();
      if (!txt) continue;
      const st = A.win.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const fg = parse(st.color); if (!fg) continue;
      const bg = bgOf(el);
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(st.fontSize);
      const bold = (parseInt(st.fontWeight, 10) || 400) >= 700;
      const need = (px >= 24 || (bold && px >= 18.66)) ? 3 : 4.5;
      checked++;
      if (ratio / need < worst) worst = ratio / need;
      if (ratio < need) problems.push('contrast ' + ratio.toFixed(2) + ' (needs ' + need + ') on "' + txt.slice(0, 16) + '"');
    }
    // the things a shared link needs
    if (!doc.querySelector('meta[property="og:image"]')) problems.push('no og:image');
    if (!doc.querySelector('meta[name="twitter:card"]')) problems.push('no twitter:card');
    if (!doc.querySelector('h1')) problems.push('no h1');
    if (!doc.querySelector('link[rel="manifest"]')) problems.push('no manifest');
    const canvas = doc.getElementById('screen');
    if (!canvas.getAttribute('aria-label')) problems.push('the canvas has no aria-label');
    const ids = {};
    for (const el of doc.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
    for (const k in ids) if (ids[k] > 1) problems.push('duplicate id ' + k);
    if (problems.length) fail(problems.slice(0, 6).join(' || '));
    return checked + ' text elements pass AA (tightest ' + worst.toFixed(2) + '× the requirement), 0 third-party assets';
  });

  /* ---------- runner ---------- */
  function loadFrame(doc, src) {
    return new Promise((resolve, reject) => {
      const f = doc.createElement('iframe');
      f.setAttribute('title', 'game under test');
      f.style.cssText = 'width:1024px;height:768px;border:0;position:absolute;left:-99999px;top:0';
      f.src = src;
      f.onload = () => {
        const win = f.contentWindow;
        // own the clock, but keep the real rAF for the crash test to hand back
        win.__realRAF = win.requestAnimationFrame.bind(win);
        win.requestAnimationFrame = () => 0;
        // let the pending frame drain, then the engine is ours to step
        setTimeout(() => resolve({ frame: f, win }), 60);
      };
      f.onerror = () => reject(new Error('could not load ' + src));
      doc.body.appendChild(f);
    });
  }

  async function runAll(opts) {
    const doc = (opts && opts.document) || document;
    const src = (opts && opts.src) || '../index.html';
    const onResult = (opts && opts.onResult) || (() => {});
    const groups = [];
    for (const t of TESTS) {
      let g = groups.find(x => x.name === t.group);
      if (!g) groups.push(g = { name: t.group, tests: [] });
      g.tests.push(t);
    }
    const results = [];
    for (const g of groups) {
      for (const t of g.tests) {
        /* a fresh frame per test. Reusing one is how a poisoned charIdx once leaked
           into every later case and produced twelve phantom failures. */
        const started = Date.now();
        let frame = null;
        try {
          const loaded = await loadFrame(doc, src);
          frame = loaded.frame;
          const A = api(loaded.win);
          const detail = await t.fn(A, frame);
          const r = { group: g.name, name: t.name, pass: true, detail: detail || '', ms: Date.now() - started };
          results.push(r); onResult(r);
        } catch (e) {
          const r = { group: g.name, name: t.name, pass: false, detail: String(e && e.message || e), ms: Date.now() - started };
          results.push(r); onResult(r);
        } finally {
          if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
        }
      }
    }
    const failed = results.filter(r => !r.pass);
    return { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  }

  root.PIPO_SUITE = { runAll, tests: TESTS };
})(typeof window !== 'undefined' ? window : this);
