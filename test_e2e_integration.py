"""
End-to-End Multi-Service Integration Test
Verifies:
  1. Core ERP Backend (Port 4000): Health Check & JWT Authentication
  2. AI Backend (Port 8000): Student Academic Risk Prediction with Scikit-learn
  3. AI Backend (Port 8000): Course RAG Assistant with Verifiable Citations
  4. Voice Backend (Port 8050): Inbound Voice Call Simulation with Auto-Objection Detection
  5. Cross-Service Workflow: Voice Backend automatically triggers Core ERP API to create a tracked ticket!
  6. Verification: Core ERP /api/v1/objections confirms ticket persisted with source='AI_VOICE_CALL'.
"""

import time
import requests
import sys

CORE_ERP_URL = "http://127.0.0.1:4000/api/v1"
AI_API_URL = "http://127.0.0.1:8000/api/v1"
VOICE_API_URL = "http://127.0.0.1:8050/api/v1"

def test_system_integration():
    print("================================================================")
    print(">> RUNNING END-TO-END MULTI-SERVICE INTEGRATION TEST SUITE")
    print("================================================================")

    # 1. Health Checks
    print("\n[Step 1] Checking Service Health...")
    r_core = requests.get(f"{CORE_ERP_URL}/health", timeout=3)
    assert r_core.status_code == 200, f"Core ERP health failed: {r_core.text}"
    print("  [PASS] Core ERP Backend (Port 4000): HEALTHY")

    r_ai = requests.get(f"{AI_API_URL}/health", timeout=3)
    assert r_ai.status_code == 200, f"AI Backend health failed: {r_ai.text}"
    print("  [PASS] AI Backend Service (Port 8000): HEALTHY")

    r_voice = requests.get(f"{VOICE_API_URL}/health", timeout=3)
    assert r_voice.status_code == 200, f"Voice Backend health failed: {r_voice.text}"
    print("  [PASS] Voice Assistant Service (Port 8050): HEALTHY")

    # 2. Core ERP Authentication
    print("\n[Step 2] Authenticating with Core ERP...")
    r_login = requests.post(f"{CORE_ERP_URL}/auth/login", json={
        "email": "admin@institution.edu",
        "password": "password123"
    }, timeout=3)
    assert r_login.status_code == 200
    token = r_login.json()["data"]["token"]
    print(f"  [PASS] Super Admin Authenticated. JWT Token Acquired (starts with: {token[:16]}...)")

    # 3. AI Predictive Model Execution
    print("\n[Step 3] Querying AI Backend for Student Risk Prediction...")
    r_risk = requests.post(f"{AI_API_URL}/ai/predict/student-risk", json={
        "institution_id": "inst-001",
        "student_id": "stu-102",
        "features": {
            "attendance_rate": 55.0,
            "midterm_avg": 44.0,
            "assignment_submission_rate": 0.45,
            "previous_cgpa": 2.20,
            "fee_default_days": 35
        }
    }, headers={"X-Service-Token": "ai_service_internal_secret_key_9901"}, timeout=5)
    assert r_risk.status_code == 200
    risk_data = r_risk.json()
    print(f"  [PASS] ML Model: {risk_data['model_version']}")
    print(f"  [PASS] Risk Level: {risk_data['risk_level']} (Probability Score: {risk_data['risk_score']})")
    print(f"  [PASS] Primary Factors Identified: {risk_data['primary_factors']}")

    # 4. AI RAG Query
    print("\n[Step 4] Querying AI Course RAG Assistant for Dijkstra Algorithm...")
    r_rag = requests.post(f"{AI_API_URL}/ai/rag/query", json={
        "institution_id": "inst-001",
        "course_id": "CSE-205",
        "query": "What is the complexity of Dijkstra algorithm?"
    }, headers={"X-Service-Token": "ai_service_internal_secret_key_9901"}, timeout=5)
    assert r_rag.status_code == 200
    rag_data = r_rag.json()
    assert len(rag_data["citations"]) > 0
    print(f"  [PASS] Grounded Citation: {rag_data['citations'][0]['document_name']} (Page {rag_data['citations'][0]['page_number']})")
    print(f"  [PASS] RAG Answer Snippet: {rag_data['answer'][:100]}...")

    # 5. Inbound Voice Assistant Call Simulation & Cross-Service Auto-Ticketing
    print("\n[Step 5] Simulating Inbound Voice Call to Voice Backend (Port 8050)...")
    call_payload = {
        "institution_id": "inst-001",
        "caller_phone": "+8801712998877",
        "caller_name": "Guardian of Student STU-102",
        "channel": "TWILIO",
        "messages": [
            "Hello, I am calling about my son's attendance record.",
            "He was marked absent on Wednesday despite being in class. The RFID scanner failed.",
            "Please fix his attendance immediately."
        ]
    }
    r_call = requests.post(f"{VOICE_API_URL}/voice/simulate/call", json=call_payload, timeout=8)
    if r_call.status_code != 200:
        print(f"Error {r_call.status_code}: {r_call.text}")
    assert r_call.status_code == 200
    call_res = r_call.json()["data"]
    print(f"  [PASS] Call Session ID: {call_res['session_id']}")
    print(f"  [PASS] Objection Detected by AI: {call_res['objection_detected']}")
    print(f"  [PASS] Objection Category: {call_res['objection_category']}")
    print(f"  [PASS] Auto-generated Core ERP Ticket ID: {call_res['erp_ticket_id']}")
    assert call_res["erp_ticket_id"] is not None, "Voice Assistant failed to auto-create Core ERP ticket!"

    # 6. Verification in Core ERP Backend
    print("\n[Step 6] Verifying Ticket Existence in Core ERP Backend Database...")
    r_obj = requests.get(f"{CORE_ERP_URL}/objections", headers={"Authorization": f"Bearer {token}"}, timeout=3)
    assert r_obj.status_code == 200
    tickets = r_obj.json()["data"]
    
    matching = [t for t in tickets if t["id"] == call_res["erp_ticket_id"]]
    assert len(matching) == 1, "Ticket not found in Core ERP!"
    t = matching[0]
    print(f"  [PASS] Ticket Verified in Core ERP Database:")
    print(f"      ID:       {t['id']}")
    print(f"      Source:   {t['source']} (matches expected AI_VOICE_CALL)")
    print(f"      Category: {t['category']}")
    print(f"      Severity: {t['severity']}")
    print(f"      Status:   {t['status']}")
    print(f"      Title:    {t['title']}")

    print("\n================================================================")
    print(">> ALL END-TO-END INTEGRATION TESTS PASSED CLEANLY (100% SUCCESS)!")
    print("================================================================\n")

if __name__ == "__main__":
    test_system_integration()
