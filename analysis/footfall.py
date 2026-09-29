"""Пешеходный поток Казани.

Виджет берёт суточные проходы из выгрузки Яндекс Геоаналитики
(`yandex-geoanalytics-hexes.json`): hex_id — ячейка H3 разрешения 7,
`pedestrian_traffic_day` — пешеходы в сутки. Ниже остаётся прежняя модель
по OpenStreetMap, её обновляет `python -m analysis.footfall`.

Модель пешеходного потока Казани по OpenStreetMap.

Это не замер пешеходов. Индекс складывается из объектов, которые притягивают
людей: входы в метро, остановки, пешеходные улицы, магазины, общепит, сервисы
и многоквартирные дома. Вес каждого слоя задан вручную, сумма раскладывается
по сетке H3 (res 9, ребро около 170 м) и сглаживается по соседям. Индекс —
перцентиль ячейки среди ячеек Казани: 0,9 значит людней 90 % города.

Все слои скачиваются одним запросом Overpass: отдельные запросы подряд
упираются в ограничение частоты. Данные кэшируются в
`data/cache/footfall_kazan.json`, обновление: `python -m analysis.footfall`.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import h3
import requests

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
CACHE_PATH = ROOT / "data" / "cache" / "footfall_kazan.json"
# south, west, north, east
BBOX = (55.70, 48.95, 55.90, 49.28)
RESOLUTION = 9
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
NOTICE = (
    "Проходимость — суточный пешеходный поток по гексагонам Яндекс Геоаналитики "
    "(сетка H3, разрешение 7). Поле ll в выгрузке — центр карты при сборе, "
    "координаты ячейки берутся из hex_id."
)
HEX_PATH = ROOT / "yandex-geoanalytics-hexes.json"
HEX_RESOLUTION = 7

LAYERS = {
    "metro": {"title": "метро", "weight": 40.0},
    "stop": {"title": "остановки", "weight": 6.0},
    "pedestrian": {"title": "пешеходные улицы", "weight": 12.0},
    "shop": {"title": "магазины", "weight": 1.5},
    "food": {"title": "общепит", "weight": 2.0},
    "service": {"title": "банки, аптеки, почта, клиники", "weight": 2.0},
    "apartments": {"title": "многоквартирные дома", "weight": 1.0},
}
FOOD_AMENITIES = {"cafe", "restaurant", "fast_food", "bar", "pub"}
SERVICE_AMENITIES = {"bank", "pharmacy", "post_office", "clinic"}
SELECTORS = (
    'node["railway"="subway_entrance"]',
    'node["station"="subway"]',
    'node["highway"="bus_stop"]',
    'node["public_transport"="platform"]',
    'way["highway"="pedestrian"]',
    'node["shop"]',
    'node["amenity"~"^(cafe|restaurant|fast_food|bar|pub|bank|pharmacy|post_office|clinic)$"]',
    'way["building"="apartments"]',
)

# Приблизительные точки станций на случай, если Overpass не ответил.
METRO_FALLBACK = (
    ("Авиастроительная", 55.8295, 49.0816),
    ("Северный вокзал", 55.8413, 49.0818),
    ("Яшьлек", 55.8277, 49.0829),
    ("Козья слобода", 55.8176, 49.0973),
    ("Кремлёвская", 55.7956, 49.1057),
    ("Площадь Тукая", 55.7872, 49.1224),
    ("Суконная слобода", 55.7771, 49.1428),
    ("Аметьево", 55.7651, 49.1686),
    ("Горки", 55.7610, 49.1897),
    ("Проспект Победы", 55.7500, 49.2079),
    ("Дубравная", 55.7432, 49.2194),
)


def _query() -> str:
    south, west, north, east = BBOX
    body = "".join(f"{selector}({south},{west},{north},{east});" for selector in SELECTORS)
    return f"[out:json][timeout:300];({body});out center qt;"


def classify(element: dict) -> str | None:
    tags = element.get("tags") or {}
    if tags.get("railway") == "subway_entrance" or tags.get("station") == "subway":
        return "metro"
    if tags.get("highway") == "bus_stop" or tags.get("public_transport") == "platform":
        return "stop"
    if element.get("type") == "way" and tags.get("highway") == "pedestrian":
        return "pedestrian"
    if element.get("type") == "way" and tags.get("building") == "apartments":
        return "apartments"
    if tags.get("shop"):
        return "shop"
    amenity = tags.get("amenity")
    if amenity in FOOD_AMENITIES:
        return "food"
    if amenity in SERVICE_AMENITIES:
        return "service"
    return None


def split_layers(payload: dict) -> dict[str, list[list[float]]]:
    layers: dict[str, list[list[float]]] = {name: [] for name in LAYERS}
    for element in payload.get("elements") or []:
        layer = classify(element)
        if layer is None:
            continue
        if "lat" in element and "lon" in element:
            layers[layer].append([element["lat"], element["lon"]])
        elif element.get("center"):
            layers[layer].append([element["center"]["lat"], element["center"]["lon"]])
    return layers


def fetch_layers() -> dict[str, list[list[float]]]:
    session = requests.Session()
    session.headers["User-Agent"] = "effective-business-bot/0.2 (footfall model)"
    last_error: Exception | None = None
    for url in OVERPASS_URLS:
        for attempt in range(1, 3):
            try:
                response = session.post(url, data={"data": _query()}, timeout=330)
                if response.status_code in {429, 502, 503, 504}:
                    last_error = RuntimeError(f"HTTP {response.status_code}")
                    log.warning("%s попытка %s: HTTP %s", url, attempt, response.status_code)
                    time.sleep(10 * attempt)
                    continue
                response.raise_for_status()
                return split_layers(response.json())
            except (requests.RequestException, ValueError) as error:
                last_error = error
                log.warning("%s попытка %s: %s", url, attempt, error)
                time.sleep(3 * attempt)
    raise RuntimeError(f"Overpass не ответил: {last_error}")


def load_layers(refresh: bool = False) -> dict:
    if CACHE_PATH.exists() and not refresh:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    try:
        layers = fetch_layers()
        missing = [name for name, points in layers.items() if not points]
    except RuntimeError as error:
        log.warning("OSM недоступен, остаются станции метро: %s", error)
        layers = {}
        missing = [name for name in LAYERS if name != "metro"]
    if not layers.get("metro"):
        layers["metro"] = [[lat, lon] for _, lat, lon in METRO_FALLBACK]
    data = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M"),
        "bbox": BBOX,
        "layers": layers,
        "missing": missing,
    }
    if len(missing) < len(LAYERS) - 1:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(data), encoding="utf-8")
    return data


@dataclass
class FootfallModel:
    index: dict[str, float]
    counts: dict[str, dict[str, int]]
    generated_at: str
    missing: list[str]

    def index_at(self, lat: float, lon: float) -> float:
        return self.index.get(h3.latlng_to_cell(lat, lon, RESOLUTION), 0.0)

    def nearby(self, lat: float, lon: float, rings: int = 2) -> dict[str, int]:
        total: dict[str, int] = defaultdict(int)
        for cell in h3.grid_disk(h3.latlng_to_cell(lat, lon, RESOLUTION), rings):
            for layer, count in self.counts.get(cell, {}).items():
                total[layer] += count
        return {LAYERS[layer]["title"]: count for layer, count in total.items()}

    def heat_points(self, floor: float = 0.25) -> list[list[float]]:
        """Точки тепловой карты. Интенсивность — квадрат индекса, чтобы выделить людные места."""
        points = []
        for cell, value in self.index.items():
            if value < floor:
                continue
            lat, lon = h3.cell_to_latlng(cell)
            points.append([round(lat, 5), round(lon, 5), round(value**2, 3)])
        return points


def build_model(data: dict) -> FootfallModel:
    raw: dict[str, float] = defaultdict(float)
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for name, points in data["layers"].items():
        weight = LAYERS[name]["weight"]
        for lat, lon in points:
            cell = h3.latlng_to_cell(lat, lon, RESOLUTION)
            raw[cell] += weight
            counts[cell][name] += 1
    cells: set[str] = set()
    for cell in raw:
        cells.update(h3.grid_disk(cell, 1))
    smoothed = {}
    for cell in cells:
        ring = [item for item in h3.grid_disk(cell, 1) if item != cell]
        smoothed[cell] = raw.get(cell, 0.0) + 0.5 * sum(raw.get(item, 0.0) for item in ring) / 6
    ordered = sorted((value, cell) for cell, value in smoothed.items() if value > 0)
    last = max(1, len(ordered) - 1)
    index = {cell: position / last for position, (_, cell) in enumerate(ordered)}
    return FootfallModel(
        index=index,
        counts={cell: dict(layer_counts) for cell, layer_counts in counts.items()},
        generated_at=data.get("generated_at", ""),
        missing=list(data.get("missing") or []),
    )


@dataclass
class HexFlow:
    """Пешеходный поток по ячейкам H3 из выгрузки Яндекс Геоаналитики."""

    cells: dict[str, dict]
    index: dict[str, float]
    generated_at: str

    def _cell(self, lat: float, lon: float) -> str:
        return h3.latlng_to_cell(lat, lon, HEX_RESOLUTION)

    def index_at(self, lat: float, lon: float) -> float:
        return self.index.get(self._cell(lat, lon), 0.0)

    def pedestrians_at(self, lat: float, lon: float) -> int:
        item = self.cells.get(self._cell(lat, lon))
        return int(item["pedestrians"]) if item else 0

    def nearby(self, lat: float, lon: float, rings: int = 0) -> dict[str, int]:
        item = self.cells.get(self._cell(lat, lon))
        if not item:
            return {}
        found = {"пешеходы в сутки": item["pedestrians"]}
        if item["auto"]:
            found["авто в сутки"] = item["auto"]
        if item["population"]:
            found["население"] = item["population"]
        return found

    def _peak(self) -> int:
        return max((item["pedestrians"] for item in self.cells.values()), default=1) or 1

    def heat_points(self) -> list[list[float]]:
        """Центры гексагонов. Интенсивность — корень доли от самого людного."""
        peak = self._peak()
        points = []
        for item in self.cells.values():
            if item["pedestrians"] <= 0:
                continue
            intensity = (item["pedestrians"] / peak) ** 0.5
            points.append([item["lat"], item["lon"], round(intensity, 3)])
        return points

    def heat_hexes(self) -> list[dict]:
        """Границы ячеек для заливки на карте. Цвет задаёт клиент по intensity."""
        peak = self._peak()
        hexes = []
        for cell, item in self.cells.items():
            if item["pedestrians"] <= 0:
                continue
            boundary = [[round(lat, 5), round(lon, 5)] for lat, lon in h3.cell_to_boundary(cell)]
            hexes.append({
                "pedestrians": item["pedestrians"],
                "intensity": round((item["pedestrians"] / peak) ** 0.5, 3),
                "boundary": boundary,
            })
        return hexes


def load_hexes(path: Path | None = None) -> HexFlow:
    source = path or HEX_PATH
    raw = json.loads(source.read_text(encoding="utf-8"))
    cells: dict[str, dict] = {}
    scraped = ""
    for row in raw:
        cell = h3.int_to_str(int(row["hex_id"]))
        if not h3.is_valid_cell(cell):
            continue
        lat, lon = h3.cell_to_latlng(cell)
        pedestrians = int(row.get("pedestrian_traffic_day") or 0)
        cells[cell] = {
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "pedestrians": pedestrians,
            "auto": int(row.get("auto_traffic_day") or 0),
            "population": int(row["population"]) if row.get("population") else 0,
        }
        scraped = max(scraped, str(row.get("scraped_at") or ""))
    ordered = sorted(cells, key=lambda cell: cells[cell]["pedestrians"])
    last = max(1, len(ordered) - 1)
    index = {cell: position / last for position, cell in enumerate(ordered)}
    return HexFlow(cells=cells, index=index, generated_at=scraped[:10])


_hex: HexFlow | None = None
_hex_error: str | None = None
_lock = threading.Lock()


def get_model() -> HexFlow:
    global _hex, _hex_error
    with _lock:
        if _hex is None:
            try:
                _hex = load_hexes()
                _hex_error = None
            except Exception as error:
                _hex_error = str(error)
                raise
        return _hex


def status() -> dict:
    try:
        model = get_model()
    except Exception as error:
        return {"status": "error", "error": str(error)}
    return {
        "status": "ready",
        "points": model.heat_points(),
        "hexes": model.heat_hexes(),
        "generated_at": model.generated_at,
        "missing": [],
        "notice": NOTICE,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    data = load_layers(refresh=True)
    counts = {name: len(points) for name, points in data["layers"].items()}
    print(json.dumps({"layers": counts, "missing": data["missing"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
