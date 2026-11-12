/* GeoIAN · Clasificador LiDAR — motor de clasificación automática
   Autor: Ian Arias Carrasco (GeoIAN) · Licencia MIT
   Algoritmo transparente en 4 etapas (didáctico, no reemplaza a PDAL/LAStools):
   1) Ruido: punto sin vecinos en un radio 3D -> 7 (bajo) o 18 (alto)
   2) Suelo: semillas = punto más bajo por celda; densificación progresiva:
      un punto pasa a suelo si queda a <= dz sobre la superficie interpolada
      (IDW de los 8 vecinos de suelo más cercanos). Basado en Axelsson (2000), simplificado.
   3) Altura sobre el suelo (HAG): 2 suelo, 3 baja, 4 media, 5 alta
   4) Edificación: puntos altos cuyo vecindario es plano (RMS de plano) -> 6
   Optimizado para millones de puntos: grillas CSR, k-vecinos por anillos y
   re-evaluación sólo de las zonas donde el suelo cambió.
*/
(function (root) {
  'use strict';
  const DEF = { ruidoR: 3.0, celda: 10, dz: 0.5, hBaja: 0.2, hMedia: 1.0, hAlta: 3.0, edifH: 2.0, edifR: 2.5, edifRMS: 0.25, edifMin: 5 };
  const MAX_CELLS = 6e6;

  // Grilla CSR (compressed sparse row) sobre una lista de índices
  function makeGrid(xs, ys, list, m, cs, xmax, ymax) {
    cs = Math.max(cs, Math.sqrt((xmax + 1) * (ymax + 1) / MAX_CELLS));
    const W = Math.floor(xmax / cs) + 1, H = Math.floor(ymax / cs) + 1;
    const start = new Int32Array(W * H + 1), cell = new Int32Array(m);
    for (let k = 0; k < m; k++) {
      const i = list ? list[k] : k;
      const c = Math.min(W - 1, Math.floor(xs[i] / cs)) + W * Math.min(H - 1, Math.floor(ys[i] / cs));
      cell[k] = c; start[c + 1]++;
    }
    for (let c = 0; c < W * H; c++) start[c + 1] += start[c];
    const fill = start.slice(0, W * H), items = new Int32Array(m);
    for (let k = 0; k < m; k++) items[fill[cell[k]]++] = list ? list[k] : k;
    return { cs, W, H, start, items };
  }
  const cxOf = (G, x) => Math.min(G.W - 1, Math.max(0, Math.floor(x / G.cs)));
  const cyOf = (G, y) => Math.min(G.H - 1, Math.max(0, Math.floor(y / G.cs)));

  // Recorre todos los índices en celdas a distancia de Chebyshev <= r
  function forNear(G, x, y, r, fn) {
    const n = Math.ceil(r / G.cs), cx = cxOf(G, x), cy = cyOf(G, y);
    const x0 = Math.max(0, cx - n), x1 = Math.min(G.W - 1, cx + n), y0 = Math.max(0, cy - n), y1 = Math.min(G.H - 1, cy + n);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const c = i + G.W * j;
      for (let k = G.start[c], e = G.start[c + 1]; k < e; k++) if (fn(G.items[k]) === false) return;
    }
  }

  function classify(X, Y, Z, prm, onProgress) {
    const p = Object.assign({}, DEF, prm || {});
    const prog = onProgress || function () {};
    const n = X.length, cls = new Uint8Array(n), hag = new Float32Array(n);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) { const x = X[i], y = Y[i]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const xs = new Float64Array(n), ys = new Float64Array(n);
    for (let i = 0; i < n; i++) { xs[i] = X[i] - x0; ys[i] = Y[i] - y0; }
    const xmax = x1 - x0, ymax = y1 - y0, area = Math.max(1, (xmax + 1) * (ymax + 1));
    const log = [];
    const tick = (stage, k, tot) => { if ((k & 0x3FFFF) === 0) prog(stage + ' ' + Math.round(100 * k / tot) + ' %'); };

    // ---------- 1) Ruido
    prog('Ruido…');
    const G0 = makeGrid(xs, ys, null, n, Math.max(p.ruidoR, 0.5), xmax, ymax);
    const R2 = p.ruidoR * p.ruidoR;
    let nr = 0;
    for (let i = 0; i < n; i++) {
      tick('Ruido', i, n);
      let found = false;
      const xi = xs[i], yi = ys[i], zi = Z[i];
      forNear(G0, xi, yi, p.ruidoR, j => {
        if (j === i) return;
        const dx = xs[j] - xi, dy = ys[j] - yi, dz = Z[j] - zi;
        if (dx * dx + dy * dy + dz * dz <= R2) { found = true; return false; }
      });
      if (!found) {
        const nb = [];
        forNear(G0, xi, yi, 6, j => { if (j !== i) nb.push(Z[j]); });
        nb.sort((a, b) => a - b);
        const med = nb.length ? nb[nb.length >> 1] : zi;
        cls[i] = zi < med ? 7 : 18; nr++;
      }
    }
    log.push('Ruido: ' + nr.toLocaleString('es-CL') + ' puntos aislados (radio ' + p.ruidoR + ' m)');

    // ---------- 2) Suelo
    prog('Suelo: semillas…');
    let nc = 0; for (let i = 0; i < n; i++) if (cls[i] === 0) nc++;
    const cand = new Int32Array(nc); { let k = 0; for (let i = 0; i < n; i++) if (cls[i] === 0) cand[k++] = i; }
    const isG = new Uint8Array(n);
    const Gs = makeGrid(xs, ys, cand, nc, p.celda, xmax, ymax);
    let nseed = 0;
    for (let c = 0; c < Gs.W * Gs.H; c++) {
      let b = -1;
      for (let k = Gs.start[c], e = Gs.start[c + 1]; k < e; k++) { const i = Gs.items[k]; if (b < 0 || Z[i] < Z[b]) b = i; }
      if (b >= 0) { isG[b] = 1; nseed++; }
    }
    log.push('Suelo: ' + nseed.toLocaleString('es-CL') + ' semillas (celda ' + p.celda + ' m)');

    // tamaño de celda de la grilla de suelo (fijo para poder marcar zonas "sucias")
    const csg = Math.min(20, Math.max(0.5, Math.sqrt(area / Math.max(1, nc)) * 3));
    const bd = new Float64Array(8), bi = new Int32Array(8);
    let lastRing = 0;
    // superficie IDW con los 8 vecinos de suelo más cercanos (búsqueda por anillos)
    function surf(G, i) {
      const x = xs[i], y = ys[i], cx = cxOf(G, x), cy = cyOf(G, y);
      let cnt = 0;
      const maxR = Math.max(G.W, G.H);
      let r = 0;
      for (; r <= maxR; r++) {
        for (let j = cy - r; j <= cy + r; j++) {
          if (j < 0 || j >= G.H) continue;
          const edge = (j === cy - r || j === cy + r);
          for (let ii = cx - r; ii <= cx + r; ii += (edge || r === 0) ? 1 : 2 * r) {
            if (ii < 0 || ii >= G.W) continue;
            const c = ii + G.W * j;
            for (let k = G.start[c], e = G.start[c + 1]; k < e; k++) {
              const q = G.items[k]; if (q === i) continue;
              const dx = xs[q] - x, dy = ys[q] - y, d2 = dx * dx + dy * dy;
              if (cnt < 8) { let t = cnt++; while (t > 0 && bd[t - 1] > d2) { bd[t] = bd[t - 1]; bi[t] = bi[t - 1]; t--; } bd[t] = d2; bi[t] = q; }
              else if (d2 < bd[7]) { let t = 7; while (t > 0 && bd[t - 1] > d2) { bd[t] = bd[t - 1]; bi[t] = bi[t - 1]; t--; } bd[t] = d2; bi[t] = q; }
            }
          }
        }
        const lim = r * G.cs;
        if (cnt >= 8 && bd[7] <= lim * lim) break;
      }
      lastRing = r;
      if (!cnt) return Z[i];
      let sw = 0, sz = 0;
      for (let t = 0; t < cnt; t++) { const w = 1 / (bd[t] + 0.01); sw += w; sz += Z[bi[t]] * w; }
      return sz / sw;
    }
    const ringOf = new Uint16Array(n);
    let dirtySAT = null, GW = 0, GH = 0;
    for (let it = 0; it < 25; it++) {
      let ng = 0; for (let k = 0; k < nc; k++) if (isG[cand[k]]) ng++;
      const gl = new Int32Array(ng); { let t = 0; for (let k = 0; k < nc; k++) if (isG[cand[k]]) gl[t++] = cand[k]; }
      const Gg = makeGrid(xs, ys, gl, ng, csg, xmax, ymax);
      GW = Gg.W; GH = Gg.H;
      const added = [];
      let tested = 0;
      for (let k = 0; k < nc; k++) {
        const i = cand[k]; if (isG[i]) continue;
        if (dirtySAT) {
          const r = ringOf[i] + 1, cx = cxOf(Gg, xs[i]), cy = cyOf(Gg, ys[i]);
          const ax = Math.max(0, cx - r), bx = Math.min(GW - 1, cx + r), ay = Math.max(0, cy - r), by = Math.min(GH - 1, cy + r);
          const W1 = GW + 1;
          const s = dirtySAT[(by + 1) * W1 + bx + 1] - dirtySAT[ay * W1 + bx + 1] - dirtySAT[(by + 1) * W1 + ax] + dirtySAT[ay * W1 + ax];
          if (s === 0) continue;
        }
        tested++;
        if ((tested & 0x3FFFF) === 0) prog('Suelo: iteración ' + (it + 1) + ' · ' + tested.toLocaleString('es-CL') + ' puntos');
        const zs = surf(Gg, i); ringOf[i] = Math.min(65000, lastRing);
        if (Z[i] - zs <= p.dz) added.push(i);
      }
      for (const i of added) isG[i] = 1;
      prog('Suelo: iteración ' + (it + 1) + ' · +' + added.length.toLocaleString('es-CL') + ' puntos');
      if (added.length === 0) { log.push('Suelo: densificación convergió en ' + (it + 1) + ' iteraciones'); break; }
      if (it === 24) log.push('Suelo: se alcanzó el máximo de 25 iteraciones');
      // tabla de áreas acumuladas de celdas con suelo nuevo
      const W1 = GW + 1, sat = new Int32Array(W1 * (GH + 1)), mark = new Uint8Array(GW * GH);
      for (const i of added) mark[cxOf(Gg, xs[i]) + GW * cyOf(Gg, ys[i])] = 1;
      for (let j = 0; j < GH; j++) { let row = 0; for (let ii = 0; ii < GW; ii++) { row += mark[ii + GW * j]; sat[(j + 1) * W1 + ii + 1] = sat[j * W1 + ii + 1] + row; } }
      dirtySAT = sat;
    }

    // ---------- 3) Altura sobre el suelo
    prog('Altura sobre el suelo…');
    let ng = 0; for (let k = 0; k < nc; k++) if (isG[cand[k]]) ng++;
    const gl = new Int32Array(ng); { let t = 0; for (let k = 0; k < nc; k++) if (isG[cand[k]]) gl[t++] = cand[k]; }
    const Gg = makeGrid(xs, ys, gl, ng, csg, xmax, ymax);
    let nhi = 0;
    for (let k = 0; k < nc; k++) {
      tick('Altura sobre el suelo', k, nc);
      const i = cand[k];
      if (isG[i]) { cls[i] = 2; hag[i] = 0; continue; }
      const h = Z[i] - surf(Gg, i); hag[i] = h;
      cls[i] = h < p.hBaja ? 2 : h < p.hMedia ? 3 : h < p.hAlta ? 4 : 5;
      if (h >= p.edifH) nhi++;
    }
    for (let i = 0; i < n; i++) if (cls[i] === 7 || cls[i] === 18) hag[i] = Z[i] - surf(Gg, i);

    // ---------- 4) Edificación por planaridad
    prog('Edificación…');
    const hi = new Int32Array(nhi); { let t = 0; for (let k = 0; k < nc; k++) { const i = cand[k]; if (!isG[i] && hag[i] >= p.edifH) hi[t++] = i; } }
    const Gh = makeGrid(xs, ys, hi, nhi, Math.max(0.5, p.edifR), xmax, ymax);
    const buf = new Int32Array(200000), R2e = p.edifR * p.edifR;
    let ne = 0; const toE = [];
    for (let k = 0; k < nhi; k++) {
      tick('Edificación', k, nhi);
      const i = hi[k], xi = xs[i], yi = ys[i];
      let m = 0;
      forNear(Gh, xi, yi, p.edifR, j => { const dx = xs[j] - xi, dy = ys[j] - yi; if (dx * dx + dy * dy <= R2e && m < buf.length) buf[m++] = j; });
      if (m < p.edifMin) continue;
      const step = m > 160 ? Math.ceil(m / 160) : 1;
      let mx = 0, my = 0, mz = 0, c = 0;
      for (let t = 0; t < m; t += step) { const j = buf[t]; mx += xs[j]; my += ys[j]; mz += Z[j]; c++; }
      mx /= c; my /= c; mz /= c;
      let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
      for (let t = 0; t < m; t += step) { const j = buf[t]; const u = xs[j] - mx, v = ys[j] - my, w = Z[j] - mz; sxx += u * u; sxy += u * v; syy += v * v; sxz += u * w; syz += v * w; }
      const det = sxx * syy - sxy * sxy; if (Math.abs(det) < 1e-9) continue;
      // descartar vecindarios lineales (cables): razón de valores propios horizontales
      const tr = sxx + syy, disc = Math.sqrt(Math.max(0, (sxx - syy) ** 2 / 4 + sxy * sxy));
      const l1 = tr / 2 + disc, l2 = tr / 2 - disc; if (l2 / l1 < 0.15) continue;
      const a = (sxz * syy - syz * sxy) / det, b = (syz * sxx - sxz * sxy) / det;
      let ss = 0; for (let t = 0; t < m; t += step) { const j = buf[t]; const r = (Z[j] - mz) - a * (xs[j] - mx) - b * (ys[j] - my); ss += r * r; }
      if (Math.sqrt(ss / c) <= p.edifRMS) toE.push(i);
    }
    for (const i of toE) { cls[i] = 6; ne++; }
    log.push('Edificación: ' + ne.toLocaleString('es-CL') + ' puntos en vecindarios planos (RMS <= ' + p.edifRMS + ' m)');
    return { cls, hag, log, params: p };
  }

  const api = { classify, DEF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GeoClassify = api;
})(typeof self !== 'undefined' ? self : this);
