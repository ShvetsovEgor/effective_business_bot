"""Общепит из OpenStreetMap: имя, адрес и координаты точки.

Запуск из корня проекта:

    python -m osm_food --h3-res 9

Пишет в каталог --out (по умолчанию data/out): places.geojson, hexes.geojson,
places.csv и map.html. Адрес есть только если в OSM заполнены улица и дом.
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

import requests

from osm_food.output import write_outputs

log = logging.getLogger(__name__)

OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
AMENITIES = "cafe|restaurant|bar|fast_food|pub|food_court"
# south, west, north, east
CITIES = {
    "kazan": ("Казань", (55.60, 48.82, 55.92, 49.38), 11),
}


def query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    return f"""
[out:json][timeout:120];
(
  node["amenity"~"^({AMENITIES})$"]({south},{west},{north},{east});
  way["amenity"~"^({AMENITIES})$"]({south},{west},{north},{east});
);
out center tags;
"""


def fetch(session: requests.Session, bbox: tuple[float, float, float, float]) -> dict:
    statement = query(bbox)
    last_error: Exception | None = None
    for url in OVERPASS_URLS:
        for attempt in range(1, 4):
            try:
                response = session.post(url, data={"data": statement}, timeout=180)
                if response.status_code in {429, 502, 504}:
                    time.sleep(5 * attempt)
                    continue
                response.raise_for_status()
                return response.json()
            except requests.RequestException as error:
                last_error = error
                log.warning("%s попытка %s: %s", url, attempt, error)
                time.sleep(3 * attempt)
    raise RuntimeError(f"Overpass не ответил: {last_error}")


def address_of(tags: dict, city_name: str) -> tuple[str, str]:
    city = tags.get("addr:city") or city_name
    street = tags.get("addr:street") or ""
    house = tags.get("addr:housenumber") or ""
    line = " ".join(part for part in (street, house) if part)
    if street and house:
        return f"{city}, {line}", "building"
    if street:
        return f"{city}, {line}", "street"
    return city, "city"


def to_records(payload: dict, city_name: str) -> list[dict]:
    records = []
    for element in payload.get("elements") or []:
        tags = element.get("tags") or {}
        if element["type"] == "node":
            lat, lon = element.get("lat"), element.get("lon")
        else:
            center = element.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue
        address, precision = address_of(tags, city_name)
        records.append(
            {
                "id": f"{element['type']}/{element['id']}",
                "name": tags.get("name") or tags.get("name:ru") or "без названия",
                "address": address,
                "lat": lat,
                "lon": lon,
                "kind": tags.get("amenity") or "",
                "precision": precision,
            }
        )
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Общепит из OpenStreetMap")
    parser.add_argument("--city", choices=tuple(CITIES), default="kazan")
    parser.add_argument("--h3-res", type=int, default=10)
    parser.add_argument("--out", default="data/out")
    args = parser.parse_args()
    city_name, bbox, zoom = CITIES[args.city]
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    session = requests.Session()
    session.headers["User-Agent"] = "effective-business-bot/0.1 (food layer)"
    payload = fetch(session, bbox)
    records = to_records(payload, city_name)
    named = sum(1 for row in records if row["name"] != "без названия")
    with_house = sum(1 for row in records if row["precision"] == "building")
    log.info("Точек OSM: %s, с названием: %s, с домом: %s", len(records), named, with_house)
    if not records:
        raise SystemExit(2)
    write_outputs(records, Path(args.out), args.h3_res, zoom=zoom)


if __name__ == "__main__":
    main()
