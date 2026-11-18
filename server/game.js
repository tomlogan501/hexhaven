// Server-side turn controller. The same board and rules modules are used by
// the browser; only this controller is allowed to mutate an online game.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ console });
for (const [file, name] of [['hex.js', 'HEX'], ['map.js', 'MAPGEN'],
  ['state.js', 'STATE'], ['rules.js', 'RULES']]) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  vm.runInContext(source + `\n;globalThis.${name} = ${name};`, context, { filename: file });
}
const { HEX, STATE, RULES } = context;
const resources = Object.keys(STATE.RES);
const hasResource = key => typeof key === 'string' && resources.includes(key);

class GameError extends Error {}
function requireAction(condition, message = 'That action is not available.') {
  if (!condition) throw new GameError(message);
}
function bundle(value) {
  requireAction(value && typeof value === 'object' && !Array.isArray(value), 'Invalid resource bundle.');
  const result = {};
  for (const [key, amount] of Object.entries(value)) {
    requireAction(hasResource(key) && Number.isSafeInteger(amount) && amount > 0 && amount <= 1000,
      'Invalid resource bundle.');
    result[key] = amount;
  }
  requireAction(Object.keys(result).length > 0, 'Select at least one resource.');
  return result;
}

class Game {
  constructor(names, radius, rollDie = () => 1 + Math.floor(Math.random() * 6)) {
    this.g = STATE.newGame(names.length, radius);
    this.g.players.forEach((player, id) => { player.name = names[id]; player.isAI = false; });
    this.setupIndex = 0;
    this.discards = [];
    this.victims = null;
    this.offer = null;
    this.rollDie = rollDie;
    STATE.addLog(this.g, 'log_new_island', {});
  }

  freeBuild(pid, kind, id) {
    const p = this.g.players[pid], saved = p.hand;
    p.hand = Object.assign(STATE.emptyHand(), RULES.COST[kind]);
    if (kind === 'settlement') RULES.buildSettlement(this.g, pid, id);
    else RULES.buildRoad(this.g, pid, id);
    const gains = p.hand;
    p.hand = saved;
    for (const [res, n] of Object.entries(gains)) p.hand[res] += n;
  }

  startRobber() {
    this.g.robberFromSeven = true;
    STATE.addLog(this.g, 'log_seven', {});
    this.discards = RULES.playersToDiscard(this.g);
    this.g.discardTarget = this.discards[0] ?? null;
    if (!this.discards.length) this.g.phase = 'robber';
  }

  finishRobber() {
    this.victims = null;
    this.g.robberFromSeven = false;
    this.g.phase = 'build';
  }

  act(pid, action) {
    const g = this.g, p = g.players[pid];
    requireAction(p && action && typeof action === 'object' && !Array.isArray(action), 'Invalid action.');
    requireAction(g.phase !== 'done', 'The game has ended.');

    if (action.type === 'discard') {
      requireAction(g.discardTarget === pid, 'Another player must discard.');
      const amounts = bundle(action.amounts);
      requireAction(Object.values(amounts).reduce((a, n) => a + n, 0) === Math.floor(STATE.totalCards(p) / 2) &&
        Object.entries(amounts).every(([res, n]) => p.hand[res] >= n), 'Choose exactly half your cards.');
      const count = Object.values(amounts).reduce((a, n) => a + n, 0);
      RULES.discardCards(g, pid, amounts);
      STATE.addLog(g, 'log_discard', { name: p.name, n: count });
      this.discards.shift();
      g.discardTarget = this.discards[0] ?? null;
      if (!this.discards.length) g.phase = 'robber';
      return;
    }
    if (action.type === 'respond') {
      requireAction(this.offer && this.offer.to === pid && typeof action.accept === 'boolean', 'No offer awaits you.');
      if (action.accept) requireAction(RULES.partnerTrade(g, this.offer.from, pid, this.offer.give, this.offer.want),
        'The players no longer have the offered cards.');
      else STATE.addLog(g, 'log_declined_offer', { to: p.name, from: g.players[this.offer.from].name });
      this.offer = null;
      return;
    }
    if (action.type === 'cancelOffer') {
      requireAction(this.offer && this.offer.from === pid, 'No offer to cancel.');
      this.offer = null;
      return;
    }
    requireAction(g.current === pid, 'Wait for your turn.');
    requireAction(g.discardTarget === null, 'A player must discard first.');
    requireAction(!this.offer, 'Resolve or cancel the trade offer first.');

    if (action.type === 'setup') {
      const { kind, id } = action;
      if (g.phase === 'setup1' && kind === 'settlement') {
        requireAction(Number.isInteger(id) && !!g.map.vertices[id] && RULES.settlementSpotFree(g, id), 'Invalid settlement.');
        this.freeBuild(pid, kind, id);
        g.phase = 'setup2';
        STATE.addLog(g, 'log_settle', { name: p.name });
      } else if (g.phase === 'setup2' && kind === 'road') {
        requireAction(Number.isInteger(id) && !!g.map.edges[id] && RULES.roadBuildable(g, pid, id), 'Invalid road.');
        this.freeBuild(pid, kind, id);
        STATE.addLog(g, 'log_road', { name: p.name });
        this.setupIndex++;
        if (this.setupIndex === g.setupOrder.length) {
          // Match the existing game's opening-card house rule.
          for (const player of g.players) player.hand = STATE.emptyHand();
          g.current = g.setupOrder[0]; g.phase = 'roll';
          STATE.addLog(g, 'log_placed', {});
        } else {
          g.current = g.setupOrder[this.setupIndex]; g.phase = 'setup1';
        }
      } else throw new GameError('Choose the required opening piece.');
    } else if (action.type === 'roll') {
      requireAction(g.phase === 'roll', 'You cannot roll now.');
      const a = this.rollDie(), b = this.rollDie(), total = a + b;
      g.dice = { a, b, total }; p.hasRolled = true; g.phase = 'build';
      STATE.addLog(g, 'log_roll', { name: p.name, n: total });
      if (total === 7) this.startRobber();
      else for (const tile of g.map.tiles) {
        if (tile.num !== total || tile.res === 'desert' || HEX.key(tile.q, tile.r) === g.robber) continue;
        const key = HEX.key(tile.q, tile.r);
        for (const player of g.players) {
          for (const vid of player.settlements) if (g.map.vertices[vid].tiles.includes(key)) STATE.payout(g, player, tile.res, 1);
          for (const vid of player.cities) if (g.map.vertices[vid].tiles.includes(key)) STATE.payout(g, player, tile.res, 2);
        }
      }
    } else if (action.type === 'robber') {
      requireAction(g.phase === 'robber' && !this.victims && typeof action.tile === 'string' &&
        g.map.byKey.has(action.tile) && action.tile !== g.robber, 'Choose another tile.');
      RULES.moveRobber(g, action.tile);
      const candidates = RULES.stealCandidates(g, pid);
      if (candidates.length === 1) { RULES.stealFromPlayer(g, pid, candidates[0]); this.finishRobber(); }
      else if (candidates.length > 1) this.victims = candidates;
      else this.finishRobber();
    } else if (action.type === 'steal') {
      requireAction(g.phase === 'robber' && this.victims && this.victims.includes(action.victim), 'Choose an eligible player.');
      RULES.stealFromPlayer(g, pid, action.victim);
      this.finishRobber();
    } else if (action.type === 'build') {
      requireAction(g.phase === 'build' && !g.robberFromSeven && Number.isInteger(action.id), 'You cannot build now.');
      const { kind, id } = action;
      if (kind === 'road') {
        requireAction(!!g.map.edges[id] && RULES.roadBuildable(g, pid, id) &&
          (p.freeRoads > 0 || RULES.canAfford(p, kind)), 'Invalid road.');
        RULES.buildRoad(g, pid, id);
      } else if (kind === 'settlement') {
        requireAction(!!g.map.vertices[id] && RULES.settlementSpotFree(g, id) &&
          RULES.settlementConnects(g, pid, id) && RULES.canAfford(p, kind), 'Invalid settlement.');
        RULES.buildSettlement(g, pid, id);
      } else if (kind === 'city') {
        requireAction(!!g.map.vertices[id] && RULES.canBuildCity(g, pid, id), 'Invalid city.');
        RULES.buildCity(g, pid, id);
      } else throw new GameError('Unknown piece.');
      p.builtThisTurn++;
      STATE.addLog(g, { road: 'log_road', settlement: 'log_settle', city: 'log_city' }[kind], { name: p.name });
      RULES.checkWinner(g);
    } else if (action.type === 'buyDev') {
      requireAction(g.phase === 'build' && !g.robberFromSeven && !!RULES.buyDevCard(g, pid), 'Cannot buy a development card.');
    } else if (action.type === 'playDev') {
      requireAction(g.phase === 'build' && !g.robberFromSeven && Object.hasOwn(STATE.DEV_CARDS, action.card), 'Cannot play that card.');
      requireAction(RULES.playDevCard(g, pid, action.card), 'Cannot play that card.');
      if (action.card === 'knight' && g.phase !== 'done') this.startRobber();
    } else if (action.type === 'maritime') {
      requireAction(g.phase === 'build' && !g.robberFromSeven && hasResource(action.give) && hasResource(action.want) && action.give !== action.want, 'Invalid exchange.');
      const rate = RULES.tradeRateFor(g, pid, action.give);
      requireAction(p.hand[action.give] >= rate, 'Not enough resources.');
      if (rate === 4) RULES.bankTrade(g, pid, action.give, rate, action.want);
      else RULES.harborTrade(g, pid, action.give, rate, action.want);
    } else if (action.type === 'offer') {
      requireAction(g.phase === 'build' && !g.robberFromSeven && Number.isInteger(action.to) &&
        !!g.players[action.to] && action.to !== pid, 'Choose a player.');
      const give = bundle(action.give), want = bundle(action.want);
      requireAction(Object.entries(give).every(([res, n]) => p.hand[res] >= n), 'Not enough resources.');
      this.offer = { from: pid, to: action.to, give, want };
    } else if (action.type === 'end') {
      requireAction(g.phase === 'build' && !g.robberFromSeven, 'Finish your turn first.');
      p.hasRolled = false; p.devPlayedThisTurn = false; p.devBoughtThisTurn = []; p.builtThisTurn = 0;
      g.current = (pid + 1) % g.players.length; g.dice = null; g.phase = 'roll';
    } else throw new GameError('Unknown action.');
    RULES.refreshScores(g);
  }

  view(pid) {
    const g = this.g;
    // JSON also copies the board, so no live server state reaches the client.
    const copy = JSON.parse(JSON.stringify(g));
    delete copy.map.byKey;
    copy.deck = Array(g.deck.length).fill(null);
    copy.players.forEach((player, id) => {
      if (id === pid) return;
      player.hand = STATE.emptyHand();
      player.devCards = Array(g.players[id].devCards.length).fill(null);
      player.devBoughtThisTurn = [];
      if (!g.winner) player.score -= g.players[id].devCards.filter(card => card === 'victory').length;
    });
    if (copy.winner) copy.winner = copy.players[g.winner.id];
    copy.log = copy.log.filter(entry => !entry || typeof entry !== 'object' ||
      (entry.k !== 'log_dev_buy' || entry.p.name === g.players[pid].name) &&
      (entry.k !== 'log_steal' || [entry.p.name, entry.p.victim].includes(g.players[pid].name)));
    return { game: copy, discardNeed: g.discardTarget === pid ? Math.floor(STATE.totalCards(g.players[pid]) / 2) : 0,
      victims: g.current === pid ? this.victims : null, offer: this.offer };
  }
}

module.exports = { Game, GameError };
