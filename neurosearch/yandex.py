"""Нейропоиск по адресу через Yandex AI Studio.

Ищет новостные сводки об адресе и собирает выводы, что из этого следует
для открытия точки. Ключ берётся из `.env`: `YANDEX_CLOUD_API_KEY` или
`YANDEX_AI_STUDIO_API_KEY`. Каталог — `YANDEX_CLOUD_FOLDER`.

В текущем SDK у генеративного поиска нет параметра `search_type`.
Русская выдача задаётся фильтром `lang=ru`. Исправление опечаток включено,
страницы вне прямого перехода с найденных сайтов не подмешиваются.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

os.environ.setdefault("GRPC_DNS_RESOLVER", "native")

from yandex_ai_studio_sdk import AIStudio

from llm.yandex import FOLDER, api_key, load_env

SEARCH_LANG = "ru"


@dataclass(frozen=True)
class Source:
    url: str
    title: str
    used: bool


@dataclass(frozen=True)
class AddressSearch:
    address: str
    query: str
    text: str
    sources: tuple[Source, ...]
    fixed_misspell_query: str | None
    is_answer_rejected: bool
    is_bullet_answer: bool


def folder_id() -> str:
    load_env()
    return os.environ.get("YANDEX_CLOUD_FOLDER", FOLDER).strip() or FOLDER


def address_query(address: str, business: str = "") -> str:
    place = address.strip()
    if not place:
        raise ValueError("Адрес пустой")
    target = business.strip() or "точки общепита или торговли"
    where = "этом перекрёстке, этих улицах и районе" if place.startswith("пересечение") else "этой улице и районе"
    return (
        f"Место: {place}. "
        f"Найди новостные сводки об {where}: стройки, транспорт, "
        "закрытия и открытия бизнеса, события и жалобы жителей. "
        "Номер дома не используй. "
        f"Дальше отдельно перечисли, что из найденного говорит за открытие: {target}, "
        "в этом месте и что говорит против. "
        "Каждый вывод привяжи к источнику."
    )


def analyze_address(address: str, *, business: str = "", timeout: float = 90) -> AddressSearch:
    query = address_query(address, business)
    sdk = AIStudio(folder_id=folder_id(), auth=api_key())
    sdk.setup_default_logging()
    search = sdk.search_api.generative(
        fix_misspell=True,
        enable_nrfm_docs=False,
        search_filters=[{"lang": SEARCH_LANG}],
    )
    result = search.run(query, timeout=timeout)
    sources = tuple(
        Source(url=item.url, title=item.title, used=item.used)
        for item in result.sources
    )
    return AddressSearch(
        address=address.strip(),
        query=query,
        text=result.text or "",
        sources=sources,
        fixed_misspell_query=result.fixed_misspell_query,
        is_answer_rejected=result.is_answer_rejected,
        is_bullet_answer=result.is_bullet_answer,
    )
