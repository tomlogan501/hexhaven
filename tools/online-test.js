// Room API and authoritative turn controller integration tests.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server');
const { Game, GameError } = require('../server/game');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', data, token) {
    const response = await fetch(base + path, { method,
      headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, value: await response.json() };
  }
  try {
    const made = await request('/api/rooms', 'POST', { name: 'Alice', radius: 2 });
    assert.equal(made.status, 201);
    const code = made.value.code, alice = made.value.token;
    const root = `/api/rooms/${code}`;
    const joined = await request(root + '/join', 'POST', { name: 'Bob' });
    assert.equal(joined.status, 201);
    const bob = joined.value.token;
    assert.equal((await request(root + '/state', 'GET', null, 'invalid')).status, 401);
    assert.equal((await request(root + '/join', 'POST', { name: 'Alice' })).status, 400);
    assert.equal((await request(root + '/start', 'POST', { version: joined.value.version }, bob)).status, 400);
    assert.equal((await request(root + '/start', 'POST', { version: made.value.version }, alice)).status, 409);
    let state = (await request(root + '/start', 'POST', { version: joined.value.version }, alice)).value;
    assert.equal(state.started, true);
    assert.equal((await request(root + '/join', 'POST', { name: 'Late' })).status, 400);
    const tokens = [alice, bob];
    assert.equal((await request(root + '/action', 'POST', { version: state.version, action: { type: 'roll' } }, bob)).status, 400);
    for (let pair = 0; pair < 4; pair++) {
      const g = state.game, pid = g.current;
      const vertex = g.map.vertices.find(v => v.owner === null && g.map.vertices.every(o => o.owner === null || v.hops[o.id] >= 2));
      let response = await request(root + '/action', 'POST', { version: state.version, action: { type: 'setup', kind: 'settlement', id: vertex.id } }, tokens[pid]);
      assert.equal(response.status, 200); state = response.value;
      const edge = state.game.map.edges.find(e => e.built === null && (e.a === vertex.id || e.b === vertex.id));
      response = await request(root + '/action', 'POST', { version: state.version, action: { type: 'setup', kind: 'road', id: edge.id } }, tokens[pid]);
      assert.equal(response.status, 200); state = response.value;
    }
    assert.equal(state.game.phase, 'roll');
    assert.deepEqual(state.game.players.map(p => [p.settlements.length, p.roads.length]), [[2, 2], [2, 2]]);
    assert.equal((await request(root + '/action', 'POST', { version: state.version, action: { type: 'end' } }, alice)).status, 400);
    const rolled = await request(root + '/action', 'POST', { version: state.version, action: { type: 'roll' } }, alice);
    assert.equal(rolled.status, 200);
    const otherView = await request(root + '/state', 'GET', null, bob);
    assert.equal(otherView.value.version, rolled.value.version);
    assert.deepEqual(otherView.value.game.map.tiles, rolled.value.game.map.tiles);
    assert.equal((await request(root + '/state', 'GET', null, alice)).status, 200); // same credential reconnects
    const another = await request('/api/rooms', 'POST', { name: 'Host', radius: 3 });
    const r2 = `/api/rooms/${another.value.code}`;
    const members = [];
    for (const name of ['One', 'Two', 'Three']) {
      const member = await request(r2 + '/join', 'POST', { name });
      assert.equal(member.status, 201); members.push(member.value);
    }
    assert.equal((await request(r2 + '/join', 'POST', { name: 'Five' })).status, 400);
    assert.equal((await request(r2 + '/leave', 'POST', {}, another.value.token)).status, 200);
    const promoted = await request(r2 + '/state', 'GET', null, members[0].token);
    assert.equal(promoted.value.host, true);
    assert.equal(promoted.value.playerId, 0);
    const fourth = await request(r2 + '/join', 'POST', { name: 'Four' });
    assert.equal(fourth.status, 201);
    const fourTokens = members.map(p => p.token).concat(fourth.value.token);
    let fourState = (await request(r2 + '/start', 'POST', { version: fourth.value.version }, fourTokens[0])).value;
    assert.equal(fourState.game.map.tiles.length, 37);
    for (let pair = 0; pair < 8; pair++) {
      const g = fourState.game, pid = g.current;
      const vertex = g.map.vertices.find(v => v.owner === null && g.map.vertices.every(o => o.owner === null || v.hops[o.id] >= 2));
      let result = await request(r2 + '/action', 'POST', { version: fourState.version, action: { type: 'setup', kind: 'settlement', id: vertex.id } }, fourTokens[pid]);
      assert.equal(result.status, 200); fourState = result.value;
      const edge = fourState.game.map.edges.find(e => e.built === null && (e.a === vertex.id || e.b === vertex.id));
      result = await request(r2 + '/action', 'POST', { version: fourState.version, action: { type: 'setup', kind: 'road', id: edge.id } }, fourTokens[pid]);
      assert.equal(result.status, 200); fourState = result.value;
    }
    assert.equal(fourState.game.phase, 'roll');
    assert.ok(fourState.game.players.every(p => p.settlements.length === 2 && p.roads.length === 2));
    console.log('PASS room creation, capacity, host transfer, authorization, 2–4 player setup, roll and synchronized views');

    // A fresh tab can recover its seat from browser storage after the game starts.
    const shared = new Map();
    const storage = map => ({ getItem: key => map.get(key) ?? null,
      setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) });
    function client() {
      const ctx = vm.createContext({ fetch, URL, AbortController, location: { origin: base },
        localStorage: storage(shared), sessionStorage: storage(new Map()),
        setTimeout: () => 1, clearTimeout: () => {} });
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'online.js'), 'utf8') +
        '\n;globalThis.transport = ONLINE;', ctx);
      let latest = null;
      ctx.transport.configure({ onState: state => { latest = state; }, onConnection: () => {},
        onError: () => {}, onExpired: () => {} });
      return { transport: ctx.transport, state: () => latest };
    }
    const host = client(), guest = client();
    await host.transport.create('', 'RecoverHost', 2);
    const recoveryCode = host.state().code;
    await guest.transport.join('', recoveryCode, 'RecoverBob');
    let started = await host.transport.start();
    if (!started) started = await host.transport.start(); // refresh after a stale lobby version
    assert.equal(started, true);
    guest.transport.suspend(false);
    const freshTab = client();
    await freshTab.transport.join('', recoveryCode, 'RecoverBob');
    assert.equal(freshTab.state().started, true);
    assert.equal(freshTab.state().playerId, 1);
    assert.equal(freshTab.state().players.length, 2);
    host.transport.suspend(false); freshTab.transport.suspend(false);
    console.log('PASS browser transport recovers a started game in a fresh tab');


    // Deterministic rule decisions and privacy checks on the same server controller.
    const game = new Game(['A', 'B', 'C'], 2, (() => { let n = 0; return () => ++n % 2 ? 3 : 4; })());
    const g = game.g;
    g.phase = 'roll'; g.players.forEach(p => { p.hand.forest = 8; });
    game.act(0, { type: 'roll' });
    assert.equal(g.discardTarget, 0);
    assert.throws(() => game.act(1, { type: 'discard', amounts: { forest: 4 } }), GameError);
    assert.throws(() => game.act(0, { type: 'discard', amounts: { forest: -4 } }), GameError);
    for (const id of [0, 1, 2]) game.act(id, { type: 'discard', amounts: { forest: 4 } });
    assert.equal(g.phase, 'robber');
    game.act(0, { type: 'robber', tile: `${g.map.tiles[0].q},${g.map.tiles[0].r}` });
    assert.equal(g.phase, 'build');
    g.players[0].hand.hill = 1; g.players[1].hand.field = 1;
    game.act(0, { type: 'offer', to: 1, give: { hill: 1 }, want: { field: 1 } });
    assert.throws(() => game.act(2, { type: 'respond', accept: true }), GameError);
    game.act(1, { type: 'respond', accept: true });
    assert.equal(g.players[0].hand.field, 1);
    assert.equal(g.players[1].hand.hill, 1);
    game.act(0, { type: 'offer', to: 1, give: { field: 1 }, want: { hill: 1 } });
    game.act(1, { type: 'respond', accept: false });
    assert.equal(g.players[0].hand.field, 1);
    g.players[1].devCards.push('victory');
    g.players[1].score = 1;
    const privateView = game.view(0);
    assert.equal(privateView.game.players[1].hand.hill, 0);
    assert.deepEqual(privateView.game.players[1].devCards, [null]);
    assert.equal(privateView.game.players[1].score, 0);
    assert.ok(privateView.game.deck.every(card => card === null));
    game.act(0, { type: 'end' });
    assert.equal(g.current, 1);
    assert.throws(() => game.act(0, { type: 'roll' }), GameError);
    g.phase = 'build';
    g.players[1].hand.forest = 4;
    assert.throws(() => game.act(1, { type: 'build', kind: 'road', id: -1 }), GameError);
    assert.throws(() => game.act(1, { type: 'maritime', give: 'forest', want: '__proto__' }), GameError);
    game.act(1, { type: 'maritime', give: 'forest', want: 'mount' });
    assert.equal(g.players[1].hand.forest, 0);
    assert.equal(g.players[1].hand.mount, 1);
    g.players[1].hand.field = 1; g.players[1].hand.mount = 1; g.players[1].hand.hill = 1;
    g.deck.push('knight');
    game.act(1, { type: 'buyDev' });
    assert.throws(() => game.act(1, { type: 'playDev', card: 'knight' }), GameError);
    assert.equal(g.players[1].devCards.at(-1), 'knight');
    const stealing = new Game(['A', 'B', 'C'], 2);
    const sg = stealing.g, tile = sg.map.tiles[0], key = `${tile.q},${tile.r}`;
    const nearby = sg.map.vertices.filter(v => v.tiles.includes(key));
    for (const [pid, vertex] of [[1, nearby[0]], [2, nearby[1]]]) {
      sg.players[pid].settlements.push(vertex.id); vertex.owner = pid; sg.players[pid].hand.forest = 1;
    }
    sg.phase = 'robber'; sg.robberFromSeven = true;
    stealing.act(0, { type: 'robber', tile: key });
    assert.deepEqual(Array.from(stealing.view(0).victims), [1, 2]);
    assert.equal(stealing.view(1).victims, null);
    assert.throws(() => stealing.act(0, { type: 'steal', victim: 0 }), GameError);
    stealing.act(0, { type: 'steal', victim: 2 });
    assert.equal(sg.players[0].hand.forest, 1);
    assert.equal(sg.players[2].hand.forest, 0);
    assert.equal(sg.phase, 'build');

    const building = new Game(['A', 'B'], 2);
    const bg = building.g, owner = bg.players[0], home = bg.map.vertices[0];
    bg.phase = 'build'; home.owner = 0; owner.settlements.push(home.id);
    Object.assign(owner.hand, { forest: 1, hill: 1, field: 2, mount: 3 });
    const road = bg.map.edges.find(edge => edge.a === home.id || edge.b === home.id);
    building.act(0, { type: 'build', kind: 'road', id: road.id });
    assert.equal(road.built, 0);
    assert.equal(owner.hand.forest, 0);
    building.act(0, { type: 'build', kind: 'city', id: home.id });
    assert.equal(home.city, true);
    assert.ok(owner.cities.includes(home.id));

    const winning = new Game(['A', 'B'], 2);
    winning.g.phase = 'build';
    winning.g.players[0].vpRevealed = 9;
    winning.g.players[0].devCards.push('victory');
    winning.act(0, { type: 'playDev', card: 'victory' });
    assert.equal(winning.g.phase, 'done');
    assert.equal(winning.g.winner.name, 'A');
    assert.throws(() => winning.act(0, { type: 'end' }), GameError);
    console.log('PASS discard, robber, building, trades, turn ownership, victory and private views');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
