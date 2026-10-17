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

  // Official: a road must touch one of the player's settlements/cities, or
  // continue one of the player's own roads — and the connection point must
  // not pass through an opponent's building.
  function roadSpotFree(g, pid, eid) {
    const map = g.map;
    const e = map.edges[eid];
    if (e.built !== null) return false;
    const mine = ownedVertices(g, pid);
    if (mine.has(e.a) || mine.has(e.b)) return true;
    const roadEnds = (vert) => {
      if (roadVertexBlocks(g, pid, vert)) return false;   // enemy building cuts
      return g.players[pid].roads.some(rid => {
        const r = map.edges[rid];
        return r.a === vert || r.b === vert;
      });
    };
    return roadEnds(e.a) || roadEnds(e.b);
  }

  // Official: after setup, a settlement must sit on a vertex of the player's
  // own road network.
  function settlementConnects(g, pid, vid) {
    const map = g.map;
    return g.players[pid].roads.some(rid => {
      const r = map.edges[rid];
      return r.a === vid || r.b === vid;
    });
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
    // Free roads (Road Building) skip the cost; otherwise the cost must be
    // covered — refuse rather than driving the hand negative.
    if (p.freeRoads > 0) {
      p.freeRoads -= 1;
    } else {
      if (!canAfford(p, 'road')) return false;
      pay(p, 'road');
    }
    p.roads.push(eid);
    g.map.edges[eid].built = pid;
    updateLongestRoad(g, pid);
    return true;
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
      STATE.addLog(g, 'log_robber_move', { res: tile.res, n: tile.num });
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
    STATE.addLog(g, 'log_steal', {
      name: g.players[robberPid].name, res, victim: victim.name,
    });
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

  // Official: the mover steals exactly ONE card from ONE victim the mover
  // chooses among the players adjacent to the robber tile holding >= 1 card.
  function stealCandidates(g, moverPid) {
    return playersAffectedByRobber(g)
      .filter(id => id !== moverPid && STATE.totalCards(g.players[id]) > 0);
  }

  // ---- development cards
  function buyDevCard(g, pid) {
    const p = g.players[pid];
    if (!canAfford(p, 'devCard')) return null;
    if (g.deck.length === 0) return null;
    pay(p, 'devCard');
    const card = g.deck.pop();
    p.devCards.push(card);
    // Official rule: a card bought this turn may not be played this turn.
    // (Victory Point cards are exempt — they may be revealed immediately.)
    p.devBoughtThisTurn.push(card);
    STATE.addLog(g, 'log_dev_buy', { name: p.name, dev: card });
    return card;
  }

  function playDevCard(g, pid, cardType, target) {
    const p = g.players[pid];
    const idx = p.devCards.indexOf(cardType);
    if (idx < 0) return false;
    // Official: at most one development card per turn — except revealing a
    // Victory Point card — and never a card bought this turn.
    if (cardType !== 'victory') {
      if (p.devPlayedThisTurn) return false;
      if (p.devBoughtThisTurn.includes(cardType)) return false;
    }
    p.devCards.splice(idx, 1);
    p.devPlayedThisTurn = true;

    if (cardType === 'knight') {
      p.playedKnights += 1;
      updateLargestArmy(g, pid);
      STATE.addLog(g, 'log_knight', { name: p.name, dev: 'knight', n: p.playedKnights });
      g.robberFromSeven = true;
    } else if (cardType === 'yearPlenty') {
      // Official: take any 2 resource cards from the bank. `target` supplies
      // the player's choice, [{res},{res}] or an array of resource keys;
      // without it the scarcest needed resources are taken.
      const needs = ['mount', 'field', 'forest', 'hill', 'pasture'];
      const picks = (Array.isArray(target) && target.length === 2)
        ? target.filter(res => STATE.RES[res]).slice(0, 2)
        : needs.filter(res => p.hand[res] === 0).slice(0, 2);
      while (picks.length < 2) {
        picks.push(needs.find(res => !picks.includes(res)) || 'forest');
      }
      for (const res of picks) {
        STATE.payout(g, p, res, 1);
        STATE.addLog(g, 'log_year_bank', { name: p.name, res });
      }
      STATE.addLog(g, 'log_year_none', { name: p.name });
    } else if (cardType === 'monopoly') {
      // Official: name ONE resource type and take ALL cards of that type from
      // every other player. `target` names the type; without one the most
      // plentiful type in the opponents' hands is taken.
      let res = (typeof target === 'string' && STATE.RES[target]) ? target : null;
      if (!res) {
        let bestTotal = -1;
        for (const other of g.players) {
          if (other.id === pid) continue;
          for (const r of Object.keys(STATE.RES)) {
            if (other.hand[r] > bestTotal) { bestTotal = other.hand[r]; res = r; }
          }
        }
      }
      let total = 0;
      for (const other of g.players) {
        if (other.id === pid) continue;
        total += other.hand[res] || 0;
        other.hand[res] = 0;
      }
      if (total > 0) {
        STATE.payout(g, p, res, total);
        STATE.addLog(g, 'log_monopoly', { name: p.name, n: total, res });
      }
      STATE.addLog(g, 'log_monopoly_none', { name: p.name });
    } else if (cardType === 'roadBuild') {
      // Official: build 2 free roads on this turn. The credits are spent by
      // RULES.buildRoad without touching the player's hand.
      p.freeRoads = (p.freeRoads || 0) + 2;
      STATE.addLog(g, 'log_roadbuild', { name: p.name });
    } else if (cardType === 'victory') {
      // A revealed VP card is permanent: it leaves the hand and its point
      // is banked on the player.
      p.vpRevealed = (p.vpRevealed || 0) + 1;
      STATE.addLog(g, 'log_vp', { name: p.name });
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
        STATE.addLog(g, 'log_army', { name: p.name, n: p.playedKnights });
      void prevHolder;
    }
  }

  // ---- longest road: longest trail of the player's edges, no branch reuse.
  // Official rule: a road chain cannot pass THROUGH a vertex where an
  // opponent's settlement or city sits (an opponent's building cuts the
  // chain); your own buildings do not cut your own chain.
  function roadVertexBlocks(g, pid, vid) {
    const v = g.map.vertices[vid];
    return v.owner !== null && v.owner !== pid;
  }

  function trailLengthFrom(g, pid, startEdge, seen) {
    const map = g.map;
    const e = map.edges[startEdge];
    if (seen.has(startEdge)) return 0;
    seen.add(startEdge);
    let best = 0;
    for (const end of [e.a, e.b]) {
      if (roadVertexBlocks(g, pid, end)) continue;   // enemy building cuts here
      for (const nid of map.vertices[end].adj) {
        const eid = map.edges.findIndex(x =>
          (x.a === end && x.b === nid) || (x.b === end && x.a === nid));
        if (eid < 0 || map.edges[eid].built !== pid || seen.has(eid)) continue;
        best = Math.max(best, trailLengthFrom(g, pid, eid, seen));
      }
    }
    return 1 + best;
  }

  function bestChainOf(g, pid) {
    let best = 0;
    for (const eid of g.players[pid].roads) {
      best = Math.max(best, trailLengthFrom(g, pid, eid, new Set()));
    }
    return best;
  }

  // Recompute every player's longest single chain and apply the official
  // card rules: awarded at a strictly longest chain of >= 5; another player
  // takes it by being strictly longer; the holder keeps it on a tie; if the
  // holder no longer has (strictly) the longest chain >= 5, the card goes to
  // the unique longest chain >= 5, or back to the table.
  function recomputeLongestRoad(g) {
    const bestBy = new Map();
    let maxLen = 0;
    for (const p of g.players) {
      const len = bestChainOf(g, p.id);
      bestBy.set(p.id, len);
      if (len > maxLen) maxLen = len;
    }
    const leaders = g.players.filter(p => bestBy.get(p.id) === maxLen);
    const prev = g.longest;

    // The holder keeps the card while it still shares the top length (tie).
    if (prev.player !== null && bestBy.get(prev.player) === maxLen && maxLen >= 5) {
      g.longest = { player: prev.player, length: maxLen };
      return;
    }
    // A unique chain of 5+ takes (back) the card.
    if (maxLen >= 5 && leaders.length === 1) {
      const leader = leaders[0];
      if (prev.player === null) {
        STATE.addLog(g, 'log_road_len', { name: leader.name, n: maxLen });
      } else {
        STATE.addLog(g, 'log_road_take', {
          name: leader.name, from: g.players[prev.player].name, n: maxLen,
        });
      }
      g.longest = { player: leader.id, length: maxLen };
      return;
    }
    // Nothing qualifies (too short, or a tie among players that is not the
    // holder's): the card goes back to the table.
    if (prev.player !== null) {
      STATE.addLog(g, 'log_road_back');
    }
    g.longest = { player: null, length: maxLen };
  }

  // Update step kept for call sites that change one player's network.
  function updateLongestRoad(g, pid) {
    void pid;
    recomputeLongestRoad(g);
  }

  // ---- scoring
  function scoreOf(g, p) {
    let s = p.settlements.length + p.cities.length * 2;
    // Count victory point cards in hand (hidden) plus already-revealed ones.
    const vpCards = p.devCards.filter(d => d === 'victory').length;
    s += vpCards + (p.vpRevealed || 0);
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

  // Best rate allowed for trading AWAY giveRes. A specific 2:1 harbour
  // only serves its own resource; the 3:1 harbour serves everything;
  // anything else is the bank's 4:1.
  function tradeRateFor(g, pid, giveRes) {
    let best = 4;
    for (const h of harborsOf(g, pid)) {
      if (h.ratio >= best) continue;
      if (h.ratio === 3 || h.res === giveRes) best = h.ratio;
    }
    return best;
  }

  function bestHarborTrade(g, pid, want) {
    const p = g.players[pid];
    // Cheapest applicable rate first, then the biggest pile to dump.
    let plan = null;
    for (const res of Object.keys(STATE.RES)) {
      if (res === want) continue;
      const rate = tradeRateFor(g, pid, res);
      if (rate >= 4) continue;
      const have = p.hand[res];
      if (have < rate) continue;
      if (!plan || rate < plan.rate ||
          (rate === plan.rate && have > p.hand[plan.give])) {
        plan = { give: res, n: rate, want, rate };
      }
    }
    return plan;
  }

  function harborTrade(g, pid, giveRes, n, wantRes) {
    const p = g.players[pid];
    if (giveRes === wantRes) return false;
    // Only allow the rate the player actually controls — matched against
    // the resource being GIVEN (official: the 2:1 harbour of a resource
    // trades 2 of that resource for 1 of any other).
    if (n !== tradeRateFor(g, pid, giveRes)) return false;
    if (p.hand[giveRes] < n) return false;
    p.hand[giveRes] -= n;
    STATE.payout(g, p, wantRes, 1);
    STATE.addLog(g, 'log_harbor_trade', {
      name: p.name, n, res: giveRes, want: wantRes, r: n,
    });
    return true;
  }

  // ---- bank (maritime) trade: 4 of one resource for 1 of another.
  function bankTrade(g, pid, giveRes, n, wantRes) {
    const p = g.players[pid];
    if (giveRes === wantRes) return false;
    if (p.hand[giveRes] < n) return false;
    p.hand[giveRes] -= n;
    STATE.payout(g, p, wantRes, 1);
    STATE.addLog(g, 'log_bank_trade', {
      name: p.name, n, res: giveRes, want: wantRes,
    });
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
    const bundle = (b) => Object.entries(b)
      .filter(([, n]) => n > 0).map(([r, n]) => [r, n]);
    STATE.addLog(g, 'log_partner_trade',
      { a: a.name, b: b.name, give: bundle(give), want: bundle(want) });
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
        // plan.rate is set for harbour trades (the matched rate); the bank
        // plan has no rate — always 4:1.
        const ok = plan.rate === undefined
          ? bankTrade(g, pid, plan.give, plan.n, plan.want)
          : harborTrade(g, pid, plan.give, plan.n, plan.want);
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
    COST, canAfford, pay, settlementSpotFree, settlementConnects,
    roadSpotFree, roadBuildable,
    canBuildCity, buildRoad, buildSettlement, buildCity,
    updateLongestRoad, scoreOf, refreshScores, checkWinner,
    // robber
    canMoveRobber, moveRobber, stealFromPlayer, playersAffectedByRobber,
    stealCandidates,
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
