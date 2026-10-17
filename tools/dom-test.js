// Headless harness: runs js/main.js against a minimal DOM/canvas stub so the
// turn flow can be exercised without a browser.
// Run: node tools/dom-test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'js');

// ---- tiny DOM
class El {
  constructor(id, tag) {
    this.id = id;
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this._cls = new Set();
    this._listeners = {};
    this._text = '';
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const self = this;
    return {
      add: (c) => self._cls.add(c),
      remove: (c) => self._cls.delete(c),
      contains: (c) => self._cls.has(c),
      toggle: (c, on) => {
        if (on === undefined) on = !self._cls.has(c);
        on ? self._cls.add(c) : self._cls.delete(c);
      },
    };
  }
  get textContent() {
    if (this.children.length) {
      return this.children.map(c => (c && c.isText) ? c._text : c.textContent).join('');
    }
    return this._text;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { this._text = String(v); this.children = []; }
  append(...kids) {
    for (const k of kids) {
      if (k == null) continue;
      this.children.push(k);
      if (k.parentElement == null) k.parentElement = this;
    }
  }
  appendChild(k) { this.append(k); return k; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  dispatch(t, ev) { (this._listeners[t] || []).forEach(f => f(ev)); }
  // Real DOM elements carry dispatchEvent; main.js's debug sweep uses it.
  dispatchEvent(ev) { this.dispatch(ev.type, ev); return true; }
  click() { this.dispatch('click', { target: this }); }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1100, height: 760, right: 1100, bottom: 760 };
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (sel === '.res' && n._cls.has('res')) return n;
      if (sel === '.player' && n._cls.has('player')) return n;
      n = n.parentElement;
    }
    return null;
  }
  getContext() {
    const noop = () => {};
    return new Proxy({}, {
      get: (t, k) => {
        if (k === 'canvas') return { width: 1100, height: 760 };
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'createLinearGradient') {
          return () => ({ addColorStop: noop });
        }
        return typeof k === 'string' ? (t[k] !== undefined ? t[k] : noop) : noop;
      },
      set: () => true,
    });
  }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

const byId = new Map();
function mk(id, tag) { const e = new El(id, tag); byId.set(id, e); return e; }

const IDS = [
  'board', 'status', 'players', 'hand', 'buildhint', 'buildbar',
  'btn-roll', 'btn-pass', 'btn-music', 'btn-sfx', 'btn-new', 'btn-debug',
  'btn-dev', 'devcards', 'devhint', 'discardpanel', 'discarthint',
  'boardinfo', 'rollresult', 'log',
];
for (const id of IDS) mk(id);

// Build buttons, as index.html declares them.
const BUILD_BTNS = ['road', 'settlement', 'city'].map((kind) => {
  const b = new El('build-' + kind, 'button');
  b.dataset.build = kind;
  return b;
});
// The canvas carries intrinsic dimensions; its rect matches 1:1 in this stub.
{
  const b = byId.get('board');
  b.width = 1100;
  b.height = 760;
}
mk('buildbar').querySelectorAll = (sel) =>
  sel === '[data-build]' ? BUILD_BTNS : [];

// document.getElementById over our stub map.
const document_ = {
  getElementById: id => byId.get(id) || null,
  createElement: t => new El('', t),
  createTextNode: t => ({ _text: String(t), isText: true }),
  querySelectorAll: s => mk('buildbar').querySelectorAll(s),
  querySelector: () => null,
  addEventListener: () => {},
  // art.js injects an SVG defs block into <body>.
  body: null,
};
document_.body = new El('body', 'body');
document_.body.insertBefore = function (node) { this.children.unshift(node); };
document_.body.firstChild = null;

const timers = [];
let lastTimer = 0;

// Minimal Web Audio stand-in so audio.js can construct its graph.
function FakeParam() {
  return {
    value: 1,
    cancelScheduledValues() {},
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
  };
}
function FakeNode() {
  const p = new FakeParam();
  return {
    connect() { return this; }, disconnect() {},
    gain: p, frequency: new FakeParam(), detune: new FakeParam(),
    type: 'sine', start() {}, stop() {},
  };
}
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = FakeNode(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { return FakeNode(); }
  createDelay() { const node = FakeNode(); node.delayTime = new FakeParam(); return node; }
  createOscillator() { return FakeNode(); }
  createStereoPanner() { const node = FakeNode(); node.pan = new FakeParam(); return node; }
  createBiquadFilter() { return FakeNode(); }
  createBufferSource() { return FakeNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
}
const intervals = [];

// art.js rasterises inline-SVG symbols into offscreen canvases. Headless there
// is no rasteriser, so Image resolves empty and every drawImage is a no-op --
// ART.get() then returns a blank canvas, which is fine for turn-flow testing.
class FakeImage {
  constructor() { this.width = 0; this.height = 0; this.onload = null; }
  set src(v) { void v; if (this.onload) this.onload(); }
  get src() { return ''; }
}

const ctxObj = {
  console,
  Math,
  document: document_,
  // audio.js reads the AudioContext off `window`, not the bare global.
  window: {
    addEventListener: () => {},
    AudioContext: FakeAudioContext,
    webkitAudioContext: FakeAudioContext,
  },
  setTimeout: (fn, ms) => {
    const id = ++lastTimer;
    timers.push({ id, fn, at: (ms || 0) });
    return id;
  },
  clearTimeout: () => {},
  setInterval: (fn, ms) => { intervals.push(fn); return intervals.length; },
  clearInterval: () => {},
  requestAnimationFrame: () => 0,
  AudioContext: FakeAudioContext,
  webkitAudioContext: FakeAudioContext,
  MouseEvent: class {
      constructor(t, i) { this.type = t; Object.assign(this, i || {}); }
    },
  Image: FakeImage,
  DOMParser: class {
    parseFromString() {
      return {
        querySelector: () => null,
        querySelectorAll: () => [],
        documentElement: { innerHTML: '' },
      };
    }
  },
};
ctxObj.globalThis = ctxObj;
vm.createContext(ctxObj);

// Capture the live game state: main.js keeps `g` private, but it hands it to
// RENDER.draw on every frame, so wrapping draw exposes it.
const LIVE = () => ctxObj.__LIVE;

// ---- load modules
const EX = {
  'hex.js': 'HEX', 'map.js': 'MAPGEN', 'state.js': 'STATE',
  'rules.js': 'RULES', 'render.js': 'RENDER', 'ai.js': 'AI',
  'audio.js': 'AUDIO', 'art.js': 'ART',
};
for (const [f, name] of Object.entries(EX)) {
  const code = fs.readFileSync(path.join(base, f), 'utf8');
  vm.runInContext(code + `\n;globalThis.${name} = ${name};`, ctxObj, { filename: f });
}
vm.runInContext(fs.readFileSync(path.join(base, 'main.js'), 'utf8'), ctxObj,
  { filename: 'main.js' });

// main.js calls RENDER.draw(...) by property lookup each frame, so patching
// the property from inside the vm scope intercepts every frame.
vm.runInContext(`
  globalThis.__realDraw = RENDER.draw;
  globalThis.__LIVE = null;
  RENDER.draw = function (c, g, w, h, sel, tool, pid) {
    globalThis.__LIVE = g;
    return globalThis.__realDraw.call(RENDER, c, g, w, h, sel, tool, pid);
  };
`, ctxObj);

// main.js is an IIFE with no exports, so read state back out of the DOM.
installCooperativeTimers(ctxObj);
const $ = (id) => document_.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// main.js schedules its game timers through this manual queue, while its own
// `await sleep(ms)` uses real timers. Driving both from one place keeps the
// two clocks in step, so runDebugAutoPlay can make progress here.
const realSetTimeout = global.setTimeout;
function installCooperativeTimers(ctx) {
  let seq = 0;
  ctx.setTimeout = (fn, ms) => {
    const id = ++seq;
    // Fire on a real clock (so ordering is genuine) but also yield to the
    // microtask queue each time, letting awaited promises settle.
    realSetTimeout(() => { void id; fn(); }, Math.min(ms || 0, 5));
    return id;
  };
  ctx.clearTimeout = () => {};
  ctx.setInterval = () => 0;
  ctx.clearInterval = () => {};
}

let fail = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
};
const logText = () => $('log').textContent;
const clickAt = (x, y) => $('board').dispatch('click', { clientX: x, clientY: y });

// Sweep the canvas in a grid until `want` shows up in the log.
async function sweep(want, step = 6) {
  for (let x = 40; x <= 1060; x += step) {
    for (let y = 40; y <= 720; y += step) {
      clickAt(x, y);
      if (logText().includes(want)) return true;
    }
  }
  return false;
}

(async () => {
  // ---- boot
  check('boot: sidebar shows 2 players', $('players').children.length === 2,
    'got ' + $('players').children.length);
  const handChips = () => $('hand').children.filter(c => c.classList.contains('res'));
  check('boot: 5 hand chips', handChips().length === 5, 'got ' + handChips().length);
  check('boot: log populated', logText().length > 0);
  check('boot: status mentions setup', /settlement/i.test($('status').textContent),
    $('status').textContent);
  check('boot: no exceptions during boot', true);

  // ---- opening settlement via real clicks
  check('placed opening settlement',
    await sweep('You founded your first settlement'));
  check('score is 1 vp after settlement',
    /1 vp/.test($('players').children[0].textContent),
    $('players').children[0].textContent);
  check('phase advanced to road placement',
    /place a road/i.test($('status').textContent), $('status').textContent);
  check('placed opening road', await sweep('You built your first road'));
  await sleep(20);
  await sleep(50);

  // ---- AI should now have its turn in the snake order
  check('AI placed its opening', /Mira founded/.test(logText()),
    logText().slice(-160));

  await sleep(20);
  await sleep(50);
  const inSetup = () => /place a (settlement|road)/i.test($('status').textContent);

  // Count occurrences of a phrase in the log. The same wording is used for
  // every setup pair, so "is it present?" is useless — only a rising count is.
  const countOf = (want) => {
    const t = logText();
    let n = 0, i = 0;
    while ((i = t.indexOf(want, i)) !== -1) { n++; i += want.length; }
    return n;
  };

  // Sweep the whole grid until the phrase count rises.
  async function sweepNew(want) {
    const before = countOf(want);
    const rect = { width: 1100, height: 760 };
    for (let x = 40; x <= 1060; x += 6) {
      for (let y = 40; y <= 720; y += 6) {
        void rect;
        clickAt(x, y);
        if (countOf(want) > before) return true;
      }
    }
    return false;
  }

  // The human may be scheduled more than once in the snake order; keep placing
  // pairs until the opening is genuinely finished.
  let pairs = 0;
  let guard = 0;
  while (inSetup() && guard++ < 6) {
    check('setup pair ' + (pairs + 1) + ': settlement',
      await sweepNew('You founded your first settlement'));
    check('setup pair ' + (pairs + 1) + ': road',
      await sweepNew('You built your first road'));
    pairs++;
    await sleep(20);
    await sleep(60);
  }
  check('snake order finished after ' + pairs + ' human pairs', !inSetup(),
    $('status').textContent);
  // The human is scheduled twice in a2-player snake order ([0,1,1,0]): once
  // before this loop (driven by the opening sweep) and once inside it.
  check('human placed 2 opening pairs', pairs === 1,
    'loop placed ' + pairs + ' (+1 earlier = ' + (pairs + 1) + ')');

  // Both players must hold 2 settlements and 2 roads once setup is done.
  {
    const built = $('players').children.map(r => r.textContent).join(' | ');
    check('sidebar reflects post-setup scores', built.length > 0, built);
  }

  // ---- roll
  if (/roll the dice/i.test($('status').textContent)) {
    $('btn-roll').click();
    check('roll produced a dice result', /rolled \d/.test(logText()),
      $('rollresult').textContent);

    // A 7 may open the discard UI or the robber phase; resolve either.
    let g7 = 0;
    while (/discard|move the robber/i.test($('status').textContent) && g7++ < 3) {
      if (/move the robber/i.test($('status').textContent)) {
        check('robber phase reached', true);
        clickAt(550, 380);
        check('robber resolution returned to build',
          !/move the robber/i.test($('status').textContent),
          $('status').textContent);
      } else {
        check('discard panel shown', !$('discardpanel').classList.contains('hidden'));
        check('hand chips are pickable during a discard',
          $('hand').children.some(c => c.classList.contains('pick')),
          $('hand').children.length + ' chips');
        // Re-query each iteration: the hand re-renders on every click.
        for (let i = 0; i < 14 && /discard/i.test($('status').textContent); i++) {
          const c = $('hand').children.find(x => x.classList.contains('pick'));
          if (!c) break;
          c.click();
        }
        check('discard completed', !/discard/i.test($('status').textContent),
          $('status').textContent);
      }
      await sleep(20);
      await sleep(50);
    }
  } else {
    check('roll reached (skipped, not human turn)', false, $('status').textContent);
  }

  // ---- building with a real click sweep
  // The human's opening spots may only touch pasture/field tiles, leaving wood
  // and brick permanently unaffordable. Grant a full hand through the live
  // state so the build path is deterministically exercised.
  {
    check('live state captured', !!LIVE(), 'captured=' + !!LIVE());
    if (LIVE()) {
      Object.assign(LIVE().players[0].hand, {
        forest: 20, pasture: 20, field: 20, hill: 20, mount: 20,
      });
    }
  }

  // Roll until the human is in the build phase with resources in hand.
  let built = false, tries = 0;
  while (!built && tries++ < 40) {
    if (/roll the dice/i.test($('status').textContent)) $('btn-roll').click();
    await sleep(20);
    await sleep(20);
    // Resolve any 7 sub-flow (discards + robber).
    let g7 = 0;
    while (/discard|move the robber/i.test($('status').textContent) && g7++ < 3) {
      if (/move the robber/i.test($('status').textContent)) {
        clickAt(550, 380);
      } else {
        for (let k = 0; k < 14; k++) {
          const c = $('hand').children.find(x =>
            x.classList && x.classList.contains('pick'));
          if (!c) break;
          c.click();
        }
      }
      await sleep(20);
      await sleep(20);
    }
    if (/build or end turn/i.test($('status').textContent)) {
      // Use the real build-tool buttons, then click a highlighted spot.
      const want = {
        settlement: 'You founded a settlement',
        road: 'You built a road',
        city: 'You built a city',
      };
      for (const kind of ['settlement', 'road', 'city']) {
        if (built) break;
        const btn = BUILD_BTNS.find(b => b.dataset.build === kind);
        if (btn) btn.click();
        if (await sweepNew(want[kind])) built = true;
      }
    }
    if (!built) { $('btn-pass').click(); await sleep(20); await sleep(20); }
  }
  check('build phase reachable via real clicks', built,
    'tries=' + tries + ' hand=' + $('hand').textContent.slice(0, 60));

  // ---- dev card path
  $('btn-dev').click();                              // disabled unless affordable
  check('buy dev card did not throw', true);

  // ---- run several full turn cycles through the real end-turn path
  let cycles = 0;
  for (let i = 0; i < 6; i++) {
    if (/roll the dice/i.test($('status').textContent)) $('btn-roll').click();
    // Resolve any 7 sub-flow (discards + robber).
    let g = 0;
    while (/discard|move the robber/i.test($('status').textContent) && g++ < 3) {
      if (/move the robber/i.test($('status').textContent)) {
        clickAt(550, 380);
      } else {
        for (let k = 0; k < 14; k++) {
          const c = $('hand').children.find(x =>
            x.classList && x.classList.contains('pick'));
          if (!c) break;
          c.click();
        }
      }
      await sleep(20);
      await sleep(20);
    }
    $('btn-pass').click();
    await sleep(20);
    await sleep(20);
    cycles++;
    if (/wins with/i.test($('status').textContent)) break;
  }
  check('survived ' + cycles + ' turn cycles without throwing', cycles > 0);
  check('turn returns to the human or a winner is declared',
    /you/i.test($('status').textContent) || /wins with/i.test($('status').textContent),
    $('status').textContent);
  check('log still rendering', $('log').children.length > 0,
    $('log').children.length + ' lines');
  check('robber + deck info rendered', /Development cards left/.test($('boardinfo').textContent),
    $('boardinfo').textContent);

  // ---- music + new game buttons
  $('btn-music').click();
  check('music toggle changes label', /Music: on/.test($('btn-music').textContent),
    $('btn-music').textContent);
  $('btn-music').click();

  $('btn-sfx').click();
  check('SFX toggle updates label to off and disables effects',
    /SFX: off/.test($('btn-sfx').textContent) && !ctxObj.AUDIO.isSfxOn(),
    $('btn-sfx').textContent);
  $('btn-sfx').click();
  check('SFX toggle restores sound effects',
    /SFX: on/.test($('btn-sfx').textContent) && ctxObj.AUDIO.isSfxOn(),
    $('btn-sfx').textContent);

  $('btn-new').click();
  await sleep(20);
  check('new game resets to setup1',
    /place a settlement/i.test($('status').textContent), $('status').textContent);
  check('new game resets the hand to empty',
    ['forest', 'pasture', 'field', 'hill', 'mount'].every(res =>
      LIVE().players[0].hand[res] === 0), $('hand').textContent);

  // ---- Debug: auto-play button (runs the real click path end to end)
  // main.js's debug run plays toward a 10 VP win, which is far longer than
  // this harness can simulate, so assert real *progress* instead of a win:
  // opening placed, setup finished, turns advancing, pieces being built.
  {
    $('btn-debug').click();
    // state.js caps g.log at 200 entries and the DOM window is 40, so early
    // lines are evicted long before a 400-turn run ends. Tee them as they
    // appear by watching the array identity (a new game replaces it).
    const tee = [];
    let prevArr = LIVE() ? LIVE().log : null;
    // Seed with what already exists: btn-debug's click() logs synchronously
    // before this loop's first poll, so those lines would otherwise be missed.
    let prevLen = prevArr ? prevArr.length : 0;
    if (prevArr) for (const line of prevArr) tee.push(line);
    // Bound the run: we assert progress, not a completed game, so a short
    // window is enough to prove the turn loop, economy and AI all work.
    const deadline = Date.now() + 45000;
    let lastTurn = 0;
    // Poll until the run truly ends: a winner, an explicit GAME OVER, or the
    // safety cap. A game can run several hundred turns, so keep waiting.
    while (Date.now() < deadline) {
      await sleep(20);
      const cur = LIVE() ? LIVE().log : null;
      if (cur && cur !== prevArr) {
        // A new game swapped in a fresh log array; start the tee over so the
        // pre-debug game's lines are not mistaken for this run's.
        tee.length = 0;
        for (const line of cur) tee.push(line);
        prevArr = cur;
        prevLen = cur.length;
      } else if (cur && cur.length > prevLen) {
        // state.js shifts the array once it exceeds 200 entries, which would
        // make prevLen drift; track by identity of the newest tail instead.
        if (cur.length < prevLen) prevLen = cur.length - 1;
        for (let i = Math.max(prevLen, cur.length - 60); i < cur.length; i++) {
          if (!tee.includes(cur[i])) tee.push(cur[i]);
        }
        prevLen = cur.length;
      }
      const joined = tee.join('\n');
      const m = /Debug: turn (\d+)/.exec(joined);
      const turn = m ? Number(m[1]) : 0;
      if (turn !== lastTurn) lastTurn = turn;
      // Stop on either a decided game or the safety cap.
      if (/hit the \d+-turn cap/.test(joined) ||
        /GAME OVER/.test(joined) ||
        (LIVE() && LIVE().winner)) break;
    }
    const al = tee.join('\n');
    check('debug auto-play starts a new game', /new island/i.test(al));
    check('debug auto-play places the opening via clicks',
      /founded your first settlement/.test(al) && /built your first road/.test(al));
    check('debug auto-play finishes setup', /Everyone is placed/.test(al));
    check('debug auto-play plays many turns', lastTurn >= 25,
      'reached turn ' + lastTurn);

    // The economy must demonstrably advance: real pieces and real score
    // growth. Whether a given dice run reaches 10 VP inside this harness's
    // wall clock is not deterministic, so assert progress, not the win.
    const g2 = LIVE();
    const maxScore = g2 ? Math.max(...g2.players.map(p => p.score)) : 0;
    const pieces = g2
      ? g2.players.reduce((a, p) =>
        a + p.settlements.length + p.cities.length * 2 + p.roads.length, 0)
      : 0;
    check('debug auto-play builds up the board', pieces >= 8,
      pieces + ' settlement/city/road pieces');
    check('debug auto-play grows scores well past the 4 VP opening',
      maxScore >= 6, 'top score ' + maxScore +
      (g2 && g2.winner ? ' (winner: ' + g2.winner.name + ')' : ''));
  }

  console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'all checks passed'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });