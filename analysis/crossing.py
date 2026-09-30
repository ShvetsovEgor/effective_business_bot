"""Ближайшее пересечение улиц по OpenStreetMap.

Новости почти никогда не пишут про номер дома, поэтому нейропоиск получает
перекрёсток этой улицы, а не точный адрес объявления.
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time

import requests

log = logging.getLogger(__name__)

OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
RADIUS_M = 600
_HOUSE = re.compile(r"^\d+[а-яa-z]?(?:к\d+)?(?:/\d+)?$", re.IGNORECASE)
_lock = threading.Lock()
_cache: dict[tuple[float, float], list[tuple[float, list[str]]]] = {}
_geo_cache: dict[str, tuple[float, float, str] | None] = {}
_last_geocode = 0.0


def street_name(address: str) -> str:
    parts = [part.strip() for part in address.split(",") if part.strip()]
    if parts and parts[0].casefold() in {"казань", "г. казань", "город казань"}:
        parts = parts[1:]
    if parts and _HOUSE.match(parts[-1].replace(" ", "")):
        parts = parts[:-1]
    return parts[-1] if parts else ""


def place_for_news(lat: float, lon: float, address: str, district: str) -> str:
    street = street_name(address)
    area = f"{district} район, Казань" if district else "Казань"
    located = _geocode(address)
    if located:
        geo_lat, geo_lon, geo_area = located
        crossing = _describe(geo_lat, geo_lon, street, allow_other=True)
        if crossing:
            return f"{crossing}, {geo_area or area}"
        if street:
            return f"{street}, {geo_area or area}"
    crossing = _describe(lat, lon, street, allow_other=False)
    if crossing:
        return f"{crossing}, {area}"
    if street:
        return f"{street}, {area}"
    return f"{address}, {area}" if district else address


def _geocode(address: str) -> tuple[float, float, str] | None:
    query = address.strip()
    if "казань" not in query.casefold():
        query = f"{query}, Казань"
    key = query.casefold()
    global _last_geocode
    with _lock:
        if key in _geo_cache:
            return _geo_cache[key]
        wait = 1.1 - (time.time() - _last_geocode)
        if wait > 0:
            time.sleep(wait)
        found = _geocode_request(query)
        _last_geocode = time.time()
        _geo_cache[key] = found
        return found


def _geocode_request(query: str) -> tuple[float, float, str] | None:
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1, "addressdetails": 1},
            headers={"User-Agent": "effective-business-bot/0.2 (street crossing)"},
            timeout=15,
        )
        response.raise_for_status()
        rows = response.json()
    except (requests.RequestException, ValueError) as error:
        log.warning("Адрес не геокодирован %s: %s", query, error)
        return None
    if not rows:
        return None
    row = rows[0]
    details = row.get("address") or {}
    district = ""
    for value in details.values():
        text = str(value)
        if text.endswith("район"):
            district = text.removesuffix(" район")
            break
    area = f"{district} район, Казань" if district else "Казань"
    return float(row["lat"]), float(row["lon"]), area


def _describe(lat: float, lon: float, street: str, *, allow_other: bool) -> str | None:
    junctions = _junctions(lat, lon)
    if not junctions:
        return None
    return _pick(junctions, street) or (_pick(junctions, "") if allow_other else None)


def _junctions(lat: float, lon: float) -> list[tuple[float, list[str]]] | None:
    key = (round(lat, 4), round(lon, 4))
    with _lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    ways = _ways(lat, lon)
    if ways is None:
        return None
    found = _collect(lat, lon, ways)
    with _lock:
        _cache[key] = found
    return found


def _ways(lat: float, lon: float) -> list[dict] | None:
    query = (
        f"[out:json][timeout:20];"
        f'way(around:{RADIUS_M},{lat},{lon})["highway"]["name"];'
        "out geom;"
    )
    session = requests.Session()
    session.headers["User-Agent"] = "effective-business-bot/0.2 (street crossing)"
    last_error: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            response = session.post(url, data={"data": query}, timeout=15)
            response.raise_for_status()
            return response.json().get("elements") or []
        except (requests.RequestException, ValueError) as error:
            last_error = error
            log.warning("Перекрёсток, %s: %s", url, error)
    log.warning("Перекрёсток не найден, Overpass не ответил: %s", last_error)
    return None


def _collect(lat: float, lon: float, ways: list[dict]) -> list[tuple[float, list[str]]]:
    nodes: dict[tuple[float, float], dict] = {}
    for way in ways:
        name = ((way.get("tags") or {}).get("name") or "").strip()
        if not name or name.casefold().startswith("станция метро"):
            continue
        for point in way.get("geometry") or []:
            key = (round(point["lat"], 5), round(point["lon"], 5))
            node = nodes.setdefault(key, {"lat": point["lat"], "lon": point["lon"], "names": set()})
            node["names"].add(name)
    junctions = []
    for node in nodes.values():
        names = sorted(node["names"], key=str.casefold)
        if len(names) < 2:
            continue
        junctions.append((_meters(lat, lon, node["lat"], node["lon"]), names))
    return junctions


def _pick(junctions: list[tuple[float, list[str]]], street: str) -> str | None:
    wanted = street.casefold()
    chosen: tuple[float, list[str]] | None = None
    for distance, names in junctions:
        matches = wanted and any(name.casefold() == wanted for name in names)
        if wanted and not matches:
            continue
        if not wanted and chosen is not None and distance >= chosen[0]:
            continue
        if chosen is None or distance < chosen[0]:
            chosen = (distance, _ordered(names, wanted) if matches else names[:3])
    if chosen is None:
        return None
    names = chosen[1]
    if len(names) == 2:
        return f"пересечение: {names[0]} и {names[1]}"
    return "пересечение: " + ", ".join(names[:-1]) + " и " + names[-1]


def _ordered(names: list[str], wanted: str) -> list[str]:
    match = next(name for name in names if name.casefold() == wanted)
    rest = [name for name in names if name != match]
    return [match, *rest[:2]]


def _meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dy = (lat2 - lat1) * 111_320
    dx = (lon2 - lon1) * 111_320 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)
