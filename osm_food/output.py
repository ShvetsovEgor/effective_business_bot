"""GeoJSON, CSV и карта точек общепита.

Координаты и названия приходят из OpenStreetMap. Сетка H3 только группирует
точки, это не измеренная проходимость.
"""

from __future__ import annotations

import csv
import json
import logging
from collections import defaultdict
from pathlib import Path

log = logging.getLogger(__name__)

POINT_FIELDS = ("id", "name", "address", "lat", "lon", "kind", "h3_index", "precision")


def to_cell(lat: float, lon: float, resolution: int) -> str:
    import h3

    if hasattr(h3, "latlng_to_cell"):
        return h3.latlng_to_cell(lat, lon, resolution)
    return h3.geo_to_h3(lat, lon, resolution)


def cell_ring(cell: str) -> list[list[float]]:
    import h3

    if hasattr(h3, "cell_to_boundary"):
        boundary = h3.cell_to_boundary(cell)
    else:
        boundary = h3.h3_to_geo_boundary(cell)
    ring = [[lon, lat] for lat, lon in boundary]
    ring.append(ring[0])
    return ring


def assign_h3(records: list[dict], resolution: int) -> None:
    for record in records:
        if record.get("lat") is None or record.get("lon") is None:
            record["h3_index"] = None
            continue
        record["h3_index"] = to_cell(float(record["lat"]), float(record["lon"]), resolution)


def hex_rows(records: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        if record.get("h3_index"):
            buckets[record["h3_index"]].append(record)
    rows = []
    for cell, items in buckets.items():
        kinds: dict[str, int] = defaultdict(int)
        for item in items:
            kinds[item.get("kind") or "unknown"] += 1
        rows.append(
            {
                "h3_index": cell,
                "places": len(items),
                "kinds": ", ".join(f"{name} {count}" for name, count in sorted(kinds.items())),
                "ring": cell_ring(cell),
            }
        )
    return rows


def write_outputs(records: list[dict], out_dir: Path, resolution: int, zoom: int = 11) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    assign_h3(records, resolution)
    point_features = []
    for record in records:
        geometry = None
        if record.get("lat") is not None and record.get("lon") is not None:
            geometry = {"type": "Point", "coordinates": [record["lon"], record["lat"]]}
        point_features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": {key: record.get(key) for key in POINT_FIELDS},
            }
        )
    hexes = hex_rows(records)
    hex_features = [
        {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [row["ring"]]},
            "properties": {key: row[key] for key in ("h3_index", "places", "kinds")},
        }
        for row in hexes
    ]
    (out_dir / "places.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": point_features}, ensure_ascii=False),
        encoding="utf-8",
    )
    (out_dir / "hexes.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": hex_features}, ensure_ascii=False),
        encoding="utf-8",
    )
    with (out_dir / "places.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=POINT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)
    _write_map(records, hex_features, out_dir / "map.html", zoom)
    log.info("Точек: %s, гексагонов: %s, каталог: %s", len(records), len(hexes), out_dir)


def _write_map(records: list[dict], hex_features: list[dict], path: Path, zoom: int) -> None:
    try:
        import folium
    except ImportError:
        log.info("folium не установлен, карта не собрана")
        return
    located = [row for row in records if row.get("lat") is not None]
    if not located:
        path.write_text("<p>Нет координат для карты.</p>", encoding="utf-8")
        return
    center_lat = sum(row["lat"] for row in located) / len(located)
    center_lon = sum(row["lon"] for row in located) / len(located)
    canvas = folium.Map(location=[center_lat, center_lon], zoom_start=zoom, tiles="OpenStreetMap")
    if hex_features:
        folium.GeoJson(
            {"type": "FeatureCollection", "features": hex_features},
            name="H3",
            tooltip=folium.GeoJsonTooltip(fields=["places", "kinds"]),
        ).add_to(canvas)
    for row in located:
        folium.CircleMarker(
            location=[row["lat"], row["lon"]],
            radius=4,
            popup=f"{row['name']}<br>{row.get('kind') or ''}<br>{row['address']}",
        ).add_to(canvas)
    canvas.save(path)
