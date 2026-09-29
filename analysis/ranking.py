"""Топ-5 мест под бизнес в Казани.

Порядок работы:
1. описание бизнеса разбирается в JSON (`brief`);
2. из модельных объявлений берутся подходящие по типу помещения и сделке;
3. у каждого считаются проходимость, соответствие запросу и черновая экономика;
4. для лучших десяти Яндекс ищет конкурентов в заданном радиусе;
5. итоговый балл: проходимость 30 %, экономика 35 %, конкуренция 20 %,
   соответствие запросу 15 %.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from analysis import competitors as competitor_search
from analysis import finance
from analysis.brief import parse_brief
from analysis.footfall import NOTICE as FOOTFALL_NOTICE
from analysis.footfall import get_model
from commercial_sim.kazan import NOTICE as OFFERS_NOTICE
from commercial_sim.kazan import build_records

SEARCH_LIMIT = 10
TOP = 5
BUDGET_SLACK = 1.3
WEIGHTS = {"footfall": 0.30, "finance": 0.35, "competition": 0.20, "fit": 0.15}


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
    if brief["area_max_m2"] and offer["area_m2"] > brief["area_max_m2"] * 1.2:
        penalty += 0.2
        flags.append("площадь больше нужной")
    if brief["needs_food"] and not offer["food_ready"]:
        penalty += 0.35
        flags.append("нужна подготовка под общепит: вытяжка и мощность")
    if brief["min_power_kw"] and offer["power_kw"] < brief["min_power_kw"]:
        penalty += 0.15
        flags.append(f"мощность {offer['power_kw']} кВт ниже нужной")
    if offer["line"] == "2":
        penalty += 0.1
        flags.append("вторая линия")
    if brief["premises"] == "street_retail" and offer["floor"] > 1:
        penalty += 0.2
        flags.append(f"{offer['floor']} этаж")
    if brief["premises"] == "street_retail" and not offer["separate_entrance"]:
        penalty += 0.1
        flags.append("нет отдельного входа")
    if brief["districts"]:
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
    affordable = [offer for offer in offers if _over_budget(offer, brief) <= BUDGET_SLACK]
    if len(affordable) >= TOP:
        dropped = len(offers) - len(affordable)
        if dropped:
            notes.append(f"Не рассматривались {dropped} объявлений дороже бюджета больше чем на 30 %.")
        offers = affordable
    elif brief["budget_month_rub"] or brief["budget_total_rub"]:
        notes.append("В бюджет укладывается меньше пяти объявлений, показаны и более дорогие.")
    return offers, notes


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
        rows.append({"offer": offer, "index": index, "fit": fit, "flags": flags, "draft": draft})
    drafts = _normalize([row["draft"]["profit_month"] for row in rows])
    for row, value in zip(rows, drafts):
        row["pre"] = 0.45 * row["index"] + 0.35 * row["fit"] + 0.2 * value
    rows.sort(key=lambda row: row["pre"], reverse=True)
    shortlist = rows[:SEARCH_LIMIT]

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
        row["competition_score"] = row["finance"]["assumptions"]["competition_factor"]

    profits = [row["finance"]["profit_month"] for row in shortlist]
    for row, value in zip(shortlist, _normalize(profits)):
        finance_score = value if row["finance"]["profit_month"] > 0 else value * 0.5
        row["scores"] = {
            "footfall": round(row["index"], 3),
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

    return {
        "brief": brief,
        "top": top,
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
