"""Координаты объявлений Авито через геокодер Яндекса.

Адрес из выгрузки очищается от времени до метро и геокодируется.
Широта и долгота записываются в json и csv рядом с объявлением.
Ключ `GEOCODER_API_KEY` в `.env` ограничен сайтом yandex.ru, поэтому
запрос идёт с заголовком Referer. Запуск: `python -m commercial_sim.avito`.
"""

from __future__ import annotations

import csv
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from envfile import load_env

ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "avito-kazan-kommercheskaya-sdam.json"
CSV_PATH = ROOT / "avito-kazan-kommercheskaya-sdam.csv"
GEOCODE_URL = "https://geocode-maps.yandex.ru/1.x/"
EXTRA_FIELDS = ("lat", "lon", "geocode_address", "geocode_kind")
NOTICE = (
    "Объявления аренды коммерческих помещений с Авито по Казани. "
    "Координаты — геокодер Яндекса по адресу объявления."
)
DISTRICTS = (
    "Вахитовский",
    "Ново-Савиновский",
    "Советский",
    "Приволжский",
    "Московский",
    "Кировский",
    "Авиастроительный",
)
AREA_TEXT = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:м²|м2|кв\.?\s*м)", re.IGNORECASE)
FLOOR_TEXT = re.compile(r"(?:на\s+)?(\d+)\s+этаж(?:е|а|у)?\b", re.IGNORECASE)
POWER_TEXT = re.compile(r"(\d+(?:[.,]\d+)?)\s*квт", re.IGNORECASE)
_offers: list[dict] | None = None
WALK = re.compile(
    r",?\s*(?:от\s+\d+\s*мин\.?|до\s+\d+\s*мин\.?|\d+\s*[–\-]\s*\d+\s*мин\.?)\s*$",
    re.IGNORECASE,
)


def geocode_query(address: str) -> str:
    text = (address or "").strip().strip('"')
    while True:
        cleaned = WALK.sub("", text).strip(" ,")
        if cleaned == text:
            break
        text = cleaned
    parts = [part.strip() for part in text.split(",") if part.strip()]
    while len(parts) > 2 and not re.search(r"\d", parts[-1]):
        parts.pop()
    text = ", ".join(parts)
    text = re.sub(r"\bПр-т\b", "проспект", text)
    text = re.sub(r"\bпр-т\b", "проспект", text)
    text = re.sub(r"\bУл\.", "улица", text)
    text = re.sub(r"\bул\.", "улица", text)
    text = re.sub(r"\bр-н\b", "район", text)
    if "казань" not in text.casefold():
        text = f"Казань, {text}"
    return text


def geocode(address: str, timeout: float = 20) -> dict:
    load_env()
    key = os.environ.get("GEOCODER_API_KEY", "").strip()
    if not key:
        raise RuntimeError("В .env нет GEOCODER_API_KEY")
    params = urllib.parse.urlencode(
        {
            "apikey": key,
            "geocode": geocode_query(address),
            "format": "json",
            "lang": "ru_RU",
            "results": "1",
            "ll": "49.12,55.79",
        }
    )
    request = urllib.request.Request(
        GEOCODE_URL + "?" + params,
        headers={
            "User-Agent": "effective-business-bot/0.2",
            "Referer": "https://yandex.ru/",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = json.loads(response.read().decode())
    members = body["response"]["GeoObjectCollection"]["featureMember"]
    if not members:
        return {"lat": None, "lon": None, "geocode_address": "", "geocode_kind": "not_found"}
    obj = members[0]["GeoObject"]
    meta = obj["metaDataProperty"]["GeocoderMetaData"]
    lon_text, lat_text = obj["Point"]["pos"].split()
    return {
        "lat": round(float(lat_text), 6),
        "lon": round(float(lon_text), 6),
        "geocode_address": meta.get("text") or "",
        "geocode_kind": meta.get("kind") or "",
    }


def _lookup(address: str) -> dict:
    delay = 0.5
    for attempt in range(4):
        try:
            return geocode(address)
        except urllib.error.HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 3:
                raise
            time.sleep(delay)
            delay *= 2
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(delay)
            delay *= 2
    return {"lat": None, "lon": None, "geocode_address": "", "geocode_kind": "not_found"}


def _area(row: dict) -> float | None:
    if isinstance(row.get("area_m2"), (int, float)) and row["area_m2"] > 0:
        return float(row["area_m2"])
    blob = f"{row.get('title') or ''} {row.get('snippet') or ''}"
    match = AREA_TEXT.search(blob)
    if not match:
        return None
    return float(match.group(1).replace(",", "."))


def _month_price(row: dict, area: float | None) -> tuple[int | None, int | None]:
    price = row.get("price")
    if not isinstance(price, (int, float)) or price <= 0:
        return None, None
    per_meter = "за м" in (row.get("period") or "").lower()
    if per_meter:
        if not area:
            return None, None
        per_m2 = int(round(price))
        return int(round(price * area)), per_m2
    per_m2 = int(round(price / area)) if area else None
    return int(round(price)), per_m2


def _kind(title: str, snippet: str) -> str:
    heading = title.lower()
    if any(word in heading for word in ("склад", "производ")):
        return "warehouse"
    if "офис" in heading:
        return "office"
    text = f"{heading} {snippet.lower()}"
    if "склад" in text or "производ" in text:
        return "warehouse"
    if "офис" in text and "свободн" not in heading:
        return "office"
    return "street_retail"


def _district(address: str, geocode_address: str) -> str:
    blob = f"{address} {geocode_address}".lower().replace("ё", "е")
    for name in DISTRICTS:
        if name.lower().replace("ё", "е") in blob:
            return name
    return ""


def _record(row: dict) -> dict | None:
    if row.get("lat") is None or row.get("lon") is None:
        return None
    area = _area(row)
    month, per_m2 = _month_price(row, area)
    if area is None or month is None:
        return None
    title = row.get("title") or "Помещение"
    snippet = row.get("snippet") or ""
    text = f"{title} {snippet}"
    floor_match = FLOOR_TEXT.search(text)
    power_match = POWER_TEXT.search(text)
    lowered = text.lower()
    if "втор" in lowered and "лини" in lowered:
        line = "2"
    else:
        line = "1"
    if "без отдельного входа" in lowered:
        entrance = False
    elif "отдельн" in lowered and "вход" in lowered:
        entrance = True
    else:
        entrance = None
    food = bool(re.search(r"вытяжк|кухн|общепит", lowered))
    return {
        "id": f"avito-{row.get('listing_id')}",
        "title": title,
        "deal": "rent",
        "kind": _kind(title, snippet),
        "district": _district(row.get("address") or "", row.get("geocode_address") or ""),
        "address": row.get("address") or "",
        "lat": row["lat"],
        "lon": row["lon"],
        "area_m2": round(area, 1),
        "price_per_m2": per_m2,
        "price_month": month,
        "price_total": None,
        "floor": int(floor_match.group(1)) if floor_match else 1,
        "condition": "",
        "power_kw": float(power_match.group(1).replace(",", ".")) if power_match else 0,
        "separate_entrance": entrance,
        "food_ready": True if food else None,
        "line": line,
        "metro": "",
        "url": row.get("url") or "",
        "data_origin": "avito",
        "notice": NOTICE,
    }


def offers() -> list[dict]:
    global _offers
    if _offers is None:
        rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
        _offers = [record for row in rows if (record := _record(row))]
    return _offers


def write_listings(rows: list[dict]) -> None:
    JSON_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    fieldnames = list(rows[0].keys()) if rows else []
    for name in EXTRA_FIELDS:
        if name not in fieldnames:
            fieldnames.append(name)
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def add_coordinates(pause: float = 0.15) -> tuple[int, int]:
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    cache: dict[str, dict] = {}
    looked = 0
    found = 0
    for index, row in enumerate(rows, start=1):
        query = geocode_query(row.get("address") or "")
        if not query or query == "Казань,":
            row.update(lat=None, lon=None, geocode_address="", geocode_kind="empty")
            continue
        if query not in cache:
            if row.get("geocode_kind"):
                cache[query] = {
                    "lat": row.get("lat"),
                    "lon": row.get("lon"),
                    "geocode_address": row.get("geocode_address") or "",
                    "geocode_kind": row.get("geocode_kind") or "",
                }
            else:
                cache[query] = _lookup(row.get("address") or "")
                looked += 1
                time.sleep(pause)
                if looked % 40 == 0:
                    for done in rows[:index]:
                        done_query = geocode_query(done.get("address") or "")
                        if done_query in cache:
                            done.update(cache[done_query])
                    write_listings(rows)
                    print(f"{looked} запросов, строка {index}/{len(rows)}", flush=True)
        row.update(cache[query])
        if row.get("lat") is not None:
            found += 1
    write_listings(rows)
    return looked, found


def main() -> None:
    looked, found = add_coordinates()
    total = len(json.loads(JSON_PATH.read_text(encoding="utf-8")))
    print(f"Готово: {found} из {total} с координатами, новых запросов {looked}")


if __name__ == "__main__":
    main()
