"""Запрос к LLM Yandex Cloud через OpenAI-совместимый API.

Ключ читается из `.env`: `YANDEX_CLOUD_API_KEY`, либо уже лежащий рядом
`YANDEX_AI_STUDIO_API_KEY`. Каталог и модель можно переопределить переменными
`YANDEX_CLOUD_FOLDER` и `YANDEX_CLOUD_MODEL`.
"""

from __future__ import annotations

import json
import os

import openai

from envfile import load_env

FOLDER = "b1gv2rfr13cpst5o42jr"
MODEL = "aliceai-llm/latest"
BASE_URL = "https://ai.api.cloud.yandex.net/v1"


def _setting(name: str, default: str) -> str:
    load_env()
    return os.environ.get(name, default).strip() or default


def api_key() -> str:
    load_env()
    key = os.environ.get("YANDEX_CLOUD_API_KEY", "").strip()
    if not key:
        key = os.environ.get("YANDEX_AI_STUDIO_API_KEY", "").strip()
    if not key:
        raise RuntimeError("В .env нет YANDEX_CLOUD_API_KEY")
    return key


def client() -> openai.OpenAI:
    return openai.OpenAI(
        api_key=api_key(),
        base_url=BASE_URL,
        project=_setting("YANDEX_CLOUD_FOLDER", FOLDER),
    )


def complete(
    text: str,
    instructions: str = "",
    *,
    temperature: float = 0.3,
    max_output_tokens: int = 1500,
) -> str:
    folder = _setting("YANDEX_CLOUD_FOLDER", FOLDER)
    model = _setting("YANDEX_CLOUD_MODEL", MODEL)
    response = client().responses.create(
        model=f"gpt://{folder}/{model}",
        temperature=temperature,
        instructions=instructions,
        input=text,
        max_output_tokens=max_output_tokens,
    )
    return response.output_text


def extract_json(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("В ответе модели нет JSON")
    value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("Модель вернула не объект JSON")
    return value


def complete_json(
    text: str,
    instructions: str,
    *,
    temperature: float = 0.1,
    max_output_tokens: int = 1500,
) -> dict:
    return extract_json(
        complete(
            text,
            instructions,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
    )
