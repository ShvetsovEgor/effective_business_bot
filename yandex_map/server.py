"""Виджет подбора места под бизнес в Казани.

Запуск: `python -m yandex_map.server`, страница http://127.0.0.1:8766/.

- `GET /api/heat` — тепловая карта модельной проходимости; пока модель строится, `status=building`;
- `GET /api/offers` — модельные объявления;
- `POST /api/analyze` `{"text": "..."}` — разбор описания, конкуренты и топ-5;
- `POST /api/insight` `{"brief": {...}, "place": {...}}` — новости района и вывод по месту.

Нужны `API_ORG_SEARCH_YANDEX` и ключ AI Studio в `.env`. Ответы Яндекса на диск не пишутся.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from analysis import footfall
from analysis.insight import district_insight
from analysis.ranking import analyze
from commercial_sim.kazan import NOTICE as OFFERS_NOTICE
from commercial_sim.kazan import build_records

STATIC_DIR = Path(__file__).resolve().parent
PAGE = STATIC_DIR / "index.html"
STATIC_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
}
HOST = "127.0.0.1"
PORT = 8766
MAX_BODY = 200_000

log = logging.getLogger(__name__)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        log.info("%s %s", self.address_string(), fmt % args)

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, json.dumps(payload, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Пустой или слишком большой запрос")
        value = json.loads(self.rfile.read(length).decode())
        if not isinstance(value, dict):
            raise ValueError("Ожидался JSON-объект")
        return value

    def do_GET(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path in {"/", "/index.html"}:
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif path == "/api/heat":
            self._json(200, footfall.status())
        elif path == "/api/offers":
            self._json(200, {"notice": OFFERS_NOTICE, "offers": build_records()})
        elif not self._static(path):
            self._send(404, b"not found", "text/plain; charset=utf-8")

    def _static(self, path: str) -> bool:
        relative = path.lstrip("/")
        if not relative or any(part == ".." for part in relative.split("/")):
            return False
        target = (STATIC_DIR / relative).resolve()
        if target.parent != STATIC_DIR or target.suffix not in STATIC_TYPES or not target.is_file():
            return False
        self._send(200, target.read_bytes(), STATIC_TYPES[target.suffix])
        return True

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._body()
            if path == "/api/analyze":
                self._json(200, analyze(str(body.get("text") or "")))
            elif path == "/api/insight":
                self._json(200, district_insight(body["brief"], body["place"]))
            else:
                self._send(404, b"not found", "text/plain; charset=utf-8")
        except (ValueError, KeyError) as error:
            self._json(400, {"error": str(error)})
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            self._json(502, {"error": f"Яндекс ответил {error.code}", "detail": detail})
        except urllib.error.URLError as error:
            self._json(502, {"error": f"Сеть: {error.reason}"})
        except Exception as error:
            log.exception("Ошибка обработки %s", path)
            self._json(500, {"error": str(error)})


def _warm_up() -> None:
    try:
        footfall.get_model()
        log.info("Модель проходимости готова")
    except Exception as error:
        log.error("Модель проходимости не собрана: %s", error)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    threading.Thread(target=_warm_up, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("http://%s:%s", HOST, PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
