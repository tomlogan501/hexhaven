// Click the debug button and watch the log.
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const PORT = 9333;
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  close() { this.ws.close(); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = list.find(t => t.type === 'page' && t.url.includes('hexhaven'));
  const c = await CDP.attach(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(2000);

  // Click the debug button
  await c.eval(`document.getElementById('btn-debug').click(); true`);
  console.log('Clicked debug button, waiting...');

  // Wait for it to complete, polling the log
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const log = await c.eval(`document.getElementById('log').textContent`);
    const status = await c.eval(`document.getElementById('status').textContent`);
    const busy = await c.eval(`!!window.busy || document.getElementById('btn-debug').disabled`);
    console.log(`  [${i+1}s] busy=${busy} status="${status.slice(0,50)}" logLines=${log.split('\\n').length}`);
    if (log.includes('Debug: auto-play complete')) {
      console.log('DEBUG COMPLETE');
      break;
    }
    if (log.includes('Debug: failed')) {
      console.log('DEBUG FAILED');
      break;
    }
  }

  const finalLog = await c.eval(`document.getElementById('log').textContent`);
  console.log('\n=== FINAL LOG ===');
  console.log(finalLog);

  const events = c.events.filter(e => e.method === 'Runtime.exceptionThrown');
  if (events.length) {
    console.log('\n=== EXCEPTIONS ===');
    for (const e of events) console.log(e.params.exceptionDetails.exception?.description);
  }

  await c.send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(__dirname, 'out', 'debug-run.png'), Buffer.from(r.data, 'base64'));
    console.log('\nsaved debug-run.png');
  });

  c.close();
})().catch(e => { console.error('FATAL', e); process.exit(2); });