# Single container: FastAPI serves the API and the built web app (blueprint §4).
# Build only; deployment requires explicit owner approval (see docs/deployment-plan.md).

FROM node:22-alpine AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM python:3.12-slim AS api
# Defaults = the public, read-only demo (docs/security-audit.md): recorded real Foundry runs are served from the
# repo, no model client is ever created (cache-only), the hard call cap is 0 on this fresh disk, and the image
# holds no endpoint, key, tenant or identity. Live inference needs all of those overridden deliberately.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    BYLINE_AI_PROVIDER=foundry \
    BYLINE_AI_CACHE_ONLY=true \
    FOUNDRY_DEPLOYMENT=gpt-4.1-mini \
    BYLINE_MODEL_CALL_CAP=0 \
    BYLINE_API_DOCS=false \
    BYLINE_TRUSTED_PROXY_HOPS=1 \
    BYLINE_STATIC_DIR=/app/web
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/requirements-ai.txt ./
RUN pip install --no-cache-dir . -r requirements-ai.txt && pip uninstall -y byline-api
COPY apps/api/ ./
COPY contracts/ /app/contracts/
COPY --from=web /web/dist /app/web
RUN useradd --create-home --uid 10001 byline && mkdir -p /app/apps/api/.cache && chown -R byline /app/apps/api/.cache
USER byline
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["python", "-m", "uvicorn", "byline.api.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]
