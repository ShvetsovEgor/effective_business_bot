"""Модельное предложение коммерческой недвижимости Казани.

Каждая запись — вымышленное объявление. Адрес стоит на реальной улице района,
координата — приближённая точка на этой улице, не кадастр и не карточка с площадки.

Ориентиры цен, март 2026, опубликованные обзоры (не каталог объявлений):
- стрит-ритейл, аренда: первичка 2 050 ₽/м², вторичка 1 750 ₽/м²;
  выше в Вахитовском, Ново-Савиновском и Советском, ниже в Кировском
  и Авиастроительном; помещения до 150 м² дороже крупных;
  по рынку встречается разброс примерно 800–8 000 ₽/м²;
- продажа стрит-ритейла: первичка около 373 тыс. ₽/м², вторичка около 249 тыс. ₽/м²;
  сделки ДОМ.РФ января–февраля 2026: около 225 тыс. ₽/м², лоты 80–85 м²,
  разброс сделок 120–600 тыс. ₽/м²;
- склад: класс A около 1 450 ₽/м², класс B около 730 ₽/м²
  (НДС и эксплуатация включены в опубликованную ставку).

Источник ориентиров: обзор UD Group за I квартал 2026
(https://ud-group.com/materialy/ekspertnye-materialy/obzor-rynka-kommercheskoy-nedvizhimosti-za-i-kvartal-2026-goda/)
и сообщение «БИЗНЕС Online» о диапазоне ставок стрит-ритейла.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

NOTICE = (
    "СИМУЛЯЦИЯ. Вымышленные объявления для MVP. "
    "Это не выгрузка Авито, ЦИАН или Росреестра. "
    "Ставки подогнаны к опубликованным средним по Казани на март 2026 года."
)

# Вторичный стрит-ритейл, помещение до 150 м², ₽/м² в месяц.
# Городское среднее вторички в обзоре — 1 750; районные базы расходятся вокруг него.
RENT_STREET = {
    "Вахитовский": 3400,
    "Ново-Савиновский": 2400,
    "Советский": 2200,
    "Приволжский": 1900,
    "Московский": 1650,
    "Кировский": 1300,
    "Авиастроительный": 1100,
}

# Вторичная продажа, ₽/м². Городское среднее вторички в обзоре — около 249 тыс.
SALE_STREET = {
    "Вахитовский": 320_000,
    "Ново-Савиновский": 270_000,
    "Советский": 250_000,
    "Приволжский": 210_000,
    "Московский": 185_000,
    "Кировский": 155_000,
    "Авиастроительный": 140_000,
}

# Первичка в обзоре дороже вторички примерно в 1,5 раза (373 / 249).
PRIMARY_SALE_FACTOR = 372_527 / 248_676

OFFERS = (
    {
        "street": "улица Баумана",
        "house": "42",
        "district": "Вахитовский",
        "lat": 55.7889,
        "lon": 49.1162,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 48,
        "floor": 1,
        "condition": "finish",
        "power_kw": 25,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": True,
        "metro": "Площадь Тукая",
        "fit": "кофейня, пекарня",
    },
    {
        "street": "улица Баумана",
        "house": "58",
        "district": "Вахитовский",
        "lat": 55.7904,
        "lon": 49.1134,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 86,
        "floor": 1,
        "condition": "finish",
        "power_kw": 30,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": True,
        "metro": "Площадь Тукая",
        "fit": "ресторан, магазин",
    },
    {
        "street": "Кремлёвская улица",
        "house": "21",
        "district": "Вахитовский",
        "lat": 55.7962,
        "lon": 49.1088,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 64,
        "floor": 1,
        "condition": "finish",
        "power_kw": 20,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": True,
        "metro": "Кремлёвская",
        "fit": "кофейня, сувениры",
    },
    {
        "street": "Петербургская улица",
        "house": "52",
        "district": "Вахитовский",
        "lat": 55.7876,
        "lon": 49.1248,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 112,
        "floor": 1,
        "condition": "finish",
        "power_kw": 35,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Площадь Тукая",
        "fit": "общепит, услуги",
    },
    {
        "street": "улица Пушкина",
        "house": "18",
        "district": "Вахитовский",
        "lat": 55.7918,
        "lon": 49.1236,
        "deal": "rent",
        "kind": "office",
        "area_m2": 74,
        "floor": 3,
        "condition": "finish",
        "power_kw": 10,
        "separate_entrance": False,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": "Площадь Тукая",
        "fit": "офис услуг, студия",
        "office_class": "B+",
    },
    {
        "street": "улица Островского",
        "house": "15",
        "district": "Вахитовский",
        "lat": 55.7941,
        "lon": 49.1114,
        "deal": "sale",
        "kind": "street_retail",
        "area_m2": 81,
        "floor": 1,
        "condition": "finish",
        "power_kw": 22,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Кремлёвская",
        "fit": "пекарня, пункт выдачи",
    },
    {
        "street": "улица Профсоюзная",
        "house": "9",
        "district": "Вахитовский",
        "lat": 55.7824,
        "lon": 49.1216,
        "deal": "sale",
        "kind": "street_retail",
        "area_m2": 54,
        "floor": 1,
        "condition": "shell",
        "power_kw": 15,
        "separate_entrance": True,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": "Суконная слобода",
        "fit": "услуги, небольшой магазин",
    },
    {
        "street": "улица Чистопольская",
        "house": "15",
        "district": "Ново-Савиновский",
        "lat": 55.8216,
        "lon": 49.1394,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 86,
        "floor": 1,
        "condition": "finish",
        "power_kw": 25,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Козья слобода",
        "fit": "кофейня, пекарня",
    },
    {
        "street": "проспект Ямашева",
        "house": "97",
        "district": "Ново-Савиновский",
        "lat": 55.8274,
        "lon": 49.1518,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 128,
        "floor": 1,
        "condition": "shell",
        "power_kw": 30,
        "separate_entrance": True,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": "Яшьлек",
        "fit": "магазин, общепит после ремонта",
    },
    {
        "street": "улица Четаева",
        "house": "34",
        "district": "Ново-Савиновский",
        "lat": 55.8182,
        "lon": 49.1276,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 54,
        "floor": 1,
        "condition": "finish",
        "power_kw": 18,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Козья слобода",
        "fit": "кофейня, пункт выдачи",
    },
    {
        "street": "улица Амирхана",
        "house": "12",
        "district": "Ново-Савиновский",
        "lat": 55.8318,
        "lon": 49.1072,
        "deal": "sale",
        "kind": "street_retail",
        "area_m2": 83,
        "floor": 1,
        "condition": "shell",
        "power_kw": 20,
        "separate_entrance": True,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": "Яшьлек",
        "fit": "услуги в новом доме",
    },
    {
        "street": "улица Мусина",
        "house": "6",
        "district": "Ново-Савиновский",
        "lat": 55.8356,
        "lon": 49.0974,
        "deal": "sale",
        "kind": "street_retail",
        "area_m2": 72,
        "floor": 1,
        "condition": "shell",
        "power_kw": 15,
        "separate_entrance": True,
        "food_ready": False,
        "line": "2",
        "prime": False,
        "metro": "Северный вокзал",
        "fit": "кабинет, небольшая торговля",
    },
    {
        "street": "улица Николая Ершова",
        "house": "29",
        "district": "Советский",
        "lat": 55.7928,
        "lon": 49.1774,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 78,
        "floor": 1,
        "condition": "finish",
        "power_kw": 28,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Аметьево",
        "fit": "кофейня у жилых домов",
    },
    {
        "street": "Сибирский тракт",
        "house": "22",
        "district": "Советский",
        "lat": 55.8164,
        "lon": 49.1986,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 146,
        "floor": 1,
        "condition": "finish",
        "power_kw": 40,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": None,
        "fit": "столовая, магазин у тракта",
    },
    {
        "street": "улица Гвардейская",
        "house": "48",
        "district": "Советский",
        "lat": 55.8236,
        "lon": 49.1672,
        "deal": "sale",
        "kind": "street_retail",
        "area_m2": 90,
        "floor": 1,
        "condition": "finish",
        "power_kw": 20,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": None,
        "fit": "пекарня, салон",
    },
    {
        "street": "улица Патриса Лумумбы",
        "house": "11",
        "district": "Советский",
        "lat": 55.7848,
        "lon": 49.1542,
        "deal": "rent",
        "kind": "office",
        "area_m2": 120,
        "floor": 4,
        "condition": "finish",
        "power_kw": 12,
        "separate_entrance": False,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": "Суконная слобода",
        "fit": "офис",
        "office_class": "B",
    },
    {
        "street": "улица Рихарда Зорге",
        "house": "66",
        "district": "Приволжский",
        "lat": 55.7596,
        "lon": 49.1874,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 92,
        "floor": 1,
        "condition": "finish",
        "power_kw": 25,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Горки",
        "fit": "кофейня, пункт выдачи",
    },
    {
        "street": "проспект Победы",
        "house": "58",
        "district": "Приволжский",
        "lat": 55.7482,
        "lon": 49.2076,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 168,
        "floor": 1,
        "condition": "finish",
        "power_kw": 35,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Проспект Победы",
        "fit": "магазин, общепит",
    },
    {
        "street": "улица Академика Парина",
        "house": "7",
        "district": "Приволжский",
        "lat": 55.7434,
        "lon": 49.1848,
        "deal": "sale",
        "kind": "street_retail",
        "area_m2": 84,
        "floor": 1,
        "condition": "shell",
        "power_kw": 18,
        "separate_entrance": True,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": "Горки",
        "fit": "услуги в новом доме",
    },
    {
        "street": "улица Декабристов",
        "house": "120",
        "district": "Московский",
        "lat": 55.8238,
        "lon": 49.0614,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 70,
        "floor": 1,
        "condition": "finish",
        "power_kw": 20,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Яшьлек",
        "fit": "пекарня, салон",
    },
    {
        "street": "улица Волкова",
        "house": "40",
        "district": "Московский",
        "lat": 55.8276,
        "lon": 49.0772,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 220,
        "floor": 1,
        "condition": "finish",
        "power_kw": 40,
        "separate_entrance": True,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": "Северный вокзал",
        "fit": "магазин у дома",
    },
    {
        "street": "улица Краснококшайская",
        "house": "85",
        "district": "Кировский",
        "lat": 55.8114,
        "lon": 49.0446,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 88,
        "floor": 1,
        "condition": "finish",
        "power_kw": 18,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": None,
        "fit": "кафе, продукты",
    },
    {
        "street": "улица Большая Крыловка",
        "house": "15",
        "district": "Кировский",
        "lat": 55.8016,
        "lon": 48.9984,
        "deal": "sale",
        "kind": "street_retail",
        "area_m2": 62,
        "floor": 1,
        "condition": "finish",
        "power_kw": 15,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": None,
        "fit": "небольшой общепит",
    },
    {
        "street": "улица Копылова",
        "house": "12",
        "district": "Авиастроительный",
        "lat": 55.8618,
        "lon": 49.0946,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 96,
        "floor": 1,
        "condition": "finish",
        "power_kw": 20,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Авиастроительная",
        "fit": "кофейня, пункт выдачи",
    },
    {
        "street": "Ленинградская улица",
        "house": "22",
        "district": "Авиастроительный",
        "lat": 55.8546,
        "lon": 49.1018,
        "deal": "rent",
        "kind": "street_retail",
        "area_m2": 58,
        "floor": 1,
        "condition": "finish",
        "power_kw": 15,
        "separate_entrance": True,
        "food_ready": False,
        "line": "2",
        "prime": False,
        "metro": "Авиастроительная",
        "fit": "услуги, кабинет",
    },
    {
        "street": "Беломорская улица",
        "house": "4",
        "district": "Авиастроительный",
        "lat": 55.8672,
        "lon": 49.0776,
        "deal": "sale",
        "kind": "street_retail",
        "area_m2": 80,
        "floor": 1,
        "condition": "finish",
        "power_kw": 18,
        "separate_entrance": True,
        "food_ready": True,
        "line": "1",
        "prime": False,
        "metro": "Авиастроительная",
        "fit": "магазин у дома",
    },
    {
        "street": "улица Чистопольская",
        "house": "44",
        "district": "Ново-Савиновский",
        "lat": 55.8194,
        "lon": 49.1488,
        "deal": "rent",
        "kind": "office",
        "area_m2": 160,
        "floor": 6,
        "condition": "finish",
        "power_kw": 15,
        "separate_entrance": False,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": "Козья слобода",
        "fit": "офис",
        "office_class": "B",
    },
    {
        "street": "улица Тэцевская",
        "house": "9",
        "district": "Приволжский",
        "lat": 55.7368,
        "lon": 49.1624,
        "deal": "rent",
        "kind": "warehouse",
        "area_m2": 480,
        "floor": 1,
        "condition": "finish",
        "power_kw": 80,
        "separate_entrance": True,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": None,
        "fit": "склад, лёгкое производство",
        "warehouse_class": "B",
        "ceiling_m": 6,
    },
    {
        "street": "Оренбургский тракт",
        "house": "158",
        "district": "Приволжский",
        "lat": 55.7512,
        "lon": 49.2314,
        "deal": "rent",
        "kind": "warehouse",
        "area_m2": 1200,
        "floor": 1,
        "condition": "finish",
        "power_kw": 150,
        "separate_entrance": True,
        "food_ready": False,
        "line": "1",
        "prime": False,
        "metro": None,
        "fit": "склад класса A",
        "warehouse_class": "A",
        "ceiling_m": 12,
    },
)


def _jitter(key: str, spread: float = 0.08) -> float:
    digest = hashlib.md5(key.encode()).hexdigest()
    unit = int(digest[:8], 16) % 1000 / 999
    return 1 - spread + unit * 2 * spread


def _round_step(value: float, step: int) -> int:
    return int(round(value / step) * step)


def _area_factor(area: float) -> float:
    if area <= 150:
        return 1.0
    if area <= 300:
        return 0.86
    return 0.74


def price_offer(offer: dict, index: int) -> dict:
    kind = offer["kind"]
    deal = offer["deal"]
    district = offer["district"]
    area = offer["area_m2"]
    key = f"{district}|{offer['street']}|{offer['house']}|{deal}|{kind}"
    factor = _jitter(key)
    if offer.get("prime"):
        factor *= 1.9
    if offer.get("line") == "2":
        factor *= 0.78
    if offer["condition"] == "shell" and kind == "street_retail" and deal == "rent":
        factor *= 0.92

    if kind == "warehouse":
        per_m2 = 1450 if offer.get("warehouse_class") == "A" else 730
        per_m2 = _round_step(per_m2 * _jitter(key, 0.04), 10)
        month = per_m2 * area
        total = None
    elif kind == "office":
        base = {"B+": 1500, "B": 1150, "A": 1900}[offer.get("office_class", "B")]
        district_k = RENT_STREET[district] / RENT_STREET["Советский"]
        per_m2 = _round_step(base * district_k * _jitter(key, 0.06), 50)
        month = per_m2 * area
        total = None
    elif deal == "rent":
        per_m2 = _round_step(RENT_STREET[district] * _area_factor(area) * factor, 50)
        month = per_m2 * area
        total = None
    else:
        per_m2 = SALE_STREET[district] * factor
        if offer["condition"] == "shell":
            per_m2 *= PRIMARY_SALE_FACTOR
        per_m2 = _round_step(per_m2, 1000)
        month = None
        total = per_m2 * area

    return {
        "per_m2": per_m2,
        "price_month": month,
        "price_total": total,
        "index": index,
    }


KIND_TITLE = {
    "street_retail": "торговое помещение",
    "office": "офис",
    "warehouse": "склад",
}


def build_records() -> list[dict]:
    records = []
    for index, offer in enumerate(OFFERS, start=1):
        money = price_offer(offer, index)
        address = f"Казань, {offer['street']}, {offer['house']}"
        title_kind = KIND_TITLE[offer["kind"]]
        if offer["deal"] == "rent":
            title = f"Аренда, {title_kind}, {offer['area_m2']} м²"
        else:
            title = f"Продажа, {title_kind}, {offer['area_m2']} м²"
        records.append(
            {
                "id": f"sim-kzn-{index:03d}",
                "title": title,
                "deal": offer["deal"],
                "kind": offer["kind"],
                "district": offer["district"],
                "address": address,
                "lat": offer["lat"],
                "lon": offer["lon"],
                "area_m2": offer["area_m2"],
                "price_per_m2": money["per_m2"],
                "price_month": money["price_month"],
                "price_total": money["price_total"],
                "floor": offer["floor"],
                "condition": offer["condition"],
                "power_kw": offer["power_kw"],
                "separate_entrance": offer["separate_entrance"],
                "food_ready": offer["food_ready"],
                "line": offer["line"],
                "metro": offer["metro"] or "",
                "fit": offer["fit"],
                "office_class": offer.get("office_class") or "",
                "warehouse_class": offer.get("warehouse_class") or "",
                "ceiling_m": offer.get("ceiling_m") or "",
                "data_origin": "simulated",
                "price_basis": "model_q1_2026_published_averages",
                "notice": NOTICE,
            }
        )
    return records


def write_outputs(out_dir: Path) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    records = build_records()
    features = []
    for record in records:
        props = {key: value for key, value in record.items() if key not in ("lat", "lon")}
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [record["lon"], record["lat"]]},
                "properties": props,
            }
        )
    collection = {
        "type": "FeatureCollection",
        "notice": NOTICE,
        "city": "Казань",
        "data_origin": "simulated",
        "features": features,
    }
    (out_dir / "kazan_commercial.geojson").write_text(
        json.dumps(collection, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    fields = list(records[0].keys())
    with (out_dir / "kazan_commercial.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(records)
    (out_dir / "map.html").write_text(_map_html(records), encoding="utf-8")
    return records


def _money(record: dict) -> str:
    if record["deal"] == "rent":
        return f"{record['price_month']:,} ₽/мес · {record['price_per_m2']:,} ₽/м²".replace(",", " ")
    return f"{record['price_total']:,} ₽ · {record['price_per_m2']:,} ₽/м²".replace(",", " ")


def _map_html(records: list[dict]) -> str:
    payload = json.dumps(records, ensure_ascii=False)
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Казань — модельные объявления</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    html, body, #map {{ margin: 0; height: 100%; }}
    #card {{
      position: absolute; top: 12px; right: 12px; z-index: 500;
      width: 320px; max-height: calc(100% - 24px); overflow: auto;
      background: #fff; padding: 14px 16px; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 14px/1.4 sans-serif;
      display: none;
    }}
    #banner {{
      position: absolute; left: 12px; bottom: 12px; z-index: 500;
      max-width: 460px; background: #fff8e6; padding: 10px 12px;
      border-radius: 8px; font: 13px/1.35 sans-serif;
    }}
    h2 {{ margin: 0 0 6px; font-size: 16px; }}
    .tag {{ color: #9a6700; font-weight: 700; font-size: 12px; }}
  </style>
</head>
<body>
  <div id="map"></div>
  <aside id="card"></aside>
  <div id="banner">Симуляция, не каталог Авито. {len(records)} вымышленных объявлений по опубликованным средним ставкам Казани на март 2026.</div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const offers = {payload};
    const map = L.map('map').setView([55.796, 49.12], 12);
    L.tileLayer('https://tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
      attribution: '&copy; OpenStreetMap'
    }}).addTo(map);
    const colors = {{ rent: '#e67e22', sale: '#2980b9' }};
    const card = document.getElementById('card');
    offers.forEach((item) => {{
      const marker = L.circleMarker([item.lat, item.lon], {{
        radius: 8, color: colors[item.deal], fillOpacity: 0.85
      }}).addTo(map);
      marker.on('click', () => {{
        const price = item.deal === 'rent'
          ? item.price_month.toLocaleString('ru-RU') + ' ₽/мес'
          : item.price_total.toLocaleString('ru-RU') + ' ₽';
        card.style.display = 'block';
        card.innerHTML = `
          <div class="tag">СИМУЛЯЦИЯ</div>
          <h2>${{item.title}}</h2>
          <div>${{item.address}}</div>
          <div>${{item.district}} район · ${{item.area_m2}} м² · ${{price}}</div>
          <div>${{item.price_per_m2.toLocaleString('ru-RU')}} ₽/м² · линия ${{item.line}}</div>
          <div>Мощность ${{item.power_kw}} кВт · ${{item.food_ready ? 'можно общепит' : 'общепит не заложен'}}</div>
          <div>Подходит: ${{item.fit}}</div>
          <div>${{item.metro ? 'Метро: ' + item.metro : 'Метро рядом нет'}}</div>
          <p>${{item.notice}}</p>`;
      }});
    }});
  </script>
</body>
</html>
"""


def summary(records: list[dict]) -> str:
    lines = [NOTICE, f"объявлений: {len(records)}"]
    for record in records:
        price = _money(record)
        lines.append(
            f"{record['id']}  {record['deal']:4}  {record['district']:18}  "
            f"{record['area_m2']:4} м²  {price}  {record['address']}"
        )
    return "\n".join(lines)
