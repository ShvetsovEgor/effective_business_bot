"""Топ-5 мест под бизнес в Казани.

Порядок работы:
1. описание бизнеса разбирается в JSON (`brief`);
2. из объявлений Авито берутся подходящие по типу помещения и сделке;
3. у каждого считаются проходимость, соответствие запросу и черновая экономика;
4. в шорт-лист попадает одно объявление на квартал: не больше четырёх из самых людных,
   остальные — с живым потоком, но не с той же площади;
5. для них Яндекс ищет конкурентов в заданном радиусе;
6. итоговый балл: поток 10 %, поток без конкурентов 45 %, экономика 30 %,
   соответствие запросу 15 %.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import h3

from analysis import competitors as competitor_search
from analysis import finance
from analysis.finance import area_ceiling, useful_area
from analysis.brief import parse_brief
from analysis.footfall import HEX_RESOLUTION
from analysis.footfall import NOTICE as FOOTFALL_NOTICE
from analysis.footfall import get_model
from commercial_sim.avito import NOTICE as OFFERS_NOTICE
from commercial_sim.avito import offers as build_records

SEARCH_LIMIT = 10
TOP = 5
BUDGET_SLACK = 1.3
PEAK_TRAFFIC = 0.90
PEAK_SLOTS = 4
MIN_TRAFFIC = 0.45
WEIGHTS = {"footfall": 0.10, "finance": 0.30, "competition": 0.45, "fit": 0.15}


def fit_score(offer: dict, brief: dict) -> tuple[float, list[str]]:
    penalty = 0.0
    bonus = 0.0
    flags = []
    if offer["deal"] == "rent" and brief["budget_month_rub"]:
        ratio = offer["price_month"] / brief["budget_month_rub"]
        if ratio > 1:
            penalty += min(0.6, (ratio - 1) * 1.5)
            flags.append(f"аренда выше бюджета на {round((ratio - 1) * 100)} %")
    if offer["deal"] == "sale" and brief["budget_total_rub"]:
        ratio = offer["price_total"] / brief["budget_total_rub"]
        if ratio > 1:
            penalty += min(0.6, (ratio - 1) * 1.5)
            flags.append(f"цена выше бюджета на {round((ratio - 1) * 100)} %")
    if brief["area_min_m2"] and offer["area_m2"] < brief["area_min_m2"] * 0.9:
        penalty += 0.25
        flags.append("площадь меньше нужной")
    useful = useful_area(brief)
    if useful and offer["area_m2"] > useful * 1.05:
        penalty += min(0.5, offer["area_m2"] / useful - 1)
        flags.append("площадь больше, чем нужно формату")
    elif brief["area_max_m2"] and offer["area_m2"] > brief["area_max_m2"] * 1.1:
        penalty += 0.2
        flags.append("площадь больше нужной")
    if brief["needs_food"] and offer.get("food_ready") is False:
        penalty += 0.35
        flags.append("нужна подготовка под общепит: вытяжка и мощность")
    if brief["min_power_kw"] and offer.get("power_kw") and offer["power_kw"] < brief["min_power_kw"]:
        penalty += 0.15
        flags.append(f"мощность {offer['power_kw']} кВт ниже нужной")
    if offer["line"] == "2":
        penalty += 0.1
        flags.append("вторая линия")
    if brief["premises"] == "street_retail" and offer["floor"] > 1:
        penalty += 0.2
        flags.append(f"{offer['floor']} этаж")
    if brief["premises"] == "street_retail" and offer.get("separate_entrance") is False:
        penalty += 0.1
        flags.append("нет отдельного входа")
    if brief["districts"] and offer.get("district"):
        if offer["district"] in brief["districts"]:
            bonus += 0.15
        else:
            penalty += 0.1
            flags.append("район не из пожеланий")
    return max(0.0, min(1.0, 1 - penalty + bonus)), flags


def _over_budget(offer: dict, brief: dict) -> float:
    if offer["deal"] == "rent" and brief["budget_month_rub"]:
        return offer["price_month"] / brief["budget_month_rub"]
    if offer["deal"] == "sale" and brief["budget_total_rub"]:
        return offer["price_total"] / brief["budget_total_rub"]
    return 1.0


def _pool(brief: dict) -> tuple[list[dict], list[str]]:
    offers = [offer for offer in build_records() if offer["kind"] == brief["premises"]]
    notes = []
    if brief["deal"] != "any":
        matched = [offer for offer in offers if offer["deal"] == brief["deal"]]
        if len(matched) >= TOP:
            offers = matched
        else:
            notes.append("Подходящих объявлений с этим типом сделки мало, добавлены оба варианта.")
    if not offers:
        offers = [offer for offer in build_records() if offer["kind"] == "street_retail"]
        notes.append("Под этот тип помещения объявлений нет, показаны торговые помещения.")
    ceiling = area_ceiling(brief)
    if ceiling:
        sized = [offer for offer in offers if offer["area_m2"] <= ceiling]
        if sized:
            dropped = len(offers) - len(sized)
            if dropped:
                notes.append(f"Не рассматривались {dropped} объявлений больше {round(ceiling)} м².")
            offers = sized
    affordable = [offer for offer in offers if _over_budget(offer, brief) <= BUDGET_SLACK]
    if len(affordable) >= TOP:
        dropped = len(offers) - len(affordable)
        if dropped:
            notes.append(f"Не рассматривались {dropped} объявлений дороже бюджета больше чем на 30 %.")
        offers = affordable
    elif brief["budget_month_rub"] or brief["budget_total_rub"]:
        notes.append("В бюджет укладывается меньше пяти объявлений, показаны и более дорогие.")
    return offers, notes


def _size_score(offer: dict, brief: dict) -> float:
    useful = useful_area(brief) or offer["area_m2"]
    if not useful:
        return 1.0
    target = useful * 0.7
    return max(0.0, 1 - abs(offer["area_m2"] - target) / useful)


def _shortlist(rows: list[dict]) -> list[dict]:
    """Одно объявление на квартал. Из самых людных берём только часть, остальное — живые улицы."""
    best: dict[str, dict] = {}
    for row in rows:
        best.setdefault(row["cell"], row)
    ordered = sorted(best.values(), key=lambda row: row["pre"], reverse=True)
    peak = [row for row in ordered if row["traffic"] >= PEAK_TRAFFIC]
    alive = [row for row in ordered if MIN_TRAFFIC <= row["traffic"] < PEAK_TRAFFIC]
    peak_take = min(PEAK_SLOTS, len(peak))
    picked = peak[:peak_take] + alive[: SEARCH_LIMIT - peak_take]
    if len(picked) < TOP:
        picked = ordered[:SEARCH_LIMIT]
    return picked


def _normalize(values: list[float]) -> list[float]:
    low, high = min(values), max(values)
    if high == low:
        return [1.0 for _ in values]
    return [(value - low) / (high - low) for value in values]


def analyze(text: str) -> dict:
    brief = parse_brief(text)
    model = get_model()
    offers, notes = _pool(brief)
    radius = brief["competitor_radius_m"]

    rows = []
    for offer in offers:
        index = model.index_at(offer["lat"], offer["lon"])
        pedestrians = model.pedestrians_at(offer["lat"], offer["lon"])
        fit, flags = fit_score(offer, brief)
        draft = finance.estimate(offer, brief, index, competitors=0, pedestrians=pedestrians)
        rows.append(
            {
                "offer": offer,
                "index": index,
                "traffic": finance.traffic_score(pedestrians),
                "cell": h3.latlng_to_cell(offer["lat"], offer["lon"], HEX_RESOLUTION),
                "fit": fit,
                "flags": flags,
                "draft": draft,
            }
        )
    drafts = _normalize([row["draft"]["profit_month"] for row in rows])
    for row, value in zip(rows, drafts):
        row["pre"] = (
            0.30 * row["traffic"]
            + 0.25 * row["fit"]
            + 0.20 * value
            + 0.25 * _size_score(row["offer"], brief)
        )
    rows.sort(key=lambda row: row["pre"], reverse=True)
    shortlist = _shortlist(rows)

    def search(row: dict) -> list[dict]:
        offer = row["offer"]
        return competitor_search.around(
            brief["competitor_queries"], offer["lat"], offer["lon"], radius, brief["category"]
        )

    with ThreadPoolExecutor(max_workers=5) as pool:
        found = list(pool.map(search, shortlist))
    chains = competitor_search.chain_names(found)

    for row, orgs in zip(shortlist, found):
        row["competitors"] = orgs
        row["competition"] = competitor_search.summarize(orgs, radius, chains, brief["peak_hours"])
        effective = len(orgs) + 0.5 * row["competition"]["chains_nearby"]
        row["finance"] = finance.estimate(
            row["offer"],
            brief,
            row["index"],
            competitors=effective,
            pedestrians=model.pedestrians_at(row["offer"]["lat"], row["offer"]["lon"]),
        )
        opened = row["finance"]["assumptions"]["competition_factor"]
        row["competition_score"] = row["traffic"] * opened

    profits = [row["finance"]["profit_month"] for row in shortlist]
    for row, value in zip(shortlist, _normalize(profits)):
        finance_score = value if row["finance"]["profit_month"] > 0 else value * 0.5
        row["scores"] = {
            "footfall": round(row["traffic"], 3),
            "finance": round(finance_score, 3),
            "competition": round(row["competition_score"], 3),
            "fit": round(row["fit"], 3),
        }
        row["scores"]["total"] = round(sum(WEIGHTS[key] * row["scores"][key] for key in WEIGHTS), 3)
    shortlist.sort(key=lambda row: row["scores"]["total"], reverse=True)

    top = []
    for rank, row in enumerate(shortlist[:TOP], start=1):
        offer = row["offer"]
        top.append(
            {
                "rank": rank,
                "id": offer["id"],
                "title": offer["title"],
                "address": offer["address"],
                "district": offer["district"],
                "lat": offer["lat"],
                "lon": offer["lon"],
                "deal": offer["deal"],
                "area_m2": offer["area_m2"],
                "price_month": offer["price_month"],
                "price_total": offer["price_total"],
                "price_per_m2": offer["price_per_m2"],
                "floor": offer["floor"],
                "line": offer["line"],
                "metro": offer["metro"],
                "food_ready": offer["food_ready"],
                "power_kw": offer["power_kw"],
                "separate_entrance": offer["separate_entrance"],
                "condition": offer["condition"],
                "url": offer.get("url") or "",
                "data_origin": offer.get("data_origin") or "",
                "footfall": {
                    "index": round(row["index"], 3),
                    "pedestrians_day": row["finance"]["pedestrians_day"],
                    "nearby": model.nearby(offer["lat"], offer["lon"]),
                },
                "finance": row["finance"],
                "competition": row["competition"],
                "competitors": [
                    {
                        "id": org["id"],
                        "name": org["name"],
                        "lat": org["lat"],
                        "lon": org["lon"],
                        "distance_m": org["distance_m"],
                        "address": org["address"],
                        "categories": [item["name"] for item in org["categories"] if item["name"]],
                        "hours": org["hours"]["text"],
                        "url": org["url"],
                        "chain": org["name"].strip().lower() in chains,
                    }
                    for org in row["competitors"]
                ],
                "flags": row["flags"],
                "scores": row["scores"],
                "verdict": finance.verdict(row["finance"], offer["deal"]),
            }
        )

    top_ids = {place["id"] for place in top}

    def _other_key(row: dict) -> tuple:
        if row.get("scores"):
            return (1, row["scores"]["total"])
        return (0, row["pre"])

    others = []
    rest = sorted((row for row in rows if row["offer"]["id"] not in top_ids), key=_other_key, reverse=True)
    for rank, row in enumerate(rest, start=len(top) + 1):
        offer = row["offer"]
        others.append(
            {
                "rank": rank,
                "id": offer["id"],
                "title": offer["title"],
                "address": offer["address"],
                "area_m2": offer["area_m2"],
                "price_month": offer["price_month"],
                "lat": offer["lat"],
                "lon": offer["lon"],
                "url": offer.get("url") or "",
            }
        )

    return {
        "brief": brief,
        "top": top,
        "others": others,
        "considered": len(offers),
        "searched": len(shortlist),
        "weights": WEIGHTS,
        "notes": notes,
        "notices": {
            "offers": OFFERS_NOTICE,
            "footfall": FOOTFALL_NOTICE,
            "competitors": "Конкуренты — ответ API Поиска по организациям Яндекса: лучшие совпадения, не полный каталог.",
            "finance": "Финансовая модель — оценка по допущениям, не прогноз выручки.",
        },
    }
