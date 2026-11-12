/* GeoIAN · Clasificador LiDAR — visor 3D (three.js) con selección y picking */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

export function createViewer(host, api) {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e6);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  const geom = new THREE.BufferGeometry();
  const mat = new THREE.PointsMaterial({ size: 3, vertexColors: true, sizeAttenuation: false });
  const pts = new THREE.Points(geom, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let idx = new Int32Array(0), pos = null, col = null, center = [0, 0, 0], exag = 1, radius = 100;
  const box = host.querySelector('.box3');

  function bg() { const c = getComputedStyle(document.documentElement).getPropertyValue('--cv').trim() || '#F7F9FB'; scene.background = new THREE.Color(c); }
  function render() { renderer.render(scene, camera); }
  controls.addEventListener('change', render);

  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix(); render();
  }
  new ResizeObserver(resize).observe(host);

  function buildPositions() {
    const D = api.data(); const n = idx.length;
    pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { const i = idx[k]; pos[3 * k] = D.X[i] - center[0]; pos[3 * k + 1] = D.Y[i] - center[1]; pos[3 * k + 2] = (D.Z[i] - center[2]) * exag; }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.computeBoundingSphere();
  }
  function refreshColors() {
    const n = idx.length;
    if (!col || col.length !== n * 3) { col = new Uint8Array(n * 3); geom.setAttribute('color', new THREE.BufferAttribute(col, 3, true)); }
    for (let k = 0; k < n; k++) { const c = api.color(idx[k]); col[3 * k] = c & 255; col[3 * k + 1] = (c >> 8) & 255; col[3 * k + 2] = (c >> 16) & 255; }
    geom.attributes.color.needsUpdate = true;
    // los puntos ocultos (clase apagada) se colapsan al centro con tamaño 0 no es posible en PointsMaterial: se filtran al reconstruir
    render();
  }
  function setIndices(list, keepView) {
    idx = list;
    const D = api.data();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (D.X[i] < x0) x0 = D.X[i]; if (D.X[i] > x1) x1 = D.X[i]; if (D.Y[i] < y0) y0 = D.Y[i]; if (D.Y[i] > y1) y1 = D.Y[i]; if (D.Z[i] < z0) z0 = D.Z[i]; if (D.Z[i] > z1) z1 = D.Z[i]; }
    if (!idx.length) { x0 = y0 = z0 = x1 = y1 = z1 = 0; }
    if (!keepView) { center = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]; radius = Math.max(1, Math.hypot(x1 - x0, y1 - y0, (z1 - z0) * exag) / 2); }
    col = null;
    buildPositions(); refreshColors();
    if (!keepView) fit();
  }
  function fit() {
    const r = radius;
    controls.target.set(0, 0, 0);
    camera.position.set(r * 0.9, -r * 1.6, r * 1.1);
    camera.near = r / 2000; camera.far = r * 40; camera.updateProjectionMatrix();
    controls.update(); render();
  }
  function setExag(e) { exag = e; if (idx.length) { buildPositions(); render(); } }
  function setSize(s) { mat.size = s; render(); }

  // ---- proyección a pantalla
  const M = new THREE.Matrix4();
  function project(cb) {
    camera.updateMatrixWorld(); M.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = M.elements, w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight, n = idx.length;
    for (let k = 0; k < n; k++) {
      const x = pos[3 * k], y = pos[3 * k + 1], z = pos[3 * k + 2];
      const cw = e[3] * x + e[7] * y + e[11] * z + e[15]; if (cw <= 0) continue;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw * 0.5 + 0.5) * w;
      const sy = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw * 0.5) * h;
      cb(k, sx, sy, cw);
    }
  }
  const el = renderer.domElement;
  let down = null;
  el.addEventListener('pointerdown', ev => {
    const r = el.getBoundingClientRect();
    down = { x: ev.clientX - r.left, y: ev.clientY - r.top, sel: ev.shiftKey && ev.button === 0, moved: false, add: ev.ctrlKey || ev.metaKey };
    if (down.sel) { controls.enabled = false; el.setPointerCapture(ev.pointerId); }
  });
  el.addEventListener('pointermove', ev => {
    if (!down) return; const r = el.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (Math.abs(x - down.x) + Math.abs(y - down.y) > 4) down.moved = true;
    if (down.sel) { box.hidden = false; box.style.left = Math.min(x, down.x) + 'px'; box.style.top = Math.min(y, down.y) + 'px'; box.style.width = Math.abs(x - down.x) + 'px'; box.style.height = Math.abs(y - down.y) + 'px'; }
  });
  el.addEventListener('pointerup', ev => {
    if (!down) return; const d = down; down = null; controls.enabled = true; box.hidden = true;
    const r = el.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (d.sel && d.moved) {
      const ax = Math.min(x, d.x), bx = Math.max(x, d.x), ay = Math.min(y, d.y), by = Math.max(y, d.y), out = [];
      project((k, sx, sy) => { if (sx >= ax && sx <= bx && sy >= ay && sy <= by && api.visible(idx[k])) out.push(idx[k]); });
      api.onBox(out, true);
    } else if (!d.moved && ev.button === 0) {
      let best = -1, bd = Infinity; const R = Math.max(7, mat.size + 4);
      project((k, sx, sy, cw) => { const dd = (sx - x) ** 2 + (sy - y) ** 2; if (dd <= R * R && api.visible(idx[k])) { const score = cw + Math.sqrt(dd) * radius / 400; if (score < bd) { bd = score; best = k; } } });
      api.onPick(best >= 0 ? idx[best] : -1, ev.shiftKey);
    }
  });
  bg();
  return { setIndices, refreshColors, setExag, setSize, fit, resize, bg: () => { bg(); render(); }, count: () => idx.length };
}
