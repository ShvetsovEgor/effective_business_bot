FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=80

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY analysis ./analysis
COPY commercial_sim ./commercial_sim
COPY llm ./llm
COPY neurosearch ./neurosearch
COPY yandex_map ./yandex_map
COPY certs ./certs
COPY envfile.py bot.py ./
COPY avito-kazan-kommercheskaya-sdam.json avito-kazan-kommercheskaya-sdam.csv ./
COPY yandex-geoanalytics-hexes.json ./

EXPOSE 80

CMD ["python", "-m", "yandex_map.server"]
