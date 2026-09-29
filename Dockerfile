FROM python:3.12-slim

WORKDIR /app
COPY certs ./certs
COPY bot.py .

CMD ["python", "-u", "bot.py"]
