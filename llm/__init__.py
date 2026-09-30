"""Вызов модели Alice в Yandex AI Studio.

`complete(text, instructions)` возвращает текст ответа. Ключ и каталог читаются
из `.env` через `envfile`: `YANDEX_CLOUD_API_KEY` или `YANDEX_AI_STUDIO_API_KEY`,
`YANDEX_CLOUD_FOLDER`, `YANDEX_CLOUD_MODEL`.
"""

from llm.yandex import complete, complete_json, extract_json

__all__ = ["complete", "complete_json", "extract_json"]
