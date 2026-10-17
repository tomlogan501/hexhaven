// Headless sanity check for the tile/vertex/edge graph.
// Run: node tools/check.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'js');
const ctx = { console, Math };
vm.createContext(ctx);
// Top-level `const` in a vm script does not land on the global object,
// so re-export each binding explicitly after running the file.
for (const f of ['hex.js', 'map.js']) {
  const name = f === 'hex.js' ? 'HEX' : 'MAPGEN';
  vm.runInContext(
    fs.readFileSync(path.join(base, f), 'utf8') + `\n;globalThis.${name} = ${name};`,
    ctx, { filename: f }
  );
}

const m = ctx.MAPGEN.build(2);
const V = m.vertices, E = m.edges, T = m.tiles;
let fail = 0;
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
};

check('19 tiles', T.length === 19, 'got ' + T.length);
check('54 vertices (Catan R=2)', V.length === 54, 'got ' + V.length);
check('72 edges (Catan R=2)', E.length === 72, 'got ' + E.length);

const counts = {};
for (const t of T) counts[t.res] = (counts[t.res] || 0) + 1;
check('tile mix 4/4/4/3/3/1',
  counts.forest === 4 && counts.pasture === 4 && counts.field === 4 &&
  counts.hill === 3 && counts.mount === 3 && counts.desert === 1,
  JSON.stringify(counts));
check('resource bag matches tile count',
  Object.values(counts).reduce((a, b) => a + b, 0) === 19);

const deserts = T.filter(t => t.res === 'desert');
check('desert has no token', deserts.every(t => t.num === 0));
check('all other tiles have a token 2-12',
  T.filter(t => t.res !== 'desert').every(t => t.num >= 2 && t.num <= 12));

// Every vertex must touch exactly 3 tiles, except outer-ring ones (2 or 1).
const dist3 = V.filter(v => v.tiles.length === 3).length;
check('some vertices touch 3 tiles', dist3 > 0, 'count=' + dist3);
check('no vertex touches >3 tiles', V.every(v => v.tiles.length <= 3));

// The vertex-distance table must be symmetric; a lopsided BFS means the
// adjacency graph is malformed.
let asym = 0, maxHop = 0;
for (const a of V) {
  for (const b of V) {
    if (a.hops[b.id] !== V[b.id].hops[a.id]) asym++;
    if (a.hops[b.id] > maxHop) maxHop = a.hops[b.id];
  }
}
check('hop distances symmetric', asym === 0, 'mismatches=' + asym);
// Radius-2 board: farthest pair is 11 edges apart (a long serpentine route).
check('max hop distance is 11', maxHop === 11, 'got ' + maxHop);

// Reachability: every vertex pair must be connected, no Infinity entries.
check('graph fully connected', V.every(v => v.hops.every(d => d !== Infinity)));

// Adjacency must be symmetric and every vertex degree 2 or 3.
check('degrees are 2 or 3', V.every(v => v.adj.length === 2 || v.adj.length === 3));
let sym = true;
for (const v of V) for (const n of v.adj) if (!V[n].adj.includes(v.id)) sym = false;
check('adjacency symmetric', sym);

// Edge endpoints must be adjacent vertices.
check('edges connect adjacent vertices',
  E.every(e => V[e.a].adj.includes(e.b)));

// No two distinct vertices at the same pixel position.
const seen = new Set();
let dupes = 0;
for (const v of V) {
  const k = Math.round(v.x * 100) + ':' + Math.round(v.y * 100);
  if (seen.has(k)) dupes++;
  seen.add(k);
}
check('no duplicate vertex positions', dupes === 0, 'dupes=' + dupes);

// Edge pixel midpoints must be unique.
const eseen = new Set();
let edupes = 0;
for (const e of E) {
  const k = Math.round(e.x * 100) + ':' + Math.round(e.y * 100);
  if (eseen.has(k)) edupes++;
  eseen.add(k);
}
check('no duplicate edge midpoints', edupes === 0, 'dupes=' + edupes);

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'all checks passed'));
process.exit(fail ? 1 : 0);
