#!/usr/bin/env python3
"""Проверочный бот MAX: отвечает на старт, /ping и повторяет текст."""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from envfile import ENV_PATH, load_env

BASE_URL = "https://platform-api2.max.ru"
ROOT = Path(__file__).resolve().parent


def ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.load_verify_locations(cafile=str(ROOT / "certs" / "russian_trusted_root_ca.pem"))
    context.load_verify_locations(cafile=str(ROOT / "certs" / "russian_trusted_sub_ca.pem"))
    return context


SSL_CONTEXT = ssl_context()


class ApiError(RuntimeError):
    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        super().__init__(f"{method} {path} -> {status} {body}")
        self.status = status
        self.body = body


def api(token: str, method: str, path: str, params: dict | None = None, body: dict | None = None) -> dict:
    query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
    url = f"{BASE_URL}{path}" + (f"?{query}" if query else "")
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": token,
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, context=SSL_CONTEXT, timeout=40) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise ApiError(method, path, error.code, detail) from error


def reply_targets(update: dict) -> list[dict]:
    if update.get("update_type") == "bot_started":
        user_id = (update.get("user") or {}).get("user_id")
        return [{"user_id": user_id}] if user_id is not None else []

    message = update.get("message") or {}
    sender = message.get("sender") or {}
    if sender.get("is_bot"):
        return []
    recipient = message.get("recipient") or {}
    chat_type = recipient.get("chat_type") or recipient.get("type")
    user_id = sender.get("user_id") or recipient.get("user_id")
    chat_id = recipient.get("chat_id")
    if chat_type in {"chat", "channel"} and chat_id is not None:
        return [{"chat_id": chat_id}]
    targets = []
    if user_id is not None:
        targets.append({"user_id": user_id})
    if chat_id is not None:
        targets.append({"chat_id": chat_id})
    return targets


def send_text(token: str, update: dict, text: str) -> None:
    last_error: ApiError | None = None
    for target in reply_targets(update):
        try:
            api(token, "POST", "/messages", params=target, body={"text": text[:4000]})
            return
        except ApiError as error:
            last_error = error
            if error.status != 404:
                raise
    if last_error is not None:
        raise last_error


def message_text(update: dict) -> str:
    body = (update.get("message") or {}).get("body") or {}
    return (body.get("text") or "").strip()


def answer_for(update: dict, bot_name: str, username: str) -> str | None:
    kind = update.get("update_type")
    if kind == "bot_started":
        return help_text(bot_name, username)
    if kind != "message_created":
        return None
    text = message_text(update)
    command = text.split()[0].lower() if text else ""
    if command in {"/start", "/help", "start"}:
        return help_text(bot_name, username)
    if command == "/ping":
        return "Понг. Бот на связи, API отвечает."
    if not text:
        return "Получил сообщение без текста. Для проверки отправьте /ping или любую фразу."
    return f"Эхо: {text}"


def help_text(bot_name: str, username: str) -> str:
    nick = f"@{username}" if username else "этому боту"
    return (
        f"{bot_name} на связи.\n"
        f"Напишите {nick} в MAX:\n"
        "/ping — проверить, что ответ доходит\n"
        "любой текст — бот пришлёт его обратно"
    )


def poll(token: str, marker: int | None) -> dict:
    params = {
        "limit": 100,
        "timeout": 20,
        "types": "message_created,bot_started",
        "marker": marker,
    }
    return api(token, "GET", "/updates", params=params)


def main() -> None:
    load_env(ENV_PATH)
    token = os.environ.get("MAX_BOT_TOKEN", "").strip()
    if not token:
        sys.exit("В .env нет MAX_BOT_TOKEN")

    me = api(token, "GET", "/me")
    bot_name = me.get("name") or me.get("first_name") or "Бот"
    username = me.get("username") or ""
    print(f"Подключён бот {bot_name} (@{username}), id={me.get('user_id')}", flush=True)

    try:
        subscriptions = api(token, "GET", "/subscriptions")
    except ApiError as error:
        print(f"Не удалось проверить webhook-подписки: {error}", flush=True)
        subscriptions = {}
    active = subscriptions.get("subscriptions") or subscriptions.get("items") or []
    if active:
        sys.exit("Long polling недоступен: у бота уже есть webhook-подписка. Для этой проверки её нужно снять.")

    primed = poll(token, None)
    marker = primed.get("marker")
    skipped = len(primed.get("updates") or [])
    print(f"Старые события пропущены: {skipped}. Жду новые сообщения.", flush=True)

    while True:
        try:
            page = poll(token, marker)
        except ApiError as error:
            if error.status == 405:
                sys.exit("Long polling отклонён (405). Обычно это значит, что включён webhook.")
            print(f"Ошибка опроса: {error}", flush=True)
            time.sleep(3)
            continue
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            print(f"Сеть: {error}", flush=True)
            time.sleep(3)
            continue

        if page.get("marker") is not None:
            marker = page["marker"]
        for update in page.get("updates") or []:
            text = answer_for(update, bot_name, username)
            if text is None:
                continue
            try:
                send_text(token, update, text)
                print(f"{update.get('update_type')}: ответ отправлен", flush=True)
            except ApiError as error:
                print(f"Не удалось ответить: {error}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nОстановлен.", flush=True)
