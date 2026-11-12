/* GeoIAN · Clasificador LiDAR — interfaz
   Autor: Ian Arias Carrasco (GeoIAN) · Licencia MIT */
import { createViewer } from './viewer3d.js';

const $ = id => document.getElementById(id);
const LasIO = window.LasIO;
const fmtN = v => Number(v).toLocaleString('es-CL');

// ---------- Clases ASPRS (LAS 1.4)
const CLS = {
  0: ['Creado, nunca clasificado', 'NC', '#9AA3AF'], 1: ['No clasificado', 'NOCLAS', '#5A6478'], 2: ['Suelo', 'SUELO', '#C2A27A'],
  3: ['Vegetación baja', 'VEG_BAJA', '#A8D86E'], 4: ['Vegetación media', 'VEG_MEDIA', '#4CAF50'], 5: ['Vegetación alta', 'VEG_ALTA', '#1E6B2E'],
  6: ['Edificación', 'EDIF', '#D9443A'], 7: ['Ruido bajo', 'RUIDO_BAJO', '#E040FB'], 8: ['Punto clave del modelo', 'CLAVE', '#FFB300'],
  9: ['Agua', 'AGUA', '#2F80ED'], 10: ['Vía férrea', 'FERROVIA', '#795548'], 11: ['Superficie de camino', 'VIA', '#455A64'],
  12: ['Traslape / reservado', 'TRASLAPE', '#B0BEC5'], 13: ['Protección de cable', 'CABLE_PROT', '#80DEEA'], 14: ['Conductor (cable)', 'CABLE', '#21A9D8'],
  15: ['Torre de transmisión', 'TORRE', '#E8772A'], 16: ['Conector de cable', 'CONECTOR', '#FF8A65'], 17: ['Tablero de puente', 'PUENTE', '#8D6E63'],
  18: ['Ruido alto', 'RUIDO_ALTO', '#E040FB']
};
const MAIN = [1, 2, 3, 4, 5, 6, 7, 9, 11, 14, 15, 17, 18];
const name = c => CLS[c] ? CLS[c][0] : 'Clase ' + c;
const code = c => CLS[c] ? CLS[c][1] : 'C' + c;
const hex = c => CLS[c] ? CLS[c][2] : '#' + ((c * 2654435761) >>> 8 & 0xFFFFFF).toString(16).padStart(6, '0');
const CODEMAP = {}; Object.keys(CLS).forEach(k => CODEMAP[CLS[k][1]] = +k);
const pack = (r, g, b) => (255 << 24 | b << 16 | g << 8 | r) >>> 0;
const hexPack = h => pack(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
const CCOL = new Uint32Array(256); for (let c = 0; c < 256; c++) CCOL[c] = hexPack(hex(c));
const SEL = pack(255, 212, 0);
const ZLUT = new Uint32Array(256);
{ const st = [[0, [33, 102, 172]], [0.25, [33, 169, 216]], [0.5, [120, 198, 121]], [0.75, [253, 190, 70]], [1, [215, 48, 39]]];
  for (let k = 0; k < 256; k++) { const t = k / 255; let a = st[0], b = st[st.length - 1]; for (let s = 0; s < st.length - 1; s++) if (t >= st[s][0] && t <= st[s + 1][0]) { a = st[s]; b = st[s + 1]; break; }
    const u = (t - a[0]) / ((b[0] - a[0]) || 1); ZLUT[k] = pack(...a[1].map((v, i) => Math.round(v + u * (b[1][i] - v)))); } }

// ---------- Estado
let D = null;            // nube: {n,X,Y,Z,C,I,RGB,P,recs,headerBytes,evlr,meta,name,ref,refLabel}
let cls = null, hag = null, ran = false, manual = 0, logLines = [];
let sel = null, selN = 0, undo = [];
let order = null;        // índices ordenados por Z (planta tipo MDS)
let vis = {}; for (let c = 0; c < 256; c++) vis[c] = true;
let zlo = 0, zhi = 1, ilo = 0, ihi = 1;
let worker = null, busy = false;
const PRM = ['ruidoR', 'celda', 'dz', 'hBaja', 'hMedia', 'hAlta', 'edifH', 'edifR', 'edifRMS'];
const DEF = { ruidoR: 3.0, celda: 10, dz: 0.5, hBaja: 0.2, hMedia: 1.0, hAlta: 3.0, edifH: 2.0, edifR: 2.5, edifRMS: 0.25 };
function setDef() { PRM.forEach(k => $(k).value = DEF[k]); } setDef(); $('dflt').onclick = setDef;

function toast(m, ms) { const d = $('msg'); d.textContent = m; d.style.display = 'block'; clearTimeout(d._t); d._t = setTimeout(() => d.style.display = 'none', ms || 2800); }
const stamp = () => new Date().toLocaleString('es-CL');
const addLog = s => logLines.push('[' + stamp() + '] ' + s);
function busyOn(t) { busy = true; $('pbar').hidden = false; $('ptxt').textContent = t; $('run').disabled = true; }
function busyOff() { busy = false; $('pbar').hidden = true; $('run').disabled = !D; }

// ---------- Tema
(function () {
  let t = null; try { t = localStorage.getItem('geoian-theme'); } catch (e) {}
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  $('theme').onclick = () => { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('geoian-theme', n); } catch (e) {} v3.bg(); draw(); drawProf(); };
})();

// ---------- Worker
function getWorker() {
  if (worker) return worker;
  worker = new Worker('js/worker.js');
  return worker;
}
function runWorker(msg, transfer) {
  return new Promise((res, rej) => {
    const w = getWorker();
    w.onmessage = ev => { const m = ev.data; if (m.type === 'progress') $('ptxt').textContent = m.msg; else if (m.type === 'error') rej(new Error(m.msg)); else res(m); };
    w.onerror = e => rej(new Error(e.message || 'Error en el proceso de fondo'));
    w.postMessage(msg, transfer || []);
  });
}

// ---------- Carga de datos
async function loadFile(file) {
  if (busy) return;
  const nm = file.name;
  busyOn('Leyendo ' + nm + '…');
  try {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    const isLas = String.fromCharCode(...head) === 'LASF';
    const m = await runWorker({ type: 'load', buffer: buf, name: nm, isLas, maxPts: +$('maxPts').value || 3e6, layout: $('layout').value, codeMap: CODEMAP }, [buf]);
    const d = m.data; d.name = nm.replace(/\.[^.]+$/, '');
    const hasCls = (() => { for (let i = 0; i < d.n; i++) if (d.C[i] > 1) return true; return false; })();
    d.ref = hasCls ? d.C : null; d.refLabel = 'Coincidencia con la clasificación original del archivo';
    setData(d, $('keepCls').checked && hasCls ? d.C.slice() : new Uint8Array(d.n));
    const mt = d.meta;
    $('finfo').textContent = nm + '\n' + (mt.source === 'TXT' ? 'Texto · columnas ' + mt.layout + ' · separador ' + mt.delim + (mt.bad ? ' · ' + fmtN(mt.bad) + ' líneas omitidas' : '') : mt.source + ' ' + mt.version + ' · formato de punto ' + mt.fmt + (mt.hasRGB ? ' · RGB' : '')) +
      '\nPuntos: ' + fmtN(d.n) + (mt.stride > 1 ? ' (de ' + fmtN(mt.total) + ', 1 de cada ' + mt.stride + ')' : '') +
      '\nCRS: ' + (mt.epsg ? 'EPSG:' + mt.epsg : 'no declarado') + '\nZ: ' + mt.bounds[2].toFixed(2) + ' a ' + mt.bounds[5].toFixed(2) + (mt.feet ? ' pies\n⚠ Coordenadas en pies: los parámetros de clasificación están en metros (multiplícalos por 3,28).' : ' m');
    if (mt.stride > 1) toast('Nube submuestreada: se cargó 1 de cada ' + mt.stride + ' puntos. Ajusta el máximo en "Opciones de lectura".', 5000);
    addLog('ABIERTO ' + nm + ' (' + d.n + ' puntos' + (mt.stride > 1 ? ', submuestreo 1/' + mt.stride : '') + ')');
  } catch (e) { toast('No se pudo leer el archivo: ' + e.message, 6000); $('log').textContent = 'Error: ' + e.message; }
  busyOff();
}
async function loadDemo() {
  if (busy) return;
  busyOn('Descargando demo…');
  try {
    const j = await (await fetch('data/los-aromos.json')).json();
    const n = j.E.length;
    const d = { n, X: Float64Array.from(j.E), Y: Float64Array.from(j.N), Z: Float64Array.from(j.Z), C: Uint8Array.from(j.C), I: null, RGB: null, P: null, recs: null, headerBytes: null, evlr: null,
      meta: { source: 'DEMO', total: n, stride: 1, n, epsg: j.epsg, hasRGB: false, hasI: false }, name: 'LosAromos', P0: j.P0 };
    d.epsg = j.epsg; d.ref = d.C; d.refLabel = 'Concordancia con la nube de referencia del docente';
    setData(d, new Uint8Array(n));
    $('finfo').textContent = 'Demo: ' + j.nombre + '\nPuntos: ' + fmtN(n) + ' · todos sin clasificar (NC)\nCRS: SIRGAS-Chile 2002 / UTM 19S (EPSG:5361)\nModo práctica: tu resultado se compara con la referencia.';
    addLog('ABIERTO demo Los Aromos (' + n + ' puntos)');
  } catch (e) { toast('No se pudo cargar la demo: ' + e.message, 5000); }
  busyOff();
}
function setData(d, c) {
  D = d; cls = c; hag = null; ran = false; manual = 0; undo = []; logLines = [];
  sel = new Uint8Array(d.n); selN = 0;
  const n = d.n;
  // orden por Z para la planta
  order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => d.Z[a] - d.Z[b]);
  zlo = d.Z[order[Math.floor(n * 0.01)]]; zhi = d.Z[order[Math.min(n - 1, Math.floor(n * 0.99))]]; if (zhi <= zlo) zhi = zlo + 1;
  if (d.I) { const s = Array.from(d.I.filter((_, i) => i % Math.max(1, Math.floor(n / 50000)) === 0)).sort((a, b) => a - b); ilo = s[Math.floor(s.length * 0.02)] || 0; ihi = s[Math.floor(s.length * 0.98)] || 1; if (ihi <= ilo) ihi = ilo + 1; }
  $('colorBy').value = d.RGB && !cls.some(v => v > 1) ? 'rgb' : (cls.some(v => v > 1) ? 'c' : 'z');
  $('colorBy').querySelector('[value=i]').disabled = !d.I; $('colorBy').querySelector('[value=rgb]').disabled = !d.RGB;
  for (let k = 0; k < 256; k++) vis[k] = true;
  sec = null; prof = null; secTmp = []; setTool('nav');
  $('run').disabled = false; $('log').textContent = 'Lista para clasificar. Ajusta parámetros y presiona "Ejecutar clasificación".';
  fillSel(); buildLeg(); fit(); drawProf(); updSel(); set3D('all');
}

// ---------- Leyenda, conteo, concordancia
function counts() { const c = new Float64Array(256); for (let i = 0; i < D.n; i++) c[cls[i]]++; return c; }
function buildLeg() {
  if (!D) { $('leg').innerHTML = ''; $('tcnt').innerHTML = ''; return; }
  const cnt = counts(); const present = []; for (let c = 0; c < 256; c++) if (cnt[c]) present.push(c);
  $('leg').innerHTML = present.map(c => '<label title="' + name(c) + '"><input type="checkbox" data-c="' + c + '"' + (vis[c] ? ' checked' : '') + '><span class="sw" style="background:' + hex(c) + '"></span>' + c + ' ' + code(c) + '</label>').join('') +
    '<span class="lk" id="lkAll">todas</span><span class="lk" id="lkNone">ninguna</span>';
  $('leg').querySelectorAll('input').forEach(el => el.onchange = () => { vis[+el.dataset.c] = el.checked; redrawAll(true); });
  $('lkAll').onclick = () => { for (let k = 0; k < 256; k++) vis[k] = true; buildLeg(); redrawAll(true); };
  $('lkNone').onclick = () => { for (let k = 0; k < 256; k++) vis[k] = false; buildLeg(); redrawAll(true); };
  $('tcnt').innerHTML = present.map(c => '<tr><td><span class="sw" style="background:' + hex(c) + '"></span>' + c + ' · ' + name(c) + '</td><td>' + code(c) + '</td><td class="n">' + fmtN(cnt[c]) + '</td></tr>').join('') +
    '<tr><td><b>Total</b></td><td></td><td class="n"><b>' + fmtN(D.n) + '</b></td></tr>';
  if (D.ref && (ran || D.ref !== D.C || manual)) {
    let ok = 0; const M = new Map();
    for (let i = 0; i < D.n; i++) { if (D.ref[i] === cls[i]) ok++; else { const k = D.ref[i] * 256 + cls[i]; M.set(k, (M.get(k) || 0) + 1); } }
    const top = [...M.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    $('accbox').innerHTML = '<div style="margin-top:10px;font-size:12.5px">' + D.refLabel + '</div><div class="big">' + (100 * ok / D.n).toFixed(2).replace('.', ',') + ' %</div>' +
      (top.length ? '<table style="margin-top:6px"><thead><tr><th>' + (D.meta.source === 'DEMO' ? 'Debería ser' : 'Original') + '</th><th>Quedó como</th><th class="r">Pts</th></tr></thead><tbody>' + top.map(([k, v]) => '<tr><td>' + code(k >> 8) + '</td><td>' + code(k & 255) + '</td><td class="n">' + fmtN(v) + '</td></tr>').join('') + '</tbody></table>' : '');
  } else $('accbox').innerHTML = '';
}
function fillSel() {
  const o = c => '<option value="' + c + '">' + c + ' ' + code(c) + '</option>';
  const list = Object.keys(CLS).map(Number).filter(c => c !== 0);
  $('from').innerHTML = '<option value="-1">Todas</option>' + o(0) + list.map(o).join('');
  $('to').innerHTML = list.map(o).join(''); $('to').value = 2;
}

// ---------- Color de un punto
function colorOf(i) {
  if (sel[i]) return SEL;
  const m = $('colorBy').value;
  if (m === 'z') { let t = (D.Z[i] - zlo) / (zhi - zlo); t = t < 0 ? 0 : t > 1 ? 1 : t; return ZLUT[(t * 255) | 0]; }
  if (m === 'i' && D.I) { let t = (D.I[i] - ilo) / (ihi - ilo); t = t < 0 ? 0 : t > 1 ? 1 : t; const g = (30 + t * 225) | 0; return pack(g, g, g); }
  if (m === 'rgb' && D.RGB) return pack(D.RGB[3 * i], D.RGB[3 * i + 1], D.RGB[3 * i + 2]);
  return CCOL[cls[i]];
}

// ---------- Planta
const cv = $('plan'), cx = cv.getContext('2d'), pv = $('prof'), px = pv.getContext('2d');
let view = { s: 1, ox: 0, oy: 0 }, tool = 'nav', sec = null, secTmp = [], drag = null, lasso = null, dpr = window.devicePixelRatio || 1, prof = null;
let spacing = 1;
function size(c) { const r = c.getBoundingClientRect(); const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
function fit() {
  size(cv); if (!D) { draw(); return; }
  const b = D.meta.bounds || bounds(); const w = cv.width, h = cv.height;
  const dx = Math.max(1, b[3] - b[0]), dy = Math.max(1, b[4] - b[1]);
  const s = Math.min(w / dx, h / dy) * 0.94;
  view = { s, ox: w / 2 - s * (b[0] + b[3]) / 2, oy: h / 2 + s * (b[1] + b[4]) / 2 };
  spacing = Math.sqrt(dx * dy / D.n);
  draw();
}
function bounds() { let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity; for (let i = 0; i < D.n; i++) { if (D.X[i] < x0) x0 = D.X[i]; if (D.X[i] > x1) x1 = D.X[i]; if (D.Y[i] < y0) y0 = D.Y[i]; if (D.Y[i] > y1) y1 = D.Y[i]; if (D.Z[i] < z0) z0 = D.Z[i]; if (D.Z[i] > z1) z1 = D.Z[i]; } D.meta.bounds = [x0, y0, z0, x1, y1, z1]; return D.meta.bounds; }
const W2S = (e, n) => [view.ox + view.s * e, view.oy - view.s * n], S2W = (x, y) => [(x - view.ox) / view.s, (view.oy - y) / view.s];
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let raf = 0; function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawNow(); }); }
function drawNow() {
  size(cv); const w = cv.width, h = cv.height;
  const img = cx.createImageData(w, h), B = new Uint32Array(img.data.buffer);
  const bgc = css('--cv') || '#F7F9FB'; B.fill(hexPack(bgc.length === 7 ? bgc : '#F7F9FB'));
  if (D) {
    const ps = +$('psize').value;
    const r = ps || Math.max(1, Math.min(4, Math.round(view.s * spacing * 0.9)));
    const s = view.s, ox = view.ox, oy = view.oy, n = D.n;
    const paint = (i, c, rr) => {
      const x = (ox + s * D.X[i]) | 0, y = (oy - s * D.Y[i]) | 0;
      if (x < -rr || y < -rr || x >= w + rr || y >= h + rr) return;
      if (rr === 1) { if (x >= 0 && y >= 0 && x < w && y < h) B[y * w + x] = c; return; }
      const a = rr >> 1, xa = Math.max(0, x - a), xb = Math.min(w - 1, x - a + rr - 1), ya = Math.max(0, y - a), yb = Math.min(h - 1, y - a + rr - 1);
      for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) B[yy * w + xx] = c;
    };
    for (let k = 0; k < n; k++) { const i = order[k]; const c = cls[i]; if (!vis[c] || sel[i]) continue; paint(i, colorOf(i), (c === 7 || c === 18) ? Math.max(3, r * 2) : r); }
    if (selN) for (let k = 0; k < n; k++) { const i = order[k]; if (sel[i] && vis[cls[i]]) paint(i, SEL, r + 1); }
  }
  cx.putImageData(img, 0, 0);
  // capas vectoriales
  if (sec) {
    const L = Math.hypot(sec.b[0] - sec.a[0], sec.b[1] - sec.a[1]) || 1, ux = (sec.b[0] - sec.a[0]) / L, uy = (sec.b[1] - sec.a[1]) / L, hw = +$('pw').value / 2;
    cx.strokeStyle = '#E8772A'; cx.lineWidth = 2 * dpr; cx.beginPath();
    [[-1, 1], [1, 1], [1, -1], [-1, -1]].forEach(([k, m], j) => { const e = (k < 0 ? sec.a[0] : sec.b[0]) - uy * hw * m, nn = (k < 0 ? sec.a[1] : sec.b[1]) + ux * hw * m; const [x, y] = W2S(e, nn); j ? cx.lineTo(x, y) : cx.moveTo(x, y); });
    cx.closePath(); cx.stroke();
    const [ax, ay] = W2S(sec.a[0], sec.a[1]), [bx, by] = W2S(sec.b[0], sec.b[1]);
    cx.fillStyle = '#E8772A'; cx.font = 'bold ' + (13 * dpr) + 'px Arial'; cx.fillText('A', ax + 5 * dpr, ay - 5 * dpr); cx.fillText('B', bx + 5 * dpr, by - 5 * dpr);
  }
  if (secTmp.length === 1) { const [x, y] = W2S(secTmp[0][0], secTmp[0][1]); cx.fillStyle = '#E8772A'; cx.beginPath(); cx.arc(x, y, 4 * dpr, 0, 7); cx.fill(); }
  if (drag && drag.rect && drag.cv === cv) { cx.strokeStyle = '#E8772A'; cx.lineWidth = 1.5 * dpr; cx.setLineDash([6, 4]); cx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); cx.setLineDash([]); }
  if (lasso && lasso.length > 1) { cx.strokeStyle = '#E8772A'; cx.lineWidth = 1.5 * dpr; cx.setLineDash([6, 4]); cx.beginPath(); lasso.forEach(([x, y], j) => j ? cx.lineTo(x, y) : cx.moveTo(x, y)); cx.closePath(); cx.stroke(); cx.setLineDash([]); }
  if (D) {
    const m = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find(v => v * view.s > 80 * dpr) || 5000;
    cx.fillStyle = css('--txt') || '#1B2A4A'; cx.fillRect(14 * dpr, h - 16 * dpr, m * view.s, 3 * dpr); cx.font = (11 * dpr) + 'px Arial'; cx.fillText(m + ' m', 14 * dpr, h - 22 * dpr);
    cx.font = 'bold ' + (12 * dpr) + 'px Arial'; cx.fillText('N ↑', w - 36 * dpr, 22 * dpr);
  } else { cx.fillStyle = css('--muted'); cx.font = (13 * dpr) + 'px Arial'; cx.fillText('Carga un archivo LAS/LAZ/XYZ o la demo para comenzar.', 18 * dpr, 30 * dpr); }
}
function evXY(c, ev) { const r = c.getBoundingClientRect(); return [(ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr]; }
const HINT = { nav: 'Rueda = zoom · arrastrar = mover · clic = seleccionar un punto (Shift = sumar)', prof: 'Clic en el punto A y luego en el punto B del perfil', rect: 'Arrastra un rectángulo para seleccionar (Shift = sumar a la selección)', lasso: 'Dibuja el contorno a mano alzada (Shift = sumar a la selección)' };
function setTool(t) { tool = t; ['tNav', 'tProf', 'tRect', 'tLasso'].forEach(id => $(id).classList.remove('on')); $({ nav: 'tNav', prof: 'tProf', rect: 'tRect', lasso: 'tLasso' }[t]).classList.add('on'); secTmp = []; draw(); $('info').textContent = HINT[t]; }
$('tNav').onclick = () => setTool('nav'); $('tProf').onclick = () => setTool('prof'); $('tRect').onclick = () => setTool('rect'); $('tLasso').onclick = () => setTool('lasso');
$('fit').onclick = fit; $('colorBy').onchange = () => redrawAll(false); $('psize').onchange = draw; $('pw').oninput = () => { draw(); drawProf(); if (mode3 === 'prof') set3D('prof', true); };
cv.addEventListener('wheel', ev => { ev.preventDefault(); const [x, y] = evXY(cv, ev); const k = ev.deltaY < 0 ? 1.25 : 0.8; view.ox = x - (x - view.ox) * k; view.oy = y - (y - view.oy) * k; view.s *= k; draw(); }, { passive: false });
cv.addEventListener('pointerdown', ev => {
  if (!D) return; const [x, y] = evXY(cv, ev); cv.setPointerCapture(ev.pointerId);
  if (tool === 'prof' && ev.button === 0) { const w = S2W(x, y); secTmp.push(w); if (secTmp.length === 2) { sec = { a: secTmp[0], b: secTmp[1] }; secTmp = []; addLog('PERFIL A(' + sec.a.map(v => v.toFixed(2)).join(', ') + ') B(' + sec.b.map(v => v.toFixed(2)).join(', ') + ') ancho ' + $('pw').value + ' m'); drawProf(); if (mode3 === 'prof') set3D('prof'); } draw(); return; }
  if (tool === 'lasso' && ev.button === 0) { lasso = [[x, y]]; drag = { cv, lasso: true, add: ev.shiftKey }; return; }
  drag = { cv, x0: x, y0: y, x1: x, y1: y, ox: view.ox, oy: view.oy, rect: tool === 'rect' && ev.button === 0, moved: false, add: ev.shiftKey };
});
cv.addEventListener('pointermove', ev => {
  if (!drag || drag.cv !== cv) return; const [x, y] = evXY(cv, ev);
  if (drag.lasso) { const l = lasso[lasso.length - 1]; if (Math.abs(l[0] - x) + Math.abs(l[1] - y) > 3 * dpr) lasso.push([x, y]); draw(); return; }
  drag.x1 = x; drag.y1 = y; if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > 4 * dpr) drag.moved = true;
  if (!drag.rect) { view.ox = drag.ox + (x - drag.x0); view.oy = drag.oy + (y - drag.y0); } draw();
});
cv.addEventListener('pointerup', ev => {
  if (!drag || drag.cv !== cv) return; const d = drag; drag = null;
  if (d.lasso) {
    const poly = lasso; lasso = null;
    if (poly.length >= 3) {
      let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity; poly.forEach(([x, y]) => { ax = Math.min(ax, x); ay = Math.min(ay, y); bx = Math.max(bx, x); by = Math.max(by, y); });
      const out = [];
      for (let i = 0; i < D.n; i++) {
        if (!vis[cls[i]]) continue; const [x, y] = W2S(D.X[i], D.Y[i]); if (x < ax || x > bx || y < ay || y > by) continue;
        let inside = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya] = poly[a], [xb, yb] = poly[b]; if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) inside = !inside; }
        if (inside) out.push(i);
      }
      select(out, d.add, 'lazo en planta');
    }
    draw(); return;
  }
  if (d.rect && d.moved) {
    const [e0, n0] = S2W(Math.min(d.x0, d.x1), Math.max(d.y0, d.y1)), [e1, n1] = S2W(Math.max(d.x0, d.x1), Math.min(d.y0, d.y1));
    const out = []; for (let i = 0; i < D.n; i++) if (vis[cls[i]] && D.X[i] >= e0 && D.X[i] <= e1 && D.Y[i] >= n0 && D.Y[i] <= n1) out.push(i);
    select(out, d.add, 'rectángulo en planta');
  } else if (!d.moved && ev.button === 0) { const [x, y] = evXY(cv, ev); pickPlan(x, y, d.add); }
  draw();
});
function pickPlan(x, y, add) {
  // dentro de 10 px: si hay puntos a <= 3 px se toma el más alto (lo que se ve en planta); si no, el más cercano
  const R2 = (10 * dpr) ** 2, r2 = (3 * dpr) ** 2, s = view.s;
  let near = -1, nd = Infinity, top = -1, tz = -Infinity;
  for (let i = 0; i < D.n; i++) {
    if (!vis[cls[i]]) continue;
    const dx = view.ox + s * D.X[i] - x, dy = view.oy - s * D.Y[i] - y, dd = dx * dx + dy * dy;
    if (dd > R2) continue;
    if (dd < nd) { nd = dd; near = i; }
    if (dd <= r2 && D.Z[i] > tz) { tz = D.Z[i]; top = i; }
  }
  const b = top >= 0 ? top : near;
  if (b < 0) { $('info').textContent = 'Sin punto cercano'; return; }
  select([b], add, 'punto');
}
function showPt(i) {
  const P = D.P ? D.P[i] : (D.P0 || 1) + i;
  $('info').textContent = 'Punto ' + P + ' · E ' + D.X[i].toFixed(3) + ' · N ' + D.Y[i].toFixed(3) + ' · Z ' + D.Z[i].toFixed(3) + ' · clase ' + cls[i] + ' ' + code(cls[i]) +
    (D.I ? ' · I ' + D.I[i] : '') + (hag ? ' · HAG ' + hag[i].toFixed(2) + ' m' : '');
}

// ---------- Selección y reclasificación
function select(list, add, where) {
  if (!add) { if (selN) sel.fill(0); selN = 0; }
  for (const i of list) if (!sel[i]) { sel[i] = 1; selN++; }
  if (list.length === 1) showPt(list[0]);
  if ($('instant').checked && list.length > 1) { applySel(where); return; }
  updSel();
  // una selección de varios puntos hecha en planta o perfil se muestra de inmediato en 3D
  if (list.length > 1 && !/3D/.test(where)) { draw(); drawProf(); set3D('sel'); }
  else redrawAll(false);
}
function selList() { const out = new Int32Array(selN); let k = 0; for (let i = 0; i < D.n && k < selN; i++) if (sel[i]) out[k++] = i; return out; }
function updSel() {
  const on = D && selN > 0;
  $('apply').disabled = !on; $('clearSel').disabled = !on; $('undo').disabled = !undo.length;
  if (!on) { $('selN').textContent = 'Sin selección'; $('selDet').textContent = 'Usa clic, Rectángulo, Lazo, el perfil o Shift + arrastrar en 3D.'; return; }
  const c = new Float64Array(256); for (let i = 0; i < D.n; i++) if (sel[i]) c[cls[i]]++;
  $('selN').textContent = fmtN(selN) + (selN === 1 ? ' punto seleccionado' : ' puntos seleccionados');
  const parts = []; for (let k = 0; k < 256; k++) if (c[k]) parts.push(code(k) + ' ' + fmtN(c[k]));
  $('selDet').textContent = parts.join(' · ');
}
function clearSel() { if (!D || !selN) return; sel.fill(0); selN = 0; updSel(); redrawAll(false); }
function applySel(where) {
  if (!D || !selN) return;
  const from = +$('from').value, to = +$('to').value;
  const ch = []; for (let i = 0; i < D.n; i++) if (sel[i] && (from < 0 || cls[i] === from) && cls[i] !== to) ch.push(i);
  sel.fill(0); selN = 0;
  if (!ch.length) { toast('Ningún punto de la clase "de" en la selección'); updSel(); redrawAll(false); return; }
  const idx = Int32Array.from(ch), old = new Uint8Array(ch.length); ch.forEach((i, k) => { old[k] = cls[i]; cls[i] = to; });
  undo.push({ idx, old }); manual += ch.length;
  addLog('MANUAL (' + (where || 'selección') + ') ' + ch.length + ' pts: ' + (from < 0 ? 'Todas' : code(from)) + ' -> ' + code(to));
  toast(fmtN(ch.length) + ' puntos → ' + to + ' ' + code(to));
  buildLeg(); updSel(); redrawAll(false);
}
function doUndo() {
  const u = undo.pop(); if (!u) return;
  if (u.all) { cls = u.all; hag = u.hag; ran = u.ran; addLog('DESHACER clasificación automática'); }
  else { u.idx.forEach((i, k) => cls[i] = u.old[k]); manual -= u.idx.length; addLog('DESHACER ' + u.idx.length + ' pts'); }
  buildLeg(); updSel(); redrawAll(false); toast('Deshecho');
}
$('apply').onclick = () => applySel('selección'); $('clearSel').onclick = clearSel; $('undo').onclick = doUndo;
document.addEventListener('keydown', ev => {
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (ev.key === 'Escape') clearSel();
  else if (ev.key === 'Enter' && selN) applySel('selección');
  else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); doUndo(); }
});

// ---------- Perfil
function drawProf() {
  size(pv); const w = pv.width, h = pv.height; px.clearRect(0, 0, w, h); px.fillStyle = css('--muted') || '#5A6478'; px.font = (12.5 * dpr) + 'px Arial';
  if (!D || !sec) { px.fillText(D ? 'Usa la herramienta Perfil (2 clics) en la planta para ver aquí un corte de la nube.' : 'Sin nube cargada.', 14 * dpr, 26 * dpr); prof = null; return; }
  const L = Math.hypot(sec.b[0] - sec.a[0], sec.b[1] - sec.a[1]) || 1, ux = (sec.b[0] - sec.a[0]) / L, uy = (sec.b[1] - sec.a[1]) / L, hw = +$('pw').value / 2;
  const idx = [], T = []; let z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < D.n; i++) { const dx = D.X[i] - sec.a[0], dy = D.Y[i] - sec.a[1]; const t = dx * ux + dy * uy; if (t < 0 || t > L) continue; const d = -dx * uy + dy * ux; if (Math.abs(d) > hw) continue; idx.push(i); T.push(t); if (vis[cls[i]]) { if (D.Z[i] < z0) z0 = D.Z[i]; if (D.Z[i] > z1) z1 = D.Z[i]; } }
  if (!idx.length || !isFinite(z0)) { px.fillText('El corredor no contiene puntos visibles.', 14 * dpr, 26 * dpr); prof = null; return; }
  const m = 38 * dpr, sx = (w - 2 * m) / L, sz = Math.min((h - 2 * m) / Math.max(z1 - z0, 1), sx * 10), zc = (z0 + z1) / 2;
  prof = { idx, T, m, sx, sz, zc, h, L };
  const Y = z => h / 2 - (z - zc) * sz, X = t => m + t * sx;
  px.strokeStyle = css('--line') || '#DCE3EA'; px.lineWidth = 1; px.font = (10.5 * dpr) + 'px Arial';
  const step = [0.5, 1, 2, 5, 10, 20, 50, 100].find(v => v * sz > 28 * dpr) || 100;
  for (let z = Math.ceil((zc - h / 2 / sz) / step) * step; z < zc + h / 2 / sz; z += step) { const y = Y(z); px.beginPath(); px.moveTo(m, y); px.lineTo(w - 8 * dpr, y); px.stroke(); px.fillText(z.toFixed(step < 1 ? 1 : 0), 2 * dpr, y + 4 * dpr); }
  px.fillText('A', m - 12 * dpr, h - 8 * dpr); px.fillText('B  (' + L.toFixed(1) + ' m · exag. vertical ×' + (sz / sx).toFixed(1) + ' · ' + fmtN(idx.length) + ' pts)', w - 300 * dpr, h - 8 * dpr);
  const r = Math.max(2 * dpr, Math.min(5 * dpr, sx * 0.5));
  const ordr = idx.map((i, k) => k).sort((a, b) => (sel[idx[a]] - sel[idx[b]]));
  for (const k of ordr) { const i = idx[k]; if (!vis[cls[i]]) continue; const c = colorOf(i); px.fillStyle = 'rgb(' + (c & 255) + ',' + ((c >> 8) & 255) + ',' + ((c >> 16) & 255) + ')'; const rr = sel[i] ? r * 1.5 : r; px.fillRect(X(T[k]) - rr / 2, Y(D.Z[i]) - rr / 2, rr, rr); }
  if (drag && drag.cv === pv) { px.strokeStyle = '#E8772A'; px.setLineDash([6, 4]); px.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0); px.setLineDash([]); }
}
pv.addEventListener('pointerdown', ev => { if (!prof) return; pv.setPointerCapture(ev.pointerId); const [x, y] = evXY(pv, ev); drag = { cv: pv, x0: x, y0: y, x1: x, y1: y, moved: false, add: ev.shiftKey }; });
pv.addEventListener('pointermove', ev => { if (!drag || drag.cv !== pv) return; const [x, y] = evXY(pv, ev); drag.x1 = x; drag.y1 = y; drag.moved = true; drawProf(); });
pv.addEventListener('pointerup', ev => {
  if (!drag || drag.cv !== pv) return; const d = drag; drag = null; if (!prof) return;
  const { idx, T, m, sx, sz, zc, h } = prof; const X = t => m + t * sx, Y = z => h / 2 - (z - zc) * sz;
  if (!d.moved || (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0)) < 4 * dpr) {
    let b = -1, bd = Infinity; idx.forEach((i, k) => { if (!vis[cls[i]]) return; const dd = (X(T[k]) - d.x0) ** 2 + (Y(D.Z[i]) - d.y0) ** 2; if (dd < bd) { bd = dd; b = i; } });
    if (b >= 0 && bd < (14 * dpr) ** 2) select([b], d.add, 'punto en perfil'); else drawProf(); return;
  }
  const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
  select(idx.filter((i, k) => vis[cls[i]] && X(T[k]) >= x0 && X(T[k]) <= x1 && Y(D.Z[i]) >= y0 && Y(D.Z[i]) <= y1), d.add, 'perfil');
});

// ---------- 3D
const MAX3D = 2000000;
let mode3 = 'all';
const v3 = createViewer($('v3d'), {
  data: () => D, color: i => colorOf(i), visible: i => vis[cls[i]],
  onPick: (i, add) => { if (i < 0) { $('info').textContent = 'Sin punto cercano en 3D'; return; } select([i], add, 'punto en 3D'); },
  onBox: (list, add) => { if (!list.length) { toast('No hay puntos en el recuadro'); return; } select(list, add, 'recuadro 3D'); }
});
function set3D(m, keepView) {
  mode3 = m; ['m3all', 'm3sel', 'm3prof'].forEach(id => $(id).classList.remove('on')); $({ all: 'm3all', sel: 'm3sel', prof: 'm3prof' }[m]).classList.add('on');
  if (!D) return;
  let list = [];
  if (m === 'sel') { if (!selN) { toast('Primero selecciona puntos (clic, rectángulo, lazo o perfil)'); return set3D('all'); } for (let i = 0; i < D.n; i++) if (sel[i]) list.push(i);
    // contexto: se agregan los vecinos visibles dentro de la caja de la selección (+20 %)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const i of list) { x0 = Math.min(x0, D.X[i]); x1 = Math.max(x1, D.X[i]); y0 = Math.min(y0, D.Y[i]); y1 = Math.max(y1, D.Y[i]); }
    const mx = Math.max(2, (x1 - x0) * 0.2), my = Math.max(2, (y1 - y0) * 0.2);
    for (let i = 0; i < D.n; i++) if (!sel[i] && vis[cls[i]] && D.X[i] >= x0 - mx && D.X[i] <= x1 + mx && D.Y[i] >= y0 - my && D.Y[i] <= y1 + my) list.push(i);
  } else if (m === 'prof') { if (!prof) { toast('Primero traza un perfil en la planta'); return set3D('all'); } list = prof.idx.filter(i => vis[cls[i]]); }
  else { for (let i = 0; i < D.n; i++) if (vis[cls[i]]) list.push(i); }
  if (list.length > MAX3D) { const st = Math.ceil(list.length / MAX3D); list = list.filter((_, k) => k % st === 0 || sel[list[k]]); toast('3D: se muestra 1 de cada ' + st + ' puntos para mantener la fluidez'); }
  v3.setIndices(Int32Array.from(list), keepView);
}
$('m3all').onclick = () => set3D('all'); $('m3sel').onclick = () => set3D('sel'); $('m3prof').onclick = () => set3D('prof');
$('exag').oninput = () => { $('exagv').textContent = '×' + $('exag').value; v3.setExag(+$('exag').value); };
$('size3').oninput = () => v3.setSize(+$('size3').value);
$('fit3').onclick = () => v3.fit();
function redrawAll(visChanged) { draw(); drawProf(); if (!D) return; if (visChanged) set3D(mode3 === 'sel' && !selN ? 'all' : mode3, true); else v3.refreshColors(); }

// ---------- Clasificación automática
$('run').onclick = async () => {
  if (!D || busy) return;
  const prm = {}; for (const k of PRM) { const v = parseFloat(String($(k).value).replace(',', '.')); if (!(v >= 0) || (k !== 'hBaja' && !(v > 0))) { toast('Revisa el parámetro ' + k); return; } prm[k] = v; }
  if (manual > 0 && !confirm('La clasificación automática reemplaza todas las clases, incluidas tus ' + fmtN(manual) + ' ediciones manuales (puedes deshacerlo). ¿Continuar?')) return;
  busyOn('Clasificando ' + fmtN(D.n) + ' puntos…'); $('log').textContent = 'Procesando…';
  try {
    const r = await runWorker({ type: 'classify', X: D.X, Y: D.Y, Z: D.Z, prm });
    undo.push({ all: cls, hag, ran });
    cls = r.cls; hag = r.hag; ran = true; manual = 0;
    $('log').textContent = r.log.join('\n') + '\nTiempo: ' + r.secs.toFixed(1).replace('.', ',') + ' s';
    addLog('AUTO ' + JSON.stringify(prm) + ' | ' + r.log.join(' | '));
    if ($('colorBy').value !== 'c') $('colorBy').value = 'c';
    sel.fill(0); selN = 0;
    buildLeg(); updSel(); redrawAll(true); toast('Clasificación automática terminada');
  } catch (e) { $('log').textContent = 'Error: ' + e.message; toast('Error: ' + e.message, 6000); }
  busyOff();
};

// ---------- Exportar
function rows() { const out = []; const nr = $('noRuido').checked; for (let i = 0; i < D.n; i++) { if (nr && (cls[i] === 7 || cls[i] === 18)) continue; out.push(i); } return out; }
const f3 = v => v.toFixed(3);
const pnum = i => D.P ? D.P[i] : (D.P0 || 1) + i;
function chunks(R, line, head, tail) { const parts = head ? [head] : []; for (let a = 0; a < R.length; a += 100000) { let s = ''; const b = Math.min(R.length, a + 100000); for (let k = a; k < b; k++) s += line(R[k]) + '\r\n'; parts.push(s); } if (tail) parts.push(tail); return parts; }
function save(parts, fname, type) { const b = new Blob(parts, { type: type || 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); addLog('EXPORT ' + fname); toast('Descargado: ' + fname); }
function exp(kind) {
  if (!D) { toast('Primero carga una nube'); return; }
  const base = D.name + '_clasificada';
  if (kind === 'log') {
    const cnt = counts(); const L = ['BITÁCORA DE CLASIFICACIÓN · ' + D.name, 'GeoIAN · Clasificador LiDAR · https://ayam-arias.github.io/clasificador-lidar/', 'Generada: ' + stamp(), 'Puntos: ' + D.n, '', ...logLines, '', 'Puntos editados manualmente (neto): ' + manual, 'Conteo final por clase:'];
    for (let c = 0; c < 256; c++) if (cnt[c]) L.push('  ' + c + ' ' + code(c) + ': ' + cnt[c]);
    return save([L.join('\r\n') + '\r\n'], D.name + '_Bitacora.txt');
  }
  const R = rows();
  if (kind === 'las') {
    const sub = R.length === D.n ? D : subset(D, R);
    const c = R.length === D.n ? cls : Uint8Array.from(R, i => cls[i]);
    const w = LasIO.writeLAS(Object.assign({}, sub, { epsg: D.meta.epsg || D.epsg }), c);
    if (w.clamped) toast(w.clamped + ' puntos con clase > 31 quedaron como 1 (el formato de punto 0–5 sólo admite 0–31)', 6000);
    return save([w.buffer], base + '.las', 'application/octet-stream');
  }
  if (kind === 'csv') return save(chunks(R, i => [pnum(i), f3(D.Y[i]), f3(D.X[i]), f3(D.Z[i]), code(cls[i])].join(',')), base + '_PNEZD.csv');
  if (kind === 'txt') { const s = $('sep').value === '\\t' ? '\t' : $('sep').value; return save(chunks(R, i => [pnum(i), f3(D.Y[i]), f3(D.X[i]), f3(D.Z[i]), code(cls[i])].join(s)), base + '_PNEZD.txt'); }
  if (R.length > 1000000 && (kind === 'xml' || kind === 'scr') && !confirm('Son ' + fmtN(R.length) + ' puntos: el archivo será muy pesado para Civil 3D. ¿Exportar igual?')) return;
  if (kind === 'scr') {
    const by = {}; R.forEach(i => (by[cls[i]] = by[cls[i]] || []).push(i));
    const parts = ['_.SETVAR CMDECHO 0\r\n_.SETVAR OSMODE 0\r\n_.SETVAR PDMODE 3\r\n_.SETVAR PDSIZE 0.4\r\n'];
    Object.keys(by).forEach(c => { parts.push('_.-LAYER _M PTO_' + code(+c) + ' \r\n'); parts.push(...chunks(by[c], i => '_.POINT ' + f3(D.X[i]) + ',' + f3(D.Y[i]) + ',' + f3(D.Z[i]))); });
    parts.push('_.-LAYER _S 0 \r\n_.ZOOM _E\r\n_.SETVAR CMDECHO 1\r\n');
    return save(parts, base + '.scr');
  }
  if (kind === 'xml') {
    const d = new Date(), ds = d.toISOString().slice(0, 10), ts = d.toTimeString().slice(0, 8);
    const head = ['<?xml version="1.0" encoding="UTF-8"?>', '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="' + ds + '" time="' + ts + '">',
      '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>',
      '<Application name="GeoIAN Clasificador LiDAR" manufacturer="Ian Arias Carrasco · GeoIAN"/>', '<CgPoints>'].join('\r\n') + '\r\n';
    return save(chunks(R, i => '<CgPoint name="' + pnum(i) + '" desc="' + code(cls[i]) + '" code="' + code(cls[i]) + '">' + f3(D.Y[i]) + ' ' + f3(D.X[i]) + ' ' + f3(D.Z[i]) + '</CgPoint>', head, '</CgPoints>\r\n</LandXML>\r\n'), base + '.xml', 'application/xml');
  }
}
function subset(d, R) {
  const n = R.length, o = { n, meta: d.meta, headerBytes: d.headerBytes, evlr: d.evlr, I: null, RGB: null };
  o.X = Float64Array.from(R, i => d.X[i]); o.Y = Float64Array.from(R, i => d.Y[i]); o.Z = Float64Array.from(R, i => d.Z[i]);
  if (d.I) o.I = Uint16Array.from(R, i => d.I[i]);
  if (d.RGB) { o.RGB = new Uint8Array(n * 3); R.forEach((i, k) => { o.RGB[3 * k] = d.RGB[3 * i]; o.RGB[3 * k + 1] = d.RGB[3 * i + 1]; o.RGB[3 * k + 2] = d.RGB[3 * i + 2]; }); }
  if (d.recs) { const L = d.meta.recLen; o.recs = new Uint8Array(n * L); R.forEach((i, k) => o.recs.set(d.recs.subarray(i * L, i * L + L), k * L)); }
  return o;
}
$('eLas').onclick = () => exp('las'); $('eCsv').onclick = () => exp('csv'); $('eTxt').onclick = () => exp('txt'); $('eXml').onclick = () => exp('xml'); $('eScr').onclick = () => exp('scr'); $('eLog').onclick = () => exp('log');

// ---------- Entrada de archivos
$('file').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }));
document.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
$('demo').onclick = loadDemo;
window.addEventListener('resize', () => { draw(); drawProf(); });

fillSel(); updSel(); draw(); drawProf();
loadDemo();
