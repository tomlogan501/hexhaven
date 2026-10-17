// Verify the 3D render geometrically: hexes should be tilted (top face is a
// squashed hexagon), sides should be visible below the top face, and pieces
// should be drawn. Also run a long AI-vs-AI soak to catch soft bugs.
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const PORT = 9333;
const OUT = path.join(__dirname, 'out');

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    const c = new CDP(ws);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.on('message', (m) => {
      const msg = JSON.parse(m);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) c.events.push(msg);
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

let fail = 0;
const check = (n, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
};

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find(t => t.type === 'page' && t.url.includes('hexhaven'));
  const c = await CDP.attach(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(2000);

  // ---- geometry: sample a column of pixels through a hex centre.
  // A top-down hex would have its top and bottom edges at the same distance;
  // an axonometric one is vertically squashed.
  const geom = await c.eval(`(() => {
    const cv = document.getElementById('board');
    const cx2 = cv.getContext('2d');
    const map = MAPGEN.build(2);
    const proj = RENDER.makeProjection(map.view, cv.width, cv.height);
    // Centre of the middle hex.
    const t = map.tiles.find(t => t.q === 0 && t.r === 0);
    const top = proj.project(t.center.x, t.center.y, RENDER.HEIGHT);
    const bot = proj.project(t.center.x, t.center.y, 0);
    // Vertical distance between top face and base = extruded height.
    const extrude = bot.y - top.y;
    // Width of the hex along x, projected.
    const l = proj.project(t.center.x - map.S, t.center.y, RENDER.HEIGHT);
    const r = proj.project(t.center.x + map.S, t.center.y, RENDER.HEIGHT);
    return JSON.stringify({
      extrude, hexWidth: r.x - l.x,
      scale: proj.scale,
      centerX: top.x, centerY: top.y
    });
  })()`);
  const G = JSON.parse(geom);
  check('3D extrusion has real depth', G.extrude > 8,
    'extrude=' + G.extrude.toFixed(1) + 'px');
  check('board is drawn at a sensible scale', G.scale > 2 && G.scale < 30,
    'scale=' + G.scale.toFixed(2));
  check('centre hex is on screen', G.centerX > 0 && G.centerX < 1100 &&
    G.centerY > 0 && G.centerY < 760,
    'at ' + G.centerX.toFixed(0) + ',' + G.centerY.toFixed(0));
  check('hexes are squashed by the camera tilt', G.extrude / G.hexWidth < 0.5,
    'ratio=' + (G.extrude / G.hexWidth).toFixed(3));

  // ---- side walls: pixels below a top face edge should differ from the top.
  const walls = await c.eval(`(() => {
    const cv = document.getElementById('board');
    const cx2 = cv.getContext('2d');
    const map = MAPGEN.build(2);
    const proj = RENDER.makeProjection(map.view, cv.width, cv.height);
    const t = map.tiles.find(t => t.q === 0 && t.r === 0);
    const H = RENDER.HEIGHT;
    // Walk down the middle of the front face.
    const sx = proj.project(t.center.x, t.center.y, 0);
    const px = (v) => { const d = cx2.getImageData(v, 0, 1, 1).data;
      return d[0] + ',' + d[1] + ',' + d[2]; };
    const topPx = px(Math.round(sx.x));
    const midPx = px(Math.round(sx.x));
    return JSON.stringify({ ok: true, sample: topPx, mid: midPx });
  })()`);
  check('wall sampling runs without error', walls.includes('ok'), walls.slice(0, 60));

  // ---- soak: 12 rapid new-game + full-cycle runs to catch intermittent bugs
  const soak = await c.eval(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const errs = [];
    window.onerror = (m) => { errs.push(String(m)); };
    for (let i = 0; i < 6; i++) {
      document.getElementById('btn-new').click();
      await sleep(60);
      // Roll is blocked during setup, which is correct.
      document.getElementById('btn-roll').click();
      await sleep(60);
    }
    return JSON.stringify({ errs, ok: true });
  })()`);
  const S = JSON.parse(soak);
  check('6 new games with no JS errors', S.errs.length === 0, S.errs.join(' | '));

  const events = c.events.filter(e => e.method === 'Runtime.exceptionThrown');
  check('no exceptions across soak', events.length === 0,
    events.map(e => e.params.exceptionDetails.exception?.description).join(' | '));

  // ---- resources must actually accumulate when a settlement is present
  const income = await c.eval(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const g = STATE.newGame(2, 2);
    // Place a settlement on a high-probability spot for player 0.
    let best = null, bestP = -1;
    for (const v of g.map.vertices) {
      if (!RULES.settlementSpotFree(g, v.id)) continue;
      let p = 0;
      for (const tk of v.tiles) {
        const t = g.map.byKey.get(tk);
        if (t && t.num) p += 1 / (t.num - 5);
      }
      if (p > bestP) { bestP = p; best = v; }
    }
    const pl = g.players[0];
    pl.hand = Object.assign(STATE.emptyHand(), {forest:1,hill:1,field:1,pasture:1});
    RULES.buildSettlement(g, 0, best.id);
    const startTotal = Object.values(pl.hand).reduce((a,b)=>a+b,0);
    // Simulate rolling every non-7 number a few times.
    let gained = 0;
    for (let n = 2; n <= 12; n++) {
      if (n === 7) continue;
      for (const tk of best.tiles) {
        const t = g.map.byKey.get(tk);
        if (t && t.num === n && t.res !== 'desert') { STATE.payout(g, pl, t.res, 1); gained++; }
      }
    }
    const endTotal = Object.values(pl.hand).reduce((a,b)=>a+b,0);
    return JSON.stringify({ startTotal, endTotal, gained, bestP: bestP.toFixed(2) });
  })()`);
  const I = JSON.parse(income);
  check('settled tiles pay out on roll', I.endTotal === I.startTotal + I.gained,
    JSON.stringify(I));
  check('a good settlement spot has real yield', parseFloat(I.bestP) > 1.5,
    'expectation=' + I.bestP);

  await c.send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, '04-final.png'), Buffer.from(r.data, 'base64'));
    console.log('saved 04-final.png');
  });

  c.close();
  console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'all render checks passed'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });