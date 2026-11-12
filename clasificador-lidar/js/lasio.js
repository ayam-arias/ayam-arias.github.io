/* GeoIAN · Clasificador LiDAR — lectura/escritura de nubes de puntos
   LAS 1.0–1.4 (formatos 0–10), LAZ (vía laz-perf/WASM) y texto (XYZ, PNEZD, CSV)
   Autor: Ian Arias Carrasco (GeoIAN) · Licencia MIT
   Especificación: ASPRS LAS 1.4 R15 (2019).
*/
(function (root) {
  'use strict';
  const td = new TextDecoder('latin1');
  const str = (u8, a, len) => td.decode(u8.subarray(a, a + len)).replace(/\0[\s\S]*$/, '').trim();

  function readHeader(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (buf.byteLength < 227 || str(u8, 0, 4) !== 'LASF') throw new Error('El archivo no es LAS/LAZ (falta la firma "LASF").');
    const h = {
      vMaj: dv.getUint8(24), vMin: dv.getUint8(25),
      headerSize: dv.getUint16(94, true), offset: dv.getUint32(96, true), nVLR: dv.getUint32(100, true),
      fmtByte: dv.getUint8(104), recLen: dv.getUint16(105, true), count: dv.getUint32(107, true),
      sx: dv.getFloat64(131, true), sy: dv.getFloat64(139, true), sz: dv.getFloat64(147, true),
      ox: dv.getFloat64(155, true), oy: dv.getFloat64(163, true), oz: dv.getFloat64(171, true),
      software: str(u8, 58, 32), system: str(u8, 26, 32), evlrStart: 0, nEVLR: 0
    };
    h.fmt = h.fmtByte & 0x3F; h.compressed = (h.fmtByte & 0x80) !== 0 || (h.fmtByte & 0x40) !== 0;
    if (h.vMin >= 4 && h.headerSize >= 375) {
      h.evlrStart = Number(dv.getBigUint64(235, true)); h.nEVLR = dv.getUint32(243, true);
      const c64 = Number(dv.getBigUint64(247, true)); if (c64 > 0) h.count = c64;
    }
    // VLR
    h.vlrs = []; let p = h.headerSize;
    for (let k = 0; k < h.nVLR && p + 54 <= h.offset; k++) {
      const user = str(u8, p + 2, 16), id = dv.getUint16(p + 18, true), len = dv.getUint16(p + 20, true);
      h.vlrs.push({ user, id, start: p, len: 54 + len, data: p + 54 }); p += 54 + len;
    }
    h.epsg = detectEPSG(dv, u8, h);
    h.feet = h.vlrs.some(v => v.id === 2112 && /UNIT\["(US survey )?f(oo|ee)t/i.test(td.decode(u8.subarray(v.data, v.start + v.len))));
    return h;
  }

  function detectEPSG(dv, u8, h) {
    for (const v of h.vlrs) {
      if (v.user !== 'LASF_Projection') continue;
      if (v.id === 2112) {
        const w = td.decode(u8.subarray(v.data, v.start + v.len));
        const m = [...w.matchAll(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
        if (!m.length) continue;
        // profundidad de corchetes de cada autoridad: 1 = CRS raíz; 2 = primer hijo de un CRS compuesto
        const depthAt = idx => { let d = 0; for (let t = 0; t < idx; t++) { const ch = w[t]; if (ch === '[' || ch === '(') d++; else if (ch === ']' || ch === ')') d--; } return d; };
        const d1 = m.find(x => depthAt(x.index) === 1);
        if (d1) return +d1[1];
        if (/^\s*(?:COMPD_CS|COMPOUNDCRS)/i.test(w)) { const d2 = m.find(x => depthAt(x.index) === 2); if (d2) return +d2[1]; }
      }
      if (v.id === 34735) {
        const nk = dv.getUint16(v.data + 6, true);
        let geo = null, model = 0, userProj = false;
        for (let k = 0; k < nk; k++) {
          const b = v.data + 8 + k * 8, key = dv.getUint16(b, true), loc = dv.getUint16(b + 2, true), val = dv.getUint16(b + 6, true);
          if (loc !== 0) continue;
          if (key === 1024) model = val;
          if (key === 3072) { if (val > 0 && val < 32767) return val; userProj = true; }
          if (key === 2048 && val > 0 && val < 32767) geo = val;
        }
        if (geo && !userProj && model !== 1) return geo;
      }
    }
    return null;
  }

  const rgbOff = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };

  /* Lee LAS o LAZ. opts: {maxPts, onProgress, LazPerf (módulo ya inicializado, sólo para LAZ)} */
  function parseLAS(buf, opts) {
    opts = opts || {};
    const h = readHeader(buf), prog = opts.onProgress || function () {};
    const total = h.count, maxPts = opts.maxPts || 3e6;
    const stride = Math.max(1, Math.ceil(total / maxPts));
    const n = Math.ceil(total / stride), L = h.recLen, fmt = h.fmt;
    const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), C = new Uint8Array(n), I = new Uint16Array(n);
    const ro = rgbOff[fmt]; const RGB = ro !== undefined ? new Uint8Array(n * 3) : null;
    const recs = new Uint8Array(n * L);
    let rgb16 = false;
    const take = (src, so, k) => {
      recs.set(src.subarray(so, so + L), k * L);
    };
    let LZ = null, ptr = 0, fptr = 0, srcU8;
    if (h.compressed) {
      if (!opts.LazPerf) throw new Error('Se requiere el módulo LAZ.');
      const M = opts.LazPerf;
      LZ = new M.LASZip();
      fptr = M._malloc(buf.byteLength); M.HEAPU8.set(new Uint8Array(buf), fptr);
      LZ.open(fptr, buf.byteLength);
      ptr = M._malloc(L);
      for (let i = 0, k = 0; i < total; i++) {
        LZ.getPoint(ptr);
        if (i % stride === 0 && k < n) { take(M.HEAPU8, ptr, k); k++; }
        if ((i & 0x7FFFF) === 0) prog('Descomprimiendo LAZ ' + Math.round(100 * i / total) + ' %');
      }
      LZ.delete(); M._free(ptr); M._free(fptr);
    } else {
      srcU8 = new Uint8Array(buf);
      if (h.offset + total * L > buf.byteLength) throw new Error('El archivo LAS está truncado.');
      for (let i = 0, k = 0; k < n; i += stride, k++) take(srcU8, h.offset + i * L, k);
    }
    // decodificar coordenadas y atributos desde los registros
    const dv = new DataView(recs.buffer);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const classOff = fmt >= 6 ? 16 : 15;
    for (let k = 0; k < n; k++) {
      const b = k * L;
      const x = dv.getInt32(b, true) * h.sx + h.ox, y = dv.getInt32(b + 4, true) * h.sy + h.oy, z = dv.getInt32(b + 8, true) * h.sz + h.oz;
      X[k] = x; Y[k] = y; Z[k] = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      I[k] = dv.getUint16(b + 12, true);
      C[k] = fmt >= 6 ? recs[b + classOff] : (recs[b + classOff] & 31);
      if (RGB) { const r = dv.getUint16(b + ro, true), g = dv.getUint16(b + ro + 2, true), bl = dv.getUint16(b + ro + 4, true); if (r > 255 || g > 255 || bl > 255) rgb16 = true; RGB[3 * k] = r >> 8; RGB[3 * k + 1] = g >> 8; RGB[3 * k + 2] = bl >> 8; }
      if ((k & 0x7FFFF) === 0) prog('Leyendo puntos ' + Math.round(100 * k / n) + ' %');
    }
    if (RGB && !rgb16) { // RGB de 8 bits guardado sin escalar
      for (let k = 0; k < n; k++) { const b = k * L; RGB[3 * k] = dv.getUint16(b + ro, true); RGB[3 * k + 1] = dv.getUint16(b + ro + 2, true); RGB[3 * k + 2] = dv.getUint16(b + ro + 4, true); }
    }
    // encabezado de salida: header + VLR (sin la VLR de laszip)
    const u8 = new Uint8Array(buf);
    const keep = h.vlrs.filter(v => !(v.user === 'laszip encoded' && v.id === 22204));
    let extra = 0; // bytes definidos por el usuario entre VLR y puntos (sólo LAS sin comprimir)
    const lastV = h.vlrs.length ? h.vlrs[h.vlrs.length - 1] : null;
    const vEnd = lastV ? lastV.start + lastV.len : h.headerSize;
    if (!h.compressed && h.offset > vEnd) extra = h.offset - vEnd;
    const hb = new Uint8Array(h.headerSize + keep.reduce((s, v) => s + v.len, 0) + extra);
    hb.set(u8.subarray(0, h.headerSize), 0);
    let q = h.headerSize; for (const v of keep) { hb.set(u8.subarray(v.start, v.start + v.len), q); q += v.len; }
    if (extra) hb.set(u8.subarray(vEnd, h.offset), q);
    let evlr = null;
    if (h.nEVLR && h.evlrStart > 0 && h.evlrStart < buf.byteLength) evlr = u8.slice(h.evlrStart);
    const meta = {
      source: h.compressed ? 'LAZ' : 'LAS', version: h.vMaj + '.' + h.vMin, fmt, recLen: L, total, stride, n,
      nVLR: keep.length, headerSize: h.headerSize, epsg: h.epsg, feet: h.feet, software: h.software,
      bounds: [x0, y0, z0, x1, y1, z1], hasRGB: !!RGB, hasI: true
    };
    return { n, X, Y, Z, C, I, RGB, recs, headerBytes: hb, evlr, meta };
  }

  /* ---------- Texto: XYZ[C], PNEZD, PENZD, CSV con encabezado ---------- */
  function parseText(text, opts) {
    opts = opts || {};
    const prog = opts.onProgress || function () {};
    const lines = text.split(/\r?\n/);
    let first = 0; while (first < lines.length && !lines[first].trim()) first++;
    const sample = lines.slice(first, first + 20).filter(l => l.trim());
    if (!sample.length) throw new Error('El archivo de texto está vacío.');
    // delimitador
    const cands = [';', '\t', ',', ' '];
    let delim = ' ';
    for (const d of cands) { const k = sample.map(l => l.trim().split(d === ' ' ? /\s+/ : d).length); if (k[k.length - 1] >= 3 && k.every(v => v === k[k.length - 1])) { delim = d; break; } }
    const split = delim === ' ' ? l => l.trim().split(/\s+/) : l => l.split(delim).map(s => s.trim());
    const decComma = delim !== ',' && sample.some(l => /\d,\d/.test(l));
    const num = s => { if (s === undefined) return NaN; if (decComma) s = s.replace(',', '.'); return s === '' ? NaN : +s; };
    // encabezado
    const f0 = split(sample[0]);
    const hasHeader = f0.filter(s => isNaN(num(s))).length >= 2;
    let col = null, layout = opts.layout || 'auto';
    if (hasHeader) {
      const nm = f0.map(s => s.toLowerCase().replace(/["'\s]/g, ''));
      const find = (...keys) => nm.findIndex(s => keys.includes(s));
      col = { x: find('x', 'e', 'este', 'easting', 'east', '//x'), y: find('y', 'n', 'norte', 'northing', 'north'), z: find('z', 'cota', 'h', 'elev', 'elevation', 'altura'),
        c: find('c', 'class', 'classification', 'clase', 'clasificacion', 'clasificación', 'd', 'desc', 'descripcion', 'descripción', 'code', 'codigo', 'código'),
        p: find('p', 'pt', 'punto', 'id', 'point', 'nro', 'numero'), i: find('i', 'intensity', 'intensidad'),
        r: find('r', 'red', 'rojo'), g: find('g', 'green', 'verde'), b: find('b', 'blue', 'azul') };
      if (col.x < 0 || col.y < 0 || col.z < 0) throw new Error('No se reconocen las columnas X/Y/Z (o E/N/Z) en el encabezado.');
      first++;
    } else {
      const k = split(sample[0]).length;
      if (layout === 'auto') {
        // PNEZD si la 1.ª columna es entero y hay 4–5 columnas con N > E (Chile UTM: N ~ 6–7 millones)
        const s = split(sample[0]);
        const isInt = /^\d+$/.test(s[0]);
        if (isInt && k >= 4 && Math.abs(num(s[1])) > Math.abs(num(s[2]))) layout = 'pnezd';
        else if (isInt && k >= 4) layout = 'penzd';
        else layout = 'xyz';
      }
      if (layout === 'pnezd') col = { p: 0, y: 1, x: 2, z: 3, c: k > 4 ? 4 : -1 };
      else if (layout === 'penzd') col = { p: 0, x: 1, y: 2, z: 3, c: k > 4 ? 4 : -1 };
      else col = { x: 0, y: 1, z: 2, c: k > 3 ? 3 : -1 };
      col.i = col.r = col.g = col.b = -1; if (col.p === undefined) col.p = -1;
    }
    const total = lines.length - first, maxPts = opts.maxPts || 3e6;
    const stride = Math.max(1, Math.ceil(total / maxPts));
    const cap = Math.ceil(total / stride);
    let X = new Float64Array(cap), Y = new Float64Array(cap), Z = new Float64Array(cap), C = new Uint8Array(cap), P = new Int32Array(cap);
    let I = col.i >= 0 ? new Uint16Array(cap) : null, RGB = col.r >= 0 && col.g >= 0 && col.b >= 0 ? new Uint8Array(cap * 3) : null;
    const codeMap = opts.codeMap || {};
    let n = 0, bad = 0, hasP = col.p >= 0, rgbMax = 0;
    for (let li = first, t = 0; li < lines.length; li++) {
      const l = lines[li]; if (!l || !l.trim()) continue;
      if ((t++ % stride) !== 0) continue;
      const s = split(l);
      const x = num(s[col.x]), y = num(s[col.y]), z = num(s[col.z]);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { bad++; continue; }
      if (n >= cap) break;
      X[n] = x; Y[n] = y; Z[n] = z;
      if (col.c >= 0 && s[col.c] !== undefined) {
        const raw = s[col.c].replace(/"/g, '').trim();
        const v = /^\d+$/.test(raw) ? +raw : (codeMap[raw.toUpperCase()] !== undefined ? codeMap[raw.toUpperCase()] : 1);
        C[n] = v > 255 ? 1 : v;
      }
      if (hasP) P[n] = parseInt(s[col.p], 10) || (n + 1);
      if (I) I[n] = Math.max(0, Math.min(65535, num(s[col.i]) || 0));
      if (RGB) { for (let q = 0; q < 3; q++) { const v = num(s[[col.r, col.g, col.b][q]]) || 0; RGB[3 * n + q] = v > 255 ? v >> 8 : v; if (v > rgbMax) rgbMax = v; } }
      n++;
      if ((n & 0x7FFFF) === 0) prog('Leyendo texto ' + Math.round(100 * li / lines.length) + ' %');
    }
    if (!n) throw new Error('No se encontraron puntos válidos en el archivo de texto.');
    X = X.slice(0, n); Y = Y.slice(0, n); Z = Z.slice(0, n); C = C.slice(0, n); P = hasP ? P.slice(0, n) : null;
    if (I) I = I.slice(0, n); if (RGB) RGB = RGB.slice(0, n * 3);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) { if (X[k] < x0) x0 = X[k]; if (X[k] > x1) x1 = X[k]; if (Y[k] < y0) y0 = Y[k]; if (Y[k] > y1) y1 = Y[k]; if (Z[k] < z0) z0 = Z[k]; if (Z[k] > z1) z1 = Z[k]; }
    const meta = { source: 'TXT', layout: hasHeader ? 'encabezado' : layout, delim: delim === '\t' ? 'tab' : delim === ' ' ? 'espacio' : delim, total, stride, n, bad, epsg: null, bounds: [x0, y0, z0, x1, y1, z1], hasRGB: !!RGB, hasI: !!I, hasClass: col.c >= 0 };
    return { n, X, Y, Z, C, I, RGB, P, recs: null, headerBytes: null, evlr: null, meta };
  }

  /* ---------- Escritura LAS ---------- */
  function writeLAS(d, cls) {
    const n = d.n;
    if (d.recs && d.headerBytes) {
      const m = d.meta, L = m.recLen, fmt = m.fmt;
      const hb = d.headerBytes.slice();
      const off = hb.length;
      const evlr = d.evlr;
      const out = new Uint8Array(off + n * L + (evlr ? evlr.length : 0));
      out.set(hb, 0);
      out.set(d.recs, off);
      const dv = new DataView(out.buffer);
      // clasificación
      let clamped = 0;
      for (let k = 0; k < n; k++) {
        const b = off + k * L;
        if (fmt >= 6) out[b + 16] = cls[k];
        else { let c = cls[k]; if (c > 31) { c = 1; clamped++; } out[b + 15] = (out[b + 15] & 0xE0) | c; }
      }
      // conteos por retorno y límites
      const byRet = new Float64Array(15);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < n; k++) {
        const b = off + k * L, rn = fmt >= 6 ? (out[b + 14] & 15) : (out[b + 14] & 7);
        if (rn >= 1 && rn <= 15) byRet[rn - 1]++;
        const x = d.X[k], y = d.Y[k], z = d.Z[k];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      out[104] = fmt; // sin bits de compresión
      dv.setUint32(96, off, true);
      dv.setUint32(100, m.nVLR, true);
      const vMin = out[25];
      const legacy = fmt < 6 && n < 4294967296;
      dv.setUint32(107, legacy ? n : 0, true);
      for (let r = 0; r < 5; r++) dv.setUint32(111 + 4 * r, legacy ? byRet[r] : 0, true);
      dv.setFloat64(179, x1, true); dv.setFloat64(187, x0, true); dv.setFloat64(195, y1, true); dv.setFloat64(203, y0, true); dv.setFloat64(211, z1, true); dv.setFloat64(219, z0, true);
      if (vMin >= 4 && m.headerSize >= 375) {
        dv.setBigUint64(247, BigInt(n), true);
        for (let r = 0; r < 15; r++) dv.setBigUint64(255 + 8 * r, BigInt(byRet[r]), true);
        if (evlr) { dv.setBigUint64(235, BigInt(off + n * L), true); out.set(evlr, off + n * L); }
        else { dv.setBigUint64(235, 0n, true); dv.setUint32(243, 0, true); }
      }
      if (vMin === 3 && m.headerSize >= 235) dv.setBigUint64(227, 0n, true);
      return { buffer: out.buffer, clamped };
    }
    // Nube desde texto: LAS 1.2 formato 0 (o 2 si hay RGB)
    const fmt = d.RGB ? 2 : 0, L = d.RGB ? 26 : 20, HS = 227;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) { const x = d.X[k], y = d.Y[k], z = d.Z[k]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const s = 0.001, ox = Math.floor(x0), oy = Math.floor(y0), oz = Math.floor(z0);
    const vlr = d.epsg ? geoKeyVLR(d.epsg) : null;
    const off = HS + (vlr ? vlr.length : 0);
    const out = new Uint8Array(off + n * L), dv = new DataView(out.buffer);
    const put = (a, t) => { for (let i = 0; i < t.length; i++) out[a + i] = t.charCodeAt(i); };
    put(0, 'LASF'); out[24] = 1; out[25] = 2; put(26, 'GeoIAN'); put(58, 'GeoIAN Clasificador LiDAR');
    const now = new Date(), doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
    dv.setUint16(90, doy, true); dv.setUint16(92, now.getFullYear(), true);
    dv.setUint16(94, HS, true); dv.setUint32(96, off, true); dv.setUint32(100, vlr ? 1 : 0, true);
    out[104] = fmt; dv.setUint16(105, L, true); dv.setUint32(107, n, true); dv.setUint32(111, n, true);
    dv.setFloat64(131, s, true); dv.setFloat64(139, s, true); dv.setFloat64(147, s, true);
    dv.setFloat64(155, ox, true); dv.setFloat64(163, oy, true); dv.setFloat64(171, oz, true);
    dv.setFloat64(179, x1, true); dv.setFloat64(187, x0, true); dv.setFloat64(195, y1, true); dv.setFloat64(203, y0, true); dv.setFloat64(211, z1, true); dv.setFloat64(219, z0, true);
    if (vlr) out.set(vlr, HS);
    let clamped = 0;
    for (let k = 0; k < n; k++) {
      const b = off + k * L;
      dv.setInt32(b, Math.round((d.X[k] - ox) / s), true); dv.setInt32(b + 4, Math.round((d.Y[k] - oy) / s), true); dv.setInt32(b + 8, Math.round((d.Z[k] - oz) / s), true);
      if (d.I) dv.setUint16(b + 12, d.I[k], true);
      out[b + 14] = 0x09; // retorno 1 de 1
      let c = cls[k]; if (c > 31) { c = 1; clamped++; } out[b + 15] = c;
      if (d.RGB) { dv.setUint16(b + 20, d.RGB[3 * k] * 257, true); dv.setUint16(b + 22, d.RGB[3 * k + 1] * 257, true); dv.setUint16(b + 24, d.RGB[3 * k + 2] * 257, true); }
    }
    return { buffer: out.buffer, clamped };
  }

  function geoKeyVLR(epsg) {
    // GeoKeyDirectoryTag mínimo: modelo proyectado/geográfico + EPSG
    const geo = epsg === 4326 || epsg === 4674 || epsg === 5360 || (epsg >= 4000 && epsg < 5000);
    const keys = [[1024, 0, 1, geo ? 2 : 1], [1025, 0, 1, 1], [geo ? 2048 : 3072, 0, 1, epsg]];
    const len = 8 + keys.length * 8, out = new Uint8Array(54 + len), dv = new DataView(out.buffer);
    const user = 'LASF_Projection'; for (let i = 0; i < user.length; i++) out[2 + i] = user.charCodeAt(i);
    dv.setUint16(18, 34735, true); dv.setUint16(20, len, true);
    const desc = 'GeoKeyDirectoryTag'; for (let i = 0; i < desc.length; i++) out[22 + i] = desc.charCodeAt(i);
    const p = 54; dv.setUint16(p, 1, true); dv.setUint16(p + 2, 1, true); dv.setUint16(p + 4, 0, true); dv.setUint16(p + 6, keys.length, true);
    keys.forEach((k, j) => k.forEach((v, t) => dv.setUint16(p + 8 + j * 8 + t * 2, v, true)));
    return out;
  }

  const api = { readHeader, parseLAS, parseText, writeLAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LasIO = api;
})(typeof self !== 'undefined' ? self : this);
