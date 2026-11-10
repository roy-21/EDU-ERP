import urllib.request
import base64
import json

code = """graph TB
    subgraph Client Tier [Frontend - All Roles]
        UI_Teacher["Teacher Portal"]
        UI_Admin["Admin Portal"]
        UI_Custom["Dynamic Role Portals"]
        UI_HR["HR Portal"]
        UI_Student["Student Portal"]
        UI_Guardian["Guardian Portal"]
    end

    subgraph Core Tier [Central Communication Hub]
        CoreERP["Core ERP Backend (NestJS / Node.js)<br/>• Auth & JWT / Dynamic RBAC<br/>• Business Logic & CRUD<br/>• Tenant Context Interceptor<br/>• API Gateway & Dispatcher"]
    end

    subgraph Specialized AI Tier [Independent Services]
        AIEngine["AI Backend (Python / FastAPI)<br/>• Risk & Dropout Prediction<br/>• Academic Performance Forecast<br/>• Intelligent Recommendations<br/>• Model Registry & Drift Monitor"]
        VoiceEngine["AI Voice & Message Assistant Backend (FastAPI)<br/>• Speech-to-Text & Text-to-Speech<br/>• Natural Language Chat Assistant<br/>• User Query Processing<br/>• AI Intelligent Notifications"]
    end

    subgraph Shared Data Tier [Common Data Infrastructure]
        SharedDB["Central Database (PostgreSQL 16 with RLS)<br/>• Multi-Tenant Isolated Schemas<br/>• Relational ERP Entities<br/>• AI Vector Embeddings / pgvector"]
        SharedStorage["Object Storage & Cache<br/>• MinIO / S3 Document Vault<br/>• Redis Session & Token Blacklist<br/>• Central Data Access Management"]
    end

    UI_Teacher -->|API Requests ONLY| CoreERP
    UI_Admin -->|API Requests ONLY| CoreERP
    UI_Custom -->|API Requests ONLY| CoreERP
    UI_HR -->|API Requests ONLY| CoreERP
    UI_Student -->|API Requests ONLY| CoreERP
    UI_Guardian -->|API Requests ONLY| CoreERP

    CoreERP <-->|RPC / HTTP REST| AIEngine
    CoreERP <-->|RPC / WebSocket / REST| VoiceEngine
    CoreERP <-->|Read / Write with RLS| SharedDB
    CoreERP <-->|Read / Write| SharedStorage

    AIEngine <-->|Direct Feature Extraction / Read & Write| SharedDB
    AIEngine <-->|Dataset Processing| SharedStorage

    VoiceEngine <-->|Call Sessions / Transcripts / Read & Write| SharedDB
    VoiceEngine <-->|Audio Chunks & Logs| SharedStorage
"""

payload = json.dumps({"code": code, "mermaid": {"theme": "dark"}})
b64 = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("utf-8")
url = f"https://mermaid.ink/svg/{b64}"

print("Fetching SVG from:", url[:60] + "...")
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        svg_data = resp.read().decode("utf-8")
        with open("workflow_diagram.svg", "w", encoding="utf-8") as f:
            f.write(svg_data)
        print("SUCCESS! Generated workflow_diagram.svg (bytes:", len(svg_data), ")")
except Exception as e:
    print("Error:", e)

