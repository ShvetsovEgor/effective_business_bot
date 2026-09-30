"""Разбор описания бизнеса в JSON.

Сначала описание отдаётся модели Alice. Если модель недоступна или вернула
не JSON, срабатывает разбор по ключевым словам. Результат всегда приводится
к одной схеме, поле `parser` говорит, кто её заполнил.
"""

from __future__ import annotations

import logging
import re

from llm import complete_json

log = logging.getLogger(__name__)

CATEGORIES = (
    "coffee",
    "cafe",
    "restaurant",
    "fast_food",
    "bakery",
    "bar",
    "retail",
    "services",
    "pickup_point",
    "other",
)
PREMISES = ("street_retail", "office", "warehouse")
DEALS = ("rent", "sale", "any")
SEGMENTS = ("econom", "middle", "premium")
PEAKS = ("morning", "day", "evening", "late")
DISTRICTS = (
    "Вахитовский",
    "Ново-Савиновский",
    "Советский",
    "Приволжский",
    "Московский",
    "Кировский",
    "Авиастроительный",
)
FOOD = {"coffee", "cafe", "restaurant", "fast_food", "bakery", "bar"}

DEFAULT_QUERIES = {
    "coffee": ["кофейня"],
    "cafe": ["кафе"],
    "restaurant": ["ресторан"],
    "fast_food": ["быстрое питание"],
    "bakery": ["пекарня"],
    "bar": ["бар"],
    "retail": ["магазин"],
    "services": ["услуги"],
    "pickup_point": ["пункт выдачи заказов"],
    "other": ["магазин"],
}

INSTRUCTIONS = """Ты разбираешь описание будущего бизнеса для подбора помещения в Казани.
Верни только JSON-объект без markdown и пояснений. Поля:
business_type — короткое название бизнеса по-русски, например «кофейня с собой»;
category — одно из: coffee, cafe, restaurant, fast_food, bakery, bar, retail, services, pickup_point, other;
premises — street_retail, office или warehouse;
deal — rent, sale или any;
budget_month_rub — предел аренды в месяц в рублях или null;
budget_total_rub — предел цены покупки в рублях или null;
area_min_m2, area_max_m2 — числа или null;
needs_food — true, если нужна кухня, вытяжка или приготовление еды;
min_power_kw — число или null;
avg_check_rub — средний чек в рублях или null, если в тексте его нет;
price_segment — econom, middle или premium;
target_audience — кратко, кто клиенты;
peak_hours — morning, day, evening или late;
competitor_queries — 1–3 коротких запроса для поиска конкурентов на Яндекс Картах, например ["кофейня", "кофе с собой"];
competitor_radius_m — радиус конкуренции в метрах, по умолчанию 500;
districts — районы Казани из описания: Вахитовский, Ново-Савиновский, Советский, Приволжский, Московский, Кировский, Авиастроительный; пустой список, если не указаны;
notes — важные условия из описания, которые не попали в поля.
Ничего не выдумывай: если значения нет в тексте, ставь null или значение по умолчанию."""


def _number(value) -> float | None:
    if value in (None, "", "null"):
        return None
    try:
        number = float(str(value).replace(" ", "").replace(",", "."))
    except ValueError:
        return None
    return number if number > 0 else None


def _choice(value, options: tuple[str, ...], default: str) -> str:
    value = str(value or "").strip().lower()
    return value if value in options else default


def normalize(data: dict, text: str, parser: str) -> dict:
    category = _choice(data.get("category"), CATEGORIES, "other")
    queries = [
        str(item).strip()
        for item in data.get("competitor_queries") or []
        if str(item).strip()
    ][:3] or DEFAULT_QUERIES[category]
    radius = _number(data.get("competitor_radius_m")) or 500
    districts = [
        name
        for name in DISTRICTS
        if any(name.lower() in str(item).lower() for item in data.get("districts") or [])
    ]
    needs_food = data.get("needs_food")
    if not isinstance(needs_food, bool):
        needs_food = category in FOOD
    return {
        "description": text.strip(),
        "business_type": str(data.get("business_type") or "").strip() or text.strip()[:60],
        "category": category,
        "premises": _choice(data.get("premises"), PREMISES, "street_retail"),
        "deal": _choice(data.get("deal"), DEALS, "rent"),
        "budget_month_rub": _number(data.get("budget_month_rub")),
        "budget_total_rub": _number(data.get("budget_total_rub")),
        "area_min_m2": _number(data.get("area_min_m2")),
        "area_max_m2": _number(data.get("area_max_m2")),
        "needs_food": needs_food,
        "min_power_kw": _number(data.get("min_power_kw")),
        "avg_check_rub": _number(data.get("avg_check_rub")),
        "price_segment": _choice(data.get("price_segment"), SEGMENTS, "middle"),
        "target_audience": str(data.get("target_audience") or "").strip(),
        "peak_hours": _choice(data.get("peak_hours"), PEAKS, "day"),
        "competitor_queries": queries,
        "competitor_radius_m": int(min(1500, max(150, radius))),
        "districts": districts,
        "notes": str(data.get("notes") or "").strip(),
        "city": "Казань",
        "parser": parser,
    }


RULES = (
    (r"барбер|салон|маникюр|стоматолог|ремонт|химчистк|ателье", "services"),
    (r"пункт выдачи|пвз", "pickup_point"),
    (r"кофе", "coffee"),
    (r"пекар|выпечк", "bakery"),
    (r"шаурм|бургер|фастфуд|фаст-фуд|пицц|донер", "fast_food"),
    (r"ресторан", "restaurant"),
    (r"\bбар\b|паб|пивн", "bar"),
    (r"кафе|столов", "cafe"),
    (r"магазин|продукт|цвет|одежд|аптек", "retail"),
)


def _money(text: str, pattern: str) -> float | None:
    match = re.search(pattern + r"\s*(\d[\d\s]*[.,]?\d*)\s*(млн|тыс|т\.р|к\b)?", text)
    if not match:
        return None
    number = float(match.group(1).replace(" ", "").replace(",", "."))
    unit = match.group(2) or ""
    if unit.startswith("млн"):
        number *= 1_000_000
    elif unit:
        number *= 1_000
    return number


def rules(text: str) -> dict:
    lower = text.lower()
    category = next((name for pattern, name in RULES if re.search(pattern, lower)), "other")
    deal = "rent"
    if re.search(r"куп|покупк|в собственност", lower):
        deal = "sale"
    if "аренд" in lower and deal == "sale":
        deal = "any"
    budget = _money(lower, r"до")
    premises = "street_retail"
    if "склад" in lower:
        premises = "warehouse"
    elif "офис" in lower:
        premises = "office"
    area = re.search(r"(\d{2,4})\s*(?:м2|м²|кв)", lower)
    return {
        "business_type": text.strip()[:60],
        "category": category,
        "premises": premises,
        "deal": deal,
        "budget_month_rub": budget if deal != "sale" else None,
        "budget_total_rub": budget if deal == "sale" else None,
        "area_min_m2": float(area.group(1)) * 0.8 if area else None,
        "area_max_m2": float(area.group(1)) * 1.2 if area else None,
        "districts": [name for name in DISTRICTS if name.lower()[:6] in lower],
    }


def parse_brief(text: str) -> dict:
    if not text.strip():
        raise ValueError("Описание бизнеса пустое")
    try:
        return normalize(complete_json(text, INSTRUCTIONS, max_output_tokens=700), text, "llm")
    except Exception as error:
        log.warning("LLM не разобрала описание: %s", error)
        return normalize(rules(text), text, "rules")
