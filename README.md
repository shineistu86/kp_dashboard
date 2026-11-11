# KP Dashboard — Peta Segmentasi Morfometri Bidang Tanah (OpenLayers)

Dashboard web interaktif untuk visualisasi hasil **K-Means Clustering (K=2)** atas
**49.994 bidang tanah SAPADA** di Kabupaten Garut, dibangun dengan **OpenLayers 10**.

Sinkron dengan: *LAPORAN KERJA PRAKTIK 2307016 revisi p5 — 12 11 2026*
(Cluster 0 = 41.244 bidang / 82,5% — biru, reguler & kompak;
Cluster 1 = 8.750 bidang / 17,5% — oranye, kompleks & memanjang).

## Struktur folder

```
kp_dashboard/              (root repo)
├─ index.html              Antarmuka dashboard (header, filter, peta, panel, footer)
├─ hasil_clustering_polygon_v9.geojson   49.994 poligon asli (31,6 MB)
├─ admin_batas.geojson     Batas 442 desa/kelurahan Garut
├─ assets/
│  ├─ css/style.css        Tema gelap responsif (desktop & mobile)
│  └─ js/
│     ├─ app.js            Peta OpenLayers, filter, interaksi, statistik live
│     └─ worker.js         Web Worker: unduh + parse GeoJSON 31,6 MB (anti-freeze)
├─ data/
│  ├─ parcels_dk.json      Lookup polygon_id → kode desa (hasil spatial join)
│  └─ desa_list.json       Daftar desa aktif + jumlah bidang per cluster
├─ tools/
│  └─ prep_data.py         (Jalankan sekali) bangun data/ dari CSV & batas admin
└─ README.md
```

File data geojson berada di root repo dan dibaca langsung oleh dashboard.

## Menjalankan secara lokal

Dashboard memuat file via `fetch`, sehingga **tidak bisa dibuka langsung dengan
double-click** (protokol `file://` memblokir fetch). Gunakan server lokal:

```powershell
cd E:\KP\kp_dashboard
python -m http.server 8000
```

Lalu buka browser: **http://localhost:8000/**

## Regenerasi data desa (opsional)

Hanya perlu jika file sumber berubah:

```powershell
cd E:\KP\peta_segmentasi_bapenda\kp_dasboard
python tools\prep_data.py
```

Skrip melakukan spatial join centroid (dari `hasil_clustering_polygon_v9.csv`)
terhadap 442 polygon batas desa (`admin_batas.geojson`) menggunakan
Shapely STRtree. Hasil verifikasi terakhir:
**49.980/49.994 bidang cocok (99,97%)** — konsisten dengan laporan integrasi
(49.979/49.994), selisih wajar karena centroid dihitung pada proyeksi metrik UTM.

## Deployment ke Vercel

1. Repo: `https://github.com/shineistu86/kp_dashboard` — file geojson (±32 MB)
   **ikut ter-commit** (wajib, karena Vercel melayankan file dari repo; masih
   di bawah ambang GitHub 100 MB/file).
2. Push ke `main`; hosting statis, tanpa build step.
3. Dashboard online di root: `https://<proyek>.vercel.app/`
   Vercel mengompres otomatis (gzip/brotli) → transfer geojson ±5–6 MB.

## Fitur

- 49.994 poligon asli (presisi penuh) via `VectorImageLayer` + Web Worker
- Basemap ganda: **Peta OSM** & **Citra Satelit** (Esri, tanpa API key)
- Filter **cluster** (Semua / Cluster 0 / Cluster 1) real-time tanpa rebuild layer
- Filter **desa/kelurahan** (131 desa aktif) + sorotan batas & auto-zoom
- Tooltip hover, klik → detail morfometri lengkap (luas, compactness,
  elongation, solidity, jumlah vertex, angle_std, edge_cv, kode desa)
- Statistik **live dihitung dari data** (header, legenda, footer)
- Empty state, tombol coba lagi, responsif mobile (panel drawer)

## Catatan sinkronisasi angka

| Sumber | Nilai |
|---|---|
| Laporan KP (Tabel 4.4) | C0 = 41.244 (82,5%) · C1 = 8.750 (17,5%) · Silhouette 0,5903 |
| Data GeoJSON (live)   | C0 = 41.244 (82,5%) · C1 = 8.750 (17,5%) — identik |
| Join desa (dashboard) | 49.980 matched / 131 desa (metodologi centroid UTM) |
| Laporan integrasi lama| 49.979 matched / 134 desa (centroid EPSG:4326) |
