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
      /* Two kinds of step, because draw() costs 10-30x what update() does -- a few
         hundred canvas operations against a handful of arithmetic ones -- and almost
         nothing this suite asserts needs a rendered frame. Measured: the heavy loops
         issue ~188,000 draw() calls, which is invisible on a GPU and is the entire
         runtime on a CI runner with a software rasteriser. So invariant and geometry
         work uses stepSim(), and rendering is covered where it is the subject (boot,
         crash, perf) plus a periodic sample inside the soak. */
      step() { A.update(); A.draw(); },
      stepSim() { A.update(); },
      run(n) { for (let i = 0; i < n; i++) A.update(); },
      runDraw(n) { for (let i = 0; i < n; i++) A.step(); },
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

  /* WHICH course is a lagoon is a property of the rotation, not a fact to hard-code.
     Three checks used to name 3-3 directly and all three went red the moment the
     rotation changed -- correctly, but for the wrong reason: the water rules had not
     moved, only their address. Finding it keeps them pointed at the thing they test. */
  function findWater(A, fromWorld) {
    for (let w = fromWorld || 1; w <= fromWorld + 12; w++) {
      for (let lv = 1; lv <= 3; lv++) {
        if (A.win.eval('buildLevel')(lv, w).water) return { w, lv };
      }
    }
    return null;
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
    const wet = findWater(A, 1);
    if (!wet) fail('no water course found in the first thirteen worlds');
    const cases = [];
    for (let ci = 0; ci < A.chars.length; ci++) {
      const mul = A.chars[ci].speed;
      cases.push({ ci, world: 1, lv: 1, run: false, cap: 1.4 * mul, label: 'land walk' });
      cases.push({ ci, world: 1, lv: 1, run: true, cap: 2.7 * mul, label: 'land run' });
      cases.push({ ci, world: wet.w, lv: wet.lv, run: false, cap: 1.55 * mul, label: 'water' });
    }
    const notes = [];
    for (const c of cases) {
      A.course(c.world, c.lv, c.ci);
      if (c.label === 'water' && !A.G.level.water) fail('expected ' + c.world + '-' + c.lv + ' to be a water course');
      if (A.G.level.enemies) A.G.level.enemies.length = 0;   // locomotion only
      const x0 = A.G.mario.x;
      A.K.right = true; A.K.run = c.run;
      let maxVx = 0;
      for (let i = 0; i < 240; i++) { A.stepSim(); maxVx = Math.max(maxVx, Math.abs(A.G.mario.vx)); }
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
    for (let i = 0; i < 200; i++) { A.stepSim(); if (stopStep < 0 && A.G.mario.vx === 0) stopStep = i; }
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
            A.stepSim();
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
        bot();
        /* one rendered frame in twenty: draw() still runs on every course, at 5% of
           the cost of rendering every step */
        if (i % 20 === 0) A.step(); else A.stepSim();
        steps++;
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
        if (i % 20 === 0) A.step(); else A.stepSim();
        steps++;
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
    for (let i = 0; i < 900; i++) { A.stepSim(); if (G.state === 'clear') sawClear = true; if (sawClear && G.state === 'ready') break; }
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
    for (let i = 0; i < 400 && G.state !== 'ready'; i++) A.stepSim();
    A.run(140);
    const backAt = G.mario.x / T;
    if (Math.abs(backAt - L.checkX) > 3) fail('respawned at tx ' + backAt.toFixed(1) + ', checkpoint is ' + L.checkX);
    notes.push('checkpoint tx' + L.checkX);

    // last life -> game over -> continue
    A.course(2, 1, 0);
    G.lives = 1;
    G.mario.y = (G.level.H + 4) * T;
    for (let i = 0; i < 500 && G.state !== 'gameover'; i++) A.stepSim();
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
    for (let i = 0; i < 700; i++) { A.stepSim(); if (G.state === 'clear') { bossCleared = true; break; } }
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
    A.tap('j'); A.stepSim(); A.tap('k'); A.stepSim();
    if (JSON.stringify(A.keysMap()) === before) fail('binding two keys changed nothing');
    A.tap('Escape');
    A.stepSim();
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
  test('perf', 'draw work per frame stays within its documented bounds', (A) => {
    /* The assertion is the DRAW-CALL COUNT, not milliseconds. This suite runs on
       whatever hardware CI hands it -- a two-core runner with a software rasteriser --
       and a wall-clock threshold there measures the runner, not the game. Draw calls
       per frame are the same number on every machine, and they are what actually
       regresses: lose the camera culling and the count explodes long before anyone
       notices a frame. Milliseconds are still reported, with a ceiling loose enough to
       survive slow CI while still catching a catastrophic regression.
       Measured on this project's reference machine: field ~90 calls (max ~129),
       water ~155, fortress ~343 (max ~473). */
    const cv = A.win.document.getElementById('screen');
    const ctx = cv.getContext('2d');
    let calls = 0;
    const origDraw = ctx.drawImage.bind(ctx);
    /* explicit arity rather than (...a): a rest-and-spread wrapper allocates an array
       on every one of several hundred calls per frame, which turns the instrument into
       a garbage generator */
    ctx.drawImage = function (a, b, c, d, e, f, g, h, i) {
      calls++;
      return arguments.length <= 3 ? origDraw(a, b, c)
        : arguments.length <= 5 ? origDraw(a, b, c, d, e)
        : origDraw(a, b, c, d, e, f, g, h, i);
    };
    const LIMITS = { field: 260, water: 400, fortress: 700 };
    const rows = [];
    try {
      A.course(1, 4, 0);
      A.K.right = true; A.K.run = true;
      A.run(300);                                  // warm up the JIT
      for (const [w, lv] of [[1, 4], [3, 3], [1, 1]]) {
        const L = A.course(w, lv, 0);
        const kind = L.fortress ? 'fortress' : (L.water ? 'water' : 'field');
        A.K.right = true; A.K.run = true;
        const ms = [], per = [];
        for (let i = 0; i < 600; i++) {
          if (A.G.lives < 4) A.G.lives = 9;
          A.update();
          calls = 0;
          const t0 = A.win.performance.now();
          A.draw();
          ms.push(A.win.performance.now() - t0);
          per.push(calls);
        }
        ms.sort((x, y) => x - y);
        const med = ms[Math.floor(ms.length / 2)];
        const avgCalls = Math.round(per.reduce((s, x) => s + x, 0) / per.length);
        const maxCalls = Math.max(...per);
        rows.push(w + '-' + lv + ' ' + kind + ' calls=' + avgCalls + '/' + maxCalls + ' med=' + med.toFixed(2) + 'ms');
        if (maxCalls > LIMITS[kind])
          fail(w + '-' + lv + ' peaked at ' + maxCalls + ' draw calls, ceiling for a ' + kind + ' course is ' + LIMITS[kind]);
        if (avgCalls === 0) fail(w + '-' + lv + ' drew nothing at all');
        if (med > 25) fail(w + '-' + lv + ' median draw ' + med.toFixed(1) + 'ms, which is beyond even a slow runner');
      }
    } finally {
      ctx.drawImage = origDraw;
      A.clearKeys();
    }
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
  test('crash', 'a thrown frame shows a message instead of freezing silently', async (A) => {
    const G = A.G;
    A.leaveTitle();
    A.run(120);
    // the loop's own try/catch is what is under test, so go through the real loop
    const errs = [];
    const realError = A.win.console.error;
    A.win.console.error = function () { errs.push(1); return realError.apply(this, arguments); };
    const sleep = (ms) => new Promise(r => A.win.setTimeout(r, ms));
    try {
      /* hand the clock back AND restart the chain: the loop stopped re-registering the
         moment rAF became a no-op, so restoring the function alone would leave nothing
         running to throw */
      A.win.requestAnimationFrame = A.win.__realRAF;
      A.win.__realRAF(A.win.loop);
      G.charIdx = 1.5;                                // CHARS[1.5] is undefined
      const startFrame = G.frame;

      /* Poll rather than sleep a fixed 350ms. On a slow or busy CI runner a fixed wait
         is a coin toss, and a test that depends on the runner's mood is a test people
         learn to re-run instead of read. */
      const t0 = Date.now();
      while (!A.crashed() && Date.now() - t0 < 8000) await sleep(50);
      const trippedIn = Date.now() - t0;
      if (!A.crashed()) fail('a throwing frame did not trip the boundary within ' + trippedIn + 'ms');

      // the simulation must stop advancing, however long the runner takes to notice
      const frozen = G.frame;
      await sleep(400);
      if (G.frame !== frozen) fail('the simulation kept stepping after the crash (' + frozen + ' -> ' + G.frame + ')');
      if (errs.length > 3) fail('logged ' + errs.length + ' times; the crash should report once');

      // and the message must actually be on the canvas
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
      return 'tripped in ' + trippedIn + 'ms after frame ' + startFrame + ', logged ' +
             errs.length + '\u00d7, ' + lit + ' lit / ' + red + ' red samples, sim frozen';
    } finally {
      A.win.console.error = realError;
    }
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

  /* ================= audio ================= */
  /* A whole subsystem that had never been checked. The failure mode it guards against
     is not a crash: it is a sound function that silently does nothing, which no
     invariant and no soak would ever notice. So this counts real node creation and
     real start() calls -- "it ran without throwing" is not evidence that anything was
     scheduled. */
  test('audio', 'every effect actually schedules sound, and mute really silences it', (A) => {
    const S = A.win.eval('Sound');
    const BGM = A.win.eval('BGM');
    try { S.init(); } catch (e) {
      fail('this environment could not create an AudioContext: ' + e.message);
    }
    if (!S.ctx) fail('init() created no AudioContext');
    for (const part of ['master', 'musicBus', 'sfxBus', 'noiseBuf']) {
      if (!S[part]) fail('init() left ' + part + ' missing');
    }
    const seconds = S.noiseBuf.length / S.ctx.sampleRate;
    if (seconds < 0.5) fail('the shared noise buffer is only ' + seconds.toFixed(2) + 's');

    const ctx = S.ctx;
    let made = 0, started = 0;
    const undo = [];
    for (const name of ['createOscillator', 'createBufferSource']) {
      const orig = ctx[name].bind(ctx);
      ctx[name] = function () {
        const n = orig();
        made++;
        if (typeof n.start === 'function') {
          const s = n.start.bind(n);
          n.start = function () { started++; return s.apply(this, arguments); };
        }
        return n;
      };
      undo.push(() => { ctx[name] = orig; });
    }
    const restore = () => { for (const f of undo) f(); };

    /* every effect the game can play, not a sample of them */
    const EFFECTS = ['jump', 'land', 'coin', 'stomp', 'bump', 'breakB', 'emerge', 'timeUp',
      'worldDone', 'roar', 'collapse', 'checkpoint', 'power', 'grow', 'pipe', 'kick',
      'fireball', 'shrink', 'flag', 'oneUp', 'die', 'fanfare', 'hurry', 'gameOver', 'record'];
    const silent = [], threw = [], missing = [];
    try {
      for (const name of EFFECTS) {
        if (typeof S[name] !== 'function') { missing.push(name); continue; }
        const m0 = made, s0 = started;
        try { S[name](); } catch (e) { threw.push(name + ': ' + e.message); continue; }
        if (made === m0) silent.push(name + ' (no node)');
        else if (started === s0) silent.push(name + ' (node never started)');
      }
      if (missing.length) fail('missing effects: ' + missing.join(', '));
      if (threw.length) fail('effects threw: ' + threw.slice(0, 4).join(' | '));
      if (silent.length) fail('effects that scheduled nothing: ' + silent.slice(0, 6).join(', '));

      // mute must stop scheduling, not merely turn the gain down
      const m1 = made, s1 = started;
      S.muted = true;
      for (const name of EFFECTS) { try { S[name](); } catch (e) {} }
      const mutedMade = made - m1, mutedStarted = started - s1;
      S.muted = false;
      if (mutedMade > 0 || mutedStarted > 0)
        fail('muted still scheduled ' + mutedMade + ' nodes / ' + mutedStarted + ' starts');

      /* And the music must schedule notes. start() only arms a setInterval -- the notes
         are written by tick() -- so tick() is called directly here rather than waiting
         on a timer, which keeps this synchronous and deterministic. select(1) also
         exercises the track switch, which is a no-op when the index is unchanged. */
      const m2 = made;
      BGM.select(1);
      BGM.start();
      if (!BGM.playing) fail('BGM.start() did not mark the music as playing');
      BGM.tick();
      const musicNodes = made - m2;
      BGM.stop();
      if (BGM.playing) fail('BGM.stop() left the music playing');
      if (musicNodes === 0) fail('a music tick scheduled no notes');
      return EFFECTS.length + ' effects, ' + made + ' nodes / ' + started + ' starts, ' +
             'muted schedules 0, music schedules ' + musicNodes + ', ctx ' + ctx.state;
    } finally { restore(); }
  });

  /* ================= offline shell stays in sync ================= */
  /* sw.js precaches a hand-written list. The list is correct today, and nothing keeps
     it correct: add a stylesheet or an icon and offline play breaks quietly, for the
     subset of players who are offline, which is the hardest group to hear from. */
  test('offline', 'the service worker precaches every asset the app needs', async (A) => {
    const doc = A.win.document;
    /* cache: 'reload' on purpose. By the time this runs a real worker is usually
       controlling the page, and reading a stale sw.js would let this check validate a
       shell list that is no longer the one being shipped. */
    const swText = await A.win.fetch('sw.js', { cache: 'reload' }).then(r => r.text());
    const block = swText.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/);
    if (!block) fail('could not find the SHELL list in sw.js');
    const shell = (block[1].match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, '').replace(/^\.\//, ''));
    if (shell.length < 5) fail('parsed only ' + shell.length + ' shell entries; the parse is wrong, not the list');

    const need = new Set();
    /* Assets the DOM actually pulls. Deliberately NOT meta-only assets: og:image is
       fetched by link scrapers, never by a player, so precaching it would spend a
       player's storage on something they will never see. */
    for (const el of doc.querySelectorAll('link[href], script[src], img[src]')) {
      const raw = el.getAttribute('href') || el.getAttribute('src') || '';
      if (!raw || /^(https?:)?\/\//i.test(raw) || raw.startsWith('data:')) continue;
      need.add(raw.replace(/^\.\//, '').split('?')[0]);
    }
    // the manifest names icons the DOM never mentions, and an installed copy needs them
    const manifestLink = doc.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      const man = await A.win.fetch(manifestLink.getAttribute('href'), { cache: 'reload' }).then(r => r.json());
      for (const icon of (man.icons || [])) if (icon.src) need.add(String(icon.src).replace(/^\.\//, '').split('?')[0]);
    }
    const missing = Array.from(need).filter(u => !shell.includes(u));
    if (missing.length) fail('not precached: ' + missing.join(', '));
    // and the entry point itself, both spellings, or a cold offline open shows nothing
    for (const entry of ['', 'index.html']) {
      if (!shell.includes(entry)) fail("the shell is missing the '" + (entry || './') + "' entry");
    }
    return shell.length + ' precached, covering ' + need.size + ' referenced assets + the entry point';
  });

  /* ================= the service worker really registers ================= */
  /* Registration is the half that could never be checked in earlier rounds, because the
     automation browser then in use refused it outright. It is asserted here; the
     CONTENTS of the precache deliberately are not, and that is worth explaining.

     A first version of this check waited for the shell to appear in CacheStorage. It
     passed on a first run (2ms -- already populated) and then failed on every run after,
     timing out at 15s with nothing cached at all. The cause is not the worker: after
     unregister(), re-registering a byte-identical script does not make the browser run
     install() again, so once runAll's reset has deleted the cache there is nothing left
     to repopulate it. The reset was manufacturing the failure.

     Rather than keep a check that is right once per browser session, this asserts only
     what is stable, and the precache contents stay covered where they can be measured
     honestly: the static shell-coverage check above, and the end-to-end run recorded in
     README (server killed, 12/12 precached, the game played offline). A flaky test is
     worse than no test -- which is the whole reason this round happened. */
  test('offline', 'the page registers a worker and it reaches active', async (A) => {
    const nav = A.win.navigator;
    if (!('serviceWorker' in nav)) fail('this browser has no service worker support');
    if (!A.win.isSecureContext) fail('not a secure context, so registration cannot be tested');
    /* Wait on the registration reaching active, which is deterministic across repeated
       runs, and read the script URL to be sure it is our worker and not something a
       browser extension installed. */
    const t0 = Date.now();
    let reg = null;
    while (Date.now() - t0 < 10000) {
      reg = await nav.serviceWorker.getRegistration();
      if (reg && reg.active) break;
      await new Promise(r => A.win.setTimeout(r, 100));
    }
    const waited = Date.now() - t0;
    if (!reg) fail('the page never registered a worker (waited ' + waited + 'ms)');
    if (!reg.active) fail('the worker never reached active in ' + waited + 'ms (state: ' +
      ((reg.installing || reg.waiting || {}).state || 'unknown') + ')');
    if (!/sw\.js$/.test(reg.active.scriptURL)) fail('an unexpected script is registered: ' + reg.active.scriptURL);
    if (reg.active.state !== 'activated') fail('the active worker is in state ' + reg.active.state);
    const scope = new A.win.URL(reg.scope).pathname;
    if (scope !== '/') fail('the worker scope is ' + scope + ', expected the site root');
    return 'active in ' + waited + 'ms, scope ' + scope + ', ' + reg.active.scriptURL.split('/').pop();
  });

  /* ================= a clean boot ================= */
  test('boot', 'the page comes up clean and stays quiet while played', (A) => {
    const G = A.G;
    if (A.crashed()) fail('the crash boundary tripped during boot');
    if (G.state !== 'title') fail('booted into state ' + G.state + ', expected title');
    if (!A.win.document.querySelectorAll('#keys kbd').length) fail('the control panel was never generated');
    // the title screen must actually be drawn, not merely not-crashed
    A.draw();
    const cv = A.win.document.getElementById('screen');
    const c2 = A.win.document.createElement('canvas');
    c2.width = cv.width; c2.height = cv.height;
    const g2 = c2.getContext('2d');
    g2.drawImage(cv, 0, 0);
    const d = g2.getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0; const hues = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) {
      if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
      hues.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
    }
    if (lit < 200) fail('the title screen is nearly blank (' + lit + ' lit samples)');
    if (hues.size < 20) fail('the title screen has only ' + hues.size + ' distinct colours');

    /* Runtime quiet. This cannot see load-time console output -- a navigation replaces
       the frame's global object, so there is nowhere to install a hook beforehand --
       and it says so rather than implying coverage it does not have. */
    const errs = [];
    const realError = A.win.console.error, realWarn = A.win.console.warn;
    A.win.console.error = function () { errs.push('error: ' + Array.from(arguments).join(' ').slice(0, 80)); return realError.apply(this, arguments); };
    A.win.console.warn = function () { errs.push('warn: ' + Array.from(arguments).join(' ').slice(0, 80)); return realWarn.apply(this, arguments); };
    try {
      A.leaveTitle();
      A.course(1, 1, 0);
      A.K.right = true; A.K.run = true;
      A.runDraw(600);
      A.clearKeys();
    } finally {
      A.win.console.error = realError; A.win.console.warn = realWarn;
    }
    if (errs.length) fail(errs.length + ' console messages while playing: ' + errs.slice(0, 3).join(' | '));
    return lit + ' lit samples, ' + hues.size + ' colours, 600 played steps with a silent console';
  });

  /* ================= the build-time structural rules ================= */
  /* This project's core discipline is that a fix becomes a RULE inside buildLevel, so
     later content cannot reintroduce it. Those rules existed and nothing re-checked
     them: they were verified by hand in the rounds that introduced them and then left
     to trust. A rule nobody re-checks is a comment.
     Nothing here steps the simulation -- it builds courses and reads their structure,
     which is why it covers 48 courses in the time one soak takes.
     The thresholds mirror the engine exactly: AIR_ROWS is [7..12], the spike approach
     is cx-5..cx+2 (ISSUE-004), and the pit/lava approach is x-3..x+1 (ISSUE-003).
     Getting those wrong in either direction makes this check a liar, so they are read
     off the engine's own comments rather than guessed. */
  test('structure', 'the build-time rules hold across 48 courses', (A) => {
    const buildLevel = A.win.eval('buildLevel');
    const buildFortress = A.win.eval('buildFortress');
    const T = A.T, AIR = [7, 8, 9, 10, 11, 12];
    /* the engine's own surfaceRow: only terrain rows count, because a reward block two
       tiles above a walkway is not the ground (scanning from row 5 once put 409 walkers
       on top of floating brick rows) */
    const surfaceRow = (map, x) => {
      for (let y = 11; y <= 14; y++) if (A.solid(map[y][x])) return y;
      return 15;
    };
    const WALKERS = ['puff', 'shelly', 'spiko'];
    let courses = 0, walkers = 0, spikos = 0, pitCols = 0, lavaCols = 0, waterCourses = 0;
    const bad = [];
    const note = (s) => { if (bad.length < 8) bad.push(s); };

    for (let w = 1; w <= 12; w++) for (let lv = 1; lv <= 4; lv++) {
      const L = lv === 4 ? buildFortress(w) : buildLevel(lv, w);
      courses++;
      const map = L.map, W = L.W, H = L.H, tag = w + '-' + lv;

      for (const e of (L.enemies || [])) {
        if (!WALKERS.includes(e.type)) continue;
        walkers++;
        const tx = Math.round(e.x / T);
        if (tx < 0 || tx >= W) { note(tag + ' ' + e.type + ' spawned outside the map at ' + tx); continue; }
        const sr = surfaceRow(map, tx);
        if (sr >= 15) { note(tag + ' ' + e.type + ' at column ' + tx + ' stands over a pit'); continue; }
        const feet = e.y + e.h, want = sr * T;
        if (feet > want + 0.01) note(tag + ' ' + e.type + ' at ' + tx + ' is buried (feet ' + feet + ' vs surface ' + want + ')');
        if (feet < want - 0.01) note(tag + ' ' + e.type + ' at ' + tx + ' floats (feet ' + feet + ' vs surface ' + want + ')');
        if (e.type === 'spiko') {
          spikos++;
          for (let x = tx - 5; x <= tx + 2; x++) {
            if (x < 0 || x >= W || !A.solid(map[13][x])) { note(tag + ' spike at ' + tx + ' has no run-up at column ' + x); break; }
            let roofed = false;
            for (const y of AIR) if (A.solid(map[y][x])) { roofed = true; break; }
            if (roofed) { note(tag + ' spike at ' + tx + ' has a roofed approach at column ' + x); break; }
          }
        }
      }

      // pit and lava airspace, over the takeoff point and not just over the hazard
      const hazard = [];
      for (let x = 0; x < W; x++) {
        const pit = surfaceRow(map, x) >= 15;
        let lava = false;
        for (let y = 11; y < H; y++) if (map[y][x] === 'L') { lava = true; break; }
        if (pit) pitCols++;
        if (lava) lavaCols++;
        hazard.push(pit || lava);
      }
      for (let x = 0; x < W; x++) {
        if (!hazard[x]) continue;
        let flagged = false;
        for (let d = -3; d <= 1 && !flagged; d++) {
          const c = x + d;
          if (c < 0 || c >= W) continue;
          for (const y of AIR) if (A.solid(map[y][c])) {
            note(tag + ' hazard column ' + x + ' is roofed at (' + c + ',' + y + ')="' + map[y][c] + '"');
            flagged = true; break;
          }
        }
      }

      /* Water passage. The engine settles this with a flood fill from the spawn; this
         asserts the necessary condition instead of reimplementing it, because a second
         copy of the flood would only be able to disagree with the first. A hero box is
         three rows tall, so every column up to the shore needs three contiguous clear
         rows or nothing can swim through it. */
      if (L.water) {
        waterCourses++;
        for (let x = 3; x <= Math.min(L.waterTo, W - 1); x++) {
          let best = 0, run = 0;
          for (let y = 0; y < H; y++) {
            if (!A.solid(map[y][x])) { run++; if (run > best) best = run; } else run = 0;
          }
          if (best < 3) { note(tag + ' water column ' + x + ' pinches to ' + best + ' clear rows'); break; }
        }
      }
    }

    if (bad.length) fail(bad.join(' || '));
    /* Coverage floors, so this cannot pass by finding nothing to inspect -- a build
       change that emptied the enemy list would otherwise read as a clean sweep. */
    if (courses !== 48) fail('built ' + courses + ' courses, expected 48');
    if (walkers < 1000) fail('only ' + walkers + ' ground walkers inspected; expected ~1243');
    if (spikos < 80) fail('only ' + spikos + ' spikes inspected; expected ~108');
    if (pitCols < 300) fail('only ' + pitCols + ' pit columns found; expected ~426');
    if (lavaCols < 200) fail('only ' + lavaCols + ' lava columns found; expected ~304');
    if (waterCourses < 3) fail('only ' + waterCourses + ' water courses found; expected ~4');
    return courses + ' courses: ' + walkers + ' walkers all grounded, ' + spikos +
      ' spikes with open approaches, ' + pitCols + ' pit + ' + lavaCols +
      ' lava columns with clear airspace, ' + waterCourses + ' water courses passable';
  });

  /* The rest of the documented build-time rules: the checkpoint's footing, the bonus
     room exits, and the room geometry that comes out of the two numbers this game is
     built on (the big hero is 30px tall and jumps 75px, so a reward block sits FOUR
     rows above the surface you hit it from -- three leaves 2px of headroom and the big
     hero cannot even start the jump). Same reasoning as the check above: these were
     verified once, by hand, and then trusted. */
  test('structure', 'checkpoints, room exits and room geometry all hold', (A) => {
    const buildLevel = A.win.eval('buildLevel');
    const roomFor = A.win.eval('roomFor');
    const T = A.T;
    let fields = 0, entries = 0, rooms = 0, rewards = 0;
    const roomIds = new Set();
    const bad = [];
    const note = (s) => { if (bad.length < 8) bad.push(s); };

    for (let w = 1; w <= 12; w++) for (let lv = 1; lv <= 3; lv++) {
      const L = buildLevel(lv, w);
      fields++;
      const map = L.map, W = L.W, H = L.H, tag = w + '-' + lv;

      /* CHECKPOINT. A course is 198 tiles; without one, a death near the flag costs
         three minutes of replay. The engine searches outward from the midpoint for a
         column with ground below, open sky above and no walker within three tiles, and
         relaxes to the first two conditions (retiring the walker) if nothing qualifies.
         Either way the result must satisfy the geometry -- and must exist at all, which
         it silently did not in two courses before the fallback was added. */
      const cx = L.checkX;
      if (!cx) note(tag + ' has no checkpoint at all');
      else {
        for (let x = cx - 1; x <= cx + 2; x++) {
          if (x < 4 || x >= W - 8) { note(tag + ' checkpoint column ' + x + ' is outside the usable range'); break; }
          if (!A.solid(map[13][x])) { note(tag + ' checkpoint column ' + x + ' has no ground to respawn onto'); break; }
          let roofed = false;
          for (let y = 6; y <= 12; y++) if (A.solid(map[y][x])) { roofed = true; break; }
          if (roofed) { note(tag + ' checkpoint column ' + x + ' is roofed, so a respawn could land inside it'); break; }
        }
        for (const e of (L.enemies || [])) {
          if (e.air) continue;
          if (Math.abs(e.x - cx * T) < 3 * T) {
            note(tag + ' a ' + e.type + ' starts ' + Math.round(Math.abs(e.x / T - cx)) + ' tiles from the checkpoint');
            break;
          }
        }
      }

      for (const e of (L.entries || [])) {
        entries++;
        /* ROOM EXIT. Three courses once named exit columns that held no pipe at all, so
           every trip fell back to re-emerging from the entrance -- the detour bought
           nothing and read as a bug. The exit must be a real pipe top, and ahead. */
        const isTop = (x) => {
          if (x < 0 || x >= W) return false;
          for (let y = 0; y < H; y++) if (map[y][x] === 'T' || map[y][x] === 'E') return true;
          return false;
        };
        if (!isTop(e.exitTx)) note(tag + ' pipe at ' + e.tx + ' exits at ' + e.exitTx + ', which holds no pipe');
        else if (e.exitTx <= e.tx) note(tag + ' pipe at ' + e.tx + ' exits backwards at ' + e.exitTx);

        const R = roomFor(e, w);
        rooms++;
        roomIds.add(R.roomId);
        const rm = R.map, rW = R.W, rH = R.H;
        /* The two rows above the exit lip are cleared unconditionally, because a big
           hero standing on the lip occupies them. An early draft put a ? block directly
           over an exit and the collision shoved the hero onto the block instead, so the
           exit could not be stood on at all. */
        for (const y of [R.exitTy - 1, R.exitTy - 2]) {
          for (const x of [R.exitTx, R.exitTx + 1]) {
            if (y >= 0 && y < rH && x >= 0 && x < rW && A.solid(rm[y][x]))
              note('room ' + R.roomId + ' blocks the exit lip at (' + x + ',' + y + ')="' + rm[y][x] + '"');
          }
        }
        // every reward block must have a surface exactly four rows under it
        for (let y = 0; y < rH; y++) for (let x = 0; x < rW; x++) {
          const c = rm[y][x];
          if (c !== '?' && c !== 'M') continue;
          rewards++;
          if (!(y + 4 < rH && A.solid(rm[y + 4][x])))
            note('room ' + R.roomId + ' has a "' + c + '" at (' + x + ',' + y + ') with no surface four rows below it');
        }
      }
    }

    if (bad.length) fail(bad.join(' || '));
    if (fields !== 36) fail('built ' + fields + ' field courses, expected 36');
    /* Floors, not targets. Five of the eight layouts carry an entrance, so 36 field
       courses yield exactly 24 of them -- sitting a floor ON that number would turn any
       future rotation change into a spurious red build. What these guard against is the
       entrances disappearing, so they are set with room to breathe. */
    if (entries < 18) fail('only ' + entries + ' pipe entrances inspected; expected ~24');
    if (rooms < 18) fail('only ' + rooms + ' bonus rooms built; expected ~24');
    if (roomIds.size < 3) fail('only room types ' + Array.from(roomIds).join(',') + ' appeared; all three should');
    if (rewards < 20) fail('only ' + rewards + ' reward blocks inspected across the rooms');
    return fields + ' courses all have a sound checkpoint, ' + entries +
      ' pipe exits all land on a pipe ahead, ' + rooms + ' rooms (' +
      Array.from(roomIds).sort().join('/') + ') with ' + rewards + ' reachable rewards and clear exit lips';
  });

  /* ================= the documented fixes ================= */
  /* README records a list of bugs this game had and fixed. Exactly one of them (the
     infinite 1UP) had a regression test; the rest were fixed, measured once, and left.
     Those are the most valuable things in the file to guard, because each one is a
     mistake this codebase has already proven it can make. */

  test('fixes', 'a hundred coins is one life, and the counter wraps', (A) => {
    const G = A.G;
    const takeCoin = A.win.eval('takeCoin');
    A.course(1, 1, 0);
    const lives0 = G.lives, run0 = G.run.coins;
    for (let i = 0; i < 100; i++) takeCoin(5, 10);
    if (G.lives - lives0 !== 1) fail('100 coins granted ' + (G.lives - lives0) + ' lives, expected 1');
    if (G.coins !== 0) fail('the coin counter sat at ' + G.coins + ' instead of wrapping to 0');
    if (G.run.coins - run0 !== 100) fail("the run's coin total moved by " + (G.run.coins - run0) + ', expected 100');
    for (let i = 0; i < 100; i++) takeCoin(5, 10);
    if (G.lives - lives0 !== 2) fail('200 coins granted ' + (G.lives - lives0) + ' lives, expected 2');
    return '100 coins -> 1 life, wraps to 0, run total keeps counting; 200 -> 2';
  });

  /* Quitting used to bank only pipoHigh, which the title's corner reads, and never the
     ranking table -- so a run good enough for the top five that ended by quitting
     vanished from it, while the corner kept a number with no context behind it. */
  test('fixes', 'quitting banks the run, and a scoreless quit does not', (A) => {
    const G = A.G, ls = A.win.localStorage;
    const loadScores = A.win.eval('loadScores');
    try { ls.removeItem('pipoScores'); ls.removeItem('pipoHigh'); } catch (e) {}
    G.scores = [];
    A.course(2, 3, 0);
    G.score = 54321; G.run.coins = 7; G.run.foes = 3;
    A.tap('p');
    if (!G.paused) fail('quit is reached from the pause screen and p did not pause');
    A.tap('q');
    if (G.state !== 'title') fail('quitting left the game in state ' + G.state);
    const rows = loadScores();
    const mine = rows.find(e => e.s === 54321);
    if (!mine) fail('the quit run never reached the table');
    for (const [k, want] of [['w', 2], ['lv', 3], ['coins', 7], ['foes', 3]]) {
      if (mine[k] !== want) fail('the banked row has ' + k + '=' + mine[k] + ', expected ' + want);
    }
    if (mine.hero !== A.chars[0].name) fail('the banked row names ' + mine.hero);
    if (G.high !== 54321) fail('the corner number is ' + G.high + ', which no longer matches the table');
    // and a run worth nothing must not take a row
    const before = loadScores().length;
    A.tap('Enter');
    A.course(1, 1, 0);
    G.score = 0;
    A.tap('p'); A.tap('q');
    const after = loadScores().length;
    try { ls.removeItem('pipoScores'); ls.removeItem('pipoHigh'); } catch (e) {}
    if (after !== before) fail('a scoreless quit changed the table from ' + before + ' to ' + after + ' rows');
    return 'banked with full context (w2-3, ' + mine.hero + ', 7 coins, 3 foes); a 0-point quit adds nothing';
  });

  /* Running out of star while standing inside an enemy was instant death: the next step
     judged an overlap that the star had been holding harmless. The tail of the
     invincibility now hands over to the ordinary hit window. */
  test('fixes', 'a star running out inside an enemy hands over instead of killing', (A) => {
    const G = A.G;
    const L = A.course(1, 1, 0);
    const m = G.mario;
    L.enemies.length = 0;
    L.enemies.push({ type: 'puff', x: m.x, y: m.y, w: 12, h: 12, vx: 0, vy: 0, t: 0 });
    m.star = 1; m.invuln = 0;
    const lives0 = G.lives;
    A.run(6);
    if (G.mario.dead) fail('the hero died as the star ran out inside an enemy');
    if (G.lives !== lives0) fail('a life was lost (' + lives0 + ' -> ' + G.lives + ')');
    if (G.mario.star !== 0) fail('the star did not actually expire (star=' + G.mario.star + ')');
    if (G.mario.invuln <= 0) fail('nothing took over from the star, so the next step can still kill');
    return 'star expired inside an enemy, invuln took over at ' + G.mario.invuln + ' frames, no life lost';
  });

  /* The bridge collapse index was off by one and always left the far plank standing, so
     the boss could still be followed across it. */
  test('fixes', 'the collapsing bridge loses every plank', (A) => {
    const G = A.G;
    const updateCollapse = A.win.eval('updateCollapse');
    const F = A.course(1, 4, 0);
    if (!F.fortress) fail('1-4 is not a fortress');
    const bx = F.bridgeX, bw = F.bridgeW;
    if (!(bw > 1)) fail('the fortress reports a bridge only ' + bw + ' tiles wide');
    let before = 0;
    for (let i = 0; i < bw; i++) if (A.solid(F.map[13][bx + i])) before++;
    if (before !== bw) fail('only ' + before + ' of ' + bw + ' planks were solid to begin with');
    G.collapse = 1;
    for (let i = 0; i < bw * 3 + 150; i++) {
      if (G.state !== 'play') break;
      updateCollapse();
    }
    const left = [];
    for (let i = 0; i < bw; i++) if (A.solid(F.map[13][bx + i])) left.push(bx + i);
    if (left.length) fail('planks still standing at columns ' + left.join(',') + ' (the far one is column ' + (bx + bw - 1) + ')');
    return 'all ' + bw + ' planks from column ' + bx + ' cleared, including the far one';
  });

  /* Coral growth was dead code: the clearance it demanded around each pillar was wider
     than the gaps the authored pairs leave, so nothing was ever placed and the count sat
     frozen no matter how many laps in you were. */
  test('fixes', 'coral deepens as the laps go on', (A) => {
    const buildLevel = A.win.eval('buildLevel');
    /* three lagoons at rising laps, wherever the rotation happens to put them */
    const spots = [];
    for (let from = 1; spots.length < 3 && from <= 24; ) {
      const hit = findWater(A, from);
      if (!hit) break;
      spots.push(hit);
      from = hit.w + 4;                     // skip ahead so the laps are far apart
    }
    if (spots.length < 3) fail('found only ' + spots.length + ' lagoons to compare laps across');
    const counts = [];
    for (const spot of spots) {
      const w = spot.w;
      const L = buildLevel(spot.lv, w);
      if (!L.water) fail('expected ' + w + '-' + spot.lv + ' to be a water course');
      let n = 0;
      for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (L.map[y][x] === 'B') n++;
      counts.push({ w, n });
    }
    if (counts[0].n < 50) fail('only ' + counts[0].n + ' coral tiles in the first lap; the count looks broken, not frozen');
    /* The bug was that the count sat FROZEN whatever lap you were on, so the property
       worth asserting is growth end to end. Demanding a strict rise between every
       adjacent pair would make the check hostage to how far apart the rotation happens
       to place two lagoons -- measured, one such pair differs by only two tiles. */
    const first = counts[0], last = counts[counts.length - 1];
    if (!(last.n > first.n))
      fail('coral did not grow from world ' + first.w + ' (' + first.n + ') to world ' +
           last.w + ' (' + last.n + ') -- the growth is dead code again');
    for (let i = 1; i < counts.length; i++) {
      if (counts[i].n < counts[i - 1].n)
        fail('coral went backwards from world ' + counts[i - 1].w + ' (' + counts[i - 1].n +
             ') to world ' + counts[i].w + ' (' + counts[i].n + ')');
    }
    return counts.map(c => 'w' + c.w + '=' + c.n).join(' -> ');
  });

  /* ================= the damage matrix ================= */
  /* README states, per enemy, whether it can be stomped and whether fire kills it. That
     table is the game's combat contract and none of it was asserted -- a change to one
     branch of updateEnemies could quietly make SPIKO stompable or the cannon barrel
     lethal, and no invariant, soak or fuzz would notice, because nothing about it is
     invalid. It is just wrong.

     Enemies are harvested from real built courses rather than constructed here. A stub
     with the fields I happen to remember is a stub that drifts; a puff taken out of 1-1
     is the puff the player meets. Three setup traps had to be measured out of the way
     first, each the same shape as a mistake this project has already recorded:
       - a glider's y is recomputed from a sine every step, so its BUILD-TIME y is not
         where it will be. The run has to settle first, then aim.
       - a ball placed inside a chomp's pipe dies on the pipe tile before it ever
         reaches the chomp, which read as "fire does nothing to chomp".
       - the hero parked next to an enemy can pick up a coin, which read as a stomp
         worth 400 instead of 200. Score is only asserted where the setup controls it. */
  function harvest(A) {
    const G = A.G;
    const want = ['puff', 'shelly', 'spiko', 'flappy', 'glider', 'chomp', 'cannon', 'blaze', 'fish'];
    const found = {};
    for (let w = 1; w <= 12 && Object.keys(found).length < want.length; w++) {
      for (let lv = 1; lv <= 4; lv++) {
        A.course(w, lv, 0);
        for (const e of (G.level.enemies || [])) {
          if (want.includes(e.type) && !found[e.type]) found[e.type] = { w, lv };
        }
      }
    }
    return found;
  }
  /* isolate one enemy of a type in its own course, awake, with the hero out of the way */
  function isolate(A, where, type) {
    const G = A.G;
    A.course(where.w, where.lv, 0);
    const e = (G.level.enemies || []).find(x => x.type === type);
    if (!e) fail('a ' + type + ' was expected in ' + where.w + '-' + where.lv + ' and is not there');
    G.level.enemies.length = 0;
    G.level.enemies.push(e);
    /* Strip the coins. These checks measure what happens to an ENEMY and what that is
       worth, and a coin is worth 200 too -- so one picked up in passing reads as a stomp
       worth 400. It bit twice: once when a hero parked beside an enemy stood on one, and
       again when new content put a coin row where the hero ends up. Removing them makes
       the whole class of contamination impossible rather than avoidable. */
    for (let y = 0; y < G.level.H; y++) {
      for (let x = 0; x < G.level.W; x++) if (G.level.map[y][x] === 'c') G.level.map[y][x] = ' ';
    }
    /* WAKE_AHEAD is 336px, so the camera can sit a long way left of the enemy and it
       still wakes -- which buys the hero somewhere to stand that is nowhere near the
       ball. 300 keeps a margin. */
    G.camera = Math.max(0, e.x - 300);
    const m = G.mario;
    /* Park the hero at the camera's left edge, not at column 3: the engine clamps the
       hero to that edge, so parking it further back does not keep it there -- it slid
       forward on the next step, which is how it once reached a coin row seven tiles
       away and turned a 200-point stomp into 400. */
    m.x = G.camera + 8; m.y = 12 * A.T; m.px = m.x; m.py = m.y; m.vx = 0; m.vy = 0;
    m.big = true; m.fire = true; m.h = 30; m.star = 0; m.dead = false;
    m.invuln = 9999;                       // parked and untouchable while we set up
    return e;
  }

  test('combat', 'fire kills what it should and nothing it should not', (A) => {
    const G = A.G;
    const where = harvest(A);
    /* what README's table says: fire is the answer to the ones that cannot be stomped,
       it turns a shelly into a shell rather than flattening it, and it is no answer at
       all to a blaze (which is made of fire) or the boss (which absorbs it). */
    const EXPECT = {
      puff:   { flat: true,  becomes: 'puff',   score: 200 },
      shelly: { flat: false, becomes: 'shell',  score: 200 },
      spiko:  { flat: true,  becomes: 'spiko',  score: 400 },
      flappy: { flat: true,  becomes: 'flappy', score: 200 },
      chomp:  { flat: true,  becomes: 'chomp',  score: 400 },
      glider: { flat: true,  becomes: 'glider', score: 200 },
      fish:   { flat: true,  becomes: 'fish',   score: 200 },
      blaze:  { flat: false, becomes: 'blaze',  score: 0 }
    };
    const rows = [];
    for (const type of Object.keys(EXPECT)) {
      if (!where[type]) fail('no course in worlds 1-12 contains a ' + type);
      const e = isolate(A, where[type], type);
      // a chomp inside its pipe would kill the ball on the pipe, not on the chomp
      if (type === 'chomp') { e.up = true; e.y = (e.homeY === undefined ? e.y : e.homeY) - 16; e.py = e.y; }
      if (type === 'glider' || type === 'fish') A.run(1);      // let the sine settle
      const want = EXPECT[type];
      const s0 = G.score;
      G.balls.length = 0;
      G.balls.push({ x: e.x + 2, y: e.y + 2, w: 8, h: 8, vx: 0, vy: 0, t: 0, px: e.x + 2, py: e.y + 2 });
      A.run(2);
      const gained = G.score - s0;
      /* lava kills regardless of invulnerability, so a hero parked over a pool would
         die and take the rest of this case with it. Say that plainly if it happens. */
      if (G.mario.dead) fail(type + ': the setup parked the hero somewhere fatal, so this case never ran');
      if (!!e.flat !== want.flat) fail(type + ': flat=' + !!e.flat + ', expected ' + want.flat);
      if (e.type !== want.becomes) fail(type + ' became "' + e.type + '", expected "' + want.becomes + '"');
      if (gained !== want.score) fail(type + ' scored ' + gained + ', expected ' + want.score);
      rows.push(type + (want.flat ? ' dies' : (want.becomes === 'shell' ? ' shells' : ' IMMUNE')) + '/' + gained);
    }
    // the boss absorbs the shot with a flash instead of ignoring it or dying to it
    A.course(1, 4, 0);
    const BS = G.level.boss;
    if (!BS) fail('1-4 has no boss');
    const m = G.mario;
    m.big = true; m.fire = true; m.h = 30; m.invuln = 9999; m.dead = false;
    G.camera = Math.max(0, BS.x - 120);
    const s1 = G.score;
    G.balls.length = 0;
    G.balls.push({ x: BS.x + 2, y: BS.y + 2, w: 8, h: 8, vx: 0, vy: 0, t: 0, px: BS.x + 2, py: BS.y + 2 });
    A.run(2);
    if (BS.dead) fail('fire killed the boss; the bridge is supposed to be the only answer');
    if (!(BS.hit > 0)) fail('fire passed through the boss without registering, which reads as a bug');
    if (G.score !== s1) fail('hitting the boss with fire scored ' + (G.score - s1) + ', expected 0');
    if (G.balls.length !== 0) fail('the boss did not absorb the ball');
    return rows.join(' ') + ' | boss absorbs (hit=' + BS.hit + ', 0 points)';
  });

  test('combat', 'stomping works on exactly the enemies it should', (A) => {
    const G = A.G;
    const where = harvest(A);
    /* hurt = the hero was big and got shrunk with the 90-frame window; unhurt = the
       hero is untouched. Using a big hero makes both outcomes observable in one step
       without a death and a respawn in the middle. */
    const EXPECT = {
      puff:   { dies: true,  becomes: 'puff',   hurt: false },
      shelly: { dies: false, becomes: 'shell',  hurt: false },   // stomp shells it
      flappy: { dies: true,  becomes: 'flappy', hurt: false },
      glider: { dies: true,  becomes: 'glider', hurt: false },
      spiko:  { dies: false, becomes: 'spiko',  hurt: true  },   // the spines hurt
      chomp:  { dies: false, becomes: 'chomp',  hurt: true  },
      cannon: { dies: false, becomes: 'cannon', hurt: false },   // the barrel is harmless
      fish:   { dies: false, becomes: 'fish',   hurt: true  }    // nothing is stompable in water
    };
    /* blaze is deliberately absent. It lives in a lava pool, so any hero position that
       touches it also has its feet over lava -- which kills outright, star or not. A
       contact test there measures the lava rule, not the blaze rule. Fire immunity is
       what distinguishes a blaze and that is asserted above. */
    const rows = [];
    for (const type of Object.keys(EXPECT)) {
      if (!where[type]) fail('no course in worlds 1-12 contains a ' + type);
      const e = isolate(A, where[type], type);
      if (type === 'chomp') { e.up = true; e.y = (e.homeY === undefined ? e.y : e.homeY) - 16; e.py = e.y; }
      if (type === 'glider' || type === 'fish') A.run(1);
      const m = G.mario;
      m.invuln = 0; m.fire = false;
      m.x = e.x; m.vx = 0;
      m.y = e.y - m.h + 4;          // feet just inside its top
      m.py = e.y - m.h - 6;         // and above its shoulders a step ago
      m.vy = 2;                     // falling, which is what makes it a stomp
      A.K.jump = false;
      const want = EXPECT[type];
      A.run(1);
      if (!!e.flat !== want.dies) fail(type + ': enemy flat=' + !!e.flat + ', expected ' + want.dies);
      if (e.type !== want.becomes) fail(type + ' became "' + e.type + '", expected "' + want.becomes + '"');
      const hurt = !m.big || m.dead;
      if (hurt !== want.hurt) fail(type + ': hero hurt=' + hurt + ' (big=' + m.big + ' dead=' + !!m.dead + '), expected hurt=' + want.hurt);
      if (want.hurt && !m.dead && m.invuln !== 90) fail(type + ' left the hero with invuln=' + m.invuln + ', expected 90');
      rows.push(type + (want.hurt ? ' HURTS' : (want.dies ? ' stomps' : ' safe')));
    }
    return rows.join(' ');
  });

  /* Damage is three stages here, not the original's two: fire -> big -> small -> death.
     The extra stage exists to make keeping a powerup worth something. */
  test('combat', 'damage costs one stage at a time', (A) => {
    const G = A.G;
    const hurtOrKill = A.win.eval('hurtOrKill');
    A.course(1, 1, 0);
    const m = G.mario;
    m.big = true; m.fire = true; m.h = 30; m.star = 0; m.invuln = 0; m.dead = false;
    const lives0 = G.lives;

    hurtOrKill(m);
    if (!m.big || m.fire) fail('the first hit should cost the flower and leave the hero big (big=' + m.big + ' fire=' + m.fire + ')');
    if (m.invuln !== 90) fail('invuln after the first hit was ' + m.invuln + ', expected 90');

    m.invuln = 0;
    hurtOrKill(m);
    if (m.big) fail('the second hit should shrink the hero');
    if (m.h !== 16) fail('a shrunk hero is ' + m.h + 'px tall, expected 16');
    if (m.invuln !== 90) fail('invuln after the shrink was ' + m.invuln);
    if (G.lives !== lives0) fail('a life was spent before the hero was small');

    // and the window really does protect: a hit inside it costs nothing
    hurtOrKill(m);
    if (m.dead) fail('a hit inside the invulnerability window killed the hero');

    m.invuln = 0;
    hurtOrKill(m);
    if (!m.dead) fail('the third hit on a small hero should be fatal');
    return 'flower -> big -> small -> death, 90 frames of grace at each step';
  });

  /* ================= the fairness rules ================= */
  /* The rules that decide how the game FEELS, and the ones a player would call unfair
     if they broke: what a chain pays and when it resets, how many fireballs you get, a
     kicked shell clearing a row, a cannon that does not shoot you in the back, and a
     flame that announces itself and never erupts under a hero already committed to a
     jump. All documented in README, none of it asserted.

     Setting these up meant measuring three more traps out of the way, all mine:
       - a shell is kicked by STOMPING it, not by walking into it, so a side contact
         does nothing at all and reads as "the chain is broken".
       - placing an enemy at an arbitrary column can drop it inside terrain, and the
         de-overlap then throws the hero 41px into the air before anything collides.
         The test finds a genuinely open stretch of flat ground first.
       - updateMario runs BEFORE updateEnemies, so a hero pinned at a height that
         gravity can reach the deck from is already `onGround` by the time the blaze
         reads it. It has to be high enough that one step cannot land it. */
  function openStretch(A, width) {
    for (let x = 6; x < 120; x++) {
      let ok = true;
      for (let d = 0; d <= width && ok; d++) {
        if (!A.solid(A.cellAt(x + d, 13))) ok = false;
        for (let y = 8; y <= 12; y++) if (A.solid(A.cellAt(x + d, y))) ok = false;
      }
      if (ok) return x;
    }
    return -1;
  }

  test('rules', 'a chain pays the ladder in order and resets on landing', (A) => {
    const G = A.G;
    const bump = A.win.eval('bumpCombo');
    const ladder = A.win.eval('COMBO_PTS');
    A.course(1, 1, 0);
    G.combo = 0; G.lives = 9;
    const paid = [];
    for (let i = 0; i < ladder.length + 3; i++) paid.push(bump());
    for (let i = 0; i < ladder.length; i++) {
      if (paid[i] !== ladder[i]) fail('stomp ' + (i + 1) + ' paid ' + paid[i] + ', ladder says ' + ladder[i]);
    }
    for (let i = ladder.length; i < paid.length; i++) {
      if (paid[i] !== ladder[ladder.length - 1])
        fail('past the top of the ladder a stomp paid ' + paid[i] + ', expected it to stay at ' + ladder[ladder.length - 1]);
    }
    /* and the whole point of the ladder: it counts within ONE jump. Landing ends it,
       which is what stops a player from farming a row of walkers from the ground. */
    const m = G.mario;
    G.combo = 5;
    m.onGround = false; m.vy = 3;
    m.y = 12 * A.T - m.h - 6; m.py = m.y;
    A.run(6);
    if (!m.onGround) fail('the hero never landed, so the reset was not exercised');
    if (G.combo !== 0) fail('landing left the combo at ' + G.combo + ', expected 0');
    return 'ladder ' + ladder.join('/') + ', capped, and zeroed on landing';
  });

  test('rules', 'two fireballs at a time, no more', (A) => {
    const G = A.G;
    A.course(1, 1, 0);
    const m = G.mario;
    m.big = true; m.fire = true; m.h = 30; m.invuln = 9999; m.dead = false;
    G.balls.length = 0;
    const seen = [];
    for (let i = 0; i < 6; i++) { A.tap('f'); seen.push(G.balls.length); }
    if (seen[0] !== 1) fail('the first press produced ' + seen[0] + ' fireballs');
    if (Math.max(...seen) > 2) fail('there were ' + Math.max(...seen) + ' fireballs in the air at once, the cap is 2');
    if (seen[seen.length - 1] !== 2) fail('after six presses there are ' + seen[seen.length - 1] + ' in the air, expected the cap of 2');
    // and a hero without the flower gets none
    m.fire = false;
    G.balls.length = 0;
    A.tap('f');
    if (G.balls.length !== 0) fail('a hero with no flower threw ' + G.balls.length + ' fireballs');
    return 'presses -> ' + seen.join(',') + ' (cap 2), none without the flower';
  });

  test('rules', 'a kicked shell clears the row', (A) => {
    const G = A.G, T = A.T;
    const L = A.course(1, 1, 0);
    const col = openStretch(A, 8);
    if (col < 0) fail('found no open stretch of flat ground to set this up on');
    L.enemies.length = 0;
    const shell = { type: 'shell', x: col * T, y: 13 * T - 10, w: 12, h: 10, vx: 0, vy: 0, t: 0 };
    shell.px = shell.x; shell.py = shell.y;
    const victims = [];
    for (let i = 1; i <= 3; i++) {
      const v = { type: 'puff', x: (col + i * 2) * T, y: 13 * T - 12, w: 12, h: 12, vx: 0, vy: 0, t: 0 };
      v.px = v.x; v.py = v.y;
      victims.push(v); L.enemies.push(v);
    }
    L.enemies.push(shell);
    G.camera = Math.max(0, shell.x - 100);
    const m = G.mario;
    m.big = false; m.fire = false; m.h = 16; m.invuln = 0; m.star = 0; m.dead = false;
    m.x = shell.x - 4; m.px = m.x; m.vx = 0;
    m.y = shell.y - m.h + 3; m.py = shell.y - m.h - 6; m.vy = 2;   // stomping it is the kick
    A.K.jump = false;
    const s0 = G.score;
    A.run(1);
    if (shell.type !== 'shellMove') fail('stomping the shell left it as "' + shell.type + '", expected shellMove');
    if (!(shell.vx > 2)) fail('the kicked shell is moving at ' + shell.vx + ', too slow to chain (needs > 2)');
    A.run(80);
    const killed = victims.filter(v => v.flat).length;
    if (killed !== victims.length) fail('the shell killed ' + killed + ' of ' + victims.length + ' enemies in its path');
    if (G.mario.dead) fail('the hero died to its own shell');
    return 'stomp -> shellMove at ' + shell.vx + ', ' + killed + '/' + victims.length +
           ' cleared, ' + (G.score - s0) + ' points';
  });

  test('rules', 'a cannon fires ahead of you, never at your back', (A) => {
    const G = A.G;
    const L = A.course(1, 1, 0);
    const cannon = (L.enemies || []).find(e => e.type === 'cannon');
    if (!cannon) fail('1-1 has no cannon to test');
    const bolts = (dx) => {
      L.enemies.length = 0; L.enemies.push(cannon);
      cannon.t = 0;
      G.camera = Math.max(0, cannon.x - 140);
      const m = G.mario;
      m.x = cannon.x + dx; m.px = m.x; m.y = 12 * A.T; m.py = m.y;
      m.invuln = 9999; m.dead = false;
      for (let i = 0; i < cannon.cool * 2 + 2; i++) A.stepSim();
      return (L.enemies || []).filter(e => e.type === 'bolt').length;
    };
    const ahead = bolts(-120), justPast = bolts(20), behind = bolts(80);
    if (ahead < 1) fail('a cannon with the hero 120px ahead of it fired ' + ahead + ' times');
    if (behind !== 0) fail('a cannon fired ' + behind + ' times at a hero 80px past it; shooting your back is noise, not a threat');
    return 'ahead ' + ahead + ', just past ' + justPast + ', behind ' + behind;
  });

  test('rules', 'a blaze announces itself and holds fire at a committed jump', (A) => {
    const G = A.G, T = A.T;
    const L = A.course(1, 4, 0);
    const blaze = (L.enemies || []).find(e => e.type === 'blaze');
    if (!blaze) fail('1-4 has no blaze to test');
    const trial = (airborne) => {
      L.enemies.length = 0; L.enemies.push(blaze);
      blaze.t = 0; blaze.warn = 0; blaze.up = false; blaze.vy = 0; blaze.y = 14 * T;
      G.camera = Math.max(0, blaze.x - 140);
      const m = G.mario;
      let warnFrames = 0, launched = false;
      for (let i = 0; i < blaze.period + 40; i++) {
        m.x = blaze.x; m.px = m.x;
        /* high and rising for the airborne case: updateMario runs first, so a hero
           pinned within gravity's reach of the deck is already grounded by the time
           the blaze reads it */
        if (airborne) { m.y = 7 * T; m.py = m.y - 2; m.vy = -1; }
        else { m.y = 13 * T - m.h; m.py = m.y; m.vy = 0; m.onGround = true; }
        m.invuln = 9999; m.dead = false; m.star = 0;
        A.stepSim();
        if (blaze.warn > 0) warnFrames++;
        if (blaze.up) launched = true;
      }
      return { warnFrames, launched };
    };
    const grounded = trial(false);
    if (!grounded.launched) fail('a blaze never launched at a hero standing at its lip');
    if (grounded.warnFrames < 15) fail('the launch was announced for only ' + grounded.warnFrames + ' frames; the rule is 20');
    const air = trial(true);
    if (air.launched) fail('a blaze erupted under a hero already in the air over its pool -- that is a coin flip, not a hazard');
    if (air.warnFrames !== 0) fail('it began winding up at an airborne hero (' + air.warnFrames + ' frames)');
    return 'grounded: ' + grounded.warnFrames + ' warning frames then a launch; airborne over the pool: no wind-up, no launch';
  });

  /* ================= the ways a player can get stranded ================= */
  /* The worst bug left in a platformer is not a crash, it is being stuck: a pipe that
     puts you somewhere you cannot leave, a lift that slides out from under you, a clock
     that kills you with no explanation. All three subsystems existed with no test. */

  test('traversal', 'every pipe round trip returns to the column the course authored', (A) => {
    const G = A.G, T = A.T;
    const enterPipe = A.win.eval('enterPipe');
    const leavePipe = A.win.eval('leavePipe');
    const roomExitUnder = A.win.eval('roomExitUnder');
    let trips = 0;
    const seenRooms = new Set();
    for (const [w, lv] of [[1, 1], [1, 2], [1, 3], [2, 3], [3, 1], [4, 3]]) {
      const L = A.course(w, lv, 0);
      for (const entry of (L.entries || [])) {
        const courseLevel = G.level;
        const tag = w + '-' + lv + ' pipe@' + entry.tx;
        enterPipe(entry);
        let arrived = false;
        for (let i = 0; i < 80 && !arrived; i++) { A.stepSim(); if (G.room) arrived = true; }
        if (!arrived) fail(tag + ': entering never reached a room');
        if (!G.level.room) fail(tag + ': the level swapped to something that is not a room');
        seenRooms.add(G.level.roomId);
        if (!G.mario.onGround) fail(tag + ': the hero arrived in the room in mid-air');

        /* stand on the room's exit lip. roomExitUnder is the engine's own test for
           "the player is on the exit", so using it keeps the setup honest. */
        const R = G.level, m = G.mario;
        m.x = R.exitTx * T + 4; m.y = R.exitTy * T - m.h; m.px = m.x; m.py = m.y;
        m.vx = 0; m.vy = 0; m.onGround = true;
        if (!roomExitUnder(m)) fail(tag + ': standing on the room exit is not recognised as being on it');

        leavePipe();
        let back = false;
        for (let i = 0; i < 80 && !back; i++) { A.stepSim(); if (!G.room) back = true; }
        if (!back) fail(tag + ': leaving never returned to the course');
        if (G.level !== courseLevel) fail(tag + ': came back to a different level object than it left');
        const outTx = Math.round(G.mario.x / T);
        if (outTx !== entry.exitTx) fail(tag + ': came out at column ' + outTx + ', the course authored ' + entry.exitTx);
        let onPipe = false;
        for (let y = 0; y < G.level.H; y++) {
          const c = G.level.map[y][outTx];
          if (c === 'T' || c === 'E') { onPipe = true; break; }
        }
        if (!onPipe) fail(tag + ': came out at column ' + outTx + ', which holds no pipe');
        if (!G.mario.onGround) fail(tag + ': came out in mid-air rather than on the lip');
        if (G.mario.dead) fail(tag + ': the hero died during the round trip');
        trips++;
      }
    }
    if (trips < 4) fail('only ' + trips + ' round trips were exercised');
    if (seenRooms.size < 3) fail('only room types ' + Array.from(seenRooms).join(',') + ' were visited; all three should be');
    return trips + ' round trips across room types ' + Array.from(seenRooms).sort().join('/') +
      ', each landing on its authored exit pipe';
  });

  test('traversal', 'a lift carries the hero instead of sliding out from under', (A) => {
    const G = A.G;
    let where = null, lift = null;
    for (const [w, lv] of [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2]]) {
      const L = A.course(w, lv, 0);
      if ((L.plats || []).length) { where = w + '-' + lv; lift = L.plats[0]; break; }
    }
    if (!lift) fail('no course in the first three worlds has a lift to ride');
    const m = G.mario;
    m.big = false; m.h = 16; m.star = 0; m.invuln = 9999; m.dead = false;
    m.x = lift.x + 2; m.px = m.x;
    m.y = lift.y - m.h; m.py = m.y - 1; m.vy = 1; m.vx = 0;
    G.camera = Math.max(0, lift.x - 120);
    A.K.left = A.K.right = A.K.jump = false;
    A.run(2);
    if (m.plat !== lift) fail(where + ': standing on the lift did not attach the hero to it');
    /* the assertion is that the hero moves WITH it -- comparing displacements rather
       than a distance, so it holds whichever way the lift happens to be travelling */
    const hx = m.x, hy = m.y, px = lift.x, py = lift.y;
    A.run(40);
    const heroDx = m.x - hx, heroDy = m.y - hy;
    const liftDx = lift.x - px, liftDy = lift.y - py;
    if (Math.abs(liftDx) + Math.abs(liftDy) < 4) fail(where + ': the lift barely moved (' + liftDx.toFixed(1) + ',' + liftDy.toFixed(1) + '), so carrying was not exercised');
    if (Math.abs(heroDx - liftDx) > 1.5) fail(where + ': the lift moved ' + liftDx.toFixed(1) + 'px across and the hero ' + heroDx.toFixed(1) + 'px');
    if (Math.abs(heroDy - liftDy) > 1.5) fail(where + ': the lift moved ' + liftDy.toFixed(1) + 'px down and the hero ' + heroDy.toFixed(1) + 'px');
    if (m.plat !== lift) fail(where + ': the hero came off the lift while riding it');
    if (m.dead) fail(where + ': the hero died while riding');
    return where + ': carried ' + liftDx.toFixed(1) + ',' + liftDy.toFixed(1) + 'px with the lift, still aboard';
  });

  test('traversal', 'the clock warns once and then explains the death', (A) => {
    const G = A.G;
    const Sound = A.win.eval('Sound');
    A.course(1, 1, 0);
    G.mario.invuln = 9999;
    G.warnedTime = false; G.time = 101; G.timeF = 0; G.timeUp = false;
    let hurries = 0;
    const realHurry = Sound.hurry;
    Sound.hurry = function () { hurries++; return realHurry.apply(this, arguments); };
    try {
      A.run(36 * 3 + 4);                       // 36 frames to a tick, so this is 3 ticks
      if (!G.warnedTime) fail('the clock passed 100 without arming the warning');
      if (hurries !== 1) fail('the hurry cue fired ' + hurries + ' times, expected exactly 1');
      if (!(G.time < 100)) fail('the clock did not advance (time=' + G.time + ')');
      A.run(36 * 2);
      if (hurries !== 1) fail('the hurry cue repeated (' + hurries + ' times); it is a one-off');

      /* Running out used to kill with no explanation, and the death card looked
         identical to a stomp. The flag is what the card reads. */
      G.time = 1; G.timeF = 0;
      for (let i = 0; i < 60 && !G.mario.dead; i++) A.stepSim();
      if (!G.mario.dead) fail('the clock reached zero without killing the hero');
      if (!G.timeUp) fail('the hero died on the clock without the timeUp flag the death card reads');
      if (G.time !== 0) fail('the clock ended at ' + G.time + ', expected 0');
    } finally {
      Sound.hurry = realHurry;
    }
    return 'one warning at 100, no repeats, death at 0 with the reason recorded';
  });

  /* ================= water ================= */
  /* The rule that keeps a lagoon from becoming a flight level: a stroke is a fixed
     impulse, and HOLDING the key does not buy any more of it. On land the variable-jump
     clamp (`if (!wet && !keys.jump && m.vy < -2) m.vy = -2`) is what makes a tap
     shorter than a hold; that clamp is gated on being dry, and if the gate ever came
     off, water would turn into a hover.
     Constants are read off the engine rather than copied, so the check cannot drift
     away from the values it is meant to be protecting. */
  test('water', 'a stroke is a fixed impulse, and the shore gives land physics back', (A) => {
    const G = A.G, T = A.T;
    const W = A.win.eval('WATER');
    const inWater = A.win.eval('inWater');
    const wet = findWater(A, 1);
    if (!wet) fail('no water course found to test in');
    const L = A.course(wet.w, wet.lv, 0);
    if (!L.water) fail(wet.w + '-' + wet.lv + ' was expected to be a water course');
    const m = G.mario;
    const park = () => {
      m.big = false; m.h = 16; m.star = 0; m.invuln = 9999; m.dead = false;
      m.x = 6 * T; m.px = m.x; m.vx = 0;
      m.y = 8 * T; m.py = m.y; m.vy = 0;
      m.onGround = false; m.jumpBuf = 0;
      if (L.enemies) L.enemies.length = 0;
      A.K.left = A.K.right = A.K.run = A.K.jump = false;
    };

    // one stroke, key held down for the whole rise versus released immediately
    const rise = (hold) => {
      park();
      if (!inWater(m)) fail('the hero is not in the water where this test parks it');
      const y0 = m.y;
      m.jumpBuf = 8;                       // the edge, as the keydown handler sets it
      A.K.jump = hold;
      let peak = m.y;
      for (let i = 0; i < 60; i++) {
        A.stepSim();
        if (m.y < peak) peak = m.y;
        if (!hold) A.K.jump = false;
      }
      A.K.jump = false;
      return y0 - peak;
    };
    const held = rise(true), tapped = rise(false);
    /* The absolute figure depends on where the measurement window starts and stops;
       what the rule actually says is that the two are the SAME. */
    if (Math.abs(held - tapped) > 0.01)
      fail('holding the key rose ' + held.toFixed(1) + 'px and tapping it ' + tapped.toFixed(1) +
           'px -- water is turning into a flight level');
    if (!(held > 15 && held < 60))
      fail('a single stroke rose ' + held.toFixed(1) + 'px, which is outside anything this game intends');

    // and strokes stack: that is how you climb a shaft
    park();
    const y0 = m.y;
    let best = m.y;
    for (let s = 0; s < 4; s++) {
      m.jumpBuf = 8;
      for (let i = 0; i < 14; i++) { A.stepSim(); if (m.y < best) best = m.y; }
    }
    const climbed = y0 - best;
    if (!(climbed > held * 1.5))
      fail('four strokes climbed ' + climbed.toFixed(1) + 'px against one stroke of ' +
           held.toFixed(1) + 'px -- they are not stacking');

    // sinking is slow in water and fast on land
    park();
    let wetTerm = 0;
    for (let i = 0; i < 200; i++) { A.stepSim(); if (m.vy > wetTerm) wetTerm = m.vy; }
    if (Math.abs(wetTerm - W.maxFall) > 0.01)
      fail('terminal fall in water was ' + wetTerm.toFixed(3) + ', WATER.maxFall says ' + W.maxFall);

    /* Past the shore the same course has to behave like dry land again, or the beach at
       the end of a lagoon would still swim. */
    let col = -1;
    for (let x = L.waterTo + 3; x < L.W - 12 && col < 0; x++) {
      let ok = A.solid(A.cellAt(x, 13));
      for (let y = 6; y <= 12; y++) if (A.solid(A.cellAt(x, y))) ok = false;
      if (ok) col = x;
    }
    if (col < 0) fail('found no open column past the shore to drop the hero into');
    m.invuln = 9999; m.dead = false;
    m.x = col * T; m.px = m.x; m.vx = 0;
    m.y = 6 * T; m.py = m.y; m.vy = 0; m.onGround = false;
    if (inWater(m)) fail('column ' + col + ' is past waterTo=' + L.waterTo + ' and still reads as water');
    let dryTerm = 0;
    for (let i = 0; i < 40; i++) { A.stepSim(); if (m.vy > dryTerm) dryTerm = m.vy; }
    if (Math.abs(dryTerm - 5.5) > 0.01)
      fail('on the beach the hero fell at ' + dryTerm.toFixed(3) + ', expected the land terminal of 5.5');
    if (!m.onGround) fail('the hero never landed on the beach');
    return 'one stroke ' + held.toFixed(1) + 'px held and tapped alike, four stroke ' +
      climbed.toFixed(1) + 'px, sink ' + wetTerm + ' wet / ' + dryTerm + ' on the beach past column ' + col;
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

  /* The page under test registers a real service worker and fills a real cache, on the
     same origin the suite runs from. Left alone that accumulates: after one run the test
     page is itself controlled by the worker, and every later fetch -- including the one
     that reads sw.js to check the shell -- goes through it. The worker is network-first,
     so it would usually still be fresh, but "usually fresh" is exactly how a stale
     engine.js made a real fix look inert earlier in this project. A suite that leaves
     state behind is a suite whose second run tests something different from its first.
     So each run starts and ends from a known state. */
  async function resetOrigin() {
    const notes = [];
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
        /* unregister() resolving does not mean the registration is gone: it is still
           handed back by getRegistrations() for a while, with an already-'activated'
           worker attached. Wait for it to actually clear, or the next run inherits a
           registration that looks ready and has no cache behind it. */
        if (regs.length) {
          const t0 = Date.now();
          let left = regs.length;
          while (Date.now() - t0 < 5000) {
            left = (await navigator.serviceWorker.getRegistrations()).length;
            if (left === 0) break;
            await new Promise(r => setTimeout(r, 100));
          }
          notes.push(regs.length + ' worker(s) unregistered' +
            (left ? ', ' + left + ' still lingering after 5s' : ' and cleared'));
        }
      }
    } catch (e) { notes.push('worker reset failed: ' + e.message); }
    try {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
      if (keys.length) notes.push(keys.length + ' cache(s) deleted');
    } catch (e) { notes.push('cache reset failed: ' + e.message); }
    return notes;
  }

  /* Published after every check so a run that never finishes can still say where it
     stopped. The first CI failure was a bare 'Timeout 300000ms exceeded' with no
     indication of whether the suite was slow or stuck -- a distinction worth one line
     of bookkeeping. */
  function publishProgress(results, total, current) {
    try {
      root.PIPO_PROGRESS = {
        done: results.length, total,
        last: current ? current.group + '/' + current.name : null,
        failedSoFar: results.filter(r => !r.pass).length,
        at: Date.now()
      };
    } catch (e) { /* nothing depends on this */ }
  }

  async function runAll(opts) {
    const doc = (opts && opts.document) || document;
    const src = (opts && opts.src) || '../index.html';
    const onResult = (opts && opts.onResult) || (() => {});
    /* `only` runs a subset by group name, for iterating on one area without paying for
       the timer-driven checks (crash and offline poll real clocks, which a hidden or
       throttled tab stretches out). The full run is still what CI reports. */
    const only = opts && opts.only
      ? (Array.isArray(opts.only) ? opts.only : [opts.only])
      : null;
    const cleanedBefore = await resetOrigin();
    publishProgress([], TESTS.length, null);
    const groups = [];
    for (const t of TESTS) {
      if (only && !only.includes(t.group)) continue;
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
          results.push(r); onResult(r); publishProgress(results, TESTS.length, t);
        } catch (e) {
          const r = { group: g.name, name: t.name, pass: false, detail: String(e && e.message || e), ms: Date.now() - started };
          results.push(r); onResult(r); publishProgress(results, TESTS.length, t);
        } finally {
          if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
        }
      }
    }
    const cleanedAfter = await resetOrigin();   // leave the origin as it was found
    const failed = results.filter(r => !r.pass);
    return {
      total: results.length, passed: results.length - failed.length, failed: failed.length,
      results, origin: { cleanedBefore, cleanedAfter }
    };
  }

  root.PIPO_SUITE = { runAll, resetOrigin, tests: TESTS };
})(typeof window !== 'undefined' ? window : this);
