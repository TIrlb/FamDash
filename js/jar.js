/* Marble-jar renderer. Draws an SVG jar whose size is fixed and whose marble
   radius scales so `goal` marbles fill ~85% of it. Marble layout and colors
   are seeded per kid, so the jar looks the same on every render. */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var PALETTE = ['#5ec8f0', '#2846c8', '#f05a28', '#f7d23a', '#f2f2ee', '#3fbf68', '#e2364a'];
  var IN = { x0: 34, x1: 266, y0: 74, y1: 420 }; // interior bounds in viewBox units
  var SQ3 = Math.sqrt(3);

  function rng(seedStr) {
    var h = 1779033703 ^ seedStr.length;
    for (var i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    var a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function slots(r, rand) {
    var out = [];
    var row = 0;
    for (var y = IN.y1 - r; y >= IN.y0 + r; y -= r * SQ3, row++) {
      var line = [];
      var off = row % 2 ? r : 0;
      for (var x = IN.x0 + r + off; x <= IN.x1 - r + 0.01; x += 2 * r) line.push({ x: x, y: y });
      // shuffle within the row so marbles don't fill strictly left-to-right
      for (var i = line.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1)); var t = line[i]; line[i] = line[j]; line[j] = t;
      }
      out = out.concat(line);
    }
    return out;
  }

  var layoutCache = {};
  function layout(seed, goal) {
    var key = seed + ':' + goal;
    if (layoutCache[key]) return layoutCache[key];
    var want = Math.ceil(goal / 0.85);
    var r = 40, pts;
    for (; r > 4; r -= 0.25) {
      pts = slots(r, rng(seed + r));
      if (pts.length >= want) break;
    }
    var rand = rng(seed + 'look');
    var marbles = pts.map(function (p) {
      var c1 = PALETTE[Math.floor(rand() * PALETTE.length)];
      var c2 = PALETTE[Math.floor(rand() * PALETTE.length)];
      return {
        x: p.x + (rand() - 0.5) * r * 0.18,
        y: p.y + (rand() - 0.5) * r * 0.12,
        rot: Math.floor(rand() * 360),
        c1: c1, c2: c2 === c1 ? '#f2f2ee' : c2
      };
    });
    return (layoutCache[key] = { r: r, marbles: marbles });
  }

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function ensureDefs() {
    if (document.getElementById('famdash-jar-defs')) return;
    var svg = el('svg', { id: 'famdash-jar-defs', width: 0, height: 0, style: 'position:absolute' });
    var defs = el('defs', {}, svg);
    var g = el('radialGradient', { id: 'mGlass', cx: '.42', cy: '.38', r: '.65' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '.12' }, g);
    el('stop', { offset: '.75', 'stop-color': '#e6f3f8', 'stop-opacity': '.08' }, g);
    el('stop', { offset: '1', 'stop-color': '#7f98a6', 'stop-opacity': '.5' }, g);
    var h = el('radialGradient', { id: 'mHi', cx: '.32', cy: '.28', r: '.42' }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.95' }, h);
    el('stop', { offset: '.35', 'stop-color': '#fff', 'stop-opacity': '.35' }, h);
    el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }, h);
    var lid = el('linearGradient', { id: 'jLid', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffffff' }, lid);
    el('stop', { offset: '1', 'stop-color': '#d9dde3' }, lid);
    var shine = el('linearGradient', { id: 'jShine', x1: '0', y1: '0', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' }, shine);
    el('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '.28' }, shine);
    el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }, shine);
    document.body.appendChild(svg);
  }

  // One vane of a cat's-eye marble, unit radius.
  var VANE = 'M0,-.86 C.5,-.42 .32,.48 0,.86 C-.32,.48 -.5,-.42 0,-.86Z';

  function drawMarble(parent, m, r, cls, delay) {
    var pos = el('g', { transform: 'translate(' + m.x.toFixed(1) + ',' + m.y.toFixed(1) + ')' }, parent);
    var anim = el('g', { 'class': 'marble ' + (cls || '') }, pos);
    if (delay) anim.style.animationDelay = delay + 'ms';
    el('circle', { r: r, fill: '#eaf6fb', opacity: '.78' }, anim);
    var v = el('g', { transform: 'rotate(' + m.rot + ') scale(' + r + ')' }, anim);
    el('path', { d: VANE, fill: m.c1 }, v);
    el('path', { d: VANE, fill: m.c2, transform: 'rotate(90) scale(.72,.9)', opacity: '.92' }, v);
    el('circle', { r: r, fill: 'url(#mGlass)' }, anim);
    el('circle', { r: r, fill: 'url(#mHi)' }, anim);
    el('circle', { r: r - 0.4, fill: 'none', stroke: 'rgba(20,40,60,.35)', 'stroke-width': '.8' }, anim);
    return pos;
  }

  /**
   * render(container, kid, prevCount)
   * prevCount: count shown last time (for drop / lift animation); pass null to skip animation.
   */
  function render(container, kid, prevCount) {
    ensureDefs();
    var L = layout(kid.id, kid.goal);
    var shown = Math.min(kid.count, L.marbles.length);
    var prev = prevCount == null ? shown : Math.min(prevCount, L.marbles.length);

    var svg = el('svg', { viewBox: '0 0 300 440', 'class': 'jar-svg', role: 'img',
      'aria-label': kid.name + ' has ' + kid.count + ' marbles' });

    // glass body (back)
    el('rect', { x: 22, y: 52, width: 256, height: 380, rx: 36, fill: 'rgba(255,255,255,.07)' }, svg);

    // goal line
    var goalIdx = Math.min(kid.goal, L.marbles.length) - 1;
    if (goalIdx >= 0) {
      var gy = Infinity;
      L.marbles.slice(0, goalIdx + 1).forEach(function (m) { if (m.y < gy) gy = m.y; });
      gy -= L.r + 3;
      el('line', { x1: 30, x2: 270, y1: gy, y2: gy, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 2, 'stroke-dasharray': '6 7' }, svg);
      el('text', { x: 262, y: gy - 7, 'text-anchor': 'end', 'class': 'jar-goal' }, svg).textContent = 'goal ' + kid.goal;
    }

    var mg = el('g', {}, svg);
    var stagger = 0;
    for (var i = 0; i < shown; i++) {
      var isNew = i >= prev;
      drawMarble(mg, L.marbles[i], L.r, isNew ? 'drop' : '', isNew ? (stagger++) * 140 : 0);
    }
    // marbles taken out float up and fade
    for (var j = shown; j < prev; j++) {
      var ghost = drawMarble(mg, L.marbles[j], L.r, 'lift', (j - shown) * 90);
      (function (gh) { setTimeout(function () { if (gh.parentNode) gh.parentNode.removeChild(gh); }, 1600); })(ghost);
    }

    // glass body (front): outline + shine
    el('rect', { x: 22, y: 52, width: 256, height: 380, rx: 36, fill: 'none', stroke: 'rgba(255,255,255,.55)', 'stroke-width': 3 }, svg);
    el('rect', { x: 40, y: 80, width: 26, height: 320, rx: 13, fill: 'url(#jShine)' }, svg);
    // lid
    el('rect', { x: 34, y: 8, width: 232, height: 52, rx: 12, fill: 'url(#jLid)' }, svg);
    el('rect', { x: 34, y: 50, width: 232, height: 10, fill: 'rgba(0,0,0,.08)' }, svg);

    container.innerHTML = '';
    container.appendChild(svg);
    return { overflow: Math.max(0, kid.count - L.marbles.length) };
  }

  global.Jar = { render: render, PALETTE: PALETTE };
})(window);
