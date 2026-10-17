// Original Catan-inspired SVG art, embedded so it works from file://.
// Exposes ART.get(id, size, color) -> offscreen canvas (cached), rasterised
// once per symbol/size/colour and then blitted each frame.
const ART = (() => {
  // The 19-tile grid is FLAT-TOP: width 2S, height sqrt(3)*S, aspect 1.1547.
  // Vertices therefore sit at left/right midpoints and at (+-S/2, +-sqrt(3)/2*S).
  // A pointy-top hexagon here would render every tile rotated 90 degrees off
  // its grid cell and squash the whole board.
  const HEX_PTS = '50,0 25,43.3 -25,43.3 -50,0 -25,-43.3 25,-43.3';

  const MARKUP = `
<defs>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#fff" stop-opacity=".7"/>
    <stop offset="60%" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
</defs>

<symbol id="hex-forest" viewBox="-50 -43.3 100 86.6">
  <defs>
    <radialGradient id="gForest" cx="0" cy="-6" r="62" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#63a24f"/>
      <stop offset="65%" stop-color="#417c35"/>
      <stop offset="100%" stop-color="#2b5423"/>
    </radialGradient>
    <clipPath id="cForest"><polygon points="${HEX_PTS}"/></clipPath>
  </defs>
  <polygon points="${HEX_PTS}" fill="url(#gForest)" stroke="#1e3a18" stroke-width="2.5"/>
  <g clip-path="url(#cForest)">
  <g fill="#274d1f" opacity=".5">
    <circle cx="-32" cy="20" r="3"/><circle cx="-14" cy="29" r="2.4"/>
    <circle cx="21" cy="27" r="3"/><circle cx="36" cy="15" r="2.4"/>
    <circle cx="-41" cy="2" r="2.4"/><circle cx="41" cy="-2" r="2.6"/>
    <circle cx="-25" cy="-25" r="2.4"/><circle cx="26" cy="-23" r="2.4"/>
  </g>
  <g fill="#1f4318">
    <path d="M14 -18 L22 -6 L6 -6 Z"/><path d="M14 -11 L24 3 L4 3 Z"/>
    <path d="M-38 -2 L-30 10 L-46 10 Z"/>
  </g>
  <g>
    <ellipse cx="-16" cy="25" rx="10" ry="2.8" fill="#142a0e" opacity=".45"/>
    <ellipse cx="18" cy="17" rx="9" ry="2.5" fill="#142a0e" opacity=".4"/>
    <ellipse cx="1" cy="-1" rx="8" ry="2.3" fill="#142a0e" opacity=".35"/>
    <rect x="-18.8" y="16" width="5.4" height="11" rx="1.8" fill="#5c4022"/>
    <rect x="15.6" y="9" width="4.8" height="10" rx="1.6" fill="#5c4022"/>
    <rect x="-1.6" y="-6" width="5" height="9" rx="1.6" fill="#5c4022"/>
    <g fill="#2b5c22">
      <path d="M-16 -27 L-5 -13 L-27 -13 Z"/>
      <path d="M-16 -18 L-3 -2 L-29 -2 Z"/>
      <path d="M-16 -7 L-1 12 L-31 12 Z"/>
      <path d="M18 -22 L27 -9 L9 -9 Z"/>
      <path d="M18 -14 L30 1 L6 1 Z"/>
      <path d="M18 -5 L32 13 L4 13 Z"/>
      <path d="M1 -31 L9 -20 L-7 -20 Z"/>
      <path d="M1 -24 L11 -10 L-9 -10 Z"/>
      <path d="M1 -13 L13 4 L-11 4 Z"/>
    </g>
    <g fill="#478c38" opacity=".9">
      <path d="M-16 -25 L-10 -15 L-14.5 -15 Z"/>
      <path d="M-16 -16 L-8 -4 L-13 -4 Z"/>
      <path d="M18 -20 L24 -11 L19.5 -11 Z"/>
      <path d="M1 -29 L6 -21 L2 -21 Z"/>
    </g>
  </g>
  </g>
  <polygon points="${HEX_PTS}" fill="url(#sheen)" opacity=".16"/>
</symbol>

<symbol id="hex-pasture" viewBox="-50 -43.3 100 86.6">
  <defs>
    <radialGradient id="gPasture" cx="0" cy="-8" r="62" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#abce7a"/>
      <stop offset="65%" stop-color="#8cbb60"/>
      <stop offset="100%" stop-color="#699645"/>
    </radialGradient>
    <clipPath id="cPasture"><polygon points="${HEX_PTS}"/></clipPath>
  </defs>
  <polygon points="${HEX_PTS}" fill="url(#gPasture)" stroke="#4a6a30" stroke-width="2.5"/>
  <g clip-path="url(#cPasture)">
  <g stroke="#5f8a3e" stroke-width="2" stroke-linecap="round" fill="none" opacity=".7">
    <path d="M-34 16 q2 -7 4 0"/><path d="M-27 23 q2 -7 4 0"/>
    <path d="M28 20 q2 -7 4 0"/><path d="M35 11 q2 -7 4 0"/>
    <path d="M-6 30 q2 -7 4 0"/><path d="M12 31 q2 -7 4 0"/>
    <path d="M-38 -6 q2 -7 4 0"/><path d="M36 -8 q2 -7 4 0"/>
  </g>
  <g>
    <ellipse cx="0" cy="19" rx="21" ry="4.5" fill="#3c5527" opacity=".38"/>
    <g stroke="#8a7a62" stroke-width="3.4" stroke-linecap="round">
      <line x1="-13" y1="10" x2="-14" y2="17"/><line x1="-5" y1="12" x2="-5.5" y2="18"/>
      <line x1="6" y1="12" x2="6.5" y2="18"/><line x1="13" y1="10" x2="14" y2="16"/>
    </g>
    <g fill="#f7f3ea" stroke="#c9bfae" stroke-width="1.6">
      <circle cx="-14" cy="2" r="7.5"/><circle cx="-5" cy="-2.5" r="9"/>
      <circle cx="6" cy="-1.5" r="8.5"/><circle cx="13" cy="4" r="7"/>
      <circle cx="3" cy="6" r="8"/><circle cx="-8" cy="7" r="7"/>
    </g>
    <circle cx="-2" cy="1" r="6.5" fill="#fffdf8"/>
    <ellipse cx="20" cy="-6" rx="8" ry="7" fill="#3a3630"/>
    <ellipse cx="20" cy="-9.5" rx="7.4" ry="4.8" fill="#4a463e"/>
    <circle cx="22.6" cy="-8" r="1.5" fill="#f7f3ea"/>
    <ellipse cx="15.6" cy="-13" rx="3.2" ry="5" fill="#3a3630" transform="rotate(-28 15.6 -13)"/>
  </g>
  </g>
  <polygon points="${HEX_PTS}" fill="url(#sheen)" opacity=".16"/>
</symbol>

<symbol id="hex-field" viewBox="-50 -43.3 100 86.6">
  <defs>
    <linearGradient id="gField" x1="0" y1="-40" x2="0" y2="40" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#eed47c"/>
      <stop offset="100%" stop-color="#c2a24c"/>
    </linearGradient>
    <clipPath id="cField"><polygon points="${HEX_PTS}"/></clipPath>
  </defs>
  <polygon points="${HEX_PTS}" fill="url(#gField)" stroke="#8f742e" stroke-width="2.5"/>
  <g clip-path="url(#cField)">
  <g stroke="#a8863a" stroke-width="3" stroke-linecap="round" fill="none" opacity=".4">
    <path d="M-44 -6 Q0 7 44 -6"/>
    <path d="M-46 9 Q0 22 46 9"/>
    <path d="M-38 24 Q0 34 38 24"/>
  </g>
  <g transform="translate(-27,-2)">
    <g stroke="#a3833a" stroke-width="2.2" stroke-linecap="round">
      <line x1="-4" y1="15" x2="-1" y2="-2"/><line x1="0" y1="16" x2="0" y2="-4"/>
      <line x1="4" y1="15" x2="1" y2="-2"/>
    </g>
    <g fill="#f4d873" stroke="#c9a845" stroke-width="1.4">
      <ellipse cx="-2" cy="-6" rx="3.4" ry="6" transform="rotate(-12 -2 -6)"/>
      <ellipse cx="0" cy="-9" rx="3.4" ry="6.5"/>
      <ellipse cx="2" cy="-6" rx="3.4" ry="6" transform="rotate(12 2 -6)"/>
    </g>
    <g stroke="#c9a845" stroke-width="1" opacity=".8">
      <line x1="0" y1="-15" x2="-3" y2="-19"/><line x1="0" y1="-15" x2="0" y2="-20"/>
      <line x1="0" y1="-15" x2="3" y2="-19"/>
    </g>
  </g>
  <g transform="translate(-9,-8) scale(.92)">
    <g stroke="#a3833a" stroke-width="2.2" stroke-linecap="round">
      <line x1="-4" y1="15" x2="-1" y2="-2"/><line x1="0" y1="16" x2="0" y2="-4"/>
      <line x1="4" y1="15" x2="1" y2="-2"/>
    </g>
    <g fill="#f4d873" stroke="#c9a845" stroke-width="1.4">
      <ellipse cx="-2" cy="-6" rx="3.4" ry="6" transform="rotate(-12 -2 -6)"/>
      <ellipse cx="0" cy="-9" rx="3.4" ry="6.5"/>
      <ellipse cx="2" cy="-6" rx="3.4" ry="6" transform="rotate(12 2 -6)"/>
    </g>
    <g stroke="#c9a845" stroke-width="1" opacity=".8">
      <line x1="0" y1="-15" x2="-3" y2="-19"/><line x1="0" y1="-15" x2="0" y2="-20"/>
      <line x1="0" y1="-15" x2="3" y2="-19"/>
    </g>
  </g>
  <g transform="translate(9,-8) scale(.92)">
    <g stroke="#a3833a" stroke-width="2.2" stroke-linecap="round">
      <line x1="-4" y1="15" x2="-1" y2="-2"/><line x1="0" y1="16" x2="0" y2="-4"/>
      <line x1="4" y1="15" x2="1" y2="-2"/>
    </g>
    <g fill="#f4d873" stroke="#c9a845" stroke-width="1.4">
      <ellipse cx="-2" cy="-6" rx="3.4" ry="6" transform="rotate(-12 -2 -6)"/>
      <ellipse cx="0" cy="-9" rx="3.4" ry="6.5"/>
      <ellipse cx="2" cy="-6" rx="3.4" ry="6" transform="rotate(12 2 -6)"/>
    </g>
    <g stroke="#c9a845" stroke-width="1" opacity=".8">
      <line x1="0" y1="-15" x2="-3" y2="-19"/><line x1="0" y1="-15" x2="0" y2="-20"/>
      <line x1="0" y1="-15" x2="3" y2="-19"/>
    </g>
  </g>
  <g transform="translate(27,-2)">
    <g stroke="#a3833a" stroke-width="2.2" stroke-linecap="round">
      <line x1="-4" y1="15" x2="-1" y2="-2"/><line x1="0" y1="16" x2="0" y2="-4"/>
      <line x1="4" y1="15" x2="1" y2="-2"/>
    </g>
    <g fill="#f4d873" stroke="#c9a845" stroke-width="1.4">
      <ellipse cx="-2" cy="-6" rx="3.4" ry="6" transform="rotate(-12 -2 -6)"/>
      <ellipse cx="0" cy="-9" rx="3.4" ry="6.5"/>
      <ellipse cx="2" cy="-6" rx="3.4" ry="6" transform="rotate(12 2 -6)"/>
    </g>
    <g stroke="#c9a845" stroke-width="1" opacity=".8">
      <line x1="0" y1="-15" x2="-3" y2="-19"/><line x1="0" y1="-15" x2="0" y2="-20"/>
      <line x1="0" y1="-15" x2="3" y2="-19"/>
    </g>
  </g>
  </g>
  <polygon points="${HEX_PTS}" fill="url(#sheen)" opacity=".16"/>
</symbol>

<symbol id="hex-hill" viewBox="-50 -43.3 100 86.6">
  <defs>
    <radialGradient id="gHill" cx="0" cy="-6" r="62" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#c98f5c"/>
      <stop offset="70%" stop-color="#a56b40"/>
      <stop offset="100%" stop-color="#84512e"/>
    </radialGradient>
    <clipPath id="cHill"><polygon points="${HEX_PTS}"/></clipPath>
  </defs>
  <polygon points="${HEX_PTS}" fill="url(#gHill)" stroke="#6b4526" stroke-width="2.5"/>
  <g clip-path="url(#cHill)">
  <ellipse cx="0" cy="16" rx="35" ry="15" fill="#7d4c2a" opacity=".35"/>
  <g stroke="#7d3f22" stroke-width="1.2">
    <polygon points="-36,16 -19,16 -16,11.5 -33,11.5" fill="#e29a66"/>
    <rect x="-36" y="16" width="17" height="8" fill="#c9703f"/>
    <polygon points="-17,16 0,16 3,11.5 -14,11.5" fill="#e29a66"/>
    <rect x="-17" y="16" width="17" height="8" fill="#c9703f"/>
    <polygon points="2,16 19,16 22,11.5 5,11.5" fill="#e29a66"/>
    <rect x="2" y="16" width="17" height="8" fill="#c9703f"/>
    <polygon points="21,16 38,16 41,11.5 24,11.5" fill="#e29a66"/>
    <rect x="21" y="16" width="17" height="8" fill="#c9703f"/>
    <polygon points="-26,5 -9,5 -6,.5 -23,.5" fill="#e29a66"/>
    <rect x="-26" y="5" width="17" height="8" fill="#c9703f"/>
    <polygon points="-7,5 10,5 13,.5 -4,.5" fill="#e29a66"/>
    <rect x="-7" y="5" width="17" height="8" fill="#c9703f"/>
    <polygon points="12,5 29,5 32,.5 15,.5" fill="#e29a66"/>
    <rect x="12" y="5" width="17" height="8" fill="#c9703f"/>
    <polygon points="-16,-6 1,-6 4,-10.5 -13,-10.5" fill="#e29a66"/>
    <rect x="-16" y="-6" width="17" height="8" fill="#c9703f"/>
    <polygon points="3,-6 20,-6 23,-10.5 6,-10.5" fill="#e29a66"/>
    <rect x="3" y="-6" width="17" height="8" fill="#c9703f"/>
    <polygon points="-7,-17 10,-17 13,-21.5 -4,-21.5" fill="#e29a66"/>
    <rect x="-7" y="-17" width="17" height="8" fill="#c9703f"/>
  </g>
  </g>
  <polygon points="${HEX_PTS}" fill="url(#sheen)" opacity=".16"/>
</symbol>

<symbol id="hex-mount" viewBox="-50 -43.3 100 86.6">
  <defs>
    <linearGradient id="gMount" x1="0" y1="-40" x2="0" y2="40" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#a8aeba"/>
      <stop offset="100%" stop-color="#5f6470"/>
    </linearGradient>
    <clipPath id="cMount"><polygon points="${HEX_PTS}"/></clipPath>
  </defs>
  <polygon points="${HEX_PTS}" fill="url(#gMount)" stroke="#464b55" stroke-width="2.5"/>
  <g clip-path="url(#cMount)">
  <g fill="#575c66" opacity=".55">
    <ellipse cx="-30" cy="24" rx="8" ry="3"/><ellipse cx="26" cy="27" rx="10" ry="3.4"/>
    <ellipse cx="36" cy="8" rx="6" ry="2.6"/><ellipse cx="-40" cy="10" rx="5" ry="2.4"/>
  </g>
  <g>
    <path d="M-30 22 L-12 -16 L6 22 Z" fill="#6e7480"/>
    <path d="M-12 -16 L6 22 L10 22 L-8 -14 Z" fill="#575d68"/>
    <path d="M-12 -16 L-6 -5 L-18 -5 Z" fill="#f4f7fb"/>
    <path d="M-12 -16 L-9 -9 L-15 -8 Z" fill="#dfe6ee"/>
    <path d="M12 16 L26 -10 L40 16 Z" fill="#7a808c"/>
    <path d="M26 -10 L40 16 L42 16 L27 -8 Z" fill="#606672"/>
    <path d="M26 -10 L30 -3 L22 -3 Z" fill="#f4f7fb"/>
  </g>
  <g fill="#9fc4d8" stroke="#5d7f94" stroke-width="1.2">
    <polygon points="-22,14 -18,20 -22,26 -26,20"/>
    <polygon points="18,20 22,25 18,30 14,25"/>
    <polygon points="2,26 5,30 2,34 -1,30"/>
  </g>
  <g fill="#e8f4fa" opacity=".9">
    <circle cx="-23" cy="18.6" r="1.1"/><circle cx="17" cy="23.6" r="1"/>
  </g>
  </g>
  <polygon points="${HEX_PTS}" fill="url(#sheen)" opacity=".16"/>
</symbol>

<symbol id="hex-desert" viewBox="-50 -43.3 100 86.6">
  <defs>
    <radialGradient id="gDesert" cx="0" cy="-8" r="62" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#f0e0ae"/>
      <stop offset="70%" stop-color="#dcc68e"/>
      <stop offset="100%" stop-color="#c2ab6e"/>
    </radialGradient>
    <clipPath id="cDesert"><polygon points="${HEX_PTS}"/></clipPath>
  </defs>
  <polygon points="${HEX_PTS}" fill="url(#gDesert)" stroke="#a3905c" stroke-width="2.5"/>
  <g clip-path="url(#cDesert)">
  <path d="M-46 4 Q-30 -8 -12 2 Q-4 7 4 4 L4 11 Q-8 16 -20 13 Q-34 10 -46 11 Z" fill="#cbb377" opacity=".8"/>
  <path d="M-2 24 Q14 14 30 22 Q38 26 44 24 L44 31 Q30 35 16 32 Q6 30 -2 31 Z" fill="#cbb377" opacity=".7"/>
  <path d="M-30 -22 Q-18 -30 -4 -24" stroke="#c4b482" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M14 -26 Q26 -34 40 -26" stroke="#c4b482" stroke-width="3" fill="none" stroke-linecap="round"/>
  <g fill="#b3a069" stroke="#8f7d4c" stroke-width="1.2">
    <ellipse cx="18" cy="6" rx="5" ry="3.4"/><ellipse cx="26" cy="9" rx="3.4" ry="2.4"/>
    <ellipse cx="-24" cy="-2" rx="4" ry="2.8"/>
  </g>
  </g>
  <polygon points="${HEX_PTS}" fill="url(#sheen)" opacity=".16"/>
</symbol>

<symbol id="robber" viewBox="-20 -28 40 56">
  <ellipse cx="0" cy="24" rx="13" ry="4" fill="#000" opacity=".3"/>
  <path d="M-11 22 q-4 -18 2 -26 q6 -8 12 0 q6 8 2 26 Z" fill="#2b2b33"/>
  <circle cx="0" cy="-8" r="7" fill="#3a3a45"/>
  <path d="M-7 -13 q7 -6 14 0 q-7 -3 -14 0" fill="#1a1a20"/>
  <circle cx="-2.5" cy="-9" r="1.4" fill="#e8e8ee"/>
  <circle cx="2.5" cy="-9" r="1.4" fill="#e8e8ee"/>
</symbol>

<symbol id="settlement" viewBox="-24 -36 48 48">
  <ellipse cx="0" cy="9" rx="13" ry="4" fill="#000" opacity=".28"/>
  <polygon points="-12,9 -12,-10 0,-16 12,-10 12,9 0,14" fill="currentColor"/>
  <polygon points="0,14 12,9 12,-10 0,-5" fill="#000" opacity=".22"/>
  <polygon points="-15,-10 0,-23 15,-10 0,3" fill="#fff" opacity=".82"/>
  <rect x="2" y="-21" width="3.5" height="7" fill="#8a8a94"/>
</symbol>

<symbol id="city" viewBox="-32 -48 64 60">
  <ellipse cx="0" cy="9" rx="18" ry="5" fill="#000" opacity=".3"/>
  <polygon points="-17,9 -17,-18 0,-25 17,-18 17,9 0,15" fill="currentColor"/>
  <polygon points="0,15 17,9 17,-18 0,-11" fill="#000" opacity=".24"/>
  <polygon points="-9,-18 -9,-34 0,-39 9,-34 9,-18 0,-14" fill="currentColor"/>
  <polygon points="0,-14 9,-18 9,-34 0,-30" fill="#000" opacity=".28"/>
  <polygon points="-20,-18 0,-35 20,-18 0,-6" fill="#fff" opacity=".88"/>
  <polygon points="-12,-34 0,-46 12,-34 0,-25" fill="#fff" opacity=".95"/>
  <g fill="#ffe9a8">
    <rect x="-12" y="-3" width="4" height="5"/><rect x="-4" y="-1" width="4" height="5"/>
    <rect x="4" y="-3" width="4" height="5"/><rect x="11" y="-5" width="4" height="5"/>
    <rect x="-6" y="-28" width="4" height="5"/>
  </g>
</symbol>

<symbol id="harbor" viewBox="-34 -18 68 36">
  <rect x="-30" y="-15" width="60" height="30" rx="8" fill="#1d4266" stroke="#5ba3d5" stroke-width="2"/>
  <path d="M-22 7 q5 -9 10 0 q5 -9 10 0" stroke="#5ba3d5" stroke-width="2" fill="none" stroke-linecap="round"/>
  <text x="12" y="6" font-family="Trebuchet MS, sans-serif" font-size="13" fill="#a8d8ff" text-anchor="middle">3:1</text>
</symbol>

<symbol id="harbor2" viewBox="-34 -18 68 36">
  <rect x="-30" y="-15" width="60" height="30" rx="8" fill="#1d4266" stroke="#5ba3d5" stroke-width="2"/>
  <text x="-9" y="7" font-family="Trebuchet MS, sans-serif" font-size="17" fill="#a8d8ff" text-anchor="middle">2:1</text>
  <text x="14" y="6" font-family="Trebuchet MS, sans-serif" font-size="13" fill="#a8d8ff" text-anchor="middle">⚓</text>
</symbol>`;

  const RES_ID = {
    forest: 'hex-forest', pasture: 'hex-pasture', field: 'hex-field',
    hill: 'hex-hill', mount: 'hex-mount', desert: 'hex-desert',
  };

  // Inject the symbols into the live document so they can be rasterised.
  function install() {
    if (document.getElementById('art-defs')) return;
    const holder = document.createElement('div');
    holder.id = 'art-defs';
    holder.style.display = 'none';
    holder.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg">' + MARKUP + '</svg>';
    document.body.insertBefore(holder, document.body.firstChild);
  }

  const cache = new Map();
  const pending = [];
  let installed = false;

  // Remember every request so the in-flight promise list can be extended at
  // any time. Previously only preloaded sizes were tracked, so a draw that
  // asked for a different size (e.g. after the projection scale changed) got
  // a permanently blank canvas.
  function track(promise) {
    pending.push(promise);
    return promise;
  }

  function standalone(id, color) {
    const sym = document.getElementById(id);
    if (!sym) return null;
    const vb = sym.getAttribute('viewBox');
    const parts = vb.split(/\s+/).map(Number);
    const vw = parts[2], vh = parts[3];
    let inner = sym.innerHTML;
    // Piece symbols use currentColor so one definition serves both players.
    if (inner.includes('currentColor')) {
      inner = inner.split('currentColor').join(color || '#e05c5c');
    }
    // Emit at the symbol's true aspect ratio. Forcing a square canvas would
    // squash the flat-top hexes, which are 1.1547 wider than tall.
    return '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="' +
      (120 * vh / vw).toFixed(2) + '" viewBox="' + vb + '">' +
      '<defs><linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#fff" stop-opacity=".7"/>' +
      '<stop offset="60%" stop-color="#fff" stop-opacity="0"/>' +
      '</linearGradient></defs>' + inner + '</svg>';
  }

  // Returns a cached offscreen canvas, or null while it is still decoding.
  function get(id, size, color) {
    if (!id) return null;
    // Round to a bucket so near-identical sizes share one cache entry and the
    // map cannot fill with hundreds of near-duplicate sprites on resize.
    const px = Math.max(8, Math.round(size / 8) * 8);
    const key = id + '|' + px + '|' + (color || '');
    if (cache.has(key)) return cache.get(key);

    const svg = standalone(id, color);
    if (!svg) return null;

    const cv = document.createElement('canvas');
    // Preserve the sprite's aspect ratio when rasterising.
    const sym = document.getElementById(id);
    const vb = sym ? sym.getAttribute('viewBox').split(/\s+/).map(Number) : [0, 0, 100, 100];
    cv.width = px;
    cv.height = Math.max(8, Math.round(px * vb[3] / vb[2]));
    const cx = cv.getContext('2d');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    // src must be set BEFORE decode() is called, otherwise it rejects
    // immediately and the sprite is never painted into the cache.
    const paint = img.decode
      ? img.decode().catch(() => {})
      : new Promise(res => { img.onload = res; img.onerror = res; });
    decoding++;
    track(paint.then(() => {
      decoding--;
      try { cx.drawImage(img, 0, 0, px, cv.height); } catch (e) { /* keep cache */ }
    }));
    cache.set(key, cv);
    return cv;
  }

  function tile(res, size) { return get(RES_ID[res] || 'hex-desert', size); }

  // Warms every sprite so the first frame is complete.
  // Sizes must be the ON-SCREEN pixel sizes, not board units: the projection
  // scales the board up several times, and blitting an 84px sprite into a
  // 280px cell is what made the whole board look blurry.
  function preload(hexSize, pieceSize, colors) {
    install();
    for (const r of Object.keys(RES_ID)) get(RES_ID[r], hexSize);
    get('settlement', pieceSize, colors[0]);
    get('city', pieceSize * 1.15, colors[0]);
    for (const c of colors) {
      get('settlement', pieceSize, c);
      get('city', pieceSize * 1.15, c);
    }
    return Promise.all(pending.slice()).then(() => { installed = true; });
  }

  // True while at least one sprite is still decoding. Callers use this to
  // decide whether another repaint is worthwhile.
  let decoding = 0;
  function inflight() { return decoding > 0; }

  // Resolves when every sprite requested so far has finished decoding. Callers
  // repaint on resolve, which is what fixes a board that renders as bare sea
  // because sprites landed after the last frame.
  function settled() {
    return Promise.all(pending.slice());
  }

  function isReady() { return installed; }

  return { RES_ID, install, get, tile, preload, settled, inflight, isReady, MARKUP };
})();