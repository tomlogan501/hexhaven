// Greedy computer opponent: scores spots, expands, upgrades.
const AI = (() => {
  // Odds a token is rolled. A 5 yields nothing, and a 7 is the robber, so both
  // are worth zero. Guarding n-5 here matters: spotScore feeds every AI
  // decision, and 1/0 would rank a worthless 5 as the best tile on the board.
  const pips = (n) => (n === 5 || n === 7 || !n ? 0 : 1 / (n - 5));

  // Value of a vertex = expected yield of its adjacent numbered tiles,
  // discounted for robber risk, plus a bonus for resource spread.
  function spotScore(g, v) {
    const map = g.map;
    let expect = 0;
    const kinds = new Set();
    for (const tk of v.tiles) {
      const t = map.byKey.get(tk);
      if (!t || t.res === 'desert') continue;
      const p = pips(t.num);
      if (g.robber === tk) continue;
      expect += p;
      kinds.add(t.res);
    }
    return expect * (1 + 0.35 * (kinds.size - 1));
  }

  function bestSettlement(g, pid) {
    const p = g.players[pid];
    if (!RULES.canAfford(p, 'settlement')) return null;
    let best = null, bestScore = -Infinity;
    for (const v of g.map.vertices) {
      if (!RULES.settlementSpotFree(g, v.id)) continue;
      let s = spotScore(g, v);
      for (const nid of v.adj) {
        for (const e of g.map.edges) {
          if ((e.a === v.id && e.b === nid) || (e.b === v.id && e.a === nid)) {
            if (e.built === pid) s += 0.6;
          }
        }
      }
      if (s > bestScore) { bestScore = s; best = v; }
    }
    return best;
  }

  function bestRoad(g, pid) {
    const p = g.players[pid];
    if (!RULES.canAfford(p, 'road')) return null;
    let best = null, bestScore = -Infinity;
    for (const e of g.map.edges) {
      if (!RULES.roadBuildable(g, pid, e.id)) continue;
      const a = g.map.vertices[e.a], b = g.map.vertices[e.b];
      const s = Math.max(spotScore(g, a), spotScore(g, b));
      if (s > bestScore) { bestScore = s; best = e; }
    }
    return best;
  }

  function bestCity(g, pid) {
    const p = g.players[pid];
    for (const vid of p.settlements) {
      if (RULES.canBuildCity(g, pid, vid)) return vid;
    }
    return null;
  }

  // Buy a dev card if affordable
  function maybeBuyDevCard(g, pid) {
    const p = g.players[pid];
    if (!RULES.canAfford(p, 'devCard') || g.deck.length === 0) return false;
    RULES.buyDevCard(g, pid);
    return true;
  }

  // Play a useful dev card
  function maybePlayDevCard(g, pid) {
    const p = g.players[pid];
    if (p.devPlayedThisTurn) return false;
    if (p.devCards.length === 0) return false;
    // Play victory cards last (they're worth points)
    const useful = ['yearPlenty', 'monopoly', 'knight', 'roadBuild', 'victory'];
    for (const card of useful) {
      if (p.devCards.includes(card)) {
        RULES.playDevCard(g, pid, card);
        return true;
      }
    }
    return false;
  }

  // Move robber to best tile (block opponent's best production)
  function smartRobberMove(g, pid) {
    if (!g.robberFromSeven) return;
    // Move to tile that blocks the most valuable opponent settlement
    let best = null, bestScore = -Infinity;
    for (const t of g.map.tiles) {
      const tk = HEX.key(t.q, t.r);
      if (tk === g.robber) continue;
      let score = 0;
      for (const opp of g.players) {
        if (opp.id === pid) continue;
        for (const vid of opp.settlements.concat(opp.cities)) {
          const v = g.map.vertices[vid];
          if (v.tiles.includes(tk)) score += 2;
        }
      }
      if (t.res !== 'desert') score += pips(t.num);
      if (score > bestScore) { bestScore = score; best = tk; }
    }
    if (best) {
      RULES.moveRobber(g, best);
      // Steal from affected opponents
      const affected = RULES.playersAffectedByRobber(g);
      for (const oppId of affected) {
        if (oppId !== pid) RULES.stealFromPlayer(g, pid, oppId);
      }
    }
    g.robberFromSeven = false;
  }

  // Discard cards if over 7
  function autoDiscard(g, pid) {
    const p = g.players[pid];
    const total = STATE.totalCards(p);
    if (total <= 7) return;
    const toDiscard = Math.floor(total / 2);
    // Discard randomly
    const amounts = {};
    let remaining = toDiscard;
    while (remaining > 0) {
      const avail = Object.entries(p.hand).filter(([, n]) => n > 0);
      if (avail.length === 0) break;
      const [res] = avail[Math.floor(Math.random() * avail.length)];
      amounts[res] = (amounts[res] || 0) + 1;
      p.hand[res] -= 1;
      remaining -= 1;
    }
    STATE.addLog(g, `${p.name} discarded ${toDiscard} cards after rolling a 7.`);
  }

  // Play out a whole turn, then hand control back.
  function takeTurn(g, onDone) {
    const pid = g.current;
    const p = g.players[pid];
    const maxBuilds = 2;
    let built = 0;
    let acted = false;

    function step() {
      // Handle robber first
      if (g.robberFromSeven) {
        smartRobberMove(g, pid);
      }
      // Discard if needed
      autoDiscard(g, pid);

      // Buy and play dev cards
      maybeBuyDevCard(g, pid);
      maybePlayDevCard(g, pid);

      // Trade with the bank so surplus resources become buildings.
      RULES.tradeTowardBuild(g, pid);

      // Priorities: city, settlement, road
      const city = bestCity(g, pid);
      if (city !== null) {
        RULES.buildCity(g, pid, city);
        STATE.addLog(g, `${p.name} built a city.`);
        built++; acted = true;
        if (built < maxBuilds) return step();
        return finish();
      }
      if (built < 1 && p.settlements.length + p.cities.length < 5) {
        const s = bestSettlement(g, pid);
        if (s) {
          RULES.buildSettlement(g, pid, s.id);
          STATE.addLog(g, `${p.name} founded a settlement.`);
          built++; acted = true;
          if (built < maxBuilds) return step();
          return finish();
        }
      }
      const r = bestRoad(g, pid);
      if (r) {
        RULES.buildRoad(g, pid, r.id);
        STATE.addLog(g, `${p.name} built a road.`);
        built++; acted = true;
        if (built < maxBuilds) return step();
        return finish();
      }
      finish();
    }

    function finish() {
      void acted;
      RULES.refreshScores(g);
      if (RULES.checkWinner(g)) return onDone();
      onDone();
    }

    setTimeout(step, 350);
  }

  // Would this AI accept a player-to-player trade? `receives` is the bundle
  // it would get, `gives` the bundle it would pay (both { res: n }).
  // Resources that close a gap toward something it can build are worth more
  // than raw card count, and the AI demands a clear margin before touching
  // its hand - it never trades one-for-one.
  function wantsTrade(g, pid, receives, gives) {
    const p = g.players[pid];
    for (const [res, n] of Object.entries(gives)) {
      if (p.hand[res] < n) return false;   // cannot pay
    }
    const goals = [
      RULES.COST.settlement, RULES.COST.city,
      RULES.COST.road, RULES.COST.devCard,
    ];
    const value = (bundle) => {
      let v = 0;
      for (const [res, n] of Object.entries(bundle)) {
        if (!n) continue;
        let unit = 1;
        for (const cost of goals) {
          if (p.hand[res] < cost[res]) unit = 1.75;  // it is missing exactly this
        }
        v += unit * n;
      }
      return v;
    };
    return value(receives) >= value(gives) * 1.3 + 0.25;
  }

  return {
    takeTurn, spotScore, bestSettlement, bestRoad, smartRobberMove, autoDiscard,
    wantsTrade,
  };
})();
