// Drive Brave over CDP: load the page, collect console errors, probe state,
// simulate a full turn, and screenshot.
const fs = require('fs');
const path = require('path');

const PORT = 9333;
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  return r.json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async attach(wsUrl) {
    const { WebSocket } = require('ws');
    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    const c = new CDP(ws);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.on('message', (m) => {
      const msg = JSON.parse(m);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        c.events.push(msg);
      }
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description ||
        r.exceptionDetails.text));
    }
    return r.result.value;
  }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await targets();
  const page = list.find(t => t.type === 'page' && t.url.includes('hexhaven'));
  if (!page) throw new Error('hexhaven page not found');
  const c = await CDP.attach(page.webSocketDebuggerUrl);

  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(2500);

  let fail = 0;
  const check = (name, cond, extra) => {
    console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
    if (!cond) fail++;
  };

  // ---- console errors / exceptions
  const errs = c.events
    .filter(e => e.method === 'Runtime.exceptionThrown')
    .map(e => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  const consoleErrs = c.events
    .filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
    .map(e => e.params.args.map(a => a.description || a.value).join(' '));
  const logErrs = c.events
    .filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map(e => e.params.entry.text + ' @ ' + (e.params.entry.url || ''));

  check('no uncaught exceptions', errs.length === 0, errs.join(' | '));
  check('no console.error calls', consoleErrs.length === 0, consoleErrs.join(' | '));
  check('no error log entries', logErrs.length === 0, logErrs.join(' | '));

  // ---- modules loaded
  const mods = await c.eval(`JSON.stringify({
    hex: typeof HEX, map: typeof MAPGEN, state: typeof STATE,
    rules: typeof RULES, render: typeof RENDER, ai: typeof AI,
    audio: typeof AUDIO
  })`);
  check('all modules defined', Object.values(JSON.parse(mods)).every(v => v !== 'undefined'), mods);

  // ---- canvas actually painted something
  const painted = await c.eval(`(() => {
    const cv = document.getElementById('board');
    const cx = cv.getContext('2d');
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const seen = new Set();
    let nonBg = 0;
    for (let i = 0; i < d.length; i += 4) {
      const k = d[i] + ',' + d[i+1] + ',' + d[i+2];
      seen.add(k);
      if (d[i] > 40 || d[i+1] > 50 || d[i+2] > 60) nonBg++;
    }
    return JSON.stringify({ colors: seen.size, nonBg, w: cv.width, h: cv.height });
  })()`);
  const p = JSON.parse(painted);
  check('canvas has many distinct colours (board drawn)', p.colors > 40,
    'colors=' + p.colors);
  check('canvas is not mostly background', p.nonBg > 20000, 'lit=' + p.nonBg);

  // ---- UI populated
  const ui = await c.eval(`JSON.stringify({
    players: document.querySelectorAll('#players .player').length,
    handChips: document.querySelectorAll('#hand .res').length,
    logLines: document.querySelectorAll('#log div').length,
    buildBtns: document.querySelectorAll('[data-build]').length,
    music: !!document.getElementById('btn-music'),
    newGame: !!document.getElementById('btn-new'),
    roll: !!document.getElementById('btn-roll')
  })`);
  const u = JSON.parse(ui);
  check('2 player rows rendered', u.players === 2, 'got ' + u.players);
  check('5 resource chips rendered', u.handChips === 5, 'got ' + u.handChips);
  check('log has entries', u.logLines > 0, 'got ' + u.logLines);
  check('3 build buttons', u.buildBtns === 3, 'got ' + u.buildBtns);
  check('music + new game + roll buttons present', u.music && u.newGame && u.roll);

  await c.send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, '01-initial.png'), Buffer.from(r.data, 'base64'));
    console.log('saved 01-initial.png');
  });

  // ---- play the human's opening: settlement + road via real clicks
  const playOpening = await c.eval(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const cv = document.getElementById('board');
    const rect = cv.getBoundingClientRect();
    const log = [];
    async function sweep(want) {
      for (let gx = 0.12; gx <= 0.92; gx += 0.015) {
        for (let gy = 0.12; gy <= 0.92; gy += 0.015) {
          const x = rect.left + rect.width * gx;
          const y = rect.top + rect.height * gy;
          cv.dispatchEvent(new MouseEvent('click', {clientX: x, clientY: y, bubbles: true}));
          await sleep(0);
          if (document.getElementById('log').textContent.includes(want)) return true;
        }
      }
      return false;
    }
    if (await sweep('You founded your first settlement')) log.push('settlement placed');
    document.querySelector('[data-build="road"]').click();
    if (await sweep('You built your first road')) log.push('road placed');
    return JSON.stringify(log);
  })()`);
  console.log('   opening: ' + playOpening);
  check('human placed an opening settlement', /settlement placed/.test(playOpening), playOpening);
  check('human placed an opening road', /road placed/.test(playOpening), playOpening);

  // Score should be 1 after founding a settlement.
  const scoreAfter = await c.eval(
    `document.querySelector('#players .player.active .score').textContent`);
  check('settlement scores 1 victory point', /1 vp/.test(scoreAfter), scoreAfter);

  await c.send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, '01b-opening.png'), Buffer.from(r.data, 'base64'));
    console.log('saved 01b-opening.png');
  });

  // ---- end setup, AI places its opening, then roll
  await c.eval(`document.getElementById('btn-pass').click(); true`);
  await sleep(2500);
  const setupDone = await c.eval(`document.getElementById('log').textContent`);
  check('AI placed its opening', /Mira founded/.test(setupDone), setupDone.slice(-140));

  await c.eval(`document.getElementById('btn-roll').click(); true`);
  await sleep(400);
  const afterRoll = await c.eval(`document.getElementById('rollresult').textContent`);
  check('dice roll produced a result', /rolled \d/.test(afterRoll), afterRoll);

  // ---- now try to build during the build phase
  const playBuild = await c.eval(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const cv = document.getElementById('board');
    const rect = cv.getBoundingClientRect();
    const out = [];
    for (const tool of ['settlement', 'road']) {
      document.querySelector('[data-build="' + tool + '"]').click();
      let done = false;
      for (let gx = 0.12; gx <= 0.92 && !done; gx += 0.02) {
        for (let gy = 0.12; gy <= 0.92 && !done; gy += 0.02) {
          const before = document.getElementById('log').textContent.length;
          cv.dispatchEvent(new MouseEvent('click', {
            clientX: rect.left + rect.width * gx,
            clientY: rect.top + rect.height * gy, bubbles: true }));
          await sleep(0);
          const after = document.getElementById('log').textContent;
          if (after.length > before) { out.push(tool + ' ok'); done = true; }
        }
      }
      if (!done) out.push(tool + ' nothing');
    }
    return JSON.stringify(out);
  })()`);
  console.log('   build phase: ' + playBuild);

  // ---- end turn, let the AI move
  await c.eval(`document.getElementById('btn-pass').click(); true`);
  await sleep(3000);
  const afterAI = await c.eval(`JSON.stringify({
    log: document.getElementById('log').textContent,
    status: document.getElementById('status').textContent,
    active: (document.querySelector('#players .player.active') || {}).textContent || ''
  })`);
  const a = JSON.parse(afterAI);
  check('AI took its turn', /Mira/.test(a.log), a.log.slice(-120));
  check('turn returned to the human', /You/.test(a.active) || /You/.test(a.status),
    'active=' + a.active + ' status=' + a.status);

  await c.send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, '02-after-turn.png'), Buffer.from(r.data, 'base64'));
    console.log('saved 02-after-turn.png');
  });

  // ---- play several AI cycles to shake out crashes
  let cycles = 0;
  for (let i = 0; i < 4; i++) {
    await c.eval(`document.getElementById('btn-pass').click(); true`).catch(() => {});
    await sleep(2200);
    cycles++;
  }
  const late = c.events.filter(e => e.method === 'Runtime.exceptionThrown');
  check('no exceptions after ' + cycles + ' turn cycles', late.length === 0,
    late.map(e => e.params.exceptionDetails.exception?.description).join(' | '));

  const final = await c.eval(`JSON.stringify({
    scores: [...document.querySelectorAll('#players .player')].map(r => r.textContent),
    logLines: document.querySelectorAll('#log div').length
  })`);
  console.log('   final: ' + final);

  await c.send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, '03-late.png'), Buffer.from(r.data, 'base64'));
    console.log('saved 03-late.png');
  });

  // ---- audio module responds to toggle without throwing
  const audio = await c.eval(`(() => {
    try {
      const b = document.getElementById('btn-music');
      b.click();
      const on = b.textContent;
      b.click();
      return JSON.stringify({ ok: true, on, off: b.textContent });
    } catch (e) { return JSON.stringify({ ok: false, err: String(e) }); }
  })()`);
  const au = JSON.parse(audio);
  check('music toggle works', au.ok && /on/.test(au.on), JSON.stringify(au));

  c.close();
  console.log('\n' + (fail ? fail + ' BROWSER CHECK(S) FAILED' : 'all browser checks passed'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
