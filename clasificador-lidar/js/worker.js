/* GeoIAN · Clasificador LiDAR — trabajo pesado fuera del hilo principal */
importScripts('classify.js', 'lasio.js');
let lazReady = null;
function getLaz() {
  if (!lazReady) {
    importScripts('../vendor/laz-perf/laz-perf.js');
    lazReady = createLazPerf({ locateFile: p => new URL('../vendor/laz-perf/' + p, self.location.href).href });
  }
  return lazReady;
}
const progress = msg => self.postMessage({ type: 'progress', msg });

self.onmessage = async ev => {
  const m = ev.data;
  try {
    if (m.type === 'load') {
      let d;
      const name = m.name.toLowerCase();
      if (/\.(las|laz)$/.test(name) || m.isLas) {
        const u8 = new Uint8Array(m.buffer, 0, 4);
        if (String.fromCharCode(...u8) !== 'LASF') throw new Error('El archivo no tiene la firma LAS ("LASF").');
        const h = LasIO.readHeader(m.buffer);
        let LazPerf = null;
        if (h.compressed) { progress('Cargando descompresor LAZ…'); LazPerf = await getLaz(); }
        d = LasIO.parseLAS(m.buffer, { maxPts: m.maxPts, onProgress: progress, LazPerf });
      } else {
        progress('Leyendo texto…');
        const text = new TextDecoder('utf-8').decode(m.buffer);
        d = LasIO.parseText(text, { maxPts: m.maxPts, layout: m.layout, codeMap: m.codeMap, onProgress: progress });
      }
      const tr = [d.X.buffer, d.Y.buffer, d.Z.buffer, d.C.buffer];
      if (d.I) tr.push(d.I.buffer); if (d.RGB) tr.push(d.RGB.buffer); if (d.P) tr.push(d.P.buffer);
      if (d.recs) tr.push(d.recs.buffer); if (d.headerBytes) tr.push(d.headerBytes.buffer); if (d.evlr) tr.push(d.evlr.buffer);
      self.postMessage({ type: 'loaded', data: d }, tr);
    } else if (m.type === 'classify') {
      const t = performance.now();
      const r = GeoClassify.classify(m.X, m.Y, m.Z, m.prm, progress);
      self.postMessage({ type: 'classified', cls: r.cls, hag: r.hag, log: r.log, secs: (performance.now() - t) / 1000 }, [r.cls.buffer, r.hag.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', msg: (e && e.message) || String(e) });
  }
};
