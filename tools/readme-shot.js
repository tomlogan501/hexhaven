// Capture README/verification screenshots: headless browser, open the game,
// run the debug auto-play so the board shows pieces, then capture the board,
// the principal menu, the rules & objectives panel and a French switch.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9337;
const OUT = path.join('docs');
const exe = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const PAGE = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
fs.mkdirSync(OUT, { recursive: true });

async function targets() { return (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); }

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async attach(wsUrl) {
    // Node >= 22 ships a global WebSocket; no dependency needed.
    const ws = new WebSocket(wsUrl);
    const c = new CDP(ws);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
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
    return r.result ? r.result.value : undefined;
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const br = spawn(exe, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--window-size=1180,760', '--disable-gpu', 'about:blank',
  ], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(250);
    try { page = (await targets()).find(t => t.type === 'page'); } catch { /* retry */ }
  }
  if (!page) throw new Error('no browser target');
  const c = await CDP.attach(page.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride',
    { width: 1180, height: 760, deviceScaleFactor: 1, mobile: false });

  await c.send('Page.navigate', { url: PAGE });
  await sleep(1200);

  // The principal menu auto-opens at boot; capture it as the title screen,
  // then close it to reach the board.
  fs.writeFileSync('docs/menu-boot.tmp.png',
    Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await c.eval(`(function(){
    const o = document.getElementById('optoverlay');
    if (o && o.classList.contains('open')) o.classList.remove('open');
    return true;
  })()`);
  await sleep(400);

  // Open the collapsible resource-graph window (bottom-right) so the debug
  // run fills it with data; plot wood specifically.
  await c.eval(`(function(){
    const w = document.getElementById('hud-graph');
    if (w) w.classList.remove('hidden');
    const s = document.getElementById('graph-res');
    if (s) { s.value = 'forest'; s.dispatchEvent(new Event('change')); }
    return true;
  })()`);
  await sleep(300);

  // Start a fresh game, then let the debug auto-play build a real board.
  await c.eval(`(function(){ const n = document.getElementById('btn-new'); if (n) n.click(); return !!n; })()`);
  await sleep(1200);
  // The new-game dialog may ask for opponents/board size — accept defaults.
  await c.eval(`(function(){
    const ok = [...document.querySelectorAll('.modal button, .dialog button, form button')]
      .find(b => /start|new|ok|play/i.test(b.textContent));
    if (ok) ok.click();
    return ok ? ok.textContent.trim() : null;
  })()`);
  await sleep(1500);

  // Let the debug auto-play build a real board, then freeze it.
  await c.eval(`(function(){ const d = document.getElementById('btn-debug'); if (d) d.click(); return !!d; })()`);
  await sleep(9000);
  await c.eval('(function(){ const d = document.getElementById("btn-debug"); if (d) d.disabled = true; return true; })()');
  await sleep(400);

  fs.writeFileSync('docs/screenshot.tmp.png',
    Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  // Capture the principal menu open.
  await c.eval('(function(){ const b = document.getElementById("btn-menu"); if (b) b.click(); return true; })()');
  await sleep(500);
  fs.writeFileSync('docs/overlay.tmp.png',
    Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  // Rules & objectives panel over the menu.
  await c.eval('(function(){ const b = document.getElementById("btn-rules"); if (b) b.click(); return true; })()');
  await sleep(500);
  fs.writeFileSync('docs/rules.tmp.png',
    Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await c.eval('(function(){ const b = document.getElementById("btn-rules-ok"); if (b) b.click(); return true; })()');
  await sleep(300);

  // Switch the menu to French, capture, then restore English.
  await c.eval(`(function(){
    const s = document.getElementById('lang');
    if (!s) return false;
    s.value = 'fr';
    s.dispatchEvent(new Event('change'));
    return true;
  })()`);
  await sleep(500);
  fs.writeFileSync('docs/menu-fr.tmp.png',
    Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await c.eval(`(function(){
    const s = document.getElementById('lang');
    s.value = 'en';
    s.dispatchEvent(new Event('change'));
    const o = document.getElementById('optoverlay');
    if (o) o.classList.remove('open');
    return true;
  })()`);
  await sleep(600);
  fs.writeFileSync('docs/screenshot.tmp.png',
    Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  br.kill();
  console.log('shot saved');
})().catch(e => { console.error(e); process.exit(1); });
