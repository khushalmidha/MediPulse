FROM python:3.10-slim

WORKDIR /app

# Install system dependencies required for ML packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Attempt to pre-cache models during build to save startup time
# (Using || true to not fail the build if HF is unreachable)
RUN python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification; \
try: \
    AutoTokenizer.from_pretrained('khushalmidha/TriageBERT'); \
    AutoModelForSequenceClassification.from_pretrained('khushalmidha/TriageBERT'); \
except Exception: \
    pass" || true

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
