FROM python:3.11-slim
WORKDIR /app
# The CPU build of torch first: the default build carries several GB of GPU libraries.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Speech models download on first use into this volume-friendly cache.
ENV HF_HOME=/app/.cache/huggingface
EXPOSE 8050
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8050"]
