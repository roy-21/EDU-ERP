import os
import subprocess
import base64

# Convert diagram image to base64 so HTML is 100% self-contained
diagram_b64 = ""
if os.path.exists("architecture_diagram.png"):
    with open("architecture_diagram.png", "rb") as f:
        diagram_b64 = base64.b64encode(f.read()).decode("utf-8")

html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Project Proposal - Next-Generation AI-Driven Smart Education Management System</title>
  <style>
    @page {{
      size: A4;
      margin: 14mm 16mm 14mm 16mm;
    }}
    
    * {{
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }}

    body {{
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      line-height: 1.5;
      font-size: 10.5pt;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }}

    /* HEADER BANNER */
    .header-box {{
      text-align: center;
      border-bottom: 2.5px solid #2563eb;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }}

    .sub-header {{
      font-size: 11pt;
      font-weight: 700;
      color: #2563eb;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 2px;
    }}

    .inst-name {{
      font-size: 15pt;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 4px 0;
    }}

    .dept-name {{
      font-size: 11pt;
      font-weight: 600;
      color: #475569;
      margin: 0 0 10px 0;
    }}

    .project-title-box {{
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #ffffff;
      padding: 14px 18px;
      border-radius: 8px;
      margin-top: 10px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    }}

    .project-title {{
      font-size: 15pt;
      font-weight: 800;
      color: #38bdf8;
      margin: 0 0 4px 0;
      letter-spacing: -0.2px;
    }}

    .project-subtitle {{
      font-size: 9.5pt;
      color: #cbd5e1;
      margin: 0;
      font-weight: 400;
    }}

    /* MEMBERS TABLE */
    .section-title {{
      font-size: 12pt;
      font-weight: 800;
      color: #0f172a;
      border-left: 4px solid #2563eb;
      padding-left: 8px;
      margin: 16px 0 10px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }}

    .members-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 14px;
    }}

    .member-card {{
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }}

    .member-card.featured {{
      border-top: 3px solid #2563eb;
    }}

    .member-name {{
      font-size: 11.5pt;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 6px 0;
    }}

    .member-meta {{
      font-size: 9pt;
      color: #475569;
      line-height: 1.45;
    }}

    .member-meta strong {{
      color: #1e293b;
    }}

    .role-badge {{
      display: inline-block;
      margin-top: 5px;
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 8pt;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #bfdbfe;
    }}

    /* OBJECTIVES LIST */
    .objectives-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 14px;
    }}

    .objective-item {{
      background: #f8fafc;
      border-left: 3px solid #0ea5e9;
      padding: 8px 12px;
      border-radius: 0 6px 6px 0;
      font-size: 9pt;
      line-height: 1.4;
    }}

    .objective-item strong {{
      color: #0369a1;
      display: block;
      margin-bottom: 2px;
      font-size: 9.5pt;
    }}

    /* FEATURES TABLE */
    table.features-table {{
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 8.8pt;
    }}

    table.features-table th {{
      background: #0f172a;
      color: #ffffff;
      padding: 7px 10px;
      text-align: left;
      font-weight: 700;
      font-size: 9pt;
    }}

    table.features-table td {{
      padding: 7px 10px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      line-height: 1.35;
    }}

    table.features-table tr:nth-child(even) {{
      background: #f8fafc;
    }}

    .cluster-title {{
      font-weight: 700;
      color: #1e40af;
      white-space: nowrap;
    }}

    /* ARCHITECTURE DIAGRAM SECTION */
    .page-break {{
      page-break-before: always;
    }}

    .diagram-wrapper {{
      background: #0f172a;
      padding: 12px;
      border-radius: 8px;
      text-align: center;
      margin: 10px 0 12px 0;
      border: 1px solid #334155;
    }}

    .diagram-img {{
      max-width: 100%;
      max-height: 480px;
      object-fit: contain;
      border-radius: 4px;
      display: block;
      margin: 0 auto;
    }}

    .tech-stack-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      margin-top: 8px;
    }}

    .tech-stack-table td {{
      padding: 5px 8px;
      border: 1px solid #e2e8f0;
      line-height: 1.35;
    }}

    .tech-stack-table td.tier {{
      background: #f1f5f9;
      font-weight: 700;
      color: #0f172a;
      width: 25%;
    }}

    /* PERSPECTIVE CARDS */
    .perspective-card {{
      background: #f8fafc;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      padding: 9px 12px;
      margin-bottom: 8px;
      font-size: 8.8pt;
    }}

    .perspective-card h4 {{
      margin: 0 0 5px 0;
      font-size: 9.5pt;
      font-weight: 700;
      color: #1e293b;
    }}

    .perspective-card ul {{
      margin: 0;
      padding-left: 18px;
    }}

    .perspective-card li {{
      margin-bottom: 3px;
    }}

    /* FOOTER */
    .footer-note {{
      text-align: center;
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1.5px solid #cbd5e1;
      font-size: 8pt;
      color: #64748b;
    }}
  </style>
</head>
<body>

  <!-- PAGE 1: TITLE, MEMBERS, OBJECTIVES & KEY FEATURES -->
  <div class="header-box">
    <div class="sub-header">Project Proposal of Final Semester - 2026</div>
    <div class="inst-name">Daffodil Institute of IT (DIIT)</div>
    <div class="dept-name">Department of Computer Science and Engineering</div>

    <div class="project-title-box">
      <div class="project-title">Next-Generation AI-Driven Smart Education Management System</div>
      <div class="project-subtitle">Enterprise Multi-Tenant SaaS Platform with Autonomous AI & Real-Time Voice Assistance</div>
    </div>
  </div>

  <div class="section-title">👥 Project Contributors / Group Members</div>
  <div class="members-grid">
    <div class="member-card featured">
      <div class="member-name">MD. Maruf Ahmmed</div>
      <div class="member-meta">
        <strong>Class ID:</strong> 210006<br>
        <strong>Registration No:</strong> 20502005439<br>
        <strong>Session:</strong> 2020–2021 | <strong>Dept:</strong> CSE, DIIT
      </div>
      <div class="role-badge">Role: System Architecture & AI Pipeline</div>
    </div>

    <div class="member-card featured">
      <div class="member-name">Sojib Chandra Roy</div>
      <div class="member-meta">
        <strong>Class ID:</strong> 210005<br>
        <strong>Registration No:</strong> 20502005384<br>
        <strong>Session:</strong> 2020–2021 | <strong>Dept:</strong> CSE, DIIT
      </div>
      <div class="role-badge">Role: Core Backend & Enterprise RBAC</div>
    </div>
  </div>

  <div class="section-title">🎯 Main Objectives</div>
  <div class="objectives-grid">
    <div class="objective-item">
      <strong>Real-Time Performance Monitoring</strong>
      Continuous real-time tracking of student GPA, academic progress, daily biometric attendance, and assignment lifecycles.
    </div>
    <div class="objective-item">
      <strong>AI-Based Learning Suggestions</strong>
      Deploy machine learning algorithms to assess individual learning curves, identify gaps, and deliver personalized study paths.
    </div>
    <div class="objective-item">
      <strong>Stakeholder Notification Gateway</strong>
      Automated dual-channel notifications (SMS, Email, Push) alerting guardians to student attendance anomalies, grades, and dues.
    </div>
    <div class="objective-item">
      <strong>Faculty & Pedagogical Intelligence</strong>
      Empower teachers with predictive cohort risk detection (dropout probability) and actionable instructional improvement insights.
    </div>
  </div>

  <div class="section-title">⚡ Key Features (Existing System Analysis)</div>
  <table class="features-table">
    <thead>
      <tr>
        <th style="width: 28%;">Functional Cluster</th>
        <th>Production Core Modules & System Capabilities</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="cluster-title">🧠 Intelligent AI & Analytics</td>
        <td>
          • <strong>AI Academic Risk Predictor:</strong> Early dropout detection and GPA forecasting using ML regression/classification.<br>
          • <strong>AI Voice & Chatbot Assistant:</strong> Independent conversational voice/text assistant for queries and parent alerts.<br>
          • <strong>Schedule Conflict Detection:</strong> Autonomous prevention of teacher, room, and section timetable clashes.
        </td>
      </tr>
      <tr>
        <td class="cluster-title">🛡️ Universal Security & RBAC</td>
        <td>
          • <strong>Universal Credential Engine:</strong> Auto-generates unique usernames and cryptographic passwords for all roles.<br>
          • <strong>Zero Plain-Text Policy:</strong> High-entropy bcrypt/Argon2id hashing with mandatory password change on first login.<br>
          • <strong>32-Module RBAC Matrix:</strong> Granular permissions (<code>read</code>, <code>create</code>, <code>update</code>, <code>delete</code>, <code>export</code>, <code>approve</code>).
        </td>
      </tr>
      <tr>
        <td class="cluster-title">🎓 Academics & Lifecycle</td>
        <td>
          • <strong>Student & Faculty Directory:</strong> Digital portfolios, transcripts, attendance registers, and RFID/ID card generator.<br>
          • <strong>Dual Admission Pipeline:</strong> Single enrollment action provisions verified student and guardian accounts concurrently.<br>
          • <strong>Examination & Grading:</strong> Seating allocation, dynamic GPA calculation, and QR-verifiable official PDF transcripts.
        </td>
      </tr>
      <tr>
        <td class="cluster-title">💳 Finance & Campus Operations</td>
        <td>
          • <strong>Fee & Invoicing Ledger:</strong> Multi-tiered fee heads, partial payments, student invoices, and ledger audits.<br>
          • <strong>Campus Vault Modules:</strong> Integrated Library Catalog, Hostel Allocations, Fleet/Transport Routes, and Inventory.
        </td>
      </tr>
    </tbody>
  </table>

  <!-- PAGE 2: ARCHITECTURE DIAGRAM, METHODOLOGY & BUSINESS PERSPECTIVE -->
  <div class="page-break"></div>

  <div class="section-title" style="margin-top: 0;">📐 Methodology & System Architecture</div>
  <p style="font-size: 8.8pt; color: #475569; margin: 0 0 8px 0;">
    The ecosystem enforces a <strong>Decoupled Tiered Microservices Architecture</strong> where the Frontend communicates exclusively with the Core ERP Backend, while AI and Voice backends operate independently sharing a secured data infrastructure.
  </p>

  <div class="diagram-wrapper">
    <div style="color: #38bdf8; font-weight: 700; font-size: 9pt; margin-bottom: 6px; letter-spacing: 0.5px;">
      SYSTEM ARCHITECTURE & MULTI-TIER COMMUNICATION WORKFLOW
    </div>
    {"<img class='diagram-img' src='data:image/png;base64," + diagram_b64 + "' alt='System Architecture Diagram' />" if diagram_b64 else "<p style='color:#fff;'>Architecture Diagram Embedded</p>"}
  </div>

  <table class="tech-stack-table">
    <tr>
      <td class="tier">Client Tier (Frontend)</td>
      <td><strong>Next.js 16 App Router</strong>, React 19, Tailwind CSS, Lucide Icons, Client Route Guards (Role-specific portals).</td>
    </tr>
    <tr>
      <td class="tier">Central Hub (Core ERP)</td>
      <td><strong>Node.js / Express / TypeScript</strong>: Central API Gateway, JWT Authentication, Dynamic RBAC, Multi-Tenant Interceptor.</td>
    </tr>
    <tr>
      <td class="tier">AI Backend Tier</td>
      <td><strong>Python / FastAPI</strong>: Scikit-Learn, PyTorch/Transformers for student risk forecasting and predictive models.</td>
    </tr>
    <tr>
      <td class="tier">Voice & Assistant Tier</td>
      <td><strong>Python / FastAPI / WebSockets</strong>: Speech-to-Text (STT), Text-to-Speech (TTS), and Natural Language Chat Query Processing.</td>
    </tr>
    <tr>
      <td class="tier">Shared Data Tier</td>
      <td><strong>PostgreSQL 16</strong> (Row-Level Security & pgvector), <strong>Redis</strong> (Cache & Session Blacklist), <strong>MinIO/S3</strong> (Object Storage).</td>
    </tr>
  </table>

  <div class="section-title">📊 Research & Business Perspective</div>
  
  <div class="perspective-card">
    <h4>🔬 5.1 Research Perspective</h4>
    <ul>
      <li><strong>Predictive Student Analytics:</strong> Utilizing supervised ML classifiers (Random Forest, Gradient Boosting, LSTMs) to identify at-risk students 6–8 weeks before examinations using attendance trajectories and LMS engagement.</li>
      <li><strong>Conversational Voice Interactivity:</strong> Domain-adapted lightweight LLMs and automated speech engines facilitating localized multilingual voice communication for parents with diverse literacy levels.</li>
      <li><strong>Algorithmic Fairness & Privacy:</strong> Continuous drift monitoring, explainable AI (XAI), and zero-data-leakage architecture guaranteeing compliance with educational privacy standards (GDPR / FERPA).</li>
    </ul>
  </div>

  <div class="perspective-card">
    <h4>💼 5.2 Business & SaaS Perspective</h4>
    <ul>
      <li><strong>Subscription Multi-Tenant SaaS Model:</strong> Tiered B2B subscription pricing (Basic, Standard, Enterprise) per active student annually, generating high-margin predictable Recurring Revenue (ARR).</li>
      <li><strong>Institutional Market Scalability:</strong> Immense market readiness across primary, secondary, and higher education seeking to replace brittle legacy desktop solutions with automated cloud ERPs.</li>
      <li><strong>Ecosystem Integration & Global Reach:</strong> White-label capability, localized multi-currency payment gateways (bKash, Nagad, Stripe, SSLCommerz), and LMS interoperability (Moodle, Canvas, Google Classroom).</li>
      <li><strong>Ancillary Revenue Channels:</strong> Premium monetization via specialized AI predictive add-ons, enterprise custom form builders, and transactional SMS/Voice communication margins.</li>
    </ul>
  </div>

  <div class="footer-note">
    <strong>Daffodil Institute of IT (DIIT)</strong> — Department of Computer Science and Engineering<br>
    Final Semester Project Proposal 2026 | Submitted by: <strong>MD. Maruf Ahmmed</strong> (210006) &amp; <strong>Sojib Chandra Roy</strong> (210005)
  </div>

</body>
</html>
"""

with open("presentation_document.html", "w", encoding="utf-8") as f:
    f.write(html_content)

print("Generated presentation_document.html successfully.")

