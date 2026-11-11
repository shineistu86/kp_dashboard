/* Worker: mengunduh & menguraikan GeoJSON 31,6 MB di luar main thread
   agar UI tidak membeku. Progres pengunduhan dihitung dari stream byte nyata. */

self.onmessage = async (e) => {
  const url = e.data.url;
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error('HTTP ' + resp.status + ', gagal memuat ' + url);
    }

    const total = Number(resp.headers.get('Content-Length') || 0);
    let features;

    if (resp.body && typeof resp.body.getReader === 'function') {
      const reader = resp.body.getReader();
      const chunks = [];
      let loaded = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        self.postMessage({ type: 'progress', phase: 'download', loaded: loaded, total: total });
      }

      self.postMessage({ type: 'progress', phase: 'parse', loaded: loaded, total: loaded });

      const buf = new Uint8Array(loaded);
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        buf.set(chunks[i], offset);
        offset += chunks[i].length;
      }

      const text = new TextDecoder('utf-8').decode(buf);
      const gj = JSON.parse(text);
      features = gj.features;
      chunks.length = 0;
    } else {
      const text = await resp.text();
      self.postMessage({ type: 'progress', phase: 'parse' });
      const gj = JSON.parse(text);
      features = gj.features;
    }

    self.postMessage({ type: 'done', count: features.length, features: features });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) ? err.message : String(err) });
  }
};
