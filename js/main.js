// Turn flow, input handling, UI binding.
//
// Phases (see STATE.newGame):
//   setup1 -> place a settlement    setup2 -> place a road
//   roll   -> dice not yet thrown   build   -> build / play cards
//   robber -> the human must move the robber after a 7 or a Knight
//   done   -> somebody reached 10

(() => {
  let isDebugModeActive = false;
  
  let g = null;
  // Setup walks g.setupOrder (snake order), one settlement+road pair per entry,
  // so every player ends the opening with two settlements and two roads.

  const $ = (id) => document.getElementById(id);
  const canvas = $('board');
  const ctx = canvas.getContext('2d');
  let tool = null;        // 'road' | 'settlement' | 'city' | null
  // User camera: zoom multiplies the fit-to-screen scale, cx/cy is the board
  // point shown at the viewport centre (null = board centre).
  let cam = { zoom: 1, cx: null, cy: null };
  let animT = 0;          // animation clock for pulsing highlights
  let winAnnounced = false; // victory fanfare fires once per game
  let busy = false;       // an AI turn is resolving
  let setupIdx = 0;       // cursor into g.setupOrder
  let discardNeed = 0;    // cards the human must still discard
  let trade = null;       // open trade panel: { give: {}, want: {} }
  const discardPick = {}; // res -> count chosen so far
  let debugRunning = false; // a full-game debug run is in progress

  const isSetup = () => g.phase === 'setup1' || g.phase === 'setup2';

  // ---- logging / status
  function log(msg) {
    if (isDebugModeActive && typeof debugMessage !== 'undefined') { // Use a dedicated variable for debugging logs if needed
      console.log(`[DEBUG] LOG: ${msg}`);
    }
    STATE.addLog(g, msg);
    renderLog();
  }

  function renderLog() {
    const el = $('log');
    if (!el) return;
    el.innerHTML = '';
    for (const line of g.log.slice(-40)) {
      const d = document.createElement('div');
      d.textContent = line;
      el.appendChild(d);
    }
    el.scrollTop = el.scrollHeight;
  }

  function setHint(msg) {
    const el = $('rollresult');
    if (el) el.textContent = msg;
  }

  function status() {
    const el = $('status');
    if (!el) return;
    if (g.winner) {
      el.textContent = `${g.winner.name} wins with ${g.winner.score} victory points!`;
      return;
    }
    const p = STATE.currentPlayer(g);
    if (discardNeed > 0) {
      el.textContent = `${p.name} must discard ${discardNeed} cards`;
    } else if (g.phase === 'setup1') {
      el.textContent = `${p.name}: place a settlement`;
    } else if (g.phase === 'setup2') {
      el.textContent = `${p.name}: place a road`;
    } else if (g.phase === 'robber') {
      el.textContent = `${p.name}: move the robber`;
    } else if (g.phase === 'roll') {
      el.textContent = `${p.name}'s turn — roll the dice`;
    } else if (g.phase === 'build') {
      el.textContent = `${p.name}'s turn — build or end turn`;
    } else {
      el.textContent = `${p.name}'s turn`;
    }
  }

  // ---- sidebar
  function badge(parent, text) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = text;
    parent.appendChild(b);
  }

  function renderPlayers() {
    const el = $('players');
    if (!el) return;
    el.innerHTML = '';
    for (const p of g.players) {
      const row = document.createElement('div');
      row.className = 'player' + (p.id === g.current ? ' active' : '');

      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = p.color;

      const nm = document.createElement('span');
      nm.textContent = p.name + (p.isAI ? '' : ' (you)');
      if (p.devCards.length) badge(nm, p.devCards.length + ' dev');
      if (p.playedKnights) {
        badge(nm, p.playedKnights + ' knight' + (p.playedKnights === 1 ? '' : 's'));
      }
      if (g.longest.player === p.id && g.longest.length >= 5) {
        badge(nm, 'Longest road ' + g.longest.length);
      }
      if (g.largestArmy.player === p.id && g.largestArmy.size >= 3) {
        badge(nm, 'Largest army ' + g.largestArmy.size);
      }

      const sc = document.createElement('span');
      sc.className = 'score';
      sc.textContent = p.score + ' vp';

      row.append(sw, nm, sc);
      el.appendChild(row);
    }
  }

  function pickedCount() {
    return Object.values(discardPick).reduce((a, b) => a + b, 0);
  }

  // ---- player-to-player trade panel -------------------------------------
  function bundleText(b) {
    return Object.entries(b).filter(([, n]) => n > 0)
      .map(([res, n]) => n + ' ' + STATE.RES[res].label).join(' + ');
  }

  function renderTradePanel() {
    const panel = $('tradepanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !trade);
    if (!trade) return;
    const buildRow = (id, bundle) => {
      const row = $(id);
      if (!row) return;
      row.innerHTML = '';
      for (const [res, info] of Object.entries(STATE.RES)) {
        const n = bundle[res] || 0;
        const chip = document.createElement('span');
        chip.className = 'res' + (n > 0 ? ' picked' : '');
        chip.dataset.res = res;
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = info.color;
        const count = document.createElement('span');
        count.className = 'rescount';
        count.textContent = '\u00d7' + n;
        chip.append(dot, count);
        row.appendChild(chip);
      }
    };
    buildRow('trade-give', trade.give);
    buildRow('trade-want', trade.want);
    const hint = $('tradehint');
    if (hint) {
      hint.textContent = 'Offer: ' + (bundleText(trade.give) || 'nothing') +
        ' \u2192 ' + (bundleText(trade.want) || 'nothing') +
        '. Click a chip to raise its count.';
    }
  }

  function proposeTrade() {
    if (!trade) return;
    const gives = {}, wants = {};
    for (const [res, n] of Object.entries(trade.give)) if (n > 0) gives[res] = n;
    for (const [res, n] of Object.entries(trade.want)) if (n > 0) wants[res] = n;
    if (!Object.keys(gives).length || !Object.keys(wants).length) {
      setHint('Set at least one card to give and one to get.');
      return;
    }
    const txt = (b) => Object.entries(b)
      .map(([r, n]) => n + ' ' + STATE.RES[r].label).join(' + ');
    // Offer to every AI in turn; the first one to accept closes the deal.
    for (const p of g.players) {
      if (p.id === 0) continue;
      if (AI.wantsTrade(g, p.id, gives, wants) &&
          RULES.partnerTrade(g, 0, p.id, gives, wants)) {
        AUDIO.build();
        trade = null;
        render();
        return;
      }
      log(`${p.name} declined ${txt(gives)} for ${txt(wants)}.`);
    }
    setHint('Nobody accepted. Sweeten the offer or close the panel.');
    render();
  }

  function renderHand() {
    const el = $('hand');
    if (!el) return;
    el.innerHTML = '';
    const p = g.players[0];
    for (const [res, info] of Object.entries(STATE.RES)) {
      const picked = discardPick[res] || 0;
      const chip = document.createElement('span');
      chip.className = 'res' +
        (discardNeed > 0 && p.hand[res] - picked > 0 ? ' pick' : '') +
        (picked > 0 ? ' picked' : '');
      chip.dataset.res = res;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = info.color;
      // Label and count are separate spans so small screens can hide the
      // word and keep just the coloured dot + count (see CSS).
      const label = document.createElement('span');
      label.className = 'reslabel';
      label.textContent = info.label;
      const count = document.createElement('span');
      count.className = 'rescount';
      count.textContent = '×' + p.hand[res] + (picked > 0 ? ' (−' + picked + ')' : '');
      chip.append(dot, label, count);
      el.appendChild(chip);
    }

    const panel = $('discardpanel');
    const hint = $('discarthint');
    if (panel && hint) {
      panel.classList.toggle('hidden', discardNeed <= 0);
      hint.textContent = discardNeed > 0
        ? `Discard ${discardNeed} card${discardNeed === 1 ? '' : 's'}: ` +
          `click the chips below (${pickedCount()}/${discardNeed} chosen).`
        : '';
    }
  }

  function renderDevCards() {
    const el = $('devcards');
    if (!el) return;
    el.innerHTML = '';
    const p = g.players[0];
    for (const type of Object.keys(STATE.DEV_CARDS)) {
      const n = p.devCards.filter((t) => t === type).length;
      if (n === 0) continue;
      const b = document.createElement('button');
      b.className = 'btn';
      b.id = 'btn-play-' + type;
      b.textContent = STATE.DEV_CARDS[type].label + ' ×' + n;
      b.disabled = g.current !== 0 || busy || g.phase !== 'build';
      b.addEventListener('click', () => playDevCard(type));
      el.appendChild(b);
    }
    const buy = $('btn-dev');
    if (buy) {
      buy.disabled = g.current !== 0 || busy || g.phase !== 'build' ||
        g.deck.length === 0 || !RULES.canAfford(p, 'devCard');
    }
  }

  function renderBoardInfo() {
    const el = $('boardinfo');
    if (!el) return;
    el.innerHTML = '';
    const line = (txt) => {
      const s = document.createElement('span');
      s.textContent = txt;
      el.appendChild(s);
    };
    if (g.robber && g.map.byKey.has(g.robber)) {
      const t = g.map.byKey.get(g.robber);
      line('Robber: ' + t.res + ' tile (' + (t.num === 0 ? 'desert' : t.num) + ')');
    } else {
      line('Robber: not placed yet');
    }
    line('Development cards left in deck: ' + g.deck.length);
  }

  // The canvas is sized by CSS to fill the stage, so its backing store must be
  // matched to the container (times devicePixelRatio for crisp art).
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  // Sprites decode asynchronously. Repaint only when a *new* sprite was
  // actually requested during the frame: unconditionally awaiting settled()
  // inside render() would resolve immediately and loop forever.
  let repaintQueued = false;
  function render() {
    resizeCanvas();
    if (g.winner && !winAnnounced) { winAnnounced = true; AUDIO.win(); }
    if (g.phase !== 'done') RULES.refreshScores(g);
    RENDER.draw(ctx, g, canvas.width, canvas.height, null, tool, 0, cam, { t: animT });
    renderPlayers();
    renderHand();
    renderTradePanel();
    renderDevCards();
    renderBoardInfo();
    renderLog();
    status();
    syncBuildBar();
    if (typeof ART !== 'undefined' && ART.inflight && !repaintQueued) {
      repaintQueued = true;
      ART.settled().then(() => {
        repaintQueued = false;
        // Repaint once, and only if decoding actually produced something.
        if (ART.inflight()) render();
      });
    }
  }

  // ---- production
  // One card per adjacent numbered, non-desert, un-robbered tile per building.
  function produce(total) {
    for (const t of g.map.tiles) {
      if (t.num !== total || t.res === 'desert') continue;
      const tk = HEX.key(t.q, t.r);
      if (g.robber === tk) continue;
      for (const pl of g.players) {
        for (const vid of pl.settlements) {
          if (g.map.vertices[vid].tiles.includes(tk)) STATE.payout(g, pl, t.res, 1);
        }
        for (const vid of pl.cities) {
          if (g.map.vertices[vid].tiles.includes(tk)) STATE.payout(g, pl, t.res, 1);
        }
      }
    }
  }

  function rollDice() {
    return 1 + Math.floor(Math.random() * 6);
  }

  // ---- the 7: everyone over seven discards, then the robber moves
  function resolveSeven(rollerId) {
    g.robberFromSeven = true;
    log('A 7 was rolled — the robber strikes.');

    const toDiscard = RULES.playersToDiscard(g);
    let humanOwes = 0;
    for (const pid of toDiscard) {
      if (pid === 0) {
        humanOwes = Math.floor(STATE.totalCards(g.players[0]) / 2);
        continue;
      }
      AI.autoDiscard(g, pid);
    }

    if (humanOwes > 0) {
      for (const k of Object.keys(discardPick)) delete discardPick[k];
      discardNeed = humanOwes;
      setHint('A 7! Discard from your hand: click the chips below.');
      render();
      return;                       // resumes via finishDiscard()
    }
    afterDiscards(rollerId);
  }

  function finishDiscard() {
    const n = pickedCount();
    const amounts = {};
    for (const [res, c] of Object.entries(discardPick)) amounts[res] = c;
    discardNeed = 0;
    for (const k of Object.keys(discardPick)) delete discardPick[k];
    RULES.discardCards(g, 0, amounts);
    log(`You discarded ${n} cards after rolling a 7.`);
    afterDiscards(0);
  }

  function afterDiscards(rollerId) {
    render();
    if (rollerId !== 0) return;      // the AI moves its own robber
    if (!g.robberFromSeven) return;
    g.phase = 'robber';
    setHint('Click a tile to move the robber, then End turn.');
    render();
  }

  function resolveHumanRobber(tileKey) {
    if (tileKey !== g.robber) {
      RULES.moveRobber(g, tileKey);
      AUDIO.robber();
      for (const victimId of RULES.playersAffectedByRobber(g)) {
        if (victimId !== 0) RULES.stealFromPlayer(g, 0, victimId);
      }
    } else {
      setHint('Robber stayed where it was.');
    }
    g.robberFromSeven = false;
    g.phase = 'build';
    render();
  }

  // ---- dice for the human
  function roll() {
    if (busy || g.phase === 'done' || g.current !== 0) return;
    if (discardNeed > 0) return;
    if (isSetup()) {
      // Roll doubles as "skip ahead" so the opening can never dead-end.
      autoFinishHumanSetup();
      if (isSetup()) return;
    }
    if (g.phase !== 'roll') {
      setHint('You already rolled this turn.');
      return;
    }
    const a = rollDice();
    const b = rollDice();
    const total = a + b;
    g.dice = { a, b, total };
    const p = g.players[0];
    p.hasRolled = true;
    g.phase = 'build';
    setHint(`You rolled ${a} + ${b} = ${total}.`);
    log(`You rolled ${total}.`);
    AUDIO.dice();
    render();

    if (total === 7) {
      resolveSeven(0);
      return;
    }
    produce(total);
    RULES.refreshScores(g);
    render();
  }

  // ---- building during a turn
  function tryPlace(kind, id) {
    if (busy || g.current !== 0 || g.phase !== 'build') return false;
    const p = g.players[0];
    if (kind === 'road') {
      if (!RULES.roadBuildable(g, 0, id)) return false;
      RULES.buildRoad(g, 0, id);
      log('You built a road.');
    } else if (kind === 'settlement') {
      if (!RULES.settlementSpotFree(g, id)) return false;
      if (!RULES.canAfford(p, 'settlement')) return false;
      RULES.buildSettlement(g, 0, id);
      log('You founded a settlement.');
    } else if (kind === 'city') {
      if (!RULES.canBuildCity(g, 0, id)) return false;
      RULES.buildCity(g, 0, id);
      log('You built a city.');
    } else {
      return false;
    }
    p.builtThisTurn += 1;
    RULES.refreshScores(g);
    RULES.checkWinner(g);
    tool = null;
    if (kind === 'city') AUDIO.city(); else AUDIO.build();
    render();
    return true;
  }

  // ---- setup: pieces are free, but the tiles still pay out
  // Hand the player exactly the cost, build, then fold whatever ended up in
  // the temporary hand (the tile gains) back into the real hand.
  function freeBuild(p, kind, id) {
    const saved = p.hand;
    p.hand = Object.assign(STATE.emptyHand(), RULES.COST[kind]);
    if (kind === 'settlement') RULES.buildSettlement(g, p.id, id);
    else RULES.buildRoad(g, p.id, id);
    const gains = p.hand;            // cost is fully spent, so only gains remain
    p.hand = saved;
    for (const [res, n] of Object.entries(gains)) {
      if (n > 0) STATE.payout(g, p, res, n);
    }
  }

  function trySetupPlace(kind, id) {
    if (busy || g.current !== 0) return false;
    const p = g.players[0];
    if (g.phase === 'setup1') {
      if (kind !== 'settlement') return false;
      if (!RULES.settlementSpotFree(g, id)) return false;
      freeBuild(p, 'settlement', id);
      g.phase = 'setup2';
      log('You founded your first settlement.');
      setHint('Now place a road from your settlement.');
      AUDIO.build();
      render();
    } else if (g.phase === 'setup2') {
      if (kind !== 'road') return false;
      if (!RULES.roadBuildable(g, 0, id)) return false;
      freeBuild(p, 'road', id);
      log('You built your first road.');
      AUDIO.build();
      RULES.refreshScores(g);
      advanceSetup();
    } else {
      return false;
    }
    return true;
  }

  // One settlement+road pair per setupOrder entry.
  function aiSetupPair() {
    const p = STATE.currentPlayer(g);
    const saved = p.hand;
    p.hand = Object.assign(STATE.emptyHand(),
      { forest: 4, hill: 4, field: 4, pasture: 4, mount: 4 });
    const s = AI.bestSettlement(g, p.id);
    if (s) {
      freeBuild(p, 'settlement', s.id);
      log(`${p.name} founded a settlement.`);
      const r = AI.bestRoad(g, p.id);
      if (r) {
        freeBuild(p, 'road', r.id);
        log(`${p.name} built a road.`);
      }
    }
    p.hand = saved;
    RULES.refreshScores(g);
  }

  function advanceSetup() {
    setupIdx += 1;
    if (setupIdx >= g.setupOrder.length) {
      // Snake order is over: opening cards go back to the bank.
      for (const p of g.players) p.hand = STATE.emptyHand();
      setupIdx = 0;
      g.phase = 'roll';
      g.current = g.setupOrder[0];
      g.dice = null;
      busy = false;
      log('Everyone is placed. Time to roll.');
      setHint('Setup complete. Roll the dice to begin.');
      render();
      return;
    }
    g.phase = 'setup1';
    g.current = g.setupOrder[setupIdx];
    const p = STATE.currentPlayer(g);
    if (p.isAI) {
      busy = true;
      setTimeout(() => {
        aiSetupPair();
        advanceSetup();
      }, 500);
    } else {
      // The previous AI branch left busy set; clear it or the human's
      // canvas clicks will be ignored for the rest of the opening.
      busy = false;
      setHint('Place your second settlement.');
      render();
    }
  }

  // Escape hatch used by End turn / Roll during setup so the opening always
  // completes even if the human never clicks.
  function autoFinishHumanSetup() {
    let guard = 0;
    while (g.current === 0 && isSetup() && !busy && guard++ < 20) {
      const p = g.players[0];
      if (g.phase === 'setup1') {
        // The AI pickers gate on affordability, so lend a temporary hand:
        // setup pieces are free and freeBuild folds tile gains back in.
        const saved = p.hand;
        p.hand = Object.assign(STATE.emptyHand(),
          { forest: 4, hill: 4, field: 4, pasture: 4, mount: 4 });
        const s = AI.bestSettlement(g, 0);
        p.hand = saved;
        if (!s) { setHint('No legal settlement spot left.'); render(); return; }
        freeBuild(p, 'settlement', s.id);
        log('You founded your first settlement.');
        g.phase = 'setup2';
        RULES.refreshScores(g);
        render();
      } else {
        const saved = p.hand;
        p.hand = Object.assign(STATE.emptyHand(),
          { forest: 4, hill: 4, field: 4, pasture: 4, mount: 4 });
        const r = AI.bestRoad(g, 0);
        p.hand = saved;
        if (!r) { setHint('No legal road spot left.'); render(); return; }
        freeBuild(p, 'road', r.id);
        log('You built your first road.');
        RULES.refreshScores(g);
        advanceSetup();              // may hand over to an AI (sets busy)
        if (busy) return;
      }
    }
    render();
  }

  // ---- development cards
  function buyDevCard() {
    if (busy || g.current !== 0 || g.phase !== 'build') return;
    const card = RULES.buyDevCard(g, 0);
    if (!card) {
      setHint(g.deck.length === 0
        ? 'The development deck is empty.'
        : 'Not enough resources for a development card.');
      render();
      return;
    }
    log(`You bought a ${STATE.DEV_CARDS[card].label} card.`);
    setHint(`You drew a ${STATE.DEV_CARDS[card].label} card.`);
    render();
  }

  function playDevCard(type) {
    if (busy || g.current !== 0 || g.phase !== 'build') return;
    if (!RULES.playDevCard(g, 0, type)) return;
    log(`You played a ${STATE.DEV_CARDS[type].label} card.`);
    if (RULES.checkWinner(g)) { render(); return; }
    // A Knight summons the robber: let the human place it.
    if (type === 'knight' && g.robberFromSeven) {
      resolveSeven(0);
      return;
    }
    setHint(`Played ${STATE.DEV_CARDS[type].label}.`);
    render();
  }

  // ---- turn flow
  function endTurn() {
    if (busy || g.current !== 0 || g.phase === 'done') return;
    if (discardNeed > 0) return;
    if (isSetup()) {
      autoFinishHumanSetup();
      return;
    }
    if (g.robberFromSeven) {
      setHint('Move the robber before ending your turn.');
      return;
    }
    if (RULES.checkWinner(g)) { render(); return; }
    const p = g.players[0];
    p.hasRolled = false;
    p.devPlayedThisTurn = false;
    p.builtThisTurn = 0;
    tool = null;
    g.current = (g.current + 1) % g.players.length;
    g.dice = null;
    g.phase = 'roll';
    const cur = STATE.currentPlayer(g);
    if (cur.isAI) runAITurn(cur);
    else {
      setHint('Roll the dice.');
      render();
    }
  }

  function runAITurn(p) {
    busy = true;
    setTimeout(() => {
      const a = rollDice();
      const b = rollDice();
      const total = a + b;
      g.dice = { a, b, total };
      p.hasRolled = true;
      log(`${p.name} rolled ${total}.`);
      if (total !== 7) {
        produce(total);
        RULES.refreshScores(g);
        render();
      }
      // takeTurn() owns robber moves, discards, dev cards and building.
      AI.takeTurn(g, () => finishAITurn(p));
    }, 600);
  }

  function finishAITurn(p) {
    p.hasRolled = false;
    p.devPlayedThisTurn = false;
    p.builtThisTurn = 0;
    RULES.refreshScores(g);
    busy = false;
    if (g.winner || g.phase === 'done') { render(); return; }
    g.robberFromSeven = false;
    g.current = (g.current + 1) % g.players.length;
    g.dice = null;
    g.phase = 'roll';
    const cur = STATE.currentPlayer(g);
    if (cur.isAI) runAITurn(cur);
    else {
      setHint('Roll the dice.');
      render();
    }
  }

  // ---- input
  function canvasPos(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (canvas.width / rect.width),
      y: (ev.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  // Vertices and edges are stored in board coordinates; the canvas holds
  // projected screen pixels, so every pick has to go through the projection
  // before it can be distance-compared against a click.
  const proj = () =>
    RENDER.makeProjection(g.map.view, canvas.width, canvas.height, cam).project;

  function pick(pos) {
    const project = proj();
    let best = null, bestD = 34;
    for (const v of g.map.vertices) {
      const s = project(v.x, v.y, RENDER.HEIGHT);
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function pickEdge(pos) {
    const project = proj();
    let best = null, bestD = 26;
    for (const e of g.map.edges) {
      const s = project(e.x, e.y, 0);
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  function pickTile(pos) {
    const project = proj();
    let best = null, bestD = 46;
    for (const t of g.map.tiles) {
      const s = project(t.center.x, t.center.y, RENDER.HEIGHT);
      const d = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  // ---- camera input: wheel zoom, drag pan, two-finger pinch -------------
  // A drag that panned the map must NOT also count as a click that places a
  // building, so click checks the dragMoved flag first.
  let dragMoved = false;

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const pos = canvasPos(ev);
    cam = RENDER.zoomAt(cam, g.map.view, canvas.width, canvas.height,
      pos.x, pos.y, ev.deltaY < 0 ? 1.13 : 1 / 1.13);
    render();
  }, { passive: false });

  const activePtrs = new Map();
  let pinchDist = 0;

  canvas.addEventListener('pointerdown', (ev) => {
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* fine */ }
    }
    activePtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (activePtrs.size === 1) dragMoved = false;
    if (activePtrs.size === 2) {
      const [p1, p2] = [...activePtrs.values()];
      pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    const prev = activePtrs.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    const rect = canvas.getBoundingClientRect();
    const k = canvas.width / Math.max(1, rect.width);

    if (activePtrs.size === 1) {
      const dx = (cur.x - prev.x) * k, dy = (cur.y - prev.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved = true;
      // Free panning at any zoom: the island can be dragged around even when
      // it fully fits the screen; clampCamera keeps part of it visible.
      if (dragMoved) {
        cam = RENDER.pan(cam, g.map.view, canvas.width, canvas.height, dx, dy);
        render();
      }
    } else if (activePtrs.size === 2) {
      activePtrs.set(ev.pointerId, cur);
      const [p1, p2] = [...activePtrs.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (pinchDist > 0 && d > 0) {
        const mx = ((p1.x + p2.x) / 2 - rect.left) * k;
        const my = ((p1.y + p2.y) / 2 - rect.top) * k;
        cam = RENDER.zoomAt(cam, g.map.view, canvas.width, canvas.height,
          mx, my, d / pinchDist);
        dragMoved = true;
        render();
      }
      pinchDist = d;
      return;
    }
    activePtrs.set(ev.pointerId, cur);
  });

  const releasePtr = (ev) => {
    activePtrs.delete(ev.pointerId);
    pinchDist = 0;
  };
  canvas.addEventListener('pointerup', releasePtr);
  canvas.addEventListener('pointercancel', releasePtr);

  // Zoom buttons: step around the viewport centre; fit restores zoom 1.
  function zoomStep(factor) {
    cam = RENDER.zoomAt(cam, g.map.view, canvas.width, canvas.height,
      canvas.width / 2, canvas.height / 2, factor);
    render();
  }
  const zoomInBtn = $('btn-zoom-in');
  if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoomStep(1.3));
  const zoomOutBtn = $('btn-zoom-out');
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomStep(1 / 1.3));
  const zoomFitBtn = $('btn-zoom-fit');
  if (zoomFitBtn) {
    zoomFitBtn.addEventListener('click', () => {
      cam = { zoom: 1, cx: null, cy: null };
      render();
    });
  }

  // Options popover (music / SFX / volume / new game / debug) behind the gear.
  const menuBtn = $('btn-menu');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const m = $('optmenu');
      if (m) m.classList.toggle('open');
    });
  }

  const sfxBtn = $('btn-sfx');
  if (sfxBtn) {
    sfxBtn.addEventListener('click', () => {
      const on = AUDIO.setSfx(!AUDIO.isSfxOn());
      sfxBtn.textContent = 'SFX: ' + (on ? 'on' : 'off');
    });
  }

  const volEl = $('volume');
  if (volEl) volEl.addEventListener('input', () => AUDIO.setVolume(volEl.value / 100));

  // Collapsible log for small screens (button is shown by CSS media query).
  const logBtn = $('btn-log');
  if (logBtn) {
    logBtn.addEventListener('click', () =>
      document.body.classList.toggle('log-open'));
  }

  // Highlight spots breathe while the human has a decision to make; the
  // canvas-only loop skips the DOM work render() does each frame.
  function highlightsActive() {
    if (!g || g.phase === 'done') return false;
    if (g.current !== 0 || busy) return false;
    return isSetup() || g.phase === 'robber' ||
      (g.phase === 'build' && (tool || g.robberFromSeven));
  }
  function frame(ts) {
    if (highlightsActive()) {
      animT = ts;
      resizeCanvas();
      RENDER.draw(ctx, g, canvas.width, canvas.height, null, tool, 0, cam, { t: ts });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  canvas.addEventListener('click', (ev) => {
    if (dragMoved) { dragMoved = false; return; }  // that was a pan, not a tap
    if (g.current !== 0 || busy || g.phase === 'done') return;
    if (discardNeed > 0) return;          // finish the discard first
    const pos = canvasPos(ev);
    if (g.phase === 'robber') {
      const t = pickTile(pos);
      if (t) resolveHumanRobber(HEX.key(t.q, t.r));
      return;
    }
    if (isSetup()) {
      if (g.phase === 'setup2') {
        const e = pickEdge(pos);
        if (e && trySetupPlace('road', e.id)) return;
      } else {
        const v = pick(pos);
        if (v && trySetupPlace('settlement', v.id)) return;
      }
      return;
    }
    if (g.phase !== 'build') return;
    if (tool === 'road') {
      const e = pickEdge(pos);
      if (e) tryPlace('road', e.id);
    } else {
      const v = pick(pos);
      if (v) tryPlace(tool || 'settlement', v.id);
    }
  });

  function syncBuildBar() {
    for (const b of document.querySelectorAll('[data-build]')) {
      b.classList.toggle('active', b.dataset.build === tool);
      b.disabled = g.current !== 0 || busy ||
        !(isSetup() || g.phase === 'build');
    }
    const tradeBtn = $('btn-trade');
    if (tradeBtn) {
      tradeBtn.disabled = g.current !== 0 || busy || discardNeed > 0 ||
        g.phase !== 'build';
      tradeBtn.classList.toggle('active', !!trade);
    }
    const el = $('buildhint');
    if (!el) return;
    if (discardNeed > 0) el.textContent = 'Discard first.';
    else if (g.phase === 'setup1') {
      el.textContent = 'Click a highlighted corner to found your settlement (free).';
    } else if (g.phase === 'setup2') {
      el.textContent = 'Click a highlighted edge to lay a road (free).';
    } else if (g.phase === 'robber') {
      el.textContent = 'Click a tile to drop the robber on it.';
    } else if (tool) {
      el.textContent = `Click a highlighted spot to build a ${tool}.`;
    } else {
      el.textContent = 'Pick a build tool, then click a highlighted spot.';
    }
  }

  for (const b of document.querySelectorAll('[data-build]')) {
    b.addEventListener('click', () => {
      if (g.current !== 0 || busy || g.phase === 'done') return;
      if (!(isSetup() || g.phase === 'build')) return;
      tool = tool === b.dataset.build ? null : b.dataset.build;
      render();
    });
  }

  const tradeBtn = $('btn-trade');
  if (tradeBtn) {
    tradeBtn.addEventListener('click', () => {
      if (busy || g.current !== 0 || discardNeed > 0 || g.phase !== 'build') return;
      trade = trade ? null : { give: {}, want: {} };
      render();
    });
  }

  const tradePanelEl = $('tradepanel');
  if (tradePanelEl) {
    // Chips cycle their count on click: give is capped by your hand, get
    // by a sane 4-per-resource ask.
    tradePanelEl.addEventListener('click', (ev) => {
      if (!trade) return;
      const chip = ev.target.closest ? ev.target.closest('.res') : null;
      if (!chip || !chip.dataset.res) return;
      const res = chip.dataset.res;
      if (chip.parentElement.id === 'trade-give') {
        const max = g.players[0].hand[res];
        trade.give[res] = ((trade.give[res] || 0) + 1) % (max + 1);
      } else {
        trade.want[res] = ((trade.want[res] || 0) + 1) % 5;
      }
      renderTradePanel();
    });
    const offerBtn = $('btn-offer');
    if (offerBtn) offerBtn.addEventListener('click', proposeTrade);
    const clearBtn = $('btn-trade-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        trade = { give: {}, want: {} };
        renderTradePanel();
      });
    }
    const closeBtn = $('btn-trade-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => { trade = null; render(); });
    }
  }

  const rollBtn = $('btn-roll');
  if (rollBtn) rollBtn.addEventListener('click', roll);

  const passBtn = $('btn-pass');
  if (passBtn) passBtn.addEventListener('click', endTurn);

  const devBtn = $('btn-dev');
  if (devBtn) devBtn.addEventListener('click', buyDevCard);

  const handEl = $('hand');
  if (handEl) {
    handEl.addEventListener('click', (ev) => {
      if (discardNeed <= 0 || g.current !== 0 || busy) return;
      const chip = ev.target.closest ? ev.target.closest('.res') : null;
      if (!chip || !chip.dataset || !chip.dataset.res) return;
      const res = chip.dataset.res;
      const p = g.players[0];
      if (pickedCount() >= discardNeed) return;
      if ((discardPick[res] || 0) >= p.hand[res]) return;
      discardPick[res] = (discardPick[res] || 0) + 1;
      renderHand();
      if (pickedCount() >= discardNeed) finishDiscard();
    });
  }

  const musicBtn = $('btn-music');
  if (musicBtn) {
    musicBtn.addEventListener('click', () => {
      const on = AUDIO.toggle();
      musicBtn.textContent = on ? 'Music: on' : 'Music: off';
    });
  }

  const opponentCount = $('opponent-count');
  const islandSize = $('island-size');
  const newBtn = $('btn-new');
  if (newBtn) newBtn.addEventListener('click', () => startNewGame());

  const debugBtn = $('btn-debug');
  if (debugBtn) debugBtn.addEventListener('click', () => { runDebugAutoPlay(); });

  function startNewGame() {
    winAnnounced = false;
    trade = null;
    const aiCount = opponentCount ? Math.min(3, Math.max(1, Number(opponentCount.value) || 2)) : 2;
    const radius = islandSize && islandSize.value === 'xl' ? 3 : 2;
    g = STATE.newGame(aiCount + 1, radius);
    setupIdx = 0;
    tool = null;
    busy = false;
    discardNeed = 0;
    for (const k of Object.keys(discardPick)) delete discardPick[k];
    g.phase = 'setup1';
    g.current = g.setupOrder[0];
    log('A new island. Place your settlement to begin (desert tile should render - version 2.0)'); setTimeout(() => log('Island rendering confirmed.'), 500);
    setHint('Place your settlement.');
    render();
  }

  // ---- debug auto-play: drives the real click path, no shortcuts
  // The human's best city: an owned settlement that is affordable to upgrade.
  function debugBestCity(pid) {
    const p = g.players[pid];
    for (const vid of p.settlements) {
      if (RULES.canBuildCity(g, pid, vid)) return { id: vid };
    }
    return null;
  }

  // Play one greedy human turn's worth of building, using the same decision
  // helpers the AI uses so a full game can be simulated quickly.
  function debugBuildTurn(pid) {
    const p = g.players[pid];
    let built = 0;

    // Convert surplus resources into what we can actually build.
    RULES.tradeTowardBuild(g, pid);

    // Buy and play a development card when it makes sense.
    if (!p.devPlayedThisTurn && RULES.canAfford(p, 'devCard') && g.deck.length > 0) {
      const card = RULES.buyDevCard(g, pid);
      if (card && card !== 'victory') {
        RULES.playDevCard(g, pid, card);
        if (card === 'knight' && g.robberFromSeven) {
          AI.smartRobberMove(g, pid);
          g.phase = 'build';
        }
      }
    }

    const city = debugBestCity(pid);
    if (city) {
      RULES.buildCity(g, pid, city.id);
      log(`${p.name} built a city.`);
      built++;
    } else if (p.settlements.length + p.cities.length < 5) {
      const s = AI.bestSettlement(g, pid);
      if (s) {
        RULES.buildSettlement(g, pid, s.id);
        log(`${p.name} founded a settlement.`);
        built++;
      }
    }
    if (built < 2) {
      const r = AI.bestRoad(g, pid);
      if (r) {
        RULES.buildRoad(g, pid, r.id);
        log(`${p.name} built a road.`);
        built++;
      }
    }
    RULES.refreshScores(g);
    return built;
  }

  // Auto-resolve anything the human must decide, so a full game runs unattended.
  function debugResolveHumanObligations() {
    const p = g.players[0];
    if (discardNeed > 0) {
      AI.autoDiscard(g, 0);
      discardNeed = 0;
      for (const k of Object.keys(discardPick)) delete discardPick[k];
    }
    // Do not gate on phase === 'robber': a 7 can leave the robber flag set
    // while the phase is still 'build', and a leaked flag makes endTurn()
    // refuse forever, which stalls the whole auto-play run.
    if (g.robberFromSeven) {
      AI.smartRobberMove(g, 0);
      g.robberFromSeven = false;
    }
    if (g.phase === 'robber') g.phase = 'build';
    void p;
  }

  // ---- debug auto-play: plays a COMPLETE game to a winner (10 VP)
  async function runDebugAutoPlay() {
    if (debugRunning) return;
    debugRunning = true;
    const btn = $('btn-debug');
    if (btn) { btn.disabled = true; btn.textContent = 'Debug: playing…'; }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const MAX_TURNS = 400;

    startNewGame();
    busy = false;

    try {
      // 1. Walk the snake setup order to completion.
      // Setup pieces are free, but the AI helpers only suggest a spot when
      // the player can afford one, so lend a temporary hand for each pick.
      function pickSetupSpot(kind) {
        const p = g.players[0];
        const saved = p.hand;
        p.hand = Object.assign(STATE.emptyHand(),
          { forest: 4, hill: 4, field: 4, pasture: 4, mount: 4 });
        const pick = kind === 'settlement'
          ? AI.bestSettlement(g, 0)
          : AI.bestRoad(g, 0);
        p.hand = saved;
        return pick;
      }

      let guard = 0;
      while (isSetup() && !g.winner && guard++ < 40) {
        if (g.current === 0) {
          // Human slot: place with the AI's own helpers.
          const p = g.players[0];
          if (g.phase === 'setup1') {
            const s = pickSetupSpot('settlement');
            if (s) {
              freeBuild(p, 'settlement', s.id);
              log('You founded your first settlement.');
              g.phase = 'setup2';
            } else {
              break;              // nowhere legal left to play
            }
          } else {
            const r = pickSetupSpot('road');
            if (r) {
              freeBuild(p, 'road', r.id);
              log('You built your first road.');
            }
            advanceSetup();
          }
          RULES.refreshScores(g);
          render();
          await sleep(20);
        } else {
          await sleep(700);          // AI setup runs on its own timer
        }
      }
      if (isSetup()) autoFinishHumanSetup();
      while (busy) await sleep(100);
      await sleep(400);

      // 2. Play turns until somebody reaches 10 victory points.
      let turns = 0;
      while (!g.winner && g.phase !== 'done' && turns < MAX_TURNS) {
        turns++;
        if (turns % 25 === 0) {
          log(`Debug: turn ${turns}… scores ` +
            g.players.map(p => `${p.name} ${p.score}`).join(', '));
        }

        if (isSetup()) { autoFinishHumanSetup(); await sleep(300); continue; }

        if (g.current === 0) {
          debugResolveHumanObligations();
          if (g.phase === 'roll') { roll(); await sleep(30); }
          debugResolveHumanObligations();
          if (g.phase === 'build') { tool = null; debugBuildTurn(0); }
          RULES.checkWinner(g);
          render();
          if (g.winner || g.phase === 'done') break;
          endTurn();                 // hands the turn to the AI
          await sleep(60);
        } else if (g.phase === 'roll' && !busy) {
          // endTurn() is human-only, so when the loop lands on the AI's turn
          // nothing has started it yet. Kick off the AI turn directly.
          runAITurn(STATE.currentPlayer(g));
          await sleep(60);
        }

        // Let the AI's timer chain finish before the next iteration.
        let w = 0;
        while (busy && w++ < 200) await sleep(50);
        await sleep(60);
      }

      RULES.refreshScores(g);
      if (g.winner) {
        log(`Debug: GAME OVER — ${g.winner.name} wins with ${g.winner.score} VP ` +
          `after ${turns} turns.`);
      } else {
        log(`Debug: hit the ${MAX_TURNS}-turn cap without a winner. ` +
          g.players.map(p => `${p.name} ${p.score} vp`).join(', '));
      }
      setHint('Debug run finished. Press New game to play yourself.');
    } catch (err) {
      log('Debug: error — ' + (err && err.message ? err.message : String(err)));
      throw err;
    } finally {
      busy = false;
      debugRunning = false;
      tool = null;
      if (btn) { btn.disabled = false; btn.textContent = 'Debug: auto-play'; }
      render();
    }
  }

  // ---- boot
  startNewGame();
  window.addEventListener('resize', render);
  // Rotation re-fits the base scale; zoom is kept relative to the fit.
  window.addEventListener('orientationchange', () => setTimeout(render, 120));

  // Decode the SVG artwork once; the first render draws flat hexes, then the
  // sprites land and we repaint. Sizes are ON-SCREEN pixels: the projection
  // scales the board several times over, and blitting a small sprite into a
  // large cell is what made everything look blurry.
  if (typeof ART !== 'undefined' && g && g.map) {
    // Preload at the DEVICE-pixel scale actually used for drawing (the canvas
    // backing store is dpr-scaled), including the user's current zoom.
    const sc = RENDER.makeProjection(g.map.view, canvas.width, canvas.height, cam).scale;
    const hexPx = Math.min(1400, Math.ceil(g.map.S * 2 * sc));
    const piecePx = Math.min(400, Math.ceil(30 * sc));
    ART.preload(hexPx, piecePx, STATE.PLAYER_COLORS).then(render);
  }
})();