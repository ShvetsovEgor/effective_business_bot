"""Конкуренты рядом с точкой из API Поиска по организациям Яндекса.

Запрос идёт в прямоугольник вокруг точки с `rspn=1`, затем организации
отсекаются по расстоянию. Ответ API — лучшие совпадения запроса, не полный
каталог. Результаты держатся в памяти процесса и на диск не пишутся.
"""

from __future__ import annotations

import json
import math
import os
import threading
import urllib.parse
import urllib.request
from collections import Counter

from envfile import load_env

SEARCH_URL = "https://search-maps.yandex.ru/v1/"

_cache: dict[tuple, dict] = {}
_cache_lock = threading.Lock()


def api_key() -> str:
    load_env()
    key = os.environ.get("API_ORG_SEARCH_YANDEX", "").strip()
    if not key:
        raise RuntimeError("В .env нет API_ORG_SEARCH_YANDEX")
    return key


def search_page(text: str, bbox: str, results: int = 50, skip: int = 0) -> dict:
    params = urllib.parse.urlencode(
        {
            "apikey": api_key(),
            "text": text,
            "type": "biz",
            "lang": "ru_RU",
            "bbox": bbox,
            "rspn": "1",
            "results": str(results),
            "skip": str(skip),
        }
    )
    request = urllib.request.Request(
        SEARCH_URL + "?" + params,
        headers={
            "User-Agent": "effective-business-bot/0.2",
            # Ключ в кабинете Яндекса ограничен сайтом yandex.ru.
            "Referer": "https://yandex.ru/",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def normalize(feature: dict) -> dict | None:
    props = feature.get("properties") or {}
    meta = props.get("CompanyMetaData") or {}
    coordinates = (feature.get("geometry") or {}).get("coordinates") or []
    if len(coordinates) < 2 or not meta.get("id"):
        return None
    address = meta.get("Address") or {}
    hours = meta.get("Hours") or {}
    availabilities = []
    for item in hours.get("Availabilities") or []:
        availabilities.append(
            {
                "days": [key for key in item if key not in {"Intervals", "TwentyFourHours"}],
                "twenty_four_hours": bool(item.get("TwentyFourHours")),
                "intervals": [
                    {"from": interval.get("from") or "", "to": interval.get("to") or ""}
                    for interval in item.get("Intervals") or []
                ],
            }
        )
    return {
        "id": str(meta["id"]),
        "name": meta.get("name") or props.get("name") or "Без названия",
        "description": props.get("description") or "",
        "address": meta.get("address") or address.get("formatted") or "",
        "categories": [
            {"class": item.get("class") or "", "name": item.get("name") or ""}
            for item in meta.get("Categories") or []
        ],
        "phones": [item.get("formatted") for item in meta.get("Phones") or [] if item.get("formatted")],
        "hours": {"text": hours.get("text") or "", "availabilities": availabilities},
        "url": meta.get("url") or "",
        "features": [
            {"id": item.get("id") or "", "name": item.get("name") or "", "value": item.get("value")}
            for item in meta.get("Features") or []
        ],
        "lon": coordinates[0],
        "lat": coordinates[1],
    }


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(a))


def bbox_around(lat: float, lon: float, radius_m: float) -> str:
    dlat = radius_m / 111_320
    dlon = radius_m / (111_320 * math.cos(math.radians(lat)))
    return f"{lon - dlon:.6f},{lat - dlat:.6f}~{lon + dlon:.6f},{lat + dlat:.6f}"


def _cached_page(text: str, bbox: str) -> dict:
    key = (text, bbox)
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    payload = search_page(text, bbox)
    with _cache_lock:
        _cache[key] = payload
    return payload


def around(queries: list[str], lat: float, lon: float, radius_m: float, category: str = "") -> list[dict]:
    bbox = bbox_around(lat, lon, radius_m)
    merged: dict[str, dict] = {}
    for text in queries:
        for feature in _cached_page(text, bbox).get("features") or []:
            org = normalize(feature)
            if org is None:
                continue
            distance = distance_m(lat, lon, org["lat"], org["lon"])
            if distance > radius_m or not is_direct(org, category, queries):
                continue
            current = merged.get(org["id"])
            if current is None:
                org["distance_m"] = round(distance)
                org["queries"] = [text]
                merged[org["id"]] = org
            elif text not in current["queries"]:
                current["queries"].append(text)
    return sorted(merged.values(), key=lambda item: item["distance_m"])


RUBRICS = {
    "coffee": {"кофейня", "кофе с собой", "чай с собой"},
    "cafe": {"кафе", "столовая", "кофейня"},
    "restaurant": {"ресторан", "пиццерия"},
    "fast_food": {"быстрое питание", "столовая", "пиццерия"},
    "bakery": {"пекарня", "кондитерская"},
    "bar": {"бар", "паб", "бар, паб", "кальян-бар"},
}


def _stems(queries: list[str]) -> set[str]:
    return {word[:5] for query in queries for word in query.lower().split() if len(word) >= 4}


def is_direct(org: dict, category: str, queries: list[str]) -> bool:
    """Прямой конкурент: основная рубрика Яндекса совпадает с форматом бизнеса.

    Запрос вроде «кофе с собой» возвращает и супермаркеты, и фастфуд: у сетевого
    супермаркета тоже бывает рубрика «Кофе с собой», но основная — «Супермаркет».
    Поэтому сверяется только первая рубрика карточки.
    """
    primary = next((item["name"].strip().lower() for item in org["categories"] if item["name"]), "")
    if not primary:
        return False
    if primary in RUBRICS.get(category, set()):
        return True
    return any(stem in primary for stem in _stems(queries))


def _minutes(clock: str) -> int | None:
    parts = clock.split(":")
    if len(parts) < 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return None
    return int(parts[0]) * 60 + int(parts[1])


def working_span(org: dict) -> tuple[int, int] | None:
    opens, closes = [], []
    for block in org["hours"]["availabilities"]:
        if block["twenty_four_hours"]:
            return 0, 24 * 60
        for interval in block["intervals"]:
            start, end = _minutes(interval["from"]), _minutes(interval["to"])
            if start is None or end is None:
                continue
            if end <= start:
                end += 24 * 60
            opens.append(start)
            closes.append(end)
    if not opens:
        return None
    return min(opens), max(closes)


def chain_names(groups: list[list[dict]]) -> set[str]:
    ids: dict[str, set[str]] = {}
    for orgs in groups:
        for org in orgs:
            ids.setdefault(org["name"].strip().lower(), set()).add(org["id"])
    return {name for name, found in ids.items() if len(found) >= 2}


def summarize(orgs: list[dict], radius_m: int, chains: set[str], peak_hours: str) -> dict:
    near = [org for org in orgs if org["distance_m"] <= 300]
    spans = [span for span in (working_span(org) for org in orgs) if span]
    late = sum(1 for _, close in spans if close >= 22 * 60)
    early = sum(1 for start, _ in spans if start <= 8 * 60)
    chain_orgs = [org for org in orgs if org["name"].strip().lower() in chains]
    categories = Counter(
        category["name"] for org in orgs for category in org["categories"] if category["name"]
    )
    notes = []
    if not orgs:
        notes.append(f"В радиусе {radius_m} м Яндекс не нашёл организаций по запросам конкурентов.")
    if chain_orgs:
        names = sorted({org["name"] for org in chain_orgs})
        notes.append(f"Сетевые игроки рядом: {', '.join(names[:4])}.")
    if spans and peak_hours in {"evening", "late"} and late < len(spans) / 2:
        notes.append("Большинство конкурентов закрываются до 22:00: вечерний формат менее занят.")
    if spans and peak_hours == "morning" and early < len(spans) / 2:
        notes.append("Большинство конкурентов открываются после 8:00: утренний поток менее занят.")
    if orgs and sum(1 for org in orgs if org["url"]) < len(orgs) / 2:
        notes.append("У большинства конкурентов нет сайта в карточке.")
    return {
        "radius_m": radius_m,
        "count": len(orgs),
        "within_300m": len(near),
        "nearest_m": orgs[0]["distance_m"] if orgs else None,
        "chains_nearby": len(chain_orgs),
        "open_late": late,
        "open_early": early,
        "with_hours": len(spans),
        "top_categories": [name for name, _ in categories.most_common(4)],
        "notes": notes,
    }
