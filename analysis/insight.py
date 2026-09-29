"""Новостной фон адреса и вывод о целесообразности открытия.

Нейропоиск ищет новости об улице и районе, затем модель Alice сводит
новости, конкурентов и финансовую модель в короткий вывод. Если нейропоиск
не ответил, вывод строится без новостей, и это видно в поле `news_error`.
"""

from __future__ import annotations

import json
import logging

from llm import complete_json
from neurosearch import analyze_address

log = logging.getLogger(__name__)

VERDICTS = ("подходит", "осторожно", "не брать")

INSTRUCTIONS = """Ты помогаешь предпринимателю решить, открывать ли бизнес по адресу в Казани.
На входе JSON: описание бизнеса, помещение, модельная проходимость, конкуренты из Яндекса,
модельная экономика и новостная сводка по улице и району.
Верни только JSON без markdown:
{"verdict": "подходит" | "осторожно" | "не брать",
 "summary": "2–3 предложения, главный вывод",
 "advantages": ["до 4 коротких пунктов"],
 "risks": ["до 4 коротких пунктов"],
 "news_factors": ["до 3 пунктов: что из новостей влияет на решение; пусто, если ничего"]}
Опирайся только на данные входа. Пешеходы в сутки — поток гексагона Яндекс Геоаналитики. Экономика на этих цифрах — модель, не называй её кассовым отчётом."""


def _facts(brief: dict, place: dict, news: str) -> dict:
    return {
        "business": {
            key: brief.get(key)
            for key in (
                "business_type",
                "category",
                "deal",
                "budget_month_rub",
                "budget_total_rub",
                "avg_check_rub",
                "price_segment",
                "target_audience",
                "peak_hours",
            )
        },
        "place": {
            key: place.get(key)
            for key in (
                "address",
                "district",
                "deal",
                "area_m2",
                "price_month",
                "price_total",
                "floor",
                "line",
                "metro",
                "food_ready",
                "flags",
            )
        },
        "footfall_model": place.get("footfall"),
        "competition": place.get("competition"),
        "nearest_competitors": [
            {key: org.get(key) for key in ("name", "distance_m", "categories", "hours", "chain")}
            for org in (place.get("competitors") or [])[:8]
        ],
        "finance_model": {
            key: (place.get("finance") or {}).get(key)
            for key in (
                "pedestrians_day",
                "visitors_day",
                "revenue_month",
                "occupancy_month",
                "profit_month",
                "payback_months",
                "occupancy_share",
            )
        },
        "rule_verdict": place.get("verdict"),
        "news": news[:3500],
    }


def district_insight(brief: dict, place: dict) -> dict:
    address = f"{place['address']}, {place['district']} район"
    news_text = ""
    sources = []
    news_error = None
    try:
        news = analyze_address(address, business=brief.get("business_type") or "")
        news_text = news.text
        sources = [
            {"title": item.title, "url": item.url, "used": item.used}
            for item in news.sources
        ]
    except Exception as error:
        log.warning("Нейропоиск не ответил для %s: %s", address, error)
        news_error = str(error)

    facts = _facts(brief, place, news_text)
    try:
        verdict = complete_json(
            json.dumps(facts, ensure_ascii=False),
            INSTRUCTIONS,
            temperature=0.2,
            max_output_tokens=900,
        )
    except Exception as error:
        log.warning("LLM не дала вывод для %s: %s", address, error)
        verdict = {"summary": "", "error": str(error)}
    if verdict.get("verdict") not in VERDICTS:
        verdict["verdict"] = place.get("verdict")
    for key in ("advantages", "risks", "news_factors"):
        verdict[key] = [str(item) for item in verdict.get(key) or []][:4]
    verdict["summary"] = str(verdict.get("summary") or "")
    return {
        "id": place["id"],
        "address": address,
        "verdict": verdict,
        "news_text": news_text,
        "sources": sources,
        "news_error": news_error,
    }
