/* ==================================================================
   Fora Vinyl — illustrated scenes
   Each scene is a painted backdrop (scene-*.jpg, from Chris's reference
   pictures) plus an animated SVG overlay: rain on the glass for the
   lofi room, drifting motes for the neon room. The live record, tonearm
   and cover are positioned over the painted ones by themes.css.
================================================================== */
(() => {
  "use strict";

  const prng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const f1 = (n) => Math.round(n * 10) / 10;

  /* Rain inside one or more window panes. Coordinates are percentages of the frame. */
  function rainOverlay(panes, seed, opts = {}) {
    const rnd = prng(seed);
    const density = opts.density || 1;
    let clips = "", lines = "", drips = "";
    panes.forEach((p, i) => {
      clips += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/>`;
      const n = Math.round(p.w * 1.6 * density);
      for (let k = 0; k < n; k++) {
        const x = p.x + rnd() * p.w, len = 2.2 + rnd() * 3.2, w = 0.08 + rnd() * 0.14;
        const dur = f1(0.8 + rnd() * 0.6), delay = f1(-rnd() * 2), op = f1(0.2 + rnd() * 0.32);
        lines += `<line x1="${f1(x)}" y1="-8" x2="${f1(x - 0.5)}" y2="${f1(-8 + len)}" stroke="#fff" stroke-opacity="${op}" stroke-width="${f1(w)}" stroke-linecap="round" style="animation-duration:${dur}s;animation-delay:${delay}s"/>`;
      }
      const nd = Math.round(p.w / 6);
      for (let k = 0; k < nd; k++) {
        const x = p.x + 1 + rnd() * (p.w - 2), y = p.y + rnd() * p.h * 0.5;
        const dur = f1(5 + rnd() * 5), delay = f1(-rnd() * 9);
        drips += `<g class="drip" style="animation-duration:${dur}s;animation-delay:${delay}s"><line x1="${f1(x)}" y1="${f1(y - 2.4)}" x2="${f1(x)}" y2="${f1(y)}" stroke="#fff" stroke-opacity=".3" stroke-width=".18" stroke-linecap="round"/><circle cx="${f1(x)}" cy="${f1(y)}" r=".22" fill="#fff" fill-opacity=".55"/></g>`;
      }
    });
    return `
<svg class="scene-overlay" viewBox="0 0 100 56.25" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="rain-clip-${seed}">${clips}</clipPath></defs>
  <g clip-path="url(#rain-clip-${seed})">
    <g class="rain rain-pct">${lines}</g>
    ${drips}
    ${panes.map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#dfe8ff" fill-opacity=".05"/>`).join("")}
  </g>
</svg>`;
  }

  /* Slow dust in the air of the neon room. */
  function motesOverlay(seed, n) {
    const rnd = prng(seed);
    let m = "";
    for (let i = 0; i < n; i++) {
      m += `<circle class="mote" cx="${f1(rnd() * 100)}" cy="${f1(15 + rnd() * 40)}" r="${f1(0.12 + rnd() * 0.22)}" fill="${rnd() > 0.5 ? "#ffd6f2" : "#d6f6ff"}" style="animation-duration:${f1(8 + rnd() * 9)}s;animation-delay:${f1(-rnd() * 14)}s"/>`;
    }
    return `<svg class="scene-overlay" viewBox="0 0 100 56.25" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${m}</svg>`;
  }

  window.FV_SCENES = {
    lofi: {
      aspect: 960 / 538,
      html:
        `<img class="scene-img" src="scene-lofi.jpg" alt="" draggable="false">` +
        rainOverlay([{ x: 40.5, y: 0, w: 35.5, h: 22.5 }, { x: 78.5, y: 0, w: 20.5, h: 33.5 }], 7),
    },
    cyber: {
      aspect: 736 / 414,
      html:
        `<img class="scene-img" src="scene-cyber.jpg" alt="" draggable="false">` +
        motesOverlay(21, 26),
    },
  };
})();
