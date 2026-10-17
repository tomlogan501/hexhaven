// Axial hex math, flat-top orientation.
// Pixel layout:  x = S * 1.5 * q ,  y = S * sqrt3 * (r + q/2)
// Corners are NOT at integer axial positions for flat-top hexes, so vertices
// are keyed in pixel space (see map.js) rather than by axial coords.
const HEX = (() => {
  const SQRT3 = Math.sqrt(3);

  // Six edge directions, ordered by screen angle starting at 30 degrees.
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  const key = (q, r) => q + ',' + r;

  function neighbors(q, r) {
    return DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
  }

  // Corner i of a flat-top hex, relative to its center, circumradius s.
  // Corners i and i+1 bound the edge that faces neighbor DIRS[i].
  function cornerOffset(i, s) {
    const a = (Math.PI / 3) * i;
    return { x: s * Math.cos(a), y: s * Math.sin(a) };
  }

  function center(q, r, s) {
    return { x: s * 1.5 * q, y: s * SQRT3 * (r + q / 2) };
  }

  // All hexes within radius R of the origin: 19 tiles at R=2, 37 at R=3.
  function spiral(R) {
    const out = [];
    for (let q = -R; q <= R; q++) {
      const lo = Math.max(-R, -q - R);
      const hi = Math.min(R, -q + R);
      for (let r = lo; r <= hi; r++) out.push({ q, r });
    }
    return out;
  }

  return { SQRT3, key, DIRS, neighbors, center, cornerOffset, spiral };
})();
