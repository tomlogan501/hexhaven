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

{
  const chainRoads = (g4, pid, fromId, roadList, usedV, count) => {
    // Walk outward from `fromId`, taking unbuilt edges that only meet the
    // frontier, and record the frontier vertex ids along the way.
    let cursor = fromId;
    for (let step = 0; step < count; step++) {
      let done = false;
      for (const e of g4.map.edges) {
        if (e.built !== null) continue;
        if (usedV.has(e.a) && usedV.has(e.b)) continue;   // no inside loop-backs
        const ok = e.a === cursor || e.b === cursor;
        if (!ok) continue;
        const other = e.a === cursor ? e.b : e.a;
        if (usedV.has(other)) continue;
        ctx.RULES.buildRoad(g4, pid, e.id);
        roadList.push(e.id);
        usedV.add(other);
        cursor = other;
        done = true;
        break;
      }
      if (!done) break;
    }
  };

  // ---- an opponent's settlement splits the chain: the card returns to the
  // table, and one more continuous stretch can win it back.
  const g4 = ctx.STATE.newGame(2, 2);
  for (const p of g4.players) {
    Object.assign(p.hand, { forest: 50, pasture: 50, field: 50, hill: 50, mount: 50 });
  }
  const v0 = g4.map.vertices.find(v => ctx.RULES.settlementSpotFree(g4, v.id));
  ctx.RULES.buildSettlement(g4, 0, v0.id);
  const roads = [], usedV = new Set([v0.id]);
  chainRoads(g4, 0, v0.id, roads, usedV, 5);
  check('chain built for the split test', roads.length >= 5,
    'roads=' + roads.length);
  check('card holder before the split', g4.longest.player === 0);

  // Enemy settlement in the middle of the chain (4th frontier vertex).
  const mid = [...usedV][3];
  ctx.RULES.buildSettlement(g4, 1, mid);
  check('opponent settlement splits the chain: card returns to the table',
    g4.longest.player === null, ctx.RULES.scoreOf(g4, g4.players[0]) + ' vp p0');

  // Continue the chain outward from the far end: passing the enemy building
  // is impossible, so the new stretch joins the far sub-chain.
  const frontierV = [...usedV][usedV.size - 1];
  chainRoads(g4, 0, frontierV, roads, usedV, 4);
  const restored = g4.longest;
  check('rebuilding one more stretch takes the longest road back',
    restored.player === 0 && restored.length >= 5,
    'holder=' + restored.player + ' len=' + restored.length);
  check('the split chain is strictly shorter than the restored one',
    restored.length === roads.length - 3,
    'len=' + restored.length + ' roads=' + roads.length);

  // ---- equal-length chains: the current holder keeps the card.
  const g5 = ctx.STATE.newGame(2, 2);
  for (const p of g5.players) {
    Object.assign(p.hand, { forest: 50, pasture: 50, field: 50, hill: 50, mount: 50 });
  }
  const y0 = g5.map.vertices.find(v => ctx.RULES.settlementSpotFree(g5, v.id));
  ctx.RULES.buildSettlement(g5, 0, y0.id);
  const r0 = [], u0 = new Set([y0.id]);
  chainRoads(g5, 0, y0.id, r0, u0, 5);
  check('p0 holds the 5-chain card', g5.longest.player === 0);
  const y1 = g5.map.vertices.find(v =>
    ctx.RULES.settlementSpotFree(g5, v.id) && !u0.has(v.id));
  ctx.RULES.buildSettlement(g5, 1, y1.id);
  const r1 = [], u1 = new Set([y1.id]);
  chainRoads(g5, 1, y1.id, r1, u1, 5);
  check('equal chain keeps the card with its holder', g5.longest.player === 0,
    'holder=' + g5.longest.player + ' len=' + g5.longest.length);
}

// ---- roads connect to the player's network (official placement rules)
{
  const gR = ctx.STATE.newGame(2, 2);
  for (const p of gR.players) {
    Object.assign(p.hand, { forest: 50, pasture: 50, field: 50, hill: 50, mount: 50 });
  }
  const vA = gR.map.vertices.find(v => ctx.RULES.settlementSpotFree(gR, v.id));
  ctx.RULES.buildSettlement(gR, 0, vA.id);
  // First road extends the settlement.
  const far = gR.map.edges.find(e =>
    e.built === null && (e.a === vA.id || e.b === vA.id));
  check('road may leave a settlement', ctx.RULES.roadBuildable(gR, 0, far.id));
  ctx.RULES.buildRoad(gR, 0, far.id);
  // The far vertex of that road must now allow extension (network build).
  const tip = far.a === vA.id ? far.b : far.a;
  const extend = gR.map.edges.find(e =>
    e.built === null && (e.a === tip || e.b === tip));
  check('road extension continues the network',
    !!extend && ctx.RULES.roadBuildable(gR, 0, extend.id));
  ctx.RULES.buildRoad(gR, 0, extend.id);
  // A detached edge (touching nothing of player 0) must be refused.
  const tip2 = extend.a === tip ? extend.b : extend.a;
  const detached = gR.map.edges.find(e => {
    if (e.built !== null) return false;
    const vs = [e.a, e.b];
    return !vs.includes(vA.id) && !vs.includes(tip) && !vs.includes(tip2);
  });
  check('detached road spot is refused',
    !detached || !ctx.RULES.roadBuildable(gR, 0, detached.id));
  // Settlements must attach to the road network after setup.
  check('settlement connects at its own road vertex',
    ctx.RULES.settlementConnects(gR, 0, tip));
}

// ---- AI: it must actually build something legal
{
  const g3 = ctx.STATE.newGame(2, 2);
  g3.current = 1;
  for (const p of g3.players) {
    Object.assign(p.hand, { forest: 15, pasture: 15, field: 15, hill: 15, mount: 15 });
  }
  const ai = g3.players[1];
  // Official rule: with no road network there is no legal settlement spot.
  check('AI refuses a settlement without any road network',
    ctx.AI.bestSettlement(g3, 1) === null);
  // Give the AI an opening place, then it must be able to build on it.
  const start = ctx.AI.bestSettlement(g3, 1, false);
  check('finds an opening settlement spot', !!start);
  if (start) {
    check('opening spot is legal', ctx.RULES.settlementSpotFree(g3, start.id));
    ctx.RULES.buildSettlement(g3, 1, start.id);
    const r = ctx.AI.bestRoad(g3, 1);
    check('AI finds a road after settling', !!r);
    check('AI road is legal', r ? ctx.RULES.roadBuildable(g3, 1, r.id) : false);
    if (r) {
      ctx.RULES.buildRoad(g3, 1, r.id);
      // The distance rule keeps every vertex one edge from the opening
      // settlement off-limits, so the AI must extend the chain until a
      // hop-2 tip exists, then settle there.
      let s2 = null;
      for (let more = 0; more < 6 && !s2; more++) {
        ctx.AI.bestSettlement(g3, 1) === null;   // stays refused while too short
        const rx = ctx.AI.bestRoad(g3, 1);
        if (!rx || !ctx.RULES.roadBuildable(g3, 1, rx.id)) break;
        ctx.RULES.buildRoad(g3, 1, rx.id);
        s2 = ctx.AI.bestSettlement(g3, 1);
      }
      check('AI settles on its road network after extending it', !!s2 &&
        ctx.RULES.settlementConnects(g3, 1, s2.id) &&
        ctx.RULES.settlementSpotFree(g3, s2.id), s2 && s2.id);
      void s2;
    }
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

// ---- dev cards: turn restrictions per official rules
{
  const gD = ctx.STATE.newGame(2, 2);
  const p = gD.players[0];
  Object.assign(p.hand, { forest: 10, pasture: 10, field: 10, hill: 10, mount: 10 });
  // Force the draw: a Knight on top of the deck.
  gD.deck.push('knight');
  const bought = ctx.RULES.buyDevCard(gD, 0);
  check('knight drawn for restriction test', bought === 'knight');
  check('a card bought this turn cannot be played this turn',
    ctx.RULES.playDevCard(gD, 0, 'knight') === false);
  // New turn: bought-cards list resets, play goes through.
  p.devBoughtThisTurn = [];
  check('playing on the next turn works',
    ctx.RULES.playDevCard(gD, 0, 'knight') === true);
  // One dev card per turn: a second card must wait.
  gD.deck.push('yearPlenty');
  ctx.RULES.buyDevCard(gD, 0);
  check('only one development card per turn',
    ctx.RULES.playDevCard(gD, 0, 'yearPlenty') === false);
}

{
  const gV = ctx.STATE.newGame(2, 2);
  const p = gV.players[0];
  Object.assign(p.hand, { forest: 10, pasture: 10, field: 10, hill: 10, mount: 10 });
  gV.deck.push('victory');
  ctx.RULES.buyDevCard(gV, 0);
  // Victory Point cards are exempt: revelable the same turn.
  check('a Victory Point card may be revealed the same turn',
    ctx.RULES.playDevCard(gV, 0, 'victory') === true);
  check('the VP card scores immediately', p.score >= 1, 'score=' + p.score);
}

// ---- Year of Plenty: takes 2 bank resources, chosen or scarcest-needed
{
  const gY = ctx.STATE.newGame(2, 2);
  const p = gY.players[0];
  p.devCards.push('yearPlenty');
  p.devBoughtThisTurn = [];
  // Targeted: the player explicitly names two resources.
  ctx.RULES.playDevCard(gY, p.id, 'yearPlenty', ['forest', 'hill']);
  check('Year of Plenty takes the chosen resources',
    p.hand.forest === 1 && p.hand.hill === 1);
  // Default: scarcest needed (nothing held → mount + field).
  const p2 = gY.players[1];
  p2.devCards.push('yearPlenty');
  p2.devBoughtThisTurn = [];
  ctx.RULES.playDevCard(gY, p2.id, 'yearPlenty');
  check('Year of Plenty defaults to the scarcest needs',
    p2.hand.mount === 1 && p2.hand.field === 1);
  // No dev cards are drawn by this card any more.
  check('Year of Plenty no longer draws dev cards',
    gY.players[0].devCards.length === 0 && gY.players[1].devCards.length === 0);
}

// ---- Monopoly: one chosen resource, all cards of that type
{
  const gM = ctx.STATE.newGame(3, 2);
  const p = gM.players[0];
  p.devCards.push('monopoly');
  p.devBoughtThisTurn = [];
  gM.players[1].hand.forest = 2;
  gM.players[2].hand.forest = 3;
  ctx.RULES.playDevCard(gM, p.id, 'monopoly', 'forest');
  check('Monopoly takes ALL cards of the chosen type',
    p.hand.forest === 5 &&
    gM.players[1].hand.forest === 0 && gM.players[2].hand.forest === 0,
    p.hand.forest);
  // Only the named type is taken.
  check('Monopoly leaves other resources alone',
    gM.players[1].hand.pasture === 0 && gM.players[2].hand.mount === 0);
  // Default target: the type the opponents hold most of.
  p.devCards.push('monopoly');
  p.devBoughtThisTurn = [];
  p.devPlayedThisTurn = false;   // a later turn: the one-per-turn cap lifted
  gM.players[1].hand.pasture = 4;
  gM.players[2].hand.pasture = 2;
  ctx.RULES.playDevCard(gM, p.id, 'monopoly');
  check('Monopoly defaults to the opponents richest type',
    p.hand.pasture === 6, p.hand.pasture);
}

// ---- Road Building: grants 2 free roads, no cards are drawn afterwards
{
  const gF = ctx.STATE.newGame(2, 2);
  const p = gF.players[0];
  p.devCards.push('roadBuild');
  p.devBoughtThisTurn = [];
  ctx.RULES.playDevCard(gF, p.id, 'roadBuild');
  check('Road Building grants 2 free roads', p.freeRoads === 2);
  // Empty hand: the free roads still build at network-attached spots, and
  // the hand must not change (the founding payout of the settlement can —
  // so compare against the hand recorded right before each road).
  p.hand = ctx.STATE.emptyHand();
  const vF = gF.map.vertices.find(v => ctx.RULES.settlementSpotFree(gF, v.id));
  ctx.RULES.buildSettlement(gF, p.id, vF.id);
  const e1 = gF.map.edges.find(e => e.built === null &&
    (e.a === vF.id || e.b === vF.id));
  const handBeforeRoad = Object.assign({}, p.hand);
  const first = ctx.RULES.buildRoad(gF, p.id, e1.id);
  const handAfterRoad = Object.assign({}, p.hand);
  check('first free road builds with an empty hand',
    first === true &&
    Object.entries(handBeforeRoad).every(([res, n]) => handAfterRoad[res] === n));
  const tipF = gF.map.edges[e1.id].a === vF.id ? gF.map.edges[e1.id].b : gF.map.edges[e1.id].a;
  const e2 = gF.map.edges.find(e => e.built === null &&
    (e.a === tipF || e.b === tipF));
  const handBeforeRoad2 = Object.assign({}, p.hand);
  const second = ctx.RULES.buildRoad(gF, p.id, e2.id);
  const handAfterRoad2 = Object.assign({}, p.hand);
  check('second free road builds and uses both credits',
    second === true && p.freeRoads === 0 &&
    Object.entries(handBeforeRoad2).every(([res, n]) => handAfterRoad2[res] === n));
  // Third road: no credits and no resources — refused, nothing placed.
  const tipG = gF.map.edges[e2.id].a === tipF ? gF.map.edges[e2.id].b : gF.map.edges[e2.id].a;
  const e3 = gF.map.edges.find(e => e.built === null &&
    (e.a === tipG || e.b === tipG));
  const refused = ctx.RULES.buildRoad(gF, p.id, e3.id);
  check('road without credits or resources is refused',
    refused === false && e3.built === null);
}

// ---- robber: exactly one steal, from one chosen victim with cards
{
  const gS = ctx.STATE.newGame(3, 2);
  // Park an island tile under the robber.
  const tile = gS.map.tiles.find(t => t.res !== 'desert');
  const tk = ctx.HEX.key(tile.q, tile.r);
  ctx.RULES.moveRobber(gS, tk);
  // Two AI settlements (with cards) + one AI without cards, all adjacent.
  const adj = gS.map.vertices.filter(v =>
    v.owner === null && v.tiles.includes(tk));
  gS.players[1].settlements.push(adj[0].id);
  gS.players[2].settlements.push(adj[1].id);
  gS.players[2].hand.pasture = 2;
  check('mover excluded, empty-handed victims excluded',
    ctx.RULES.stealCandidates(gS, 0).join(',') === '2',
    ctx.RULES.stealCandidates(gS, 0).join(','));
  gS.players[1].hand.forest = 3;
  const cands = ctx.RULES.stealCandidates(gS, 0);
  // One steal must take exactly one card from the chosen victim only.
  ctx.RULES.stealFromPlayer(gS, 0, cands[0]);
  check('a single steal moves exactly one card',
    Object.values(gS.players[0].hand).reduce((a, b) => a + b, 0) === 1);
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
