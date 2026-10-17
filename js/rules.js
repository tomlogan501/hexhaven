// Build legality, longest road, robber, scoring, dev cards, largest army.
const RULES = (() => {
  const COST = {
    road:       { forest: 1, hill: 1 },
    settlement: { forest: 1, hill: 1, field: 1, pasture: 1 },
    city:       { field: 2, mount: 3 },
    devCard:    { field: 1, mount: 1, hill: 1 },
  };

  function canAfford(p, kind) {
    const c = COST[kind];
    if (!c) return false;
    return Object.entries(c).every(([res, n]) => p.hand[res] >= n);
  }

  function pay(p, kind) {
    if (!COST[kind]) return;
    for (const [res, n] of Object.entries(COST[kind])) p.hand[res] -= n;
  }

  // A settlement needs no other settlement/city within 2 edges (hop distance).
  function settlementSpotFree(g, vid) {
    const v = g.map.vertices[vid];
    if (v.owner !== null) return false;
    return g.map.vertices.every(o => o.owner === null || v.hops[o.id] >= 2);
  }

  function ownedVertices(g, pid) {
    const p = g.players[pid];
    return new Set([...p.settlements, ...p.cities]);
  }

  // A road must touch one of the player's own settlements or cities.
  function roadSpotFree(g, pid, eid) {
    const map = g.map;
    const e = map.edges[eid];
    if (e.built !== null) return false;
    const mine = ownedVertices(g, pid);
    return mine.has(e.a) || mine.has(e.b);
  }

  function roadBuildable(g, pid, eid) {
    return roadSpotFree(g, pid, eid);
  }

  function canBuildCity(g, pid, vid) {
    const p = g.players[pid];
    if (!p.settlements.includes(vid)) return false;
    if (p.cities.includes(vid)) return false;
    return canAfford(p, 'city');
  }

  function buildRoad(g, pid, eid) {
    const p = g.players[pid];
    const e = g.map.edges[eid];
    p.roads.push(eid);
    e.built = pid;
    pay(p, 'road');
    updateLongestRoad(g, pid);
  }

  function buildSettlement(g, pid, vid) {
    const p = g.players[pid];
    const v = g.map.vertices[vid];
    p.settlements.push(vid);
    v.owner = pid;
    v.city = false;
    pay(p, 'settlement');
    // Founding a settlement takes one card from each adjacent numbered tile.
    for (const tk of v.tiles) {
      const t = g.map.byKey.get(tk);
      if (t && t.res !== 'desert') STATE.payout(g, p, t.res, 1);
    }
    updateLongestRoad(g, pid);
  }

  function buildCity(g, pid, vid) {
    const p = g.players[pid];
    const v = g.map.vertices[vid];
    p.settlements = p.settlements.filter(s => s !== vid);
    p.cities.push(vid);
    v.city = true;
    pay(p, 'city');
  }

  // ---- robber
  function canMoveRobber(g, fromKey) {
    const map = g.map;
    // Robber can move to any tile (not current position)
    return map.tiles.filter(t => HEX.key(t.q, t.r) !== fromKey);
  }

  function moveRobber(g, tileKey) {
    g.robber = tileKey;
    const tile = g.map.byKey.get(tileKey);
    if (tile && tile.res !== 'desert') {
      STATE.addLog(g, `Robber moved to ${tile.res} tile (${tile.num}).`);
    }
  }

  // Steal a random card from a player adjacent to the robber tile.
  function stealFromPlayer(g, robberPid, victimId) {
    const victim = g.players[victimId];
    const cardTypes = Object.entries(victim.hand).filter(([, n]) => n > 0);
    if (cardTypes.length === 0) return null;
    const [res] = cardTypes[Math.floor(Math.random() * cardTypes.length)];
    victim.hand[res] -= 1;
    STATE.payout(g, g.players[robberPid], res, 1);
    STATE.addLog(g, `${g.players[robberPid].name} stole a ${STATE.RES[res].label} from ${victim.name}.`);
    return res;
  }

  // Players affected by the robber on a 7.
  function playersAffectedByRobber(g) {
    if (!g.robber) return [];
    const tile = g.map.byKey.get(g.robber);
    if (!tile) return [];
    const tk = HEX.key(tile.q, tile.r);
    const affected = new Set();
    for (const p of g.players) {
      for (const vid of p.settlements.concat(p.cities)) {
        if (g.map.vertices[vid].tiles.includes(tk)) {
          affected.add(p.id);
        }
      }
    }
    return [...affected];
  }

  // ---- development cards
  function buyDevCard(g, pid) {
    const p = g.players[pid];
    if (!canAfford(p, 'devCard')) return null;
    if (g.deck.length === 0) return null;
    pay(p, 'devCard');
    const card = g.deck.pop();
    p.devCards.push(card);
    STATE.addLog(g, `${p.name} bought a ${STATE.DEV_CARDS[card].label} card.`);
    return card;
  }

  function playDevCard(g, pid, cardType, target) {
    const p = g.players[pid];
    const idx = p.devCards.indexOf(cardType);
    if (idx < 0) return false;
    p.devCards.splice(idx, 1);
    p.devPlayedThisTurn = true;

    if (cardType === 'knight') {
      p.playedKnights += 1;
      updateLargestArmy(g, pid);
      STATE.addLog(g, `${p.name} played a Knight (${p.playedKnights} total).`);
      g.robberFromSeven = true;
    } else if (cardType === 'yearPlenty') {
      for (const res of ['forest', 'field']) {
        if (g.deck.length > 0) p.devCards.push(g.deck.pop());
      }
      STATE.addLog(g, `${p.name} played Year of Plenty.`);
    } else if (cardType === 'monopoly') {
      // Steal one of each resource type from all opponents
      for (const other of g.players) {
        if (other.id === pid) continue;
        for (const res of Object.keys(STATE.RES)) {
          if (other.hand[res] > 0) {
            other.hand[res] -= 1;
            STATE.payout(g, p, res, 1);
            break;
          }
        }
      }
      STATE.addLog(g, `${p.name} played Monopoly.`);
    } else if (cardType === 'roadBuild') {
      STATE.addLog(g, `${p.name} played Road Building.`);
    } else if (cardType === 'victory') {
      STATE.addLog(g, `${p.name} revealed a Victory Point card!`);
    }
    void target;
    refreshScores(g);
    checkWinner(g);
    return true;
  }

  // ---- largest army
  function updateLargestArmy(g, pid) {
    const p = g.players[pid];
    if (p.playedKnights < 3) return;
    if (p.playedKnights > g.largestArmy.size) {
      const prevHolder = g.largestArmy.player;
      g.largestArmy = { player: pid, size: p.playedKnights };
      STATE.addLog(g, `${p.name} has the Largest Army: ${p.playedKnights} knights.`);
      void prevHolder;
    }
  }

  // ---- longest road: longest trail of the player's edges, no branch reuse
  function trailLengthFrom(g, pid, startEdge, seen) {
    const map = g.map;
    const e = map.edges[startEdge];
    if (seen.has(startEdge)) return 0;
    seen.add(startEdge);
    let best = 0;
    for (const end of [e.a, e.b]) {
      for (const nid of map.vertices[end].adj) {
        const eid = map.edges.findIndex(x =>
          (x.a === end && x.b === nid) || (x.b === end && x.a === nid));
        if (eid < 0 || map.edges[eid].built !== pid || seen.has(eid)) continue;
        best = Math.max(best, trailLengthFrom(g, pid, eid, seen));
      }
    }
    return 1 + best;
  }

  function updateLongestRoad(g, pid) {
    const p = g.players[pid];
    let best = 0;
    for (const eid of p.roads) {
      best = Math.max(best, trailLengthFrom(g, pid, eid, new Set()));
    }
    const prev = g.longest;
    if (best > prev.length) {
      g.longest = { player: pid, length: best };
      STATE.addLog(g, `${p.name} has the longest road: ${best}`);
    } else if (best < prev.length && prev.player === pid) {
      let winner = null, len = 0;
      for (const pl of g.players) {
        let m = 0;
        for (const eid of pl.roads) m = Math.max(m, trailLengthFrom(g, pl.id, eid, new Set()));
        if (m > len) { len = m; winner = pl.id; }
      }
      g.longest = { player: len >= 5 ? winner : null, length: len };
    }
  }

  // ---- scoring
  function scoreOf(g, p) {
    let s = p.settlements.length + p.cities.length * 2;
    // Count victory point cards in hand
    const vpCards = p.devCards.filter(d => d === 'victory').length;
    s += vpCards;
    if (g.longest.player === p.id && g.longest.length >= 5) s += 2;
    if (g.largestArmy.player === p.id && g.largestArmy.size >= 3) s += 2;
    return s;
  }

  function refreshScores(g) {
    for (const p of g.players) p.score = scoreOf(g, p);
  }

  function checkWinner(g) {
    refreshScores(g);
    const w = g.players.find(p => p.score >= 10);
    if (w) { g.winner = w; g.phase = 'done'; }
    return w;
  }

  // ---- harbors (ports)
  // A player controls a harbor if a settlement/city of theirs sits on either
  // endpoint of a harbor edge. Ports are only usable for the resource they
  // name; a generic 3:1 works for anything.
  function harborsOf(g, pid) {
    const p = g.players[pid];
    const mine = new Set([...p.settlements, ...p.cities]);
    const out = [];
    for (const e of g.map.edges) {
      if (!e.port) continue;
      if (!mine.has(e.a) && !mine.has(e.b)) continue;
      out.push(e.port);
    }
    return out;
  }

  // Best exchange rate this player can use for a given resource.
  // 3 (generic harbor) beats 2 (specific) beats 4 (bank).
  function tradeRateFor(g, pid, wantRes) {
    let best = 4;
    for (const h of harborsOf(g, pid)) {
      if (h.res && h.res !== wantRes) continue;   // wrong resource
      if (h.ratio < best) best = h.ratio;
    }
    return best;
  }

  function bestHarborTrade(g, pid, want) {
    const p = g.players[pid];
    const rate = tradeRateFor(g, pid, want);
    if (rate >= 4) return null;
    // Dump the resource we hold most of, never the one we want.
    let give = null, giveCount = -1;
    for (const res of Object.keys(STATE.RES)) {
      if (res === want) continue;
      const have = p.hand[res];
      if (have < rate) continue;
      if (have > giveCount) { giveCount = have; give = res; }
    }
    if (give === null) return null;
    return { give, n: rate, want, rate };
  }

  function harborTrade(g, pid, giveRes, n, wantRes) {
    const p = g.players[pid];
    if (giveRes === wantRes) return false;
    // Only allow the rate the player actually controls.
    if (n < tradeRateFor(g, pid, wantRes)) return false;
    if (p.hand[giveRes] < n) return false;
    p.hand[giveRes] -= n;
    STATE.payout(g, p, wantRes, 1);
    STATE.addLog(g, `${p.name} traded ${n} ${STATE.RES[giveRes].label} ` +
      `for 1 ${STATE.RES[wantRes].label} (harbor ${n}:1).`);
    return true;
  }

  // ---- bank (maritime) trade: 4 of one resource for 1 of another.
  function bankTrade(g, pid, giveRes, n, wantRes) {
    const p = g.players[pid];
    if (giveRes === wantRes) return false;
    if (p.hand[giveRes] < n) return false;
    p.hand[giveRes] -= n;
    STATE.payout(g, p, wantRes, 1);
    STATE.addLog(g, `${p.name} traded ${n} ${STATE.RES[giveRes].label} ` +
      `for 1 ${STATE.RES[wantRes].label} at the bank (4:1).`);
    return true;
  }

  // ---- player-to-player trade -------------------------------------------
  // give/want are bundles { res: n } from the OFFERING player's point of
  // view: `give` leaves their hand and lands in the partner's, `want` is
  // paid by the partner. Both sides are validated before anything moves.
  function partnerTrade(g, fromPid, toPid, give, want) {
    if (fromPid === toPid) return false;
    const a = g.players[fromPid], b = g.players[toPid];
    for (const [res, n] of Object.entries(give)) {
      if (!STATE.RES[res] || a.hand[res] < n) return false;
    }
    for (const [res, n] of Object.entries(want)) {
      if (!STATE.RES[res] || b.hand[res] < n) return false;
    }
    for (const [res, n] of Object.entries(give)) { a.hand[res] -= n; b.hand[res] += n; }
    for (const [res, n] of Object.entries(want)) { b.hand[res] -= n; a.hand[res] += n; }
    return true;
  }

  // Pick the resource we need most that we can afford, preferring to dump
  // resources we have most of. Returns the resource bought, or null.
  function planBankTrade(g, pid, want) {
    const p = g.players[pid];
    // Highest-count resource we are short of.
    let give = null, giveCount = -1;
    for (const res of Object.keys(STATE.RES)) {
      if (res === want) continue;
      const have = p.hand[res];
      if (have < 4) continue;
      if (have > giveCount) { giveCount = have; give = res; }
    }
    if (give === null) return null;
    return { give, n: 4, want };
  }

  // Make progress toward a build. Uses the best available rate: a 2:1 or 3:1
  // harbor if the player controls one, otherwise the 4:1 bank.
  //
  // Without this, a player holding only useless resources (e.g. sheep and
  // grain, when brick and ore are needed) can never build anything, because
  // 4:1 requires four of a single card that production never delivers.
  function tradeTowardBuild(g, pid) {
    const p = g.players[pid];
    let traded = true;
    let guard = 0;
    while (traded && guard++ < 16) {
      traded = false;
      if (p.settlements.some(v => canBuildCity(g, pid, v))) break;
      if (canAfford(p, 'settlement')) break;
      if (canAfford(p, 'road')) break;

      // Work out what is still missing. A city needs 2 grain + 3 ore; failing
      // that, a road needs wood + brick.
      const wants = ['mount', 'field', 'forest', 'hill'];
      for (const w of wants) {
        if (p.hand[w] > 0) continue;
        // Prefer a harbor rate; fall back to the bank.
        const plan = bestHarborTrade(g, pid, w) || planBankTrade(g, pid, w);
        if (!plan) continue;
        const ok = plan.rate
          ? harborTrade(g, pid, plan.give, plan.n, plan.want)
          : bankTrade(g, pid, plan.give, plan.n, plan.want);
        if (ok) { traded = true; break; }
      }
    }
  }

  // ---- discard on 7
  function playersToDiscard(g) {
    return g.players.filter(p => STATE.handOverSeven(p)).map(p => p.id);
  }

  function discardCards(g, pid, amounts) {
    const p = g.players[pid];
    for (const [res, n] of Object.entries(amounts)) {
      p.hand[res] -= n;
    }
    refreshScores(g);
  }

  return {
    COST, canAfford, pay, settlementSpotFree, roadSpotFree, roadBuildable,
    canBuildCity, buildRoad, buildSettlement, buildCity,
    updateLongestRoad, scoreOf, refreshScores, checkWinner,
    // robber
    canMoveRobber, moveRobber, stealFromPlayer, playersAffectedByRobber,
    // dev cards
    buyDevCard, playDevCard,
    // largest army
    updateLargestArmy,
    // discard
    playersToDiscard, discardCards,
    // bank trade
    bankTrade, planBankTrade, tradeTowardBuild,
    // player-to-player
    partnerTrade,
    // harbors
    harborsOf, tradeRateFor, bestHarborTrade, harborTrade,
  };
})();
