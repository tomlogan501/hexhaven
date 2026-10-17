// Browser capture + image analysis.
//
// Screenshots cannot be viewed directly in this environment, so this tool
// converts them into facts: region occupancy, colour clusters, text-ish
// contrast, and an ASCII luminance map. That makes "is the UI ugly?"
// answerable with measurements instead of guesswork.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

function load(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

// Average colour of a rectangle.
function regionMean(png, x, y, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(png.width, x + w), y1 = Math.min(png.height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (png.width * yy + xx) << 2;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n } : null;
}

// Relative luminance 0..1.
function lum(c) {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

// Contrast ratio between two colours, WCAG-style.
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Coarse colour clusters over the whole image.
function palette(png, buckets = 5) {
  const hist = new Map();
  for (let i = 0; i < png.data.length; i += 4 * 7) {   // sample every 7th px
    const q = v => Math.round(v / buckets) * buckets;
    const k = q(png.data[i]) + ',' + q(png.data[i + 1]) + ',' + q(png.data[i + 2]);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const total = [...hist.values()].reduce((a, b) => a + b, 0);
  return [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([k, v]) => {
      const [r, g, b] = k.split(',').map(Number);
      return { rgb: `${r},${g},${b}`, pct: +(v / total * 100).toFixed(1) };
    });
}

// How much of the frame is background (near the modal/sea colour)?
function coverage(png, bgRgb) {
  let bg = 0, total = 0;
  for (let i = 0; i < png.data.length; i += 4 * 7) {
    total++;
    if (Math.abs(png.data[i] - bgRgb[0]) < 14 &&
        Math.abs(png.data[i + 1] - bgRgb[1]) < 14 &&
        Math.abs(png.data[i + 2] - bgRgb[2]) < 14) bg++;
  }
  return +(bg / total * 100).toFixed(1);
}

// ASCII luminance map: a coarse but readable impression of the layout.
function asciiMap(png, cols = 76) {
  const rows = Math.max(8, Math.round(cols * png.height / png.width * 0.5));
  const ramp = ' .:-=+*#%@';
  let out = '';
  for (let ry = 0; ry < rows; ry++) {
    let line = '';
    for (let rx = 0; rx < cols; rx++) {
      const x = Math.floor(rx * png.width / cols);
      const y = Math.floor(ry * png.height / rows);
      const i = (png.width * y + x) << 2;
      const l = (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] +
        0.0722 * png.data[i + 2]) / 255;
      line += ramp[Math.min(ramp.length - 1, Math.floor(l * ramp.length))];
    }
    out += line + '\n';
  }
  return out;
}

// Edge density per region: busy areas read as cluttered.
function edgeDensity(png, x, y, w, h) {
  let edges = 0, n = 0;
  const x1 = Math.min(png.width, x + w), y1 = Math.min(png.height, y + h);
  for (let yy = Math.max(1, y); yy < y1 - 1; yy++) {
    for (let xx = Math.max(1, x); xx < x1 - 1; xx++) {
      const i = (png.width * yy + xx) << 2;
      const j = (png.width * yy + xx + 1) << 2;
      const d = Math.abs(png.data[i] - png.data[j]) +
        Math.abs(png.data[i + 1] - png.data[j + 1]) +
        Math.abs(png.data[i + 2] - png.data[j + 2]);
      if (d > 60) edges++;
      n++;
    }
  }
  return n ? +(edges / n * 100).toFixed(1) : 0;
}

const file = process.argv[2];
if (!file) { console.error('usage: node analyze.js shot.png'); process.exit(1); }
const png = load(file);

console.log(`FILE: ${path.basename(file)}  ${png.width}x${png.height}`);
const SEA = [22, 32, 43];
console.log(`background coverage (sea ${SEA}): ${coverage(png, SEA)}%`);

console.log('\nREGION MEANS (r,g,b / luminance / contrast vs sea):');
const regs = {
  'top bar':      [0, 0, png.width, 40],
  'top-left':     [0, 40, Math.round(png.width * 0.22), Math.round(png.height * 0.22)],
  'top-right':    [Math.round(png.width * 0.78), 40, Math.round(png.width * 0.22), Math.round(png.height * 0.22)],
  'centre':       [Math.round(png.width * 0.38), Math.round(png.height * 0.38), Math.round(png.width * 0.24), Math.round(png.height * 0.24)],
  'bottom-centre':[Math.round(png.width * 0.31), Math.round(png.height * 0.80), Math.round(png.width * 0.38), Math.round(png.height * 0.18)],
};
for (const [name, [x, y, w, h]] of Object.entries(regs)) {
  const c = regionMean(png, x, y, w, h);
  if (!c) continue;
  const sea = { r: SEA[0], g: SEA[1], b: SEA[2] };
  console.log(`  ${name.padEnd(15)} ${c.r.toFixed(0)},${c.g.toFixed(0)},${c.b.toFixed(0)}` +
    `  lum=${lum(c).toFixed(3)}  contrast=${contrast(c, sea).toFixed(2)}` +
    `  edges=${edgeDensity(png, x, y, w, h)}%`);
}

console.log('\nTOP COLOURS:');
for (const p of palette(png))
  console.log(`  rgb(${p.rgb})  ${p.pct}%`);

console.log('\nASCII LUMINANCE MAP:');
console.log(asciiMap(png));