# -*- coding: utf-8 -*-
"""
prep_data.py — Persiapan data lookup desa/kelurahan untuk dashboard kp_dasboard.

Menggabungkan (spatial join) titik pusat (centroid) 49.994 bidang tanah dari
hasil_clustering_polygon_v9.csv dengan 442 polygon batas administrasi dari
admin_batas.geojson, menghasilkan data/parcels_dk.json berisi mapping
polygon_id -> kode desa/kelurahan.

File sumber TIDAK diubah sama sekali (geojson asli tetap utuh).

Metodologi identik dengan process_and_link_data.py (spatial join berbasis
centroid), sesuai laporan integrasi batas admin: 49.979/49.994 (99,97%) cocok.

Jalankan dari folder kp_dasboard:
    python tools/prep_data.py
"""

import csv
import json
import os
import sys
from datetime import datetime, timezone

try:
    from shapely.geometry import shape, Point
    from shapely.strtree import STRtree
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Pada repo standalone ini, admin_batas.geojson ada di root repo.
# CSV sumber tidak di-commit (ukuran); salin ke root repo bila regenerasi.
CSV_PATH = os.path.join(BASE, "hasil_clustering_polygon_v9.csv")
ADMIN_PATH = os.path.join(BASE, "admin_batas.geojson")
OUT_PATH = os.path.join(BASE, "data", "parcels_dk.json")


def load_admin():
    with open(ADMIN_PATH, "r", encoding="utf-8") as f:
        gj = json.load(f)
    feats = gj["features"]
    print(f"Batas admin dimuat : {len(feats)} desa/kelurahan")
    return feats


def load_centroids():
    rows = []
    with open(CSV_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            try:
                lon = float(r["centroid_lon"])
                lat = float(r["centroid_lat"])
            except (TypeError, ValueError):
                continue
            rows.append((int(r["polygon_id"]), lon, lat, int(r["cluster"])))
    print(f"Centroid bidang    : {len(rows)} polygon")
    return rows


def join_shapely(admin_feats, points):
    geoms = [shape(ft["geometry"]) for ft in admin_feats]
    dk_ids = [ft["properties"]["dk_id"] for ft in admin_feats]
    tree = STRtree(geoms)
    mapping = {}
    unmatched = []
    for pid, lon, lat, _cluster in points:
        p = Point(lon, lat)
        hit = None
        for idx in tree.query(p):
            if geoms[int(idx)].covers(p):
                hit = dk_ids[int(idx)]
                break
        if hit is not None:
            mapping[pid] = hit
        else:
            unmatched.append(pid)
    return mapping, unmatched


def point_in_ring(lon, lat, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            xint = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < xint:
                inside = not inside
        j = i
    return inside


def join_pure_python(admin_feats, points):
    prepped = []
    for ft in admin_feats:
        g = ft["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        rings_flat = []
        xmin = ymin = 1e18
        xmax = ymax = -1e18
        for poly in polys:
            flat = []
            for ring in poly:
                flat.append(ring)
                for x, y in ring:
                    xmin = min(xmin, x); xmax = max(xmax, x)
                    ymin = min(ymin, y); ymax = max(ymax, y)
            rings_flat.append(flat)
        prepped.append((ft["properties"]["dk_id"], rings_flat, (xmin, ymin, xmax, ymax)))

    mapping = {}
    unmatched = []
    for pid, lon, lat, _cluster in points:
        hit = None
        for dk_id, polys, (xmin, ymin, xmax, ymax) in prepped:
            if not (xmin <= lon <= xmax and ymin <= lat <= ymax):
                continue
            for poly in polys:
                crossings = 0
                for ring in poly:
                    if point_in_ring(lon, lat, ring):
                        crossings += 1
                if crossings % 2 == 1:
                    hit = dk_id
                    break
            if hit is not None:
                break
        if hit is not None:
            mapping[pid] = hit
        else:
            unmatched.append(pid)
    return mapping, unmatched


def main():
    print("=" * 62)
    print("PREP DATA kp_dasboard — spatial join centroid x batas desa")
    print("=" * 62)

    for p, label in [(CSV_PATH, "CSV centroid"), (ADMIN_PATH, "GeoJSON admin")]:
        if not os.path.exists(p):
            sys.exit(f"ERROR: {label} tidak ditemukan: {p}")

    admin_feats = load_admin()
    points = load_centroids()

    print(f"Mesin join        : {'Shapely STRtree' if HAS_SHAPELY else 'pure-Python (ray casting)'}")
    if HAS_SHAPELY:
        mapping, unmatched = join_shapely(admin_feats, points)
    else:
        mapping, unmatched = join_pure_python(admin_feats, points)

    matched = len(mapping)
    total = len(points)
    desa_count = len(set(mapping.values()))

    out = {
        "_meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "engine": "shapely-STRtree" if HAS_SHAPELY else "pure-python",
            "total_parcels": total,
            "matched": matched,
            "matched_pct": round(matched / total * 100, 3),
            "unmatched": len(unmatched),
            "desa_count": desa_count,
            "unmatched_ids": unmatched[:50],
        },
        "map": {str(k): v for k, v in sorted(mapping.items())},
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"Output            : {OUT_PATH} ({size_kb:,.0f} KB)")

    desa_stats = {}
    for pid, _lon, _lat, cluster in points:
        dk = mapping.get(pid)
        if dk is None:
            continue
        s = desa_stats.setdefault(dk, {"total": 0, "c0": 0, "c1": 0})
        s["total"] += 1
        s["c0" if cluster == 0 else "c1"] += 1

    desa_list = [
        {"id": dk, "total": s["total"], "c0": s["c0"], "c1": s["c1"]}
        for dk, s in sorted(desa_stats.items())
    ]
    desa_list_path = os.path.join(BASE, "data", "desa_list.json")
    with open(desa_list_path, "w", encoding="utf-8") as f:
        json.dump(desa_list, f, separators=(",", ":"), ensure_ascii=False)
    print(f"Output            : {desa_list_path} ({os.path.getsize(desa_list_path) / 1024:,.1f} KB, {len(desa_list)} desa)")

    print("-" * 62)
    print(f"Cocok (matched)   : {matched}/{total} ({matched / total * 100:.2f}%)")
    print(f"  referensi laporan integrasi: 49.979/49.994 (99,97%)")
    print(f"Desa tercakup     : {desa_count}")
    print(f"Tidak cocok       : {len(unmatched)} polygon {unmatched[:10] if unmatched else ''}")
    print(f"Output            : {OUT_PATH} ({size_kb:,.0f} KB)")
    print("SELESAI — file GeoJSON asli tidak disentuh.")


if __name__ == "__main__":
    main()
