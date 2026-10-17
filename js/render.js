// Canvas renderer: flat top-down board (no 3D).
const RENDER = (() => {
  const HEIGHT = 0;           // no extrusion: everything is flat on the board
  const PIECE_H = 22;         // settlement/city height

  // Board coords (x right, y down) -> screen, straight and unsheared so the
  // hexes sit in a regular grid with no tilt.
  //
  // ---- camera: fit-to-screen base scale + user zoom/pan -----------------

  // Decorative wave arcs scattered around the island, generated once from a
  // fixed seed so the sea looks alive but identical on every frame.
  const WAVES = (() => {
    let s = 42;
    const rnd = () =>
      (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out = [];
    for (let i = 0; i < 90; i++) {
      out.push({
        x: (rnd() * 2 - 1) * 1500,
        y: (rnd() * 2 - 1) * 1500,
        r: 3 + rnd() * 7,
        a: rnd() * Math.PI,
      });
    }
    return out;
  })();
  // The base scale always CONTAINS the whole board, in portrait and in
  // landscape alike. The old max(byHeight, ...) let the island spill off
  // narrow windows, cropping tiles with no way to scroll back to them.
  // zoom 1 always shows the entire island, so it is a safe default; the user
  // can then pinch / scroll / use the +/− buttons to get closer.
  function fitScale(view, w, h) {
    const margin = 10;
    return Math.max(1, Math.min(
      (w - margin * 2) / view.w,
      (h - margin * 2) / view.h));
  }

  // Zoom-out goes BELOW the fit scale so the island can be pulled back into
  // its sea context; clampCamera keeps it centred whenever it is smaller
  // than the viewport, so a zoomed-out island can never drift off-screen.
  const MIN_ZOOM = 0.5, MAX_ZOOM = 6;

  function defaultCamera() { return { zoom: 1, cx: null, cy: null }; }

  // Keep the camera legal: zoom within range, and the island always partly
  // visible. The centre may move freely — at ANY zoom, including the fit
  // view — but at least half the island (never under 30%) must stay on
  // screen, so panning can shift the island around without ever parking it
  // out of sight.
  function clampCamera(cam, view, w, h) {
    cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom || 1));
    const scale = fitScale(view, w, h) * cam.zoom;
    const halfW = w / (2 * scale), halfH = h / (2 * scale);
    const keepW = Math.min(view.w, Math.max(Math.min(halfW, view.w / 2), view.w * 0.3));
    const keepH = Math.min(view.h, Math.max(Math.min(halfH, view.h / 2), view.h * 0.3));
    const cx = cam.cx == null ? view.x + view.w / 2 : cam.cx;
    const cy = cam.cy == null ? view.y + view.h / 2 : cam.cy;
    cam.cx = Math.min(Math.max(cx, view.x + keepW - halfW), view.x + view.w - keepW + halfW);
    cam.cy = Math.min(Math.max(cy, view.y + keepH - halfH), view.y + view.h - keepH + halfH);
    return cam;
  }

  function makeProjection(view, w, h, cam) {
    const c = cam ? clampCamera({ zoom: cam.zoom, cx: cam.cx, cy: cam.cy }, view, w, h)
                  : defaultCamera();
    const scale = fitScale(view, w, h) * c.zoom;
    const cx = c.cx == null ? view.x + view.w / 2 : c.cx;
    const cy = c.cy == null ? view.y + view.h / 2 : c.cy;
    const ox = w / 2 - cx * scale;
    const oy = h / 2 - cy * scale;

    // Nothing occludes anything, so no depth sorting is needed.
    // `scale` is exposed on the projection itself: the draw helpers need it to
    // rasterise sprites at their true on-screen size, and reading it off the
    // projected point would silently yield undefined.
    const project = (x, y) => ({ x: ox + x * scale, y: oy + y * scale, scale });
    project.scale = scale;
    return { project, scale, depth: () => 0, ox, oy, zoom: c.zoom };
  }

  // Zoom keeping the board point under screen position (sx, sy) pinned.
  function zoomAt(cam, view, w, h, sx, sy, factor) {
    const before = makeProjection(view, w, h, cam);
    const bx = (sx - before.ox) / before.scale;
    const by = (sy - before.oy) / before.scale;
    cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (cam.zoom || 1) * factor));
    const after = makeProjection(view, w, h, cam);
    cam.cx = (w / 2 - sx) / after.scale + bx;
    cam.cy = (h / 2 - sy) / after.scale + by;
    return clampCamera(cam, view, w, h);
  }

  // Pan by a screen-pixel delta (dx, dy).
  function pan(cam, view, w, h, dx, dy) {
    const scale = fitScale(view, w, h) * (cam.zoom || 1);
    cam.cx = (cam.cx == null ? view.x + view.w / 2 : cam.cx) - dx / scale;
    cam.cy = (cam.cy == null ? view.y + view.h / 2 : cam.cy) - dy / scale;
    return clampCamera(cam, view, w, h);
  }

  function poly(ctx, pts, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r},${gg},${b})`;
  }

  function hexPath(tile, S, project) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const off = HEX.cornerOffset(i, S);
      pts.push(project(tile.center.x + off.x, tile.center.y + off.y));
    }
    return pts;
  }

  // One flat hex: the pre-rendered SVG artwork, or a plain polygon fallback.
  function drawTile(ctx, tile, S, project, colors, highlight) {
    const top = hexPath(tile, S, project);
    if (!colors['desert']) colors['desert'] = '#f0a475'; const base = colors[tile.res] || '#f0a475';
    // Rasterise at the size the hex actually occupies on screen, otherwise
    // the sprite is upscaled and the board looks soft.
    const sc = project.scale;
    const art = ART.tile(tile.res, S * 2 * sc);

    if (art) {
      const xs = top.map(p => p.x), ys = top.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      ctx.save();
      if (highlight) ctx.filter = 'brightness(1.22)';
      ctx.drawImage(art, minX, minY, maxX - minX, maxY - minY);
      ctx.restore();
      // A crisp gold rim makes the selected tile pop without washing out the
      // artwork underneath the brightness filter.
      if (highlight) {
        ctx.save();
        ctx.strokeStyle = 'rgba(240, 201, 135, .9)';
        ctx.lineWidth = Math.max(2, 2.4 * sc);
        ctx.beginPath();
        ctx.moveTo(top[0].x, top[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(top[i].x, top[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    } else {
      // Ensure desert tiles get proper color even with fallback
      const finalColor = (tile.res === 'desert') ? '#f0a475' : (colors[tile.res] || base);
      poly(ctx, top, highlight ? shade(finalColor, 26) : finalColor, 'rgba(0,0,0,.3)');
    }
  }

  // Number tokens share the harbour buoy styling so the whole board speaks
  // one visual language: deep-sea disc, light-blue ring, gold number, pale
  // pips underneath (dots = 6 - |n - 7|, the real Catan odds).
  function drawToken(ctx, tile, S, project, colors) {
    if (tile.res === 'desert') return;
    const c = project(tile.center.x, tile.center.y);
    const k = project.scale;
    const r = Math.max(8, S * 0.32 * k);

    // Drop shadow first so the token lifts off the tile.
    ctx.beginPath();
    ctx.arc(c.x, c.y + r * 0.16, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 18, 32, .4)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    if (typeof ctx.createRadialGradient === 'function') {
      try {
        const g = ctx.createRadialGradient(
          c.x - r * 0.3, c.y - r * 0.35, r * 0.2, c.x, c.y, r);
        g.addColorStop(0, '#3f7db3');
        g.addColorStop(1, '#173d61');
        ctx.fillStyle = g;
      } catch (e) { ctx.fillStyle = '#1d4266'; }
    } else ctx.fillStyle = '#1d4266';
    ctx.fill();
    ctx.strokeStyle = 'rgba(168, 216, 255, .85)';
    ctx.lineWidth = Math.max(1.2, S * 0.05 * k);
    ctx.stroke();

    // Thin inner ring, same detail line as the harbour buoys.
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(168, 216, 255, .28)';
    ctx.lineWidth = Math.max(1, S * 0.03 * k);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd98a';
    ctx.font = `700 ${Math.round(S * 0.28 * k)}px "Trebuchet MS", sans-serif`;
    ctx.fillText(String(tile.num), c.x, c.y - r * 0.18);

    const pips = Math.max(1, 6 - Math.abs(tile.num - 7));
    ctx.fillStyle = '#d8ecff';
    const pr = Math.max(1.1, S * 0.028 * k);
    const gap = pr * 2.6;
    const x0 = c.x - ((pips - 1) * gap) / 2;
    for (let i = 0; i < pips; i++) {
      ctx.beginPath();
      ctx.arc(x0 + i * gap, c.y + r * 0.42, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    void colors;
  }

  function drawHouse(ctx, v, project, color, isCity) {
    const base = project(v.x, v.y);
    // Pieces are authored at ~30px but the board is scaled up, so size them
    // by the projection or they render as specks.
    const size = (isCity ? 34 : 28) * project.scale;
    const art = ART.get(isCity ? 'city' : 'settlement', size, color);
    if (art) {
      ctx.drawImage(art, base.x - size / 2, base.y - size * 0.72, size, size);
      return;
    }
    const w = isCity ? 15 : 11;
    const h = isCity ? 30 : PIECE_H;
    const dx = w * 0.55, dy = w * 0.30;
    poly(ctx, [
      { x: base.x - w, y: base.y }, { x: base.x - w, y: base.y - h },
      { x: base.x - w + dx, y: base.y - h - dy }, { x: base.x + dx, y: base.y - dy },
    ], shade(color, -40), null);
    poly(ctx, [
      { x: base.x + dx, y: base.y - dy }, { x: base.x + dx, y: base.y - h - dy },
      { x: base.x + w, y: base.y - h }, { x: base.x + w, y: base.y },
    ], shade(color, -14), null);
    poly(ctx, [
      { x: base.x - w, y: base.y - h }, { x: base.x - w + dx, y: base.y - h - dy },
      { x: base.x + w + dx, y: base.y - h - dy }, { x: base.x + w, y: base.y - h },
    ], shade(color, 34), null);
  }

  // Harbour badge: a round buoy OUT in the sea, offset from the coast along
  // the island-centre -> edge direction, tied to the shore with a small
  // wooden jetty. Ratio on top, resource icon underneath. Drawing it away
  // from the tiles keeps every hex edge clean and readable.
  function drawHarbor(ctx, e, project, harbor, S, centerX, centerY) {
    if (!harbor) return;
    const dx = e.x - centerX, dy = e.y - centerY;
    const len = Math.hypot(dx, dy) || 1;
    // Stay inside the map view's shore padding (S * 1.05): centre at 0.60 S
    // + radius 0.40 S keeps the whole buoy on screen in tight portrait fits.
    const off = S * 0.60;
    const a = project(e.x, e.y);
    const p = project(e.x + (dx / len) * off, e.y + (dy / len) * off);
    const k = project.scale;
    const r = Math.max(9, S * 0.40 * k);

    // Wooden jetty from the coast to the buoy.
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10, 20, 30, .35)';
    ctx.lineWidth = Math.max(3, S * 0.13 * k);
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 2 * k); ctx.lineTo(p.x, p.y + 2 * k); ctx.stroke();
    ctx.strokeStyle = '#8a6238';
    ctx.lineWidth = Math.max(2.5, S * 0.10 * k);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.strokeStyle = '#a87c4a';
    ctx.lineWidth = Math.max(1, S * 0.04 * k);
    ctx.beginPath(); ctx.moveTo(a.x, a.y - k); ctx.lineTo(p.x, p.y - k); ctx.stroke();

    // Buoy shadow, then the disc.
    ctx.beginPath();
    ctx.arc(p.x, p.y + r * 0.18, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 18, 32, .4)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (typeof ctx.createRadialGradient === 'function') {
      try {
        const g = ctx.createRadialGradient(
          p.x - r * 0.3, p.y - r * 0.35, r * 0.2, p.x, p.y, r);
        g.addColorStop(0, '#3f7db3');
        g.addColorStop(1, '#173d61');
        ctx.fillStyle = g;
      } catch (e2) { ctx.fillStyle = '#1d4266'; }
    } else ctx.fillStyle = '#1d4266';
    ctx.fill();
    ctx.strokeStyle = 'rgba(168, 216, 255, .85)';
    ctx.lineWidth = Math.max(1.2, S * 0.05 * k);
    ctx.stroke();

    // Ratio (top) + resource icon (bottom). 2:1 ports get a warm ratio so
    // the good ones read at a glance; 3:1 shows the anchor. Ore ports draw
    // a faceted gray rock (vector): the ore emoji is unreliable on some
    // systems, and a rock reads better anyway.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = harbor.res ? '#ffd98a' : '#d8ecff';
    ctx.font = `700 ${Math.round(S * 0.34 * k)}px "Trebuchet MS", sans-serif`;
    ctx.fillText(harbor.ratio + ':1', p.x, p.y - r * 0.28);
    if (harbor.res === 'mount') {
      drawRock(ctx, p.x, p.y + r * 0.38, S * 0.30 * k);
    } else {
      ctx.font = `${Math.round(S * 0.30 * k)}px "Trebuchet MS", sans-serif`;
      ctx.fillText(harbor.res ? MAPGEN.HARBOR_LABELS[harbor.res] : '\u2693',
        p.x, p.y + r * 0.38);
    }
  }

  // A faceted gray boulder — the ore artwork. Drawn as vectors so it stays
  // crisp at every zoom and never depends on emoji fonts.
  function drawRock(ctx, cx, cy, s) {
    ctx.save();
    ctx.translate(cx, cy);
    // Body: irregular heptagon with a dark outline.
    ctx.beginPath();
    ctx.moveTo(-0.55 * s, 0.42 * s);
    ctx.lineTo(-0.38 * s, 0.05 * s);
    ctx.lineTo(-0.12 * s, -0.35 * s);
    ctx.lineTo(0.22 * s, -0.42 * s);
    ctx.lineTo(0.52 * s, -0.10 * s);
    ctx.lineTo(0.58 * s, 0.22 * s);
    ctx.lineTo(0.38 * s, 0.48 * s);
    ctx.lineTo(-0.30 * s, 0.52 * s);
    ctx.closePath();
    ctx.fillStyle = '#8d8d95';
    ctx.strokeStyle = 'rgba(18, 24, 32, .6)';
    ctx.lineWidth = Math.max(1, s * 0.09);
    ctx.fill();
    ctx.stroke();
    // Sunlit top facet for volume.
    ctx.beginPath();
    ctx.moveTo(-0.12 * s, -0.35 * s);
    ctx.lineTo(0.22 * s, -0.42 * s);
    ctx.lineTo(0.30 * s, -0.05 * s);
    ctx.lineTo(-0.10 * s, 0.02 * s);
    ctx.closePath();
    ctx.fillStyle = '#bcbfc7';
    ctx.fill();
    // Small dark speck like exposed ore.
    ctx.beginPath();
    ctx.arc(0.05 * s, 0.22 * s, s * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40, 48, 58, .45)';
    ctx.fill();
    ctx.restore();
  }

  // The robber: a scarlet badge in the same visual family as the number
  // tokens and harbour buoys, carrying a dark bandit bust (hat, head,
  // shoulders) with glowing gold eyes. Drawn as vectors so it stays crisp at
  // every zoom level.
  function drawRobber(ctx, tile, S, project) {
    const c = project(tile.center.x, tile.center.y);
    const k = project.scale;
    const r = Math.max(10, S * 0.38 * k);

    // Shadow, then the scarlet disc.
    ctx.beginPath();
    ctx.arc(c.x, c.y + r * 0.16, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 18, 32, .4)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    if (typeof ctx.createRadialGradient === 'function') {
      try {
        const g = ctx.createRadialGradient(
          c.x - r * 0.3, c.y - r * 0.35, r * 0.2, c.x, c.y, r);
        g.addColorStop(0, '#d4553f');
        g.addColorStop(1, '#7a2318');
        ctx.fillStyle = g;
      } catch (e) { ctx.fillStyle = '#8a2a1c'; }
    } else ctx.fillStyle = '#8a2a1c';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 190, 170, .9)';
    ctx.lineWidth = Math.max(1.2, S * 0.05 * k);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 0.8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 190, 170, .3)';
    ctx.lineWidth = Math.max(1, S * 0.03 * k);
    ctx.stroke();

    // Bandit bust in near-black against the red.
    const ink = '#20202a';
    ctx.fillStyle = ink;
    // Shoulders: a rounded trapezoid rising from the bottom of the disc.
    ctx.beginPath();
    ctx.moveTo(c.x - r * 0.46, c.y + r * 0.62);
    ctx.quadraticCurveTo(c.x - r * 0.5, c.y + r * 0.18, c.x, c.y + r * 0.18);
    ctx.quadraticCurveTo(c.x + r * 0.5, c.y + r * 0.18, c.x + r * 0.46, c.y + r * 0.62);
    ctx.closePath();
    ctx.fill();
    // Head.
    ctx.beginPath();
    ctx.arc(c.x, c.y - r * 0.12, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    // Tricorn hat: wide brim plus a domed crown.
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - r * 0.30, r * 0.42, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x, c.y - r * 0.30, r * 0.26, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    // Glowing gold eyes — the only warm point on the silhouette.
    ctx.fillStyle = '#ffd98a';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c.x + side * r * 0.10, c.y - r * 0.10, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHighlightVertex(ctx, v, project, color, glow) {
    const c = project(v.x, v.y);
    const r = Math.max(12, 8 * project.scale);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = glow;
    ctx.lineWidth = Math.max(2.5, project.scale * 1.4);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r, r * 0.58, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawRoad(ctx, e, va, vb, project, color) {
    const a = project(va.x, va.y);
    const b = project(vb.x, vb.y);
    // Width follows the projection so roads keep their proportions under
    // zoom instead of staying hairline-thin at fit scale.
    const wRoad = Math.min(26, Math.max(4, project.scale * 5));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Drop shadow, then the beam, then a lit core: a cheap 3D plank.
    ctx.strokeStyle = 'rgba(10, 20, 30, .35)';
    ctx.lineWidth = wRoad * 1.25;
    ctx.beginPath(); ctx.moveTo(a.x, a.y + wRoad * 0.22); ctx.lineTo(b.x, b.y + wRoad * 0.22); ctx.stroke();
    ctx.strokeStyle = shade(color, -55);
    ctx.lineWidth = wRoad;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = shade(color, 38);
    ctx.lineWidth = wRoad * 0.45;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  function drawHighlightEdge(ctx, e, va, vb, project, color, glow) {
    const a = project(va.x, va.y);
    const b = project(vb.x, vb.y);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = glow;
    ctx.lineWidth = Math.max(4, project.scale * 2.2);
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = color;
    const vr = Math.max(5, project.scale * 2.6);
    ctx.beginPath();
    ctx.ellipse(a.x, a.y, vr, vr * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, vr, vr * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- public entry point
  // `cam` is the user camera ({ zoom, cx, cy }), `anim` an optional
  // { t: ms } timestamp that makes placement highlights pulse.
  function draw(ctx, g, w, h, sel, tool, pid, cam, anim) {
    const map = g.map;
    const view = map.view;
    const proj = makeProjection(view, w, h, cam);
    const project = proj.project;
    const depth = proj.depth;
    const colors = MAPGEN.COLORS;
    // Highlights breathe only when an animation timestamp was supplied;
    // static callers (tests) get a constant mid alpha.
    const pulse = anim
      ? 0.55 + 0.35 * Math.sin(anim.t / 260)
      : 0.85;

    ctx.clearRect(0, 0, w, h);

    // Fill the frame with sea rather than leaving 44% of it as dead flat
    // navy. A radial vignette gives the board a horizon and reads as water
    // instead of an empty void. Fall back to a flat fill if the context does
    // not support gradients (e.g. a minimal test stub).
    let seaFill = '#1d4a78';
    if (typeof ctx.createRadialGradient === 'function') {
      try {
        const sea = ctx.createRadialGradient(
          w * 0.5, h * 0.42, Math.min(w, h) * 0.05,
          w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
        sea.addColorStop(0, '#2a6396');
        sea.addColorStop(0.55, '#1d4a78');
        sea.addColorStop(1, '#0f2c48');
        seaFill = sea;
      } catch (e) { /* keep the flat fill */ }
    }
    ctx.fillStyle = seaFill;
    ctx.fillRect(0, 0, w, h);

    // Soft shadow under the island so it reads as floating on the water,
    // plus a scatter of faint wave arcs that pan/zoom with the board.
    const icx = view.x + view.w / 2, icy = view.y + view.h / 2;
    const c0 = project(icx, icy);
    ctx.save();
    ctx.translate(c0.x, c0.y);
    ctx.scale(1, 0.62);
    const shadowR = Math.max(view.w, view.h) * 0.5 * proj.scale * 1.12;
    if (typeof ctx.createRadialGradient === 'function') {
      try {
        const sh = ctx.createRadialGradient(0, 0, shadowR * 0.55, 0, 0, shadowR);
        sh.addColorStop(0, 'rgba(4, 16, 30, .5)');
        sh.addColorStop(1, 'rgba(4, 16, 30, 0)');
        ctx.fillStyle = sh;
        ctx.beginPath();
        ctx.arc(0, 0, shadowR, 0, Math.PI * 2);
        ctx.fill();
      } catch (e) { /* shadow is decorative; skip on failure */ }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 255, 255, .08)';
    ctx.lineWidth = Math.max(1, proj.scale * 0.8);
    for (const wv of WAVES) {
      const p = project(wv.x, wv.y);
      if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, wv.r * proj.scale * 0.5, wv.a, wv.a + Math.PI * 0.9);
      ctx.stroke();
    }

    // Painter's algorithm: everything sorted far -> near.
    const jobs = [];
    for (const t of map.tiles) {
      const isSel = sel && sel.kind === 'tile' && sel.key === HEX.key(t.q, t.r);
      jobs.push({ d: depth(t.center.x, t.center.y), f: () => drawTile(ctx, t, map.S, project, colors, isSel) });
    }
    for (const t of map.tiles) {
      if (t.res === 'desert') continue;
      jobs.push({ d: depth(t.center.x, t.center.y) + 0.1, f: () => drawToken(ctx, t, map.S, project, colors) });
    }
    if (g.robber && map.byKey.has(g.robber)) {
      const t = map.byKey.get(g.robber);
      jobs.push({ d: depth(t.center.x, t.center.y) + 0.2, f: () => drawRobber(ctx, t, map.S, project) });
    }
    for (const e of map.edges) {
      if (e.built === null) continue;
      const p = g.players[e.built];
      const va = map.vertices[e.a];
      const vb = map.vertices[e.b];
      jobs.push({ d: depth(e.x, e.y) + 0.3, f: () => drawRoad(ctx, e, va, vb, project, p.color) });
    }
    // Harbors sit on coastal edge midpoints, so they must be drawn ABOVE the
    // tiles but still BELOW roads and pieces that share the same coastline.
    const islandCX = view.x + view.w / 2, islandCY = view.y + view.h / 2;
    for (const e of map.edges) {
      if (!e.port) continue;
      jobs.push({
        d: depth(e.x, e.y) + 0.15,
        f: () => drawHarbor(ctx, e, project, e.port, map.S, islandCX, islandCY),
      });
    }
    for (const v of map.vertices) {
      if (v.owner === null) continue;
      const p = g.players[v.owner];
      const isSel = sel && sel.kind === 'vertex' && sel.id === v.id;
      jobs.push({ d: depth(v.x, v.y) + 0.5, f: () => drawHouse(ctx, v, project, p.color, v.city) });
      if (isSel) {
        jobs.push({
          d: depth(v.x, v.y) + 0.55,
          f: () => {
            const c = project(v.x, v.y);
            ctx.strokeStyle = '#f0c987';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.ellipse(c.x, c.y, 20, 11, 0, 0, Math.PI * 2);
            ctx.stroke();
          },
        });
      }
    }

    // Placement highlights for the human player during build/setup.
    if (pid === 0 && (tool === 'settlement' || tool === 'road' || tool === 'city')) {
      if (tool === 'settlement') {
        for (const v of map.vertices) {
          // During the first setup round any legal corner goes; afterwards a
          // settlement must attach to the player's road network (official).
          if (RULES.settlementSpotFree(g, v.id) &&
              (g.phase === 'setup1' || RULES.settlementConnects(g, 0, v.id))) {
            jobs.push({ d: depth(v.x, v.y) + 0.6, f: () => drawHighlightVertex(ctx, v, project, '#4ec96a', pulse) });
          }
        }
      } else if (tool === 'road') {
        for (const e of map.edges) {
          if (RULES.roadBuildable(g, 0, e.id)) {
            const va = map.vertices[e.a], vb = map.vertices[e.b];
            jobs.push({ d: depth(e.x, e.y) + 0.6, f: () => drawHighlightEdge(ctx, e, va, vb, project, '#4ec96a', pulse) });
          }
        }
      } else if (tool === 'city') {
        for (const v of map.vertices) {
          if (RULES.canBuildCity(g, 0, v.id)) {
            jobs.push({ d: depth(v.x, v.y) + 0.6, f: () => drawHighlightVertex(ctx, v, project, '#e0a83c', pulse) });
          }
        }
      }
    }

    jobs.sort((a, b) => a.d - b.d);
    for (const j of jobs) j.f();
  }

  return {
    draw, HEIGHT, makeProjection,
    fitScale, defaultCamera, clampCamera, zoomAt, pan, MAX_ZOOM,
  };
})();
