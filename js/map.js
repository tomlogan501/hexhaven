// Builds the tile/vertex/edge graph from the hex spiral.
const MAPGEN = (() => {
  const RESOURCES = ['forest', 'pasture', 'field', 'hill', 'mount', 'desert'];
  const COLORS = {
    forest: '#3f7a3f', pasture: '#8ec06c', field: '#d8c35a',
    hill: '#b0764a', mount: '#8d8d95', desert: '#d9cfa6',
  };
  const HARBOR_ICONS = { 2: '2:1', 3: '3:1' };
  // The ore (mount) harbour ignores this map — render.js draws a vector
  // rock instead, because the rock emoji fails to render on some systems.
  const HARBOR_LABELS = { forest: '🌲', pasture: '🐑', field: '🌾', hill: '🧱', mount: '🪨', null: '?' };
  // Official mix: 5 specific 2:1 ports — one per resource type (rulebook:
  // "only 1 special harbor for each type of resource") — plus 4 generic
  // 3:1 ports.
  const HARBOR_TYPES = [
    { ratio: 2, res: 'forest' }, { ratio: 2, res: 'pasture' },
    { ratio: 2, res: 'field' },  { ratio: 2, res: 'hill' },
    { ratio: 2, res: 'mount' },
    { ratio: 3, res: null }, { ratio: 3, res: null }, { ratio: 3, res: null },
    { ratio: 3, res: null },
  ];

  function build(R) {
    const S = 42; // hex circumradius
    const tiles = [];
    const byKey = new Map();

    for (const { q, r } of HEX.spiral(R)) {
      const t = {
        q, r, res: 'desert', num: 0, port: null,
        center: HEX.center(q, r, S), idx: tiles.length,
      };
      byKey.set(HEX.key(q, r), t);
      tiles.push(t);
    }

    assignTiles(tiles);

    // Vertices are keyed by pixel position: flat-top corners do not land on
    // integer axial coordinates, so neighbouring tiles only share corners if
    // we collapse them geometrically.
    const vertices = [];
    const vIndex = new Map();
    const vkey = (x, y) => Math.round(x * 100) + ':' + Math.round(y * 100);
    const tileCorners = new Map(); // tileKey -> [vertexId x6]

    for (const t of tiles) {
      const ids = [];
      for (let i = 0; i < 6; i++) {
        const off = HEX.cornerOffset(i, S);
        const x = t.center.x + off.x;
        const y = t.center.y + off.y;
        const k = vkey(x, y);
        let v = vIndex.get(k);
        if (!v) {
          v = { id: vertices.length, x, y, adj: [], owner: null, city: false, tiles: [] };
          vIndex.set(k, v);
          vertices.push(v);
        }
        const tk = HEX.key(t.q, t.r);
        if (!v.tiles.includes(tk)) v.tiles.push(tk);
        ids.push(v.id);
      }
      tileCorners.set(HEX.key(t.q, t.r), ids);
    }

    // Corner i to corner i+1 bounds the edge facing neighbor DIRS[i].
    const edges = [];
    const eIndex = new Map();
    for (const t of tiles) {
      const ids = tileCorners.get(HEX.key(t.q, t.r));
      const tk = HEX.key(t.q, t.r);
      for (let i = 0; i < 6; i++) {
        const a = ids[i], b = ids[(i + 1) % 6];
        const k = a < b ? a + '-' + b : b + '-' + a;
        if (eIndex.has(k)) { edges[eIndex.get(k)].tiles.push(tk); continue; }
        const va = vertices[a], vb = vertices[b];
        const e = {
          id: edges.length, a, b,
          x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2,
          built: null, tiles: [tk], port: null,
        };
        eIndex.set(k, e.id);
        edges.push(e);
      }
    }

    for (const e of edges) {
      const a = vertices[e.a], b = vertices[e.b];
      if (!a.adj.includes(b.id)) a.adj.push(b.id);
      if (!b.adj.includes(a.id)) b.adj.push(a.id);
    }

    // Hop distance from every vertex to every other: the settlement rule.
    for (const v of vertices) v.hops = hopMap(vertices, v.id);

    // Assign harbors to outer edges
    assignHarbors(tiles, edges, vertices, R);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of tiles) {
      minX = Math.min(minX, t.center.x); maxX = Math.max(maxX, t.center.x);
      minY = Math.min(minY, t.center.y); maxY = Math.max(maxY, t.center.y);
    }
    // Pad enough for the hexes (S) AND the harbour buoys moored out in the
    // sea: an outer edge midpoint already reaches ~3.75 S from the island
    // centre in x, and the buoy adds 0.6 S of offset + 0.4 S of radius, so
    // ~1.7 S of padding keeps every buoy inside the view even in tight
    // portrait fits. (The old 1.05 S clipped the port markers.)
    const pad = S * 1.7;
    const view = {
      x: minX - pad, y: minY - pad,
      w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2,
    };

    return { R, S, tiles, byKey, vertices, edges, view };
  }

  function assignHarbors(tiles, edges, vertices, R) {
    // Find all edges on the outer boundary (edges with only 1 tile)
    const outerEdges = edges.filter(e => e.tiles.length === 1);
    // Shuffle and pick 9 for harbors (standard Catan)
    const shuffled = outerEdges.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const harborTypes = HARBOR_TYPES.slice();
    for (let i = harborTypes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [harborTypes[i], harborTypes[j]] = [harborTypes[j], harborTypes[i]];
    }
    for (let i = 0; i < 9 && i < shuffled.length; i++) {
      shuffled[i].port = harborTypes[i];
    }
  }

  function hopMap(vertices, from) {
    const dist = new Array(vertices.length).fill(Infinity);
    dist[from] = 0;
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of vertices[cur].adj) {
        if (dist[n] === Infinity) { dist[n] = dist[cur] + 1; queue.push(n); }
      }
    }
    return dist;
  }

  // Standard island: 4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, 1 desert
  // = 19 tiles. An XL island holds several of those "rounds" per 18-tile set.
  function assignTiles(tiles) {
    const rounds = Math.ceil(tiles.length / 19);
    const baseCounts = { desert: 1, forest: 4, pasture: 4, field: 4, hill: 3, mount: 3 };
    const bag = [];
    for (const [res, n] of Object.entries(baseCounts)) {
      // One desert per round, except never more deserts than the island has
      // tiles beyond a full 18-tile round (keeps the last round non-empty).
      const count = res === 'desert'
        ? Math.min(rounds, Math.max(1, tiles.length - 18 * rounds))
        : n * rounds;
      for (let i = 0; i < count; i++) bag.push(res);
    }
    while (bag.length > tiles.length) bag.pop();
    while (bag.length < tiles.length) bag.push('forest');
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }

    // Official number tokens per round: 2..12 minus 7 (a 7 roll always
    // moves the robber and never sits on a tile). Counts: 2 and 12 once,
    // everything else twice — exactly one token per non-desert tile.
    const baseNumbers = [];
    for (let n = 2; n <= 12; n++) {
      if (n === 7) continue;
      const reps = (n === 2 || n === 12) ? 1 : 2;
      for (let i = 0; i < reps; i++) baseNumbers.push(n);
    }
    const desertCount = bag.filter(res => res === 'desert').length;
    const numbers = [];
    while (numbers.length < tiles.length - desertCount) numbers.push(...baseNumbers);
    numbers.length = tiles.length - desertCount;
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }

    // Deal outward from the centre so the richest tiles are contested.
    // The desert takes no token and must not consume one either.
    const dist = (t) => Math.abs(t.q) + Math.abs(t.r) + Math.abs(t.q + t.r);
    const byDist = tiles.slice().sort((a, b) => dist(a) - dist(b));
    byDist.forEach((t, i) => { t.res = bag[i]; });
    let ni = 0;
    byDist.forEach((t) => {
      t.num = t.res === 'desert' ? 0 : numbers[ni++];
    });
  }

  return { build, RESOURCES, COLORS, HARBOR_ICONS, HARBOR_LABELS, HARBOR_TYPES };
})();
