/* Reads salary-slip files into positioned words: photos (OCR), PDF (digital text or scanned), Word, Excel, CSV, text.
   Everything runs in the browser. Two ways to get the OCR engine:
   - normal site: files in /vendor (cached by the service worker, works offline after the first load)
   - single-file preview: the engine is embedded in the page (window.KH_EMBED) and started from Blob URLs. */
(function (root) {
  'use strict';
  const abs = (p) => new URL(p, document.baseURI).href;
  const embedded = () => !!root.KH_EMBED;
  const MAX_BYTES = 12 * 1024 * 1024;
  // Gambar terlalu besar membuat OCR di HP berjam-jam; 2000 px sisi panjang cukup untuk struk.
  const MAX_LONG = 2000, WORKER_INIT_MS = 45000, RECOGNIZE_MS = 120000, ALT_BUDGET_MS = 40000;
  const fitScale = (long) => (long > MAX_LONG ? MAX_LONG / long : long < 1200 ? Math.min(2, 1500 / long) : 1);
  const withTimeout = (p, ms, msg) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(Object.assign(new Error(msg), { timeout: true })), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });

  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Gagal memuat mesin baca. Periksa koneksi lalu coba lagi.')); };
      document.head.append(s);
    });
    return loaded[src];
  }
  function bytesFromB64(s) { const bin = atob(s.trim()); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  const hasSimd = () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } };

  /** Source of the OCR worker for embedded mode: language data served by a fetch shim, core defined before the worker code. */
  function workerParts(coreBytes, workerBytes, engB64, indB64) {
    // Embedded mode must serve the correct compressed model for each requested language.
    // Tesseract requests both ind.traineddata.gz and eng.traineddata.gz for "ind+eng".
    const head = '(function(){var D={eng:"';
    const middle = '",ind:"';
    const tail = '"};var f=self.fetch;self.fetch=function(u,o){var n=String(u).split("?")[0].split("/").pop().toLowerCase();if(/\.traineddata(?:\.gz)?$/.test(n)){var lang=/^ind(?:[._-]|$)/.test(n)?"ind":"eng",b=D[lang]||D.eng,bin=atob(b),a=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return Promise.resolve(new Response(a,{status:200}));}return f.apply(self,arguments);};})();\n';
    return [head, engB64, middle, indB64 || engB64, tail, coreBytes, '\n', workerBytes];
  }

  // Cara menyalakan mesin baca, dicoba berurutan. Penting: createWorker milik Tesseract menelan error pada tahap memuat bahasa dan
  // inisialisasi (janjinya tidak pernah selesai), jadi tiap percobaan dipantau lewat errorHandler dan batas macet per tahap.
  const STRATEGIES = [
    { name: 'standar', core: 'vendor/tesseract/', embed: false },
    { name: 'data bahasa dari memori', core: 'vendor/tesseract/', embed: true },
    { name: 'mode kompatibilitas', core: 'vendor/tesseract/tesseract-core-lstm-lowmem.wasm.js', embed: true }
  ];
  const STALL_MS = 20000;
  const STAGE_LABEL = (st) => /core/.test(st) ? 'memuat inti' : /initializing tesseract/.test(st) ? 'menyalakan WebAssembly' : /language/.test(st) ? 'memuat data bahasa' : /initializing api/.test(st) ? 'menyiapkan pembaca teks' : 'memulai';
  // Cara menyalakan mesin yang terakhir berhasil diingat antar-peluncuran, agar tidak mengulang cara yang gagal di perangkat ini.
  const prefStore = () => { try { return root.KHNativeStorage || root.localStorage || null; } catch (e) { return null; } };
  const loadStrat = () => { try { const n = Number(prefStore() && prefStore().getItem('kh_ocr_strategy')); return Number.isInteger(n) && n >= 0 && n < STRATEGIES.length ? n : 0; } catch (e) { return 0; } };
  const saveStrat = (n) => { try { const st = prefStore(); if (st && String(st.getItem('kh_ocr_strategy')) !== String(n)) st.setItem('kh_ocr_strategy', String(n)); } catch (e) { /* tidak penting */ } };
  let stratIdx = 0, worker = null, workerPromise = null, progressCb = null, nativeWorkerBlobUrl = null;
  const b64OfBuffer = (buf) => { const u = new Uint8Array(buf); let out = ''; for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(out); };
  const nativeOcrBridge = () => {
    const bridge = root.KHNativeStorage;
    return bridge && typeof bridge.readOcrAssetBase64 === 'function' ? bridge : null;
  };
  /** Android path: read the OCR runtime from APK assets using the native bridge.
   *  WebView worker fetches are not reliable on every device/vendor; no appassets URL or
   *  network permission is needed for language data, worker code, or the wasm core. */
  async function startNativeEngine(logger) {
    const bridge = nativeOcrBridge();
    if (!bridge) throw new Error('Jembatan aset OCR Android tidak tersedia. Perbarui aplikasi KasHarian.');
    await loadScript(abs('vendor/tesseract/tesseract.min.js'));
    const read = (name) => {
      const value = bridge.readOcrAssetBase64(name);
      if (typeof value !== 'string' || value.length < 100) throw new Error('Aset OCR di APK tidak lengkap: ' + name + '. Pasang ulang APK KasHarian.');
      return value;
    };
    if (typeof bridge.hasOcrAssets === 'function' && !bridge.hasOcrAssets()) {
      throw new Error('Paket OCR di APK tidak lengkap. Buat ulang dan pasang APK KasHarian terbaru.');
    }
    const coreName = hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm-lowmem.wasm.js';
    logger({ status: 'Memuat data OCR dari aplikasi', progress: 0 });
    const eng = read('eng.traineddata.gz');
    logger({ status: 'Memuat bahasa Indonesia', progress: 0.25 });
    const ind = read('ind.traineddata.gz');
    logger({ status: 'Menyiapkan inti OCR', progress: 0.5 });
    const core = bytesFromB64(read(coreName));
    const workerSource = bytesFromB64(read('worker.min.js'));
    const parts = workerParts(core, workerSource, eng, ind);
    const blobUrl = URL.createObjectURL(new Blob(parts, { type: 'text/javascript' }));
    try {
      const result = await new Promise((resolve, reject) => {
        let settled = false, last = Date.now(), stage = 'memulai OCR lokal';
        const finishError = (error) => {
          if (settled) return;
          settled = true;
          clearInterval(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        };
        const timer = setInterval(() => {
          if (Date.now() - last > STALL_MS) finishError(new Error('Mesin OCR berhenti pada tahap ' + stage + '. Coba tutup aplikasi lain lalu ulangi pemindaian.'));
        }, 1000);
        const log = (message) => {
          last = Date.now();
          stage = STAGE_LABEL(String(message && message.status || stage));
          logger(message);
        };
        try {
          root.Tesseract.createWorker('ind+eng', 1, {
            workerPath: blobUrl,
            workerBlobURL: false,
            langPath: 'https://kasharian.invalid/tessdata',
            gzip: true,
            cacheMethod: 'none',
            logger: log,
            errorHandler: finishError
          }).then((created) => {
            if (settled) { try { created.terminate(); } catch (_) {} return; }
            settled = true;
            clearInterval(timer);
            resolve(created);
          }, finishError);
        } catch (error) {
          finishError(error);
        }
      });
      nativeWorkerBlobUrl = blobUrl;
      return result;
    } catch (error) {
      URL.revokeObjectURL(blobUrl);
      throw error;
    }
  }
  /** Skrip worker (blob) yang menyajikan file bahasa dari memori lalu memuat worker Tesseract: tidak ada fetch dari dalam worker. */
  async function langWorkerUrl(workerUrl) {
    const get = async (name) => { const r = await fetch(abs('vendor/tessdata/' + name + '.traineddata.gz')); if (!r.ok) throw new Error('Gagal memuat ' + name + ' (' + r.status + ')'); return b64OfBuffer(await r.arrayBuffer()); };
    const [eng, ind] = [await get('eng'), await get('ind')];
    const head = '(function(){var D={eng:"', mid = '",ind:"', tail = '"};var f=self.fetch;self.fetch=function(u,o){var n=String(u).split("?")[0].split("/").pop().toLowerCase(),m=/^([a-z_]+)\\.traineddata(?:\\.gz)?$/.exec(n);if(m&&D[m[1]]){var b=atob(D[m[1]]),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return Promise.resolve(new Response(a,{status:200}));}return f.apply(self,arguments);};})();\nimportScripts(' + JSON.stringify(workerUrl) + ');';
    return URL.createObjectURL(new Blob([head, eng, mid, ind, tail], { type: 'text/javascript' }));
  }
  /** Satu percobaan menyalakan mesin. Gagal cepat dengan pesan asli bila ada error, atau bila satu tahap macet. */
  async function startEngine(st, logger) {
    let workerPath = abs('vendor/tesseract/worker.min.js'), blobUrl = null;
    if (st.embed) workerPath = blobUrl = await langWorkerUrl(workerPath);
    try {
      return await new Promise((resolve, reject) => {
        let done = false, last = Date.now(), stage = 'memulai';
        const fail = (e) => { if (done) return; done = true; clearInterval(timer); reject(e instanceof Error ? e : new Error(String(e))); };
        const timer = setInterval(() => { if (Date.now() - last > STALL_MS) fail(new Error('macet di tahap "' + stage + '" selama ' + Math.round((Date.now() - last) / 1000) + ' detik')); }, 1000);
        const log = (m) => { last = Date.now(); stage = STAGE_LABEL(String(m && m.status || '')); logger(m); };
        root.Tesseract.createWorker('ind+eng', 1, { workerPath, corePath: abs(st.core), langPath: abs('vendor/tessdata/'), gzip: true, workerBlobURL: false, cacheMethod: 'none', logger: log, errorHandler: (e) => fail(new Error(String(e))) })
          .then((w) => { if (done) { try { w.terminate(); } catch (_) { /* sudah dibatalkan */ } return; } done = true; clearInterval(timer); resolve(w); }, fail);
      });
    } finally { if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 120000); }
  }
  async function getWorker() {
    if (worker) return worker;
    if (!workerPromise) {
      workerPromise = (async () => {
        const logger = (m) => { if (progressCb) progressCb(m); };
        const nativeBridge = nativeOcrBridge();
        if (!hasSimd() && !embedded() && !nativeBridge) throw new Error('Peramban ini belum mendukung WebAssembly SIMD yang dibutuhkan mesin baca. Perbarui Chrome/Firefox atau gunakan perangkat yang mendukung; data Anda tidak berubah.');
        if (nativeBridge) {
          worker = await startNativeEngine(logger);
          stratIdx = 0;
        } else if (embedded()) {
          if (!root.Tesseract) throw new Error('Mesin baca tidak tersedia di halaman ini.');
          const el = (id) => { const node = document.getElementById(id); return node ? node.textContent.trim() : ''; };
          const eng = el('kh-lang'), ind = el('kh-lang-ind');
          const parts = workerParts(bytesFromB64(el('kh-core')), bytesFromB64(el('kh-worker')), eng, ind || eng);
          const url = URL.createObjectURL(new Blob(parts, { type: 'text/javascript' }));
          worker = await root.Tesseract.createWorker(ind ? 'ind+eng' : 'eng', 1, { workerPath: url, workerBlobURL: false, langPath: 'https://kasharian.invalid/tessdata', gzip: true, cacheMethod: 'none', logger });
        } else {
          await loadScript(abs('vendor/tesseract/tesseract.min.js'));
          const errs = []; stratIdx = loadStrat();
          for (let k = 0; k < STRATEGIES.length && !worker; k++) {
            const idx = (stratIdx + k) % STRATEGIES.length, st = STRATEGIES[idx];
            try {
              if (k > 0 && progressCb) progressCb({ status: 'kompatibilitas', progress: 0 });
              worker = await startEngine(st, logger);
              stratIdx = idx; saveStrat(idx);
            } catch (e) { worker = null; errs.push(st.name + ': ' + String(e && e.message || e).slice(0, 240)); }
          }
          if (!worker) {
            const ver = /Chrome\/([\d.]+)/.exec((root.navigator && navigator.userAgent) || '');
            throw new Error('Mesin baca tidak bisa dijalankan di perangkat ini. Rincian: ' + errs.join(' | ') + (ver ? ' [WebView ' + ver[1] + ']' : ''));
          }
        }
        return worker;
      })().catch((e) => { workerPromise = null; const msg = e && e.message ? e.message : 'Mesin baca gagal dimulai.'; throw Object.assign(new Error(msg), { fatal: /^Mesin baca tidak bisa|SIMD/.test(msg) }); });
    }
    return workerPromise;
  }

  /** Pratinjau ringan (maks 1000 px, JPEG) agar layar hasil tidak men-decode foto mentah berukuran belasan megapiksel. */
  async function previewOf(src, file) {
    try {
      const long = Math.max(src.width, src.height), s = Math.min(1, 1000 / long), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.width * s)); c.height = Math.max(1, Math.round(src.height * s));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
      if (blob && blob.size > 0) return URL.createObjectURL(blob);
    } catch (e) { /* jatuh ke berkas asli */ }
    return URL.createObjectURL(file);
  }
  async function bitmapOf(file) {
    if (root.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
    }
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url;
    try { await img.decode(); return img; }
    catch (e) { throw new Error('Gambar tidak bisa dibuka oleh peramban ini. Coba ekspor ulang sebagai JPG, PNG, atau WEBP.'); }
    finally { URL.revokeObjectURL(url); }
  }

  /** Layar gelap (screenshot mode gelap) dibalik agar teks hitam di latar putih, karena mesin baca jauh lebih akurat begitu. */
  function isDark(src) {
    const c = document.createElement('canvas'); c.width = 48; c.height = Math.max(8, Math.min(240, Math.round(48 * src.height / src.width)));
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data, g = [];
    for (let i = 0; i < d.length; i += 4) g.push((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000);
    const sorted = g.slice().sort((a, b) => a - b), med = sorted[g.length >> 1];
    const flat = g.filter((v) => Math.abs(v - med) <= 22).length / g.length;
    return med < 100 && flat >= 0.55;           // latar gelap yang rata = layar mode gelap; foto struk di atas kain gelap tidak ikut terbalik
  }
  /** Putaran piksel murni (abu-abu, balik bila gelap, regangkan kontras, ambang Sauvola). Dijalankan di worker agar layar tetap bergerak;
   *  fungsi ini juga dipakai sebagai cadangan di thread utama. Tidak boleh memakai variabel di luar dirinya selain sauvola. */
  function pixelPass(d, W, H, invert, bin, win) {
    const hist = new Uint32Array(256); let sum = 0;
    for (let i = 0; i < d.length; i += 4) { let g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; if (invert) g = 255 - g; d[i] = g; hist[g]++; sum += g; }
    const n = d.length / 4, mean = sum / n;
    let acc = 0, lo = 0, hi = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    const span = Math.max(40, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)) | 0; d[i] = d[i + 1] = d[i + 2] = v; }
    if (bin) sauvola(d, W, H, win);
    return { mean, span };
  }
  let pixWorker = null, pixSeq = 0; const pixWait = new Map();
  function pixelWorker() {
    if (pixWorker !== null) return pixWorker || null;
    try {
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined') { pixWorker = false; return null; }
      const code = pixelPass.toString() + '\n' + sauvola.toString() +
        '\nonmessage=function(e){var m=e.data;try{var q=pixelPass(new Uint8ClampedArray(m.buf),m.W,m.H,m.invert,m.bin,m.win);postMessage({id:m.id,buf:m.buf,q:q},[m.buf]);}catch(x){postMessage({id:m.id,error:String(x&&x.message||x)});}};';
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), w = new Worker(url);
      w.onmessage = (e) => { const r = pixWait.get(e.data.id); if (r) { pixWait.delete(e.data.id); r(e.data); } };
      w.onerror = () => { pixWorker = false; pixWait.forEach((r) => r({ error: 'worker' })); pixWait.clear(); try { w.terminate(); } catch (_) { /* sudah mati */ } };
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      pixWorker = w; return w;
    } catch (e) { pixWorker = false; return null; }
  }
  /** Kirim salinan piksel ke worker; null bila worker tidak ada/gagal/terlalu lama (pemanggil memakai cadangan di thread utama). */
  function runPixelPass(buf, W, H, invert, bin, win) {
    const w = pixelWorker(); if (!w) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = ++pixSeq, t = setTimeout(() => { pixWait.delete(id); resolve(null); }, 60000);
      pixWait.set(id, (r) => { clearTimeout(t); resolve(r.error ? null : r); });
      try { const copy = buf.slice(0); w.postMessage({ id, buf: copy, W, H, invert, bin, win }, [copy]); } catch (e) { clearTimeout(t); pixWait.delete(id); resolve(null); }
    });
  }
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));
  /** Potong (sx,sy,sw,sh), perbesar/kecilkan, abu-abu, balik bila gelap, regangkan kontras. Berat-piksel dijalankan di worker. */
  async function prep(src, sx, sy, sw, sh, scale, invert, bin) {
    await yieldUI();                                      // beri kesempatan layar menggambar tahap terbaru lebih dulu
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height), win = Math.max(15, (Math.round(scale * 5) * 2) | 1);
    const viaWorker = await runPixelPass(img.data.buffer, c.width, c.height, !!invert, !!bin, win);
    let q;
    if (viaWorker) { q = viaWorker.q; ctx.putImageData(new ImageData(new Uint8ClampedArray(viaWorker.buf), c.width, c.height), 0, 0); }
    else { q = pixelPass(img.data, c.width, c.height, !!invert, !!bin, win); ctx.putImageData(img, 0, 0); }
    return { canvas: c, quality: { width: sw, height: sh, mean: q.mean, span: q.span, inverted: !!invert } };
  }
  /** Ambang lokal (Sauvola): membuat teks struk yang buram dan tidak rata pencahayaannya jadi hitam-putih yang tegas. */
  function sauvola(d, W, H, win) {
    const w1 = W + 1, I = new Float64Array(w1 * (H + 1)), I2 = new Float64Array(w1 * (H + 1));
    for (let y = 0; y < H; y++) { let r = 0, r2 = 0; for (let x = 0; x < W; x++) { const v = d[(y * W + x) * 4]; r += v; r2 += v * v; I[(y + 1) * w1 + x + 1] = I[y * w1 + x + 1] + r; I2[(y + 1) * w1 + x + 1] = I2[y * w1 + x + 1] + r2; } }
    const h = win >> 1, out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { const y0 = Math.max(0, y - h), y1 = Math.min(H, y + h + 1); for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - h), x1 = Math.min(W, x + h + 1), n = (x1 - x0) * (y1 - y0);
      const sum = I[y1 * w1 + x1] - I[y0 * w1 + x1] - I[y1 * w1 + x0] + I[y0 * w1 + x0], sq = I2[y1 * w1 + x1] - I2[y0 * w1 + x1] - I2[y1 * w1 + x0] + I2[y0 * w1 + x0];
      const m = sum / n, sd = Math.sqrt(Math.max(0, sq / n - m * m)); out[y * W + x] = d[(y * W + x) * 4] > m * (1 + 0.2 * (sd / 128 - 1)) ? 255 : 0; } }
    for (let i = 0; i < out.length; i++) { const v = out[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; }
  }
  async function preprocess(src) {
    const w0 = src.width, h0 = src.height, long = Math.max(w0, h0);
    const scale = fitScale(long);
    return await prep(src, 0, 0, w0, h0, scale, isDark(src));
  }
  /** Foto struk: satu kali baca. Screenshot panjang (riwayat transaksi): dipotong per bagian dengan tumpang tindih, ukuran teks dijaga. */
  async function ocrImage(src, name, type, onStage) {
    const t0 = Date.now();
    const W = src.width, H = src.height, pixels = W * H, dark = isDark(src), tall = H / W > 2.2 && H > 2000;
    // PNG is common for screenshots, but file type/name alone must never make an image un-retryable.
    const shot = dark || /screenshot|screen[_ -]?shot|tangkapan|capture/i.test(name || '');
    // MIME type is not evidence of layout: phone screenshots, downloaded receipt photos, and scans are all often PNG.
    // Prefer block mode for ordinary receipts; dark/UI screenshots use sparse-text mode and can retry the other mode.
    const mode = shot ? '11' : '6';
    if (!tall) {
      const long = Math.max(W, H), scale = fitScale(long);
      onStage && onStage(shot ? 'Menyiapkan screenshot struk' : 'Meningkatkan keterbacaan gambar');
      const pre = await prep(src, 0, 0, W, H, scale, dark);
      const r = await ocrCanvas(pre.canvas, 0, mode);
      return {
        words: r.words, confidence: r.confidence, quality: pre.quality, shot,
        retry: async (onS) => { onS && onS('Membaca ulang dengan mode teks berbeda'); return (await ocrCanvas(pre.canvas, 0, mode === '6' ? '11' : '6')).words; },
        // Try alternate segmentation and local thresholding for screenshots and camera photos alike.
        // Keep the temporary canvas below a safe pixel ceiling to avoid exhausting mobile memory.
        alts: pixels <= 4_500_000 && Math.max(W, H) <= 4200 ? async (onS) => {
          const out = [], configs = [
            [1.45, false, shot ? '11' : '6'],
            [1.8, true, '6']
          ];
          let k = 0;
          for (const [sc, bin, m] of configs) {
            if (Date.now() - t0 > ALT_BUDGET_MS) break;
            onS && onS(`Membaca ulang dengan pengaturan lain (${++k} dari ${configs.length})`);
            try {
              const cap = Math.sqrt((bin ? 1_650_000 : 3_000_000) / pixels);
              const actualScale = Math.max(0.65, Math.min(sc, cap));
              const p = await prep(src, 0, 0, W, H, actualScale, dark, bin);
              const rr = await ocrCanvas(p.canvas, 0, m);
              out.push(rr.words);
            } catch (e) { /* one alternate failing must not discard other attempts */ }
          }
          return out;
        } : null
      };
    }
    const scale = Math.min(2.5, Math.max(1, 1300 / W)), th = Math.floor(2200 / scale), ov = Math.ceil(110 / scale), words = [];
    let conf = 0, n = 0, quality = null;
    const tiles = Math.max(1, Math.ceil((H - ov) / (th - ov)));
    for (let i = 0; i < tiles; i++) {
      const s0 = i * (th - ov), s1 = Math.min(H, s0 + th);
      onStage && onStage(`Membaca bagian ${i + 1} dari ${tiles}`);
      const pre = await prep(src, 0, s0, W, s1 - s0, scale, dark); quality = quality || pre.quality;
      const r = await ocrCanvas(pre.canvas, 0, mode); conf += r.confidence; n++;
      const lo = i ? s0 + ov / 2 : -1, hi = i === tiles - 1 ? Infinity : s0 + th - ov / 2;
      r.words.forEach((x) => { const y0 = s0 + x.y0 / scale, y1 = s0 + x.y1 / scale, yc = (y0 + y1) / 2; if (yc >= lo && yc < hi) words.push({ ...x, x0: x.x0 / scale, x1: x.x1 / scale, y0, y1 }); });
    }
    return { words, confidence: n ? conf / n : 0, quality, shot: true,
      retry: async (onS) => { onS && onS('Membaca ulang bagian gambar dengan mode berbeda'); const p = await prep(src, 0, 0, W, H, Math.min(1.5, 3000 / Math.max(W, H)), dark); return (await ocrCanvas(p.canvas, 0, '6')).words; },
      alts: pixels <= 4_500_000 && Math.max(W, H) <= 4200 ? async (onS) => {
        const p = await prep(src, 0, 0, W, H, Math.max(0.7, Math.min(1.25, Math.sqrt(3_000_000 / pixels))), dark, true);
        onS && onS('Mencoba ambang kontras alternatif untuk screenshot panjang');
        return [(await ocrCanvas(p.canvas, 0, '6')).words, (await ocrCanvas(p.canvas, 0, '11')).words];
      } : null
    };
  }

  function adviceFor(q, conf) {
    const out = [];
    if (q) {
      if (q.mean < 85 && !q.inverted) out.push('Foto terlalu gelap. Coba foto ulang di tempat lebih terang.');
      if (q.span < 90) out.push('Kontras foto rendah, teks mungkin sulit dibaca.');
      if (Math.max(q.width, q.height) < 900) out.push('Resolusi foto kecil. Dekatkan kamera atau pakai foto asli.');
    }
    if (conf != null && conf < 65) out.push('Teks kurang jelas terbaca. Periksa hasil dan nominal satu per satu sebelum disimpan.');
    return out;
  }

  function wordsFromOcr(data) {
    let ws = data.words;
    if (!ws && data.blocks) ws = data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    return (ws || []).map((w) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, conf: w.confidence }));
  }
  let curMode = null;
  /** Matikan mesin yang macet supaya percobaan berikutnya memulai yang baru (kalau tidak, semua scan berikutnya ikut gagal). */
  async function resetWorker() {
    const w = worker; worker = null; workerPromise = null; curMode = null;
    if (w) { try { await w.terminate(); } catch (e) { /* sudah mati */ } }
    if (nativeWorkerBlobUrl) { try { URL.revokeObjectURL(nativeWorkerBlobUrl); } catch (e) {} nativeWorkerBlobUrl = null; }
  }
  const shrink = (canvas, f) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(canvas.width * f)); c.height = Math.max(1, Math.round(canvas.height * f)); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0, c.width, c.height); return c; };
  async function recognizeOnce(canvas, mode) {
    const w = await getWorker();
    mode = mode || '6';                                  // 6 = blok seragam (struk), 11 = teks tersebar (screenshot aplikasi)
    if (curMode !== mode) { try { await w.setParameters({ tessedit_pageseg_mode: mode, preserve_interword_spaces: '1' }); curMode = mode; } catch (e) { /* pakai bawaan */ } }
    const { data } = await withTimeout(w.recognize(canvas, {}, { text: true, blocks: true }), RECOGNIZE_MS, 'Pembacaan terlalu lama. Coba foto yang lebih dekat dan terang.');
    return data;
  }
  async function ocrCanvas(canvas, yOffset, mode) {
    let data = null, scale = 1, err = null;
    for (let attempt = 0; attempt < 3 && !data; attempt++) {
      try {
        // If segmentation produced no words, switch once between receipt-block (6) and sparse-text (11)
        // before shrinking. This catches layouts misclassified from screenshots or camera scans.
        const trialScale = attempt === 2 ? 0.72 : 1;
        const trialMode = attempt === 1 ? (mode === '6' ? '11' : '6') : mode;
        const trial = await recognizeOnce(trialScale < 1 ? shrink(canvas, trialScale) : canvas, trialMode);
        if (wordsFromOcr(trial).length) { data = trial; scale = trialScale; }
        else { err = new Error('Belum ada teks yang terbaca pada percobaan ini'); await resetWorker(); }
      } catch (e) { err = e; if (e && e.fatal) break; await resetWorker(); if (e && e.timeout) break; } // buat ulang worker setelah error; jangan ulang bila sudah kehabisan waktu
    }
    if (!data) throw new Error('Teks belum berhasil dibaca' + (err && err.message ? ` (${err.message})` : '') + '. Gambar masih dapat disimpan, atau coba JPG/PNG yang lebih jelas.');
    return { words: wordsFromOcr(data).map((x) => ({ ...x, x0: x.x0 / scale, x1: x.x1 / scale, y0: x.y0 / scale + yOffset, y1: x.y1 / scale + yOffset })), confidence: Number(data.confidence) || 0 };
  }

  // ---------- PDF ----------
  async function pdfLib() {
    if (!root.pdfjsLib) await loadScript(abs('vendor/pdfjs/pdf.min.js'));
    // The worker script defines window.pdfjsWorker; with it present pdf.js runs without a Web Worker (no CSP/Blob problems).
    if (!root.pdfjsWorker && !embedded()) await loadScript(abs('vendor/pdfjs/pdf.worker.min.js'));
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = embedded() ? 'about:blank' : abs('vendor/pdfjs/pdf.worker.min.js');
    return root.pdfjsLib;
  }
  async function readPdf(file, onStage) {
    const lib = await pdfLib();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = Math.min(doc.numPages, 10);
    const warning = doc.numPages > 10 ? `PDF memiliki ${doc.numPages} halaman. Hanya 10 halaman pertama dibaca.` : null;
    let previewUrl = null, textWords = 0;
    const textPages = [];
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const ws = tc.items.filter((i) => i.str && i.str.trim()).map((i) => {
        const x0 = i.transform[4], hgt = Math.abs(i.height || i.transform[3] || 10), y0 = vp.height - i.transform[5] - hgt + (p - 1) * 100000;
        return { text: i.str, x0, x1: x0 + (i.width || 0), y0, y1: y0 + hgt };
      });
      textPages.push(ws); textWords += ws.length;
      if (p === 1) {
        try {
          const view = page.getViewport({ scale: 1.3 });
          const c = document.createElement('canvas'); c.width = view.width; c.height = view.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: view }).promise;
          previewUrl = c.toDataURL('image/jpeg', 0.7);
        } catch (e) { previewUrl = null; }
      }
    }
    if (textWords >= 10) return { words: textPages.flat(), imageUrl: previewUrl, engine: 'PDF teks digital', confidence: 100, advice: [], warning };
    let words = [], conf = 0;                       // scanned PDF: render each page and OCR it
    for (let p = 1; p <= pages; p++) {
      onStage && onStage(`Membaca halaman ${p} dari ${pages}`);
      const page = await doc.getPage(p);
      const view = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas'); c.width = view.width; c.height = view.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: view }).promise;
      const r = await ocrCanvas((await preprocess(c)).canvas, (p - 1) * 100000);
      words = words.concat(r.words); conf += r.confidence / pages;
    }
    return { words, imageUrl: previewUrl, engine: 'OCR di perangkat', confidence: conf, advice: adviceFor(null, conf), warning };
  }

  // ---------- one file ----------
  const extOf = (n) => (/\.([a-z0-9]+)$/i.exec(n || '') || [, ''])[1].toLowerCase();
  async function readOne(file, onStage) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name || 'Berkas'} melebihi 12 MB.`);
    const ext = extOf(file.name), type = file.type || '';
    const done = (r) => Object.assign({ imageUrl: null, confidence: 100, advice: [], warning: null }, r);
    if (type === 'application/pdf' || ext === 'pdf') { onStage && onStage('Membuka PDF'); return readPdf(file, onStage); }
    if (ext === 'docx' || type.includes('wordprocessingml')) { onStage && onStage('Membaca dokumen Word'); return done(await root.KHDocs.readDocx(await file.arrayBuffer())); }
    if (ext === 'xlsx' || type.includes('spreadsheetml')) { onStage && onStage('Membaca dokumen Excel'); return done(await root.KHDocs.readXlsx(await file.arrayBuffer())); }
    if (ext === 'doc' || ext === 'xls') throw new Error(`Format .${ext} lama tidak bisa dibaca. Simpan sebagai .docx/.xlsx atau PDF, lalu coba lagi.`);
    if (ext === 'csv' || type === 'text/csv') return done(root.KHDocs.readCsv(await file.text()));
    if (ext === 'txt' || type === 'text/plain') return done(root.KHDocs.readTxt(await file.text()));
    if (type.startsWith('image/') || /^(png|jpe?g|webp|bmp|gif|heic|heif)$/.test(ext)) {
      if (/^(heic|heif)$/.test(ext) || /heic|heif/.test(type)) { try { await createImageBitmap(file); } catch (e) { throw new Error('Format HEIC belum didukung di peramban ini. Ekspor gambar sebagai JPG, PNG, atau WEBP lalu coba lagi.'); } }
      onStage && onStage('Menyiapkan gambar');
      const bmp = await bitmapOf(file);
      onStage && onStage('Menyiapkan mesin baca \u00b7 memulai');
      const preview = await previewOf(bmp, file);
      const r = await ocrImage(bmp, file.name, type, onStage);
      return done({ words: r.words, imageUrl: preview, engine: 'OCR di perangkat', confidence: r.confidence, advice: adviceFor(r.quality, r.confidence), screenshot: r.shot, retry: r.retry, alts: r.alts });
    }
    throw new Error(`Jenis berkas "${file.name || type}" belum didukung. Pakai foto, PDF, Word (.docx), Excel (.xlsx), CSV, atau teks.`);
  }

  /** Several files (for example one photo per page) are read in order and merged into one slip. */
  async function readFiles(files, onStage) {
    const list = [...files];
    if (!list.length) throw new Error('Belum ada berkas dipilih.');
    progressCb = (m) => {
      if (!onStage) return;
      if (m.status === 'recognizing text') onStage(`Membaca teks ${Math.round(m.progress * 100)}%`);
      else if (m.status === 'kompatibilitas') onStage('Mencoba mode kompatibilitas');
      else if (/loading|initializ/.test(m.status)) onStage('Menyiapkan mesin baca \u00b7 ' + STAGE_LABEL(m.status) + (m.progress != null && m.progress > 0 ? ' ' + Math.round(m.progress * 100) + '%' : ''));
    };
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const tag = list.length > 1 ? `Berkas ${i + 1} dari ${list.length}: ` : '';
      const r = await readOne(list[i], (s) => onStage && onStage(tag + s));
      r.words = r.words.map((w) => ({ ...w, y0: w.y0 + i * 1000000, y1: w.y1 + i * 1000000 }));
      results.push(r);
    }
    return {
      words: results.flatMap((r) => r.words),
      imageUrl: (results.find((r) => r.imageUrl) || {}).imageUrl || null,
      engine: [...new Set(results.map((r) => r.engine))].join(' + '),
      confidence: Math.min(...results.map((r) => r.confidence)),
      advice: [...new Set(results.flatMap((r) => r.advice))],
      warning: results.map((r) => r.warning).filter(Boolean).join(' ') || null,
      count: list.length,
      retry: list.length === 1 ? results[0].retry : null,
      alts: list.length === 1 ? results[0].alts : null
    };
  }

  /** Honest readiness report, shown on the slip screen. */
  async function selfTest() {
    const bridge = nativeOcrBridge();
    const nativeAssets = !!(bridge && (typeof bridge.hasOcrAssets !== 'function' || bridge.hasOcrAssets()));
    const r = { embedded: embedded(), nativeOcr: !!bridge, nativeAssets, wasm: typeof WebAssembly === 'object', simd: hasSimd(), worker: false, unzip: typeof DecompressionStream !== 'undefined' };
    try {
      const u = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
      r.worker = await new Promise((res) => {
        let w; const t = setTimeout(() => { try { w.terminate(); } catch (e) { /* ignore */ } res(false); }, 2500);
        try { w = new Worker(u); w.onmessage = () => { clearTimeout(t); w.terminate(); res(true); }; w.onerror = () => { clearTimeout(t); res(false); }; } catch (e) { clearTimeout(t); res(false); }
      });
    } catch (e) { r.worker = false; }
    r.photoOcr = r.wasm && (r.simd || r.nativeOcr) && r.worker && (!r.nativeOcr || r.nativeAssets);
    return r;
  }


  root.KHOCR = { reset: resetWorker, readFiles, readFile: (f, s) => readFiles([f], s), selfTest, _workerParts: workerParts, _bytesFromB64: bytesFromB64 };
})(typeof self !== 'undefined' ? self : this);
