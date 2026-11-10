<div align="center">

## Project Proposal of Final Semester - 2026

## Department of Computer Science and Engineering
### Daffodil Institute of IT (DIIT)

---

# Next-Generation AI-Driven Smart Education Management System

---

### Submitted By (Group Members):

| Detail | Group Member (1) | Group Member (2) |
| :--- | :--- | :--- |
| **Student Name** | **MD. Maruf Ahmmed** | **Sojib Chandra Roy** |
| **Class ID** | `210006` | `210005` |
| **Registration No** | `20502005439` | `20502005384` |
| **Session** | `2020–2021` | `2020–2021` |
| **Department** | Computer Science and Engineering (CSE) | Computer Science and Engineering (CSE) |
| **Institution** | Daffodil Institute of IT (DIIT) | Daffodil Institute of IT (DIIT) |

---

### 1. Project Title
**Next-Generation AI-Driven Smart Education Management System**  

---

### 2. Main Objectives
The core purpose of this project is to transform traditional administrative educational software into an active, intelligent, and predictive institutional operating system. The targeted objectives include:

- **Real-Time Performance & Behavioral Monitoring:** Track academic performance (GPA, continuous assessments, course milestones), daily attendance (biometric and schedule-based), and assignment lifecycles in real time.
- **AI-Based Personalized Learning Suggestions:** Deploy machine learning models that analyze individual learning paces, detect learning gaps, and deliver tailored recommendations and instructional resource paths.
- **Automated Dual-Channel Stakeholder Communication:** Keep guardians and parents actively engaged through instantaneous, automated notifications (SMS, Email, and Push) regarding student attendance, exam alerts, fee dues, and academic flags.
- **Faculty Intelligence & Pedagogical Enhancement:** Provide educators with granular cohort insights, early risk detection (dropout / failing probability), and data-backed instructional suggestions to optimize teaching outcomes.
- **Streamlined Institutional Administration:** Unify governance across 32 modular domains—from admissions, grading, and dynamic role-based access control (RBAC) to finance, hostel, and digital asset tracking—under a single, secure multi-tenant architecture.

---

### 3. Key Features *(Derived from Existing System Analysis)*

Based on the architectural codebase and modular ERP foundations, the system features a comprehensive suite of enterprise capabilities:

| Functional Cluster | Core Modules & Capabilities |
| :--- | :--- |
| **Intelligent Core & Analytics** | • **AI Academic Risk Predictor:** Early dropout detection and GPA forecasting using ML regression and classification.<br/>• **AI Voice & Chatbot Assistant:** Independent conversational voice/text assistant for student query resolution and automated parent announcements.<br/>• **Automated Conflict Detection Engine:** Prevents teacher, room, and schedule overlaps across academic timetables. |
| **Universal Security & RBAC** | • **Universal Automated Credential Engine:** Automatically provisions unique usernames and cryptographic temporary passwords for any standard or dynamic role.<br/>• **Zero Plain-Text Policy:** Industry-standard password hashing (bcrypt / Argon2id) with mandatory password changes upon first login.<br/>• **32-Module RBAC Matrix:** Granular permission toggles (`read`, `create`, `update`, `delete`, `export`, `approve`) across all institutional faculties. |
| **Academics & Life-Cycle** | • **Student & Faculty Information Management:** Complete digital portfolios, transcripts, attendance, and ID card generation.<br/>• **Admissions & Dual Provisioning Pipeline:** Single-step enrollment that concurrently establishes verified student and guardian portal credentials.<br/>• **Automated Examination & Grading Engine:** Exam hall assignments, dynamic grading policies, CGPA tabulation, and verifiable PDF transcripts with QR verification. |
| **Finance, Logistics & Operations** | • **Integrated Fee & Accounting Ledger:** Multi-tiered fee structures, digital invoicing, partial payment tracking, and ledger reconciliation.<br/>• **Campus Operations Vault:** Dedicated management modules for Library Catalogs, Hostel Allocations, Fleet/Transport Routes, and Asset Inventory. |

---

### 4. Methodology & Framework

The platform follows a **Decoupled Tiered Microservices / Modular Architecture** adhering to strict enterprise boundaries:

```mermaid
graph TB
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
```

#### Technical Stack Summary:
1. **Frontend Tier:** Next.js 16 (App Router), React 19, Tailwind CSS, Lucide Icons, Client Route Guards.
2. **Central Hub (Core ERP):** Node.js, Express, TypeScript, JWT (JSON Web Tokens), Role-Based Access Control Interceptor.
3. **AI Backend Tier:** Python, FastAPI, Scikit-Learn, PyTorch/Transformers for predictive modeling.
4. **Voice & Assistant Tier:** Python, FastAPI, WebSockets, Speech-to-Text (STT), Text-to-Speech (TTS), and Natural Language Query Processing.
5. **Shared Data Layer:** PostgreSQL 16 with Row-Level Security (RLS) policies for strict tenant data isolation, Redis cache, and S3-compatible Object Storage.

---

### 5.Business Perspective

- **Subscription-Based Multi-Tenant SaaS Model:** Tiered B2B SaaS pricing model (Basic, Standard, Enterprise) charged per-active-student per academic year, ensuring predictable recurring revenue (ARR).
- **Market Viability & Scalability:** High domestic and international market demand across primary, secondary, and higher education institutions seeking to replace fragmented legacy desktop systems with cloud-native automation.
- **Global Expansion & Ecosystem Integration:** Ready-to-scale modular architecture capable of white-label localization, custom multi-currency payment gateway integrations (bKash, Nagad, Stripe, SSLCommerz), and LMS interoperability (Moodle, Canvas, Google Classroom).

---

<div align="center">

*Submitted to: Department of Computer Science and Engineering, Daffodil Institute of IT (DIIT)*  

Submitted by MD. Maruf Ahmmed & Sojib Chandra Roy

</div>
