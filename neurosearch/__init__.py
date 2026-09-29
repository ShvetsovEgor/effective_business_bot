"""Нейропоиск Яндекса по адресу.

`analyze_address(address)` ищет новостные сводки и просит выводы за и против
открытия точки. Запуск: `python -m neurosearch "Казань, улица Баумана, 42"`.
Ключ тот же, что у модуля `llm`.
"""

from neurosearch.yandex import analyze_address

__all__ = ["analyze_address"]
