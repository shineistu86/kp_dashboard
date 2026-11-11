/* ==========================================================================
   KP DASHBOARD : Peta Segmentasi Morfometri Bidang Tanah (OpenLayers)
   Data : hasil_clustering_polygon_v9.geojson (49.994 bidang, poligon asli)
   Sinkron: Laporan KP 2307016 rev p5 12 11 2026 (C0 biru 82,5% / C1 oranye 17,5%)
   ========================================================================== */
'use strict';

/* Guard: jika pustaka OpenLayers gagal dimuat, tampilkan error jelas */
if (typeof ol === 'undefined') {
  const msgEl0 = document.getElementById('loading-msg');
  if (msgEl0) msgEl0.textContent = 'Error: pustaka OpenLayers (assets/vendor/ol.js) gagal dimuat. Periksa koneksi lalu klik Coba Lagi.';
  const retry0 = document.getElementById('btn-retry');
  if (retry0) retry0.hidden = false;
  throw new Error('OpenLayers tidak termuat');
}

/* ---------- Konfigurasi ---------- */
const COLORS = {
  0: { fill: 'rgba(43,130,201,0.62)', stroke: '#1b5b91' },
  1: { fill: 'rgba(217,111,28,0.62)', stroke: '#96480b' }
};
const CLUSTER_LABEL = {
  0: 'Cluster 0: Reguler dan Kompak',
  1: 'Cluster 1: Kompleks, Memanjang, atau Tidak Beraturan'
};
const PATHS = {
  parcels: 'hasil_clustering_polygon_v9.geojson',
  admin: 'admin_batas.geojson',
  desaList: 'data/desa_list.json',
  dkMap: 'data/parcels_dk.json'
};
const GARUT_EXTENT_4326 = [107.42, -7.65, 108.02, -7.05];

/* ---------- State ---------- */
let clusterFilter = 'all';
let adminFilter = 'all';
let selectedFeature = null;
let initialExtent = null;
let dkMap = {};
let isSidebarOpen = true;
let uiReady = false;

/* ---------- Util ---------- */
const $ = (id) => document.getElementById(id);
const fmtInt = (n) => n.toLocaleString('id-ID');
const nextTick = () => new Promise((r) => setTimeout(r, 0));

function isMobile() { return window.innerWidth <= 900; }

function setProgress(pct, msg) {
  const prog = $('prog');
  const pctEl = $('loading-pct');
  const msgEl = $('loading-msg');
  if (prog) prog.style.width = Math.min(100, Math.max(0, pct)) + '%';
  if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  if (msg && msgEl) msgEl.textContent = msg;
}

function loadFail(message) {
  const msgEl = $('loading-msg');
  const h2 = document.querySelector('#loading h2');
  if (msgEl) msgEl.textContent = 'Error: ' + message;
  if (h2) { h2.textContent = 'Gagal Memuat'; h2.style.color = '#d96f1c'; }
  const retry = $('btn-retry');
  if (retry) retry.hidden = false;
}

/* ---------- Peta OpenLayers ---------- */
const map = new ol.Map({
  target: 'map',
  view: new ol.View({
    center: ol.proj.fromLonLat([107.9, -7.3]),
    zoom: 11,
    minZoom: 8,
    maxZoom: 19,
    constrainResolution: true
  }),
  controls: ol.control.defaults.defaults().extend([new ol.control.ScaleLine({ units: 'metric' })])
});

const osmLayer = new ol.layer.Tile({
  visible: true,
  source: new ol.source.OSM()
});

const satLayer = new ol.layer.Tile({
  visible: false,
  source: new ol.source.XYZ({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attributions: 'Citra satelit © Esri, Maxar, Earthstar Geographics',
    maxZoom: 19
  })
});

const parcelSource = new ol.source.Vector();
const adminSource = new ol.source.Vector();
const highlightSource = new ol.source.Vector();

const HIDDEN_STYLE = new ol.style.Style();
const PARCEL_STYLES = {
  0: new ol.style.Style({
    fill: new ol.style.Fill({ color: COLORS[0].fill }),
    stroke: new ol.style.Stroke({ color: COLORS[0].stroke, width: 0.8 })
  }),
  1: new ol.style.Style({
    fill: new ol.style.Fill({ color: COLORS[1].fill }),
    stroke: new ol.style.Stroke({ color: COLORS[1].stroke, width: 0.8 })
  })
};

function parcelStyleFn(feature) {
  if (!isVisible(feature)) return HIDDEN_STYLE;
  return PARCEL_STYLES[feature.get('cluster')] || HIDDEN_STYLE;
}

const ADMIN_DEFAULT = new ol.style.Style({
  stroke: new ol.style.Stroke({ color: '#2a7fca', width: 1.8, lineDash: [5, 5] }),
  fill: new ol.style.Fill({ color: 'rgba(42,127,202,0.04)' })
});
const ADMIN_SELECTED = new ol.style.Style({
  stroke: new ol.style.Stroke({ color: '#00e5ff', width: 3.2 }),
  fill: new ol.style.Fill({ color: 'rgba(0,229,255,0.10)' })
});
const ADMIN_DIM = new ol.style.Style({
  stroke: new ol.style.Stroke({ color: '#122030', width: 1, lineDash: [3, 3] }),
  fill: new ol.style.Fill({ color: 'rgba(5,12,20,0.68)' })
});

function adminStyleFn(feature) {
  if (adminFilter === 'all') return ADMIN_DEFAULT;
  return feature.get('dk_id') === adminFilter ? ADMIN_SELECTED : ADMIN_DIM;
}

const adminLayer = new ol.layer.Vector({
  source: adminSource,
  style: adminStyleFn
});

const parcelLayer = new ol.layer.VectorImage({
  source: parcelSource,
  style: parcelStyleFn
});

const highlightLayer = new ol.layer.Vector({
  source: highlightSource,
  style: new ol.style.Style({
    stroke: new ol.style.Stroke({ color: '#ffffff', width: 3 }),
    fill: new ol.style.Fill({ color: 'rgba(255,255,255,0.18)' })
  }),
  zIndex: 30
});

map.addLayer(osmLayer);
map.addLayer(satLayer);
map.addLayer(adminLayer);
map.addLayer(parcelLayer);
map.addLayer(highlightLayer);

/* ---------- Tooltip ---------- */
const tooltipEl = $('tooltip');
const tooltip = new ol.Overlay({
  element: tooltipEl,
  positioning: 'bottom-center',
  offset: [0, -6],
  stopEvent: false,
  insertFirst: false
});
map.addOverlay(tooltip);

function showTooltip(feature, coord) {
  const c = feature.get('cluster');
  tooltipEl.innerHTML =
    '<div class="tt-id">Bidang #' + feature.get('polygon_id') + '</div>' +
    '<div class="' + (c === 0 ? 'tt-c0' : 'tt-c1') + '">' + CLUSTER_LABEL[c] + '</div>' +
    '<div class="tt-row">Luas ' + fmtInt(Math.round(feature.get('area'))) + ' m², Komp ' +
    Number(feature.get('compactness')).toFixed(3) + '</div>';
  tooltipEl.classList.add('visible');
  tooltip.setPosition(coord);
}
function hideTooltip() {
  tooltipEl.classList.remove('visible');
  tooltip.setPosition(undefined);
}

/* ---------- Visibilitas & filter ---------- */
function isVisible(feature) {
  if (clusterFilter !== 'all' && feature.get('cluster') !== clusterFilter) return false;
  if (adminFilter !== 'all' && feature.get('dk') !== adminFilter) return false;
  return true;
}

function setClusterFilter(val, sourceBtn) {
  if (!uiReady) return;
  clusterFilter = val === 'all' ? 'all' : Number(val);
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  const btn = sourceBtn || document.querySelector('.filter-btn[data-cluster="' + val + '"]');
  if (btn) btn.classList.add('active');
  clearSelection();
  parcelLayer.changed();
  updateStats();
}

function setAdminFilter(val) {
  if (!uiReady) return;
  adminFilter = val;
  clearSelection();

  const adminToggle = $('toggle-admin-layer');
  if (val !== 'all' && adminToggle && !adminToggle.checked) {
    adminToggle.checked = true;
    adminLayer.setVisible(true);
  }

  parcelLayer.changed();
  adminLayer.changed();
  updateStats();

  if (val !== 'all') {
    const feats = adminSource.getFeatures();
    for (let i = 0; i < feats.length; i++) {
      if (feats[i].get('dk_id') === val) {
        map.getView().fit(feats[i].getGeometry().getExtent(), {
          padding: [56, 56, 56, 56],
          maxZoom: 16,
          duration: 500
        });
        break;
      }
    }
  } else if (initialExtent) {
    map.getView().fit(initialExtent, { padding: [36, 36, 36, 36], maxZoom: 14, duration: 500 });
  }
}

/* ---------- Statistik live ---------- */
function updateStats() {
  const feats = parcelSource.getFeatures();
  let total = 0, c0 = 0, c1 = 0;

  for (let i = 0; i < feats.length; i++) {
    if (!isVisible(feats[i])) continue;
    total++;
    if (feats[i].get('cluster') === 0) c0++; else c1++;
  }

  const p0 = total > 0 ? (c0 / total * 100) : 0;
  const p1 = total > 0 ? (c1 / total * 100) : 0;

  if ($('hdr-total')) $('hdr-total').textContent = fmtInt(total);
  if ($('ftr-total')) $('ftr-total').textContent = fmtInt(total);
  if ($('c0-count')) $('c0-count').textContent = fmtInt(c0) + ' bidang (' + p0.toFixed(1).replace('.', ',') + '%)';
  if ($('c1-count')) $('c1-count').textContent = fmtInt(c1) + ' bidang (' + p1.toFixed(1).replace('.', ',') + '%)';
  if ($('c0-bar')) $('c0-bar').style.width = p0 + '%';
  if ($('c1-bar')) $('c1-bar').style.width = p1 + '%';
  if ($('ftr-c0')) $('ftr-c0').innerHTML = fmtInt(c0) + ' <span class="pct">(' + p0.toFixed(1).replace('.', ',') + '%)</span>';
  if ($('ftr-c1')) $('ftr-c1').innerHTML = fmtInt(c1) + ' <span class="pct">(' + p1.toFixed(1).replace('.', ',') + '%)</span>';

  const empty = $('empty-state');
  if (empty) empty.hidden = total !== 0;
}

/* ---------- Detail bidang terpilih ---------- */
function infoRow(label, value, cls) {
  return '<div class="info-row"><span class="info-label">' + label +
    '</span><span class="info-value' + (cls ? ' ' + cls : '') + '">' + value + '</span></div>';
}

function renderDetail(feature) {
  const c = feature.get('cluster');
  const dk = feature.get('dk');
  const html =
    infoRow('Polygon ID', feature.get('polygon_id')) +
    infoRow('Kode Desa/Kelurahan', dk ? dk : 'Tidak teridentifikasi') +
    infoRow('Cluster', CLUSTER_LABEL[c], c === 0 ? 'c0' : 'c1') +
    '<div class="info-section-title">Rincian Morfometri Geometris</div>' +
    infoRow('Luas Bidang', fmtInt(Math.round(feature.get('area'))) + ' m²') +
    infoRow('Batas (Compactness)', Number(feature.get('compactness')).toFixed(3)) +
    infoRow('Bentuk (Elongation)', Number(feature.get('elongation')).toFixed(3)) +
    infoRow('Soliditas (Solidity)', Number(feature.get('solidity')).toFixed(3)) +
    infoRow('Jumlah Sudut (Vertex)', feature.get('num_vertices') + ' titik') +
    infoRow('Simpangan Sudut (angle_std)', Number(feature.get('angle_std')).toFixed(2) + '°') +
    infoRow('Variasi Sisi (edge_cv)', Number(feature.get('edge_cv')).toFixed(3));

  const content = $('info-content');
  if (content) content.innerHTML = html;

  const panel = $('info-panel');
  if (panel) panel.hidden = false;

  const interp = $('interp');
  const usage = $('usage');
  if (interp) interp.style.display = 'none';
  if (usage) usage.style.display = 'none';
}

function selectFeature(feature) {
  clearHighlight();
  selectedFeature = feature;
  highlightSource.addFeature(new ol.Feature({ geometry: feature.getGeometry() }));
  renderDetail(feature);
  if (!isSidebarOpen) toggleSidebar(true);
}

function clearHighlight() {
  highlightSource.clear();
}

function clearSelection() {
  clearHighlight();
  selectedFeature = null;
  const panel = $('info-panel');
  if (panel) panel.hidden = true;
  const interp = $('interp');
  const usage = $('usage');
  if (interp) interp.style.display = '';
  if (usage) usage.style.display = '';
}

/* ---------- Interaksi peta ---------- */
let lastMove = 0;

map.on('pointermove', (evt) => {
  if (evt.dragging || !uiReady) { hideTooltip(); return; }
  const now = performance.now();
  if (now - lastMove < 45) return;
  lastMove = now;

  const hit = map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
    layerFilter: (l) => l === parcelLayer,
    hitTolerance: 2
  });

  if (hit && isVisible(hit)) {
    showTooltip(hit, evt.coordinate);
    map.getTargetElement().style.cursor = 'pointer';
  } else {
    hideTooltip();
    map.getTargetElement().style.cursor = '';
  }
});

map.on('singleclick', (evt) => {
  if (!uiReady) return;
  const hit = map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
    layerFilter: (l) => l === parcelLayer,
    hitTolerance: 2
  });
  if (hit && isVisible(hit)) {
    selectFeature(hit);
  } else {
    clearSelection();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') clearSelection();
});

/* ---------- Sidebar responsif ---------- */
function toggleSidebar(forceState) {
  const panel = $('panel');
  const floatingBtn = $('btn-floating-sidebar');
  const backdrop = $('sidebar-backdrop');
  if (!panel || !floatingBtn || !backdrop) return;

  isSidebarOpen = (typeof forceState === 'boolean') ? forceState : !isSidebarOpen;

  if (isMobile()) {
    panel.classList.remove('collapsed');
    if (isSidebarOpen) {
      panel.classList.add('mobile-open');
      backdrop.classList.add('active');
      floatingBtn.classList.remove('visible');
    } else {
      panel.classList.remove('mobile-open');
      backdrop.classList.remove('active');
      floatingBtn.classList.add('visible');
    }
  } else {
    panel.classList.remove('mobile-open');
    backdrop.classList.remove('active');
    if (isSidebarOpen) {
      panel.classList.remove('collapsed');
      floatingBtn.classList.remove('visible');
    } else {
      panel.classList.add('collapsed');
      floatingBtn.classList.add('visible');
    }
  }
  setTimeout(() => map.updateSize(), 320);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const panel = $('panel');
    const floatingBtn = $('btn-floating-sidebar');
    const backdrop = $('sidebar-backdrop');
    if (!panel || !floatingBtn || !backdrop) return;

    if (isMobile()) {
      panel.classList.remove('collapsed');
      if (!panel.classList.contains('mobile-open')) {
        floatingBtn.classList.add('visible');
        backdrop.classList.remove('active');
        isSidebarOpen = false;
      }
    } else {
      panel.classList.remove('mobile-open');
      backdrop.classList.remove('active');
      if (panel.classList.contains('collapsed')) {
        floatingBtn.classList.add('visible');
        isSidebarOpen = false;
      } else {
        floatingBtn.classList.remove('visible');
        isSidebarOpen = true;
      }
    }
    map.updateSize();
  }, 150);
});

/* ---------- Pemuatan data ---------- */
function populateDesaDropdown(list) {
  const sel = $('admin-select');
  if (!sel) return;
    sel.innerHTML = '<option value="all">Semua Desa/Kelurahan (Garut)</option>';
  list.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.id + ' (' + fmtInt(d.total) + ' bidang)';
    sel.appendChild(opt);
  });
}

function loadWorkerParcels() {
  return new Promise((resolve, reject) => {
    const worker = new Worker('assets/js/worker.js');
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        if (m.phase === 'download' && m.total > 0) {
          setProgress(5 + (m.loaded / m.total) * 65,
            'Mengunduh 49.994 bidang tanah… (' + (m.loaded / 1048576).toFixed(1) + ' / ' + (m.total / 1048576).toFixed(1) + ' MB)');
        } else if (m.phase === 'parse') {
          setProgress(74, 'Menguraikan GeoJSON (±31,6 MB)…');
        }
      } else if (m.type === 'done') {
        resolve(m.features);
        worker.terminate();
      } else if (m.type === 'error') {
        reject(new Error(m.message));
        worker.terminate();
      }
    };
    worker.onerror = (err) => {
      reject(new Error(err.message || 'Web Worker gagal dijalankan'));
      worker.terminate();
    };
    worker.postMessage({ url: new URL(PATHS.parcels, document.baseURI).href });
  });
}

async function buildParcelFeatures(rawFeatures) {
  const fmt = new ol.format.GeoJSON({
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });

  const CHUNK = 2500;
  const total = rawFeatures.length;
  const feats = [];

  for (let i = 0; i < total; i += CHUNK) {
    const slice = rawFeatures.slice(i, i + CHUNK);
    const part = fmt.readFeatures({ type: 'FeatureCollection', features: slice });
    for (let j = 0; j < part.length; j++) {
      const f = part[j];
      f.set('dk', dkMap[String(f.get('polygon_id'))] || null, true);
      feats.push(f);
    }
    setProgress(78 + ((i + CHUNK) / total) * 20, 'Membangun lapisan peta… (' + fmtInt(Math.min(i + CHUNK, total)) + ' / ' + fmtInt(total) + ')');
    await nextTick();
  }
  return feats;
}

async function boot() {
  try {
    setProgress(2, 'Memuat daftar wilayah & batas administrasi…');

    const [desaRes, dkRes, adminRes] = await Promise.all([
      fetch(PATHS.desaList).then((r) => { if (!r.ok) throw new Error('desa_list.json tidak ditemukan'); return r.json(); }),
      fetch(PATHS.dkMap).then((r) => { if (!r.ok) throw new Error('parcels_dk.json tidak ditemukan'); return r.json(); }),
      fetch(PATHS.admin).then((r) => { if (!r.ok) throw new Error('admin_batas.geojson tidak ditemukan'); return r.json(); })
    ]);

    populateDesaDropdown(desaRes);
    dkMap = (dkRes && dkRes.map) ? dkRes.map : {};

    const fmt = new ol.format.GeoJSON({
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    });
    adminSource.addFeatures(fmt.readFeatures(adminRes));

    setProgress(5, 'Mengunduh GeoJSON bidang tanah (31,6 MB)…');
    const rawFeatures = await loadWorkerParcels();

    const feats = await buildParcelFeatures(rawFeatures);
    setProgress(99, 'Menambahkan ' + fmtInt(feats.length) + ' bidang ke peta…');
    parcelSource.addFeatures(feats);

    let ext = parcelSource.getExtent();
    if (!ext || !isFinite(ext[0]) || !isFinite(ext[3])) {
      ext = ol.proj.transformExtent(GARUT_EXTENT_4326, 'EPSG:4326', 'EPSG:3857');
    }
    initialExtent = ext;
    map.getView().fit(initialExtent, { padding: [36, 36, 36, 36], maxZoom: 14 });

    updateStats();
    uiReady = true;

    setProgress(100, 'Selesai!');
    await new Promise((r) => setTimeout(r, 250));
    const loading = $('loading');
    if (loading) loading.style.display = 'none';

    if (isMobile()) toggleSidebar(false);
  } catch (err) {
    loadFail(err.message || String(err));
  }
}

/* ---------- Ikatan antarmuka ---------- */
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => setClusterFilter(btn.dataset.cluster, btn));
});

document.querySelectorAll('.legend-item').forEach((item) => {
  const activate = () => setClusterFilter(item.dataset.cluster);
  item.addEventListener('click', activate);
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
  });
});

const adminSelect = $('admin-select');
if (adminSelect) adminSelect.addEventListener('change', () => setAdminFilter(adminSelect.value));

const adminToggle = $('toggle-admin-layer');
if (adminToggle) adminToggle.addEventListener('change', () => adminLayer.setVisible(adminToggle.checked));

document.querySelectorAll('.basemap-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.basemap-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    osmLayer.setVisible(btn.dataset.basemap === 'osm');
    satLayer.setVisible(btn.dataset.basemap === 'sat');
  });
});

/* ---------- Mulai ---------- */
boot();
