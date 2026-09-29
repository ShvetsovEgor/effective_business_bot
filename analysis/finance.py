"""Финансовая модель точки: проходимость × конверсия × чек против аренды.

Все коэффициенты — допущения для MVP, не отраслевая статистика.
Проходимость берётся из модели `footfall`, аренда и цена — из модельных
объявлений `commercial_sim`. Для покупки ежемесячная стоимость помещения
считается как 1 % цены: доход, который принёс бы тот же капитал под 12 % годовых.
"""

from __future__ import annotations

PEDESTRIANS_MIN = 300
PEDESTRIANS_MAX = 15_000
# Индекс — перцентиль ячейки по городу, коммерческие улицы почти все в верхней
# пятой части. Крутая степень разводит центр и обычную улицу у дома.
PEDESTRIANS_POWER = 4
SALE_MONTHLY_RATE = 0.01
SEGMENT_CHECK = {"econom": 0.8, "middle": 1.0, "premium": 1.35}

# capture — доля прохожих, которые становятся покупателями за день.
# capacity_m2 — предел покупателей в день на 1 м² зала: кресла, столы, касса.
# margin — доля выручки после себестоимости и сдельной оплаты мастеров.
# opex — зарплаты, коммунальные и прочие расходы, без аренды.
PROFILES = {
    "coffee": {"capture": 0.015, "capacity_m2": 5.0, "check": 350, "margin": 0.68, "opex_base": 180_000, "opex_m2": 1_000, "fitout_m2": 30_000},
    "cafe": {"capture": 0.010, "capacity_m2": 2.5, "check": 700, "margin": 0.62, "opex_base": 300_000, "opex_m2": 1_500, "fitout_m2": 40_000},
    "restaurant": {"capture": 0.005, "capacity_m2": 1.5, "check": 1_500, "margin": 0.60, "opex_base": 500_000, "opex_m2": 2_000, "fitout_m2": 55_000},
    "fast_food": {"capture": 0.015, "capacity_m2": 4.0, "check": 450, "margin": 0.60, "opex_base": 250_000, "opex_m2": 1_200, "fitout_m2": 35_000},
    "bakery": {"capture": 0.015, "capacity_m2": 5.0, "check": 400, "margin": 0.60, "opex_base": 220_000, "opex_m2": 1_200, "fitout_m2": 35_000},
    "bar": {"capture": 0.004, "capacity_m2": 1.5, "check": 1_300, "margin": 0.68, "opex_base": 350_000, "opex_m2": 1_500, "fitout_m2": 45_000},
    "retail": {"capture": 0.010, "capacity_m2": 3.0, "check": 900, "margin": 0.35, "opex_base": 150_000, "opex_m2": 600, "fitout_m2": 15_000},
    "services": {"capture": 0.003, "capacity_m2": 0.4, "check": 1_500, "margin": 0.45, "opex_base": 120_000, "opex_m2": 800, "fitout_m2": 12_000},
    "pickup_point": {"capture": 0.015, "capacity_m2": 6.0, "check": 60, "margin": 1.00, "opex_base": 90_000, "opex_m2": 300, "fitout_m2": 8_000},
    "other": {"capture": 0.006, "capacity_m2": 2.0, "check": 800, "margin": 0.50, "opex_base": 180_000, "opex_m2": 800, "fitout_m2": 20_000},
}


def daily_pedestrians(index: float) -> int:
    return round(PEDESTRIANS_MIN + (PEDESTRIANS_MAX - PEDESTRIANS_MIN) * index**PEDESTRIANS_POWER)


def competition_factor(pedestrians: int, competitors: float) -> float:
    """Доля спроса, которая остаётся новой точке.

    Давление — число прямых конкурентов на 1000 прохожих в день. В людном
    месте десять кофеен мешают меньше, чем три в спальном квартале.
    """
    pressure = competitors / max(1.0, pedestrians / 1000)
    return max(0.2, 1 / (1 + 0.35 * pressure))


def estimate(
    offer: dict,
    brief: dict,
    index: float,
    competitors: float,
    pedestrians: int | None = None,
) -> dict:
    profile = PROFILES.get(brief["category"], PROFILES["other"])
    if pedestrians is None:
        pedestrians = daily_pedestrians(index)
    access = 1.0
    if offer["line"] == "2":
        access *= 0.6
    if offer["floor"] > 1:
        access *= 0.4
    if not offer["separate_entrance"]:
        access *= 0.75
    competition = competition_factor(pedestrians, competitors)
    demand = pedestrians * profile["capture"] * access * competition
    capacity = profile["capacity_m2"] * offer["area_m2"]
    visitors = min(demand, capacity)
    check = brief.get("avg_check_rub") or profile["check"] * SEGMENT_CHECK[brief["price_segment"]]
    revenue = visitors * check * 30
    gross = revenue * profile["margin"]
    opex = profile["opex_base"] + profile["opex_m2"] * offer["area_m2"]
    if offer["deal"] == "rent":
        occupancy = offer["price_month"]
        entry = 2 * offer["price_month"]
    else:
        occupancy = offer["price_total"] * SALE_MONTHLY_RATE
        entry = offer["price_total"]
    profit = gross - occupancy - opex
    capex = profile["fitout_m2"] * offer["area_m2"] + entry
    return {
        "pedestrians_day": pedestrians,
        "visitors_day": round(visitors),
        "capacity_limited": demand > capacity,
        "avg_check_rub": round(check),
        "revenue_month": round(revenue),
        "gross_margin_month": round(gross),
        "occupancy_month": round(occupancy),
        "opex_month": round(opex),
        "profit_month": round(profit),
        "capex": round(capex),
        "payback_months": round(capex / profit, 1) if profit > 0 else None,
        "occupancy_share": round(occupancy / revenue, 3) if revenue else None,
        "rent_per_1000_pedestrians": round(occupancy / (pedestrians * 30 / 1000)),
        "assumptions": {
            "capture": profile["capture"],
            "access_factor": round(access, 2),
            "competition_factor": round(competition, 2),
            "margin": profile["margin"],
            "sale_monthly_rate": SALE_MONTHLY_RATE if offer["deal"] == "sale" else None,
        },
    }


def verdict(finance: dict, deal: str) -> str:
    """Правило без LLM. При покупке помещение остаётся в собственности, поэтому окупаемость до 60 месяцев."""
    if finance["profit_month"] <= 0:
        return "не брать"
    payback = finance["payback_months"]
    share = finance["occupancy_share"]
    limit = 60 if deal == "sale" else 24
    if share is not None and share <= 0.2 and payback is not None and payback <= limit:
        return "подходит"
    return "осторожно"
