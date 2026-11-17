# SmartHeart -- FastAPI prediction app (app/server.py)
#
#   docker build -t smartheart .
#   docker run --rm -p 8000:8000 -v smartheart-data:/data smartheart
#
# The first run creates data/smartheart.db inside the /data volume and prints the
# generated admin password to the container log -- copy it from `docker logs`.

FROM python:3.12-slim

# libgomp1: OpenMP runtime needed by xgboost / catboost / scikit-learn
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONWARNINGS=ignore \
    PYTHONPATH=/app/src

WORKDIR /app

# CPU-only torch first: the default PyPI wheel pulls ~2.5 GB of CUDA libraries the
# app never uses (models are loaded with map_location="cpu").
RUN pip install --no-cache-dir torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu

COPY requirements-app.txt .
RUN pip install --no-cache-dir -r requirements-app.txt

# Source, models and the training CSV (SHAP builds its background set from data/merge.csv)
COPY src/ ./src/
COPY app/ ./app/
COPY models/ ./models/
COPY data/merge.csv ./data/merge.csv

# SQLite lives in its own volume so it is not shadowed by anything in /app/data
RUN useradd --create-home --uid 1000 appuser \
 && mkdir -p /data \
 && chown -R appuser:appuser /data /app
USER appuser
VOLUME ["/data"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/', timeout=4).status == 200 else 1)"

# Append --seed-demo to create demo patients, or --reset-admin to print a new admin password.
CMD ["python", "app/server.py", "--host", "0.0.0.0", "--port", "8000", "--db", "/data/smartheart.db"]
