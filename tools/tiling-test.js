// Verify the hex tiling is geometrically exact: neighbours must share exactly
// two corners, every interior point must be touched by exactly 3 hexes, and
// no hex may overlap another. Also compare the ART aspect to the GRID aspect.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'js');
const ctx = { console, Math };
vm.createContext(ctx);
for (const f of ['hex.js', 'map.js']) {
  const n = f === 'hex.js' ? 'HEX' : 'MAPGEN';
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8') +
    `\n;globalThis.${n} = ${n};`, ctx, { filename: f });
}
const HEX = ctx.HEX, MAPGEN = ctx.MAPGEN;

let fail = 0;
const check = (n, c, x) => {
  console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x ? '  ' + x : ''));
  if (!c) fail++;
};

const m = MAPGEN.build(2);
const S = m.S;

// ---- what shape does the GRID actually produce?
const corners = (t) => {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const o = HEX.cornerOffset(i, S);
    pts.push([t.center.x + o.x, t.center.y + o.y]);
  }
  return pts;
};
const c0 = corners(m.tiles[0]);
const gMinX = Math.min(...c0.map(p => p[0])), gMaxX = Math.max(...c0.map(p => p[0]));
const gMinY = Math.min(...c0.map(p => p[1])), gMaxY = Math.max(...c0.map(p => p[1]));
const gW = gMaxX - gMinX, gH = gMaxY - gMinY;
console.log(`GRID hex: width=${gW.toFixed(2)} height=${gH.toFixed(2)} aspect=${(gW / gH).toFixed(4)}`);
console.log(`  flat-top hex should have aspect ${(2 / Math.sqrt(3)).toFixed(4)} = 1.1547`);

check('grid hexes are FLAT-TOP (aspect 1.1547)',
  Math.abs(gW / gH - 2 / Math.sqrt(3)) < 0.001, (gW / gH).toFixed(4));

// ---- what shape does the ART produce?
const artSvg = fs.readFileSync(path.join(base, 'art.js'), 'utf8');
const hexPoly = artSvg.match(/HEX_PTS = '([^']+)'/);
let artAspect = null, artIsPointy = null;
if (hexPoly) {
  const nums = hexPoly[1].split(/[\s,]+/).filter(Boolean).map(Number);
  const xs = [], ys = [];
  for (let i = 0; i < nums.length; i += 2) { xs.push(nums[i]); ys.push(nums[i + 1]); }
  const aW = Math.max(...xs) - Math.min(...xs);
  const aH = Math.max(...ys) - Math.min(...ys);
  artAspect = aW / aH;
  artIsPointy = aH > aW;   // vertex at top and bottom
  console.log(`ART hex:  width=${aW.toFixed(2)} height=${aH.toFixed(2)} aspect=${artAspect.toFixed(4)}`);
  console.log(`  orientation: ${artIsPointy ? 'POINTY-TOP' : 'flat-top'}`);
}

check('art hexagon exists in art.js', !!hexPoly);
check('ART orientation matches GRID orientation',
  artIsPointy === false,
  artIsPointy ? 'ART IS POINTY-TOP BUT GRID IS FLAT-TOP' : 'both flat-top');
check('ART aspect matches GRID aspect',
  Math.abs(artAspect - gW / gH) < 0.01,
  `art=${artAspect.toFixed(4)} grid=${(gW / gH).toFixed(4)}`);

// ---- neighbours must share exactly two corners
const key = p => Math.round(p[0] * 100) + ':' + Math.round(p[1] * 100);
let shared = [];
for (const t of m.tiles) {
  for (const nb of HEX.neighbors(t.q, t.r)) {
    const k2 = HEX.key(nb.q, nb.r);
    const other = m.byKey.get(k2);
    if (!other) continue;
    const a = new Set(corners(t).map(key));
    const inter = corners(other).map(key).filter(k => a.has(k));
    shared.push(inter.length);
  }
}
const bad = shared.filter(n => n !== 2);
check('every adjacent pair shares exactly 2 corners',
  bad.length === 0, `${shared.length} pairs, ${bad.length} bad` +
  (bad.length ? ' got ' + JSON.stringify([...new Set(bad)]) : ''));

// ---- every lattice corner is shared by exactly 3 hexes (or fewer on the rim)
const counts = new Map();
for (const t of m.tiles) for (const c of corners(t)) {
  const k = key(c);
  counts.set(k, (counts.get(k) || 0) + 1);
}
const dist = {};
for (const n of counts.values()) dist[n] = (dist[n] || 0) + 1;
console.log(`corners shared by N hexes: ${JSON.stringify(dist)}`);
check('no corner shared by more than 3 hexes',
  Object.keys(dist).every(n => +n <= 3));
check('there are interior 3-hex junctions', (dist['3'] || 0) === 24,
  'count=' + (dist['3'] || 0));

// ---- the sprite's rasterised canvas must keep the flat-top aspect
const vbMatches = [...artSvg.matchAll(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/g)]
  .map(m => ({ y: +m[2], w: +m[3], h: +m[4] }))
  .filter(v => Math.abs(v.w / v.h - 2 / Math.sqrt(3)) < 0.02);
check('hex symbol viewBoxes use the flat-top aspect', vbMatches.length >= 6,
  vbMatches.length + ' symbols');

console.log('\n' + (fail ? fail + ' CHECK(S) FAILED' : 'tiling is geometrically exact'));
process.exit(fail ? 1 : 0);