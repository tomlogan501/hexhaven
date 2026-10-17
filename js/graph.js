// Resource-history graph: records every player's full hand at each turn
// boundary and draws the evolution of ONE selected resource (or the hand
// total) as one line per player on a plain canvas — no chart library, same
// dependency-free spirit as the game.
// The window may be shown/collapsed (see #hud-graph in index.html/style.css);
// the resource to plot is picked with the #graph-res dropdown.
const GRAPH = (() => {
  // One entry per finished turn: per player, a copy of the whole hand.
  let history = [];

  function reset() { history = []; }

  // Take a snapshot of every player's hand. Called at each turn change
  // (endTurn / finishAITurn) and once at game start.
  function turnSnapshot(g) {
    history.push(g.players.map((p) => Object.assign({}, p.hand)));
    // Keep the graph bounded during long debug runs.
    if (history.length > 900) history.shift();
  }

  // Full hand for an entry, or just one resource; resSel null = total.
  const val = (row, pi, resSel) => {
    const hand = row[pi] || {};
    if (!resSel) {
      return Object.values(hand).reduce((a, n) => a + n, 0);
    }
    return hand[resSel] || 0;
  };

  // Round 1.2-ish up to a nice tick step.
  function niceStep(max) {
    const raw = max / 5;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) {
      if (m * pow >= raw) return m * pow;
    }
    return 10 * pow;
  }

  // Draw onto a canvas element. resSel is a resource key ('forest', …) or
  // null/undefined for the hand total. Player names/colors come from the
  // game, so the legend always matches the players panel.
  function draw(cv, g, resSel) {
    if (!cv || !cv.getContext) return;
    const dpr = (typeof devicePixelRatio === 'number') ? devicePixelRatio : 1;
    const w = cv.clientWidth || 320;
    const h = cv.clientHeight || 170;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const x = cv.getContext('2d');
    if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);

    const padL = 30, padB = 17, padT = 20, padR = 6;
    const gw = Math.max(10, w - padL - padR);
    const gh = Math.max(10, h - padT - padB);

    // Scales: Y to the largest plotted value, X spans at least 10 turns so
    // the opening stretch is readable.
    let maxV = 5;
    for (const row of history) {
      for (let pi = 0; pi < row.length; pi++) {
        const v = val(row, pi, resSel);
        if (v > maxV) maxV = v;
      }
    }
    const yMax = Math.ceil(maxV / 5) * 5;
    const nTurns = Math.max(10, history.length);

    const px = (i) => padL + (gw * (i + 1)) / nTurns;
    const py = (v) => padT + gh * (1 - v / yMax);

    // Grid + Y ticks.
    const step = yMax > 0 ? niceStep(yMax) : 1;
    x.strokeStyle = 'rgba(255,255,255,.09)';
    x.fillStyle = 'rgba(255,255,255,.55)';
    x.font = '9px system-ui, sans-serif';
    x.textAlign = 'right';
    x.lineWidth = 1;
    for (let v = 0; v <= yMax; v += step) {
      const y = py(v);
      x.beginPath();
      x.moveTo(padL, y);
      x.lineTo(padL + gw, y);
      x.stroke();
      x.fillText(String(v), padL - 4, y + 3);
    }

    // One step line per player for the selected resource.
    for (let pi = 0; pi < (g ? g.players.length : 0); pi++) {
      x.beginPath();
      x.strokeStyle = (g.players[pi] && g.players[pi].color) || '#888';
      x.lineWidth = 1.6;
      x.lineJoin = 'round';
      if (history.length) {
        x.moveTo(px(0), py(val(history[0], pi, resSel)));
        for (let i = 1; i < history.length; i++) {
          x.lineTo(px(i), py(val(history[i], pi, resSel)));
        }
        x.lineTo(px(history.length - 1), py(val(history[history.length - 1], pi, resSel)));
      } else {
        x.moveTo(px(0), py(0));
      }
      x.stroke();
    }

    // Legend: colour dot + name + current value, laid out along the top.
    if (g) {
      x.textAlign = 'left';
      let lx = padL;
      x.font = '10px system-ui, sans-serif';
      for (const p of g.players) {
        const cur = history.length
          ? val(history[history.length - 1], p.id, resSel) : 0;
        const label = (p.name || '?') + ': ' + cur;
        x.fillStyle = p.color;
        x.fillRect(lx, 8, 7, 7);
        x.fillStyle = 'rgba(255,255,255,.85)';
        x.fillText(label, lx + 10, 15);
        lx += 12 + x.measureText(label).width + 10;
        if (lx > padL + gw) break;   // narrow window: first players win
      }
    }
  }

  return { reset, turnSnapshot, draw, get length() { return history.length; } };
})();
