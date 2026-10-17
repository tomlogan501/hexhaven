// Headless rules + AI test. Run: node tools/game-test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'js');
const ctx = { console, Math, setTimeout: () => 0, window: {} };
vm.createContext(ctx);

const EXPORTS = {
  'hex.js': 'HEX', 'map.js': 'MAPGEN', 'state.js': 'STATE',
  'rules.js': 'RULES', 'ai.js': 'AI',
};
for (const [f, name] of Object.entries(EXPORTS)) {
  const code = fs.readFileSync(path.join(base, f), 'utf8');
  vm.runInContext(code + `\n;globalThis.${name} = ${name};`, ctx, { filename: f });
}

let fail = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
};

const g = ctx.STATE.newGame(2, 2);
const map = g.map;
void map;

// Give both players resources so cost checks are not the thing under test.
for (const p of g.players) {
  Object.assign(p.hand, { forest: 20, pasture: 20, field: 20, hill: 20, mount: 20 });
}

// First settlement anywhere it is legal.
let spot = null;
for (const v of map.vertices) {
  if (ctx.RULES.settlementSpotFree(g, v.id)) { spot = v; break; }
}
check('a legal opening spot exists', !!spot);
ctx.RULES.buildSettlement(g, 0, spot.id);
check('settlement marked owned', map.vertices[spot.id].owner === 0);
// The spot is random, so assert the invariant (cost paid, 3 tiles gained)
// rather than which resources happened to be adjacent.
{
  const p = g.players[0];
  const total = Object.values(p.hand).reduce((a, b) => a + b, 0);
  // Hand starts at 100 (5 resources x 20). A settlement costs 4 and collects
  // from each adjacent numbered tile, so the desert reduces the payout.
  const deserts = spot.tiles.filter(tk => g.map.byKey.get(tk).res === 'desert').length;
  const expected = 100 - 4 + (3 - deserts);
  check('settlement costs 4, yields one card per numbered tile',
    total === expected, 'expected=' + expected + ' got=' + total + ' deserts=' + deserts);
  check('at most one desert on the map',
    g.map.tiles.filter(t => t.res === 'desert').length === 1);
}

// The distance rule must now block every neighbour of that spot.
let blocked = 0;
for (const nid of spot.adj) {
  if (!ctx.RULES.settlementSpotFree(g, nid)) blocked++;
}
check('adjacent spots blocked (2-edge rule)', blocked === spot.adj.length,
  blocked + '/' + spot.adj.length);

// A road from the settlement is legal; a far-away road is not.
let near = null, far = null;
for (const e of map.edges) {
  if (e.a === spot.id || e.b === spot.id) { near = e; break; }
}
for (const e of map.edges) {
  if (e.a !== spot.id && e.b !== spot.id && e.built === null) { far = e; break; }
}
check('road from own settlement allowed', ctx.RULES.roadBuildable(g, 0, near.id));
check('disconnected road refused', !ctx.RULES.roadBuildable(g, 0, far.id));

// Road costs 1 forest + 1 hill: snapshot the hand around the call.
{
  const p = g.players[0];
  const before = { ...p.hand };
  ctx.RULES.buildRoad(g, 0, near.id);
  check('road costs 1 wood + 1 brick',
    p.hand.forest === before.forest - 1 && p.hand.hill === before.hill - 1,
    'forest ' + before.forest + '->' + p.hand.forest +
    ', hill ' + before.hill + '->' + p.hand.hill);
  check('road deducted from other resources not at all',
    p.hand.field === before.field && p.hand.pasture === before.pasture &&
    p.hand.mount === before.mount);
}

// Cannot build the same road twice.
check('road cannot be built twice', !ctx.RULES.roadBuildable(g, 0, near.id));

// City upgrade: settlement becomes city, score +1.
const before = ctx.RULES.scoreOf(g, g.players[0]);
ctx.RULES.buildCity(g, 0, spot.id);
const after = ctx.RULES.scoreOf(g, g.players[0]);
check('city upgrade raises score by 1', after === before + 1, before + ' -> ' + after);
check('city flags vertex', map.vertices[spot.id].city === true);
check('settlement list no longer holds the vertex',
  !g.players[0].settlements.includes(spot.id));

// Longest road on a single connected segment is 1.
check('longest road counts the single segment', g.longest.length === 1,
  'len=' + g.longest.length);

// ---- longest road: build a chain and confirm it is counted
{
  const g2 = ctx.STATE.newGame(2, 2);
  for (const p of g2.players) {
    Object.assign(p.hand, { forest: 50, pasture: 50, field: 50, hill: 50, mount: 50 });
  }
  const v0 = g2.map.vertices.find(v => ctx.RULES.settlementSpotFree(g2, v.id));
  ctx.RULES.buildSettlement(g2, 0, v0.id);
  // Walk outward, always taking an unbuilt edge from the frontier.
  const built = new Set();
  const usedV = new Set([v0.id]);
  for (let step = 0; step < 5; step++) {
    let done = false;
    for (const e of g2.map.edges) {
      if (e.built !== null) { continue; }
      const aOk = usedV.has(e.a), bOk = usedV.has(e.b);
      if (!aOk && !bOk) continue;
      const other = aOk ? e.b : e.a;
      if (usedV.has(other)) continue;
      // Settlement spacing only blocks settlements, not roads.
      ctx.RULES.buildRoad(g2, 0, e.id);
      built.add(e.id);
      usedV.add(other);
      done = true;
      break;
    }
    if (!done) break;
  }
  check('5-road chain counted', g2.longest.length === 5, 'len=' + g2.longest.length);
  check('longest road holder is the builder', g2.longest.player === 0);
}

// ---- AI: it must actually build something legal
{
  const g3 = ctx.STATE.newGame(2, 2);
  g3.current = 1;
  for (const p of g3.players) {
    Object.assign(p.hand, { forest: 15, pasture: 15, field: 15, hill: 15, mount: 15 });
  }
  const ai = g3.players[1];
  const s = ctx.AI.bestSettlement(g3, 1);
  check('AI finds a settlement spot', !!s);
  if (s) {
    check('AI spot is legal', ctx.RULES.settlementSpotFree(g3, s.id));
    ctx.RULES.buildSettlement(g3, 1, s.id);
    const r = ctx.AI.bestRoad(g3, 1);
    check('AI finds a road after settling', !!r);
    check('AI road is legal', r ? ctx.RULES.roadBuildable(g3, 1, r.id) : false);
  }
  void ai;
}

// ---- AI-to-AI player trades are reciprocal and logged
{
  const gTrade = ctx.STATE.newGame(3, 2);
  for (const p of gTrade.players) p.hand = ctx.STATE.emptyHand();
  gTrade.players[1].hand.pasture = 1;
  gTrade.players[2].hand.forest = 1;
  const before = gTrade.log.length;
  check('AI trades a needed resource with another AI', ctx.AI.tradeWithAI(gTrade, 1));
  check('AI trade transfers both resources',
    gTrade.players[1].hand.forest === 1 && gTrade.players[1].hand.pasture === 0 &&
    gTrade.players[2].hand.forest === 0 && gTrade.players[2].hand.pasture === 1);
  check('AI trade offer and acceptance are logged',
    gTrade.log.length > before &&
    gTrade.log.some(line => /Mira offered 1 Sheep to Tomas for 1 Wood/.test(line)) &&
    gTrade.log.some(line => /Mira traded 1 Sheep to Tomas for 1 Wood/.test(line)),
    gTrade.log.slice(before).join(' | '));

  const gDecline = ctx.STATE.newGame(3, 2);
  for (const p of gDecline.players) p.hand = ctx.STATE.emptyHand();
  gDecline.players[1].hand.forest = 1;
  gDecline.players[2].hand.forest = 1;
  ctx.AI.tradeWithAI(gDecline, 1);
  check('AI trade refusals and final no-trade status are logged',
    gDecline.log.some(line => /declined/.test(line)) &&
    gDecline.log.some(line => /completed no player trade this turn/.test(line)),
    gDecline.log.join(' | '));
}

// ---- resources: paying more than you hold must be refused
{
  const g4 = ctx.STATE.newGame(2, 2);
  const p = g4.players[0];
  p.hand = ctx.STATE.emptyHand();
  check('cannot afford road with empty hand', !ctx.RULES.canAfford(p, 'road'));
  check('cannot afford settlement with empty hand', !ctx.RULES.canAfford(p, 'settlement'));
  p.hand = { forest: 1, hill: 1, field: 1, pasture: 1, mount: 0 };
  check('can afford settlement', ctx.RULES.canAfford(p, 'settlement'));
  check('cannot afford city (needs 3 ore)', !ctx.RULES.canAfford(p, 'city'));
  p.hand.mount = 3; p.hand.field = 2;
  check('can afford city with 2 grain + 3 ore', ctx.RULES.canAfford(p, 'city'));
}

// ---- scoring: 10 points wins
{
  const g5 = ctx.STATE.newGame(2, 2);
  g5.players[0].cities = [0, 1, 2, 3, 4];
  ctx.RULES.refreshScores(g5);
  check('five cities = 10 points', g5.players[0].score === 10, 'score=' + g5.players[0].score);
  check('winner detected', ctx.RULES.checkWinner(g5) !== null);
  check('phase set to done', g5.phase === 'done');
}

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'all checks passed'));
process.exit(fail ? 1 : 0);
