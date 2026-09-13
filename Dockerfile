FROM node:22-bookworm-slim AS web
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ENV CI=1
RUN npm run typecheck && npm run build:web

FROM python:3.14-slim-bookworm AS backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml ./
COPY app/ app/
COPY card_utils/ card_utils/
COPY callbreak/ callbreak/
COPY marriage/ marriage/
COPY flush/ flush/
RUN pip install --no-cache-dir . && useradd --uid 10001 --create-home bhidne
USER bhidne
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"
# One process is required: all rooms, authentication and game state live in memory.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]

# Optional combined deployment; the Droplet uses only the backend target.
FROM backend AS combined
ENV BHIDNE_WEB_DIR=/app/web
COPY --from=web /build/client/dist/ /app/web/
