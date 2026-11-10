# Deployment & Operational Guide

## 1. Local Development via Docker Compose

The simplest way to run all 4 independent applications along with their dedicated databases is Docker Compose:

```bash
# 1. Clone repository & copy environment templates
cp .env.example .env

# 2. Build and launch all containers
docker-compose up --build
```

### Services & Port Mappings:
| Service | Technology | Port | URL |
| :--- | :--- | :--- | :--- |
| **Web Frontend** | Next.js 16 | 3000 | `http://localhost:3000` |
| **Core ERP API** | Node.js / Express | 4000 | `http://localhost:4000` |
| **AI Backend** | Python FastAPI | 8000 | `http://localhost:8000` |
| **Voice Assistant** | Python FastAPI | 8050 | `http://localhost:8050` |
| **ERP PostgreSQL** | PostgreSQL 16 | 5432 | `localhost:5432` |
| **AI PostgreSQL** | PG + pgvector | 5433 | `localhost:5433` |
| **Voice PostgreSQL**| PostgreSQL 16 | 5434 | `localhost:5434` |
| **Redis** | Redis 7 | 6379 | `localhost:6379` |

---

## 2. Independent Manual Execution

Each application can also be executed standalone in development mode:

### 2.1 Frontend:
```bash
npm install
npm run dev
# Running on http://localhost:3000
```

### 2.2 Core ERP Backend:
```bash
cd apps/core-api
npm install
npm run dev
# Running on http://localhost:4000
```

### 2.3 AI Backend:
```bash
cd apps/ai-api
python -m venv venv
source venv/bin/activate # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# Running on http://localhost:8000
```

### 2.4 Voice Assistant Backend:
```bash
cd apps/voice-api
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8050 --reload
# Running on http://localhost:8050
```

