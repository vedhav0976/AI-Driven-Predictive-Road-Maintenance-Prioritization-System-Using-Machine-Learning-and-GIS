FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu && pip install -r backend/requirements.txt
COPY backend/*.py ./backend/
COPY models/best.pt models/reported_validation.json ./models/
COPY frontend/public/bengaluru-roads.geojson ./frontend/public/bengaluru-roads.geojson
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
