"""
Comprehensive End-to-End Multi-Service Chain Verification Test
Tests the full flow:
  Client/Frontend -> Core ERP Gateway (4000) -> AI Backend (8000)
  Client/Frontend -> Core ERP Gateway (4000) -> Voice Backend (8050)
  Voice Backend (8050) -> Core ERP (4000) Auto-Ticketing
"""

import requests
import sys

CORE_ERP_BASE = "http://127.0.0.1:4000/api/v1"
AI_BACKEND_BASE = "http://127.0.0.1:8000/api/v1"
VOICE_BACKEND_BASE = "http://127.0.0.1:8050/api/v1"

def run_audit_tests():
    print("==================================================================")
    print(">> RUNNING COMPREHENSIVE AI & VOICE FULL-CHAIN INTEGRATION TESTS")
    print("==================================================================")
    
    # Step 1: Health of All 3 Backends
    print("\n[Audit Test 1] Verifying All 3 Service Health Endpoints...")
    r1 = requests.get(f"{CORE_ERP_BASE}/health", timeout=3)
    assert r1.status_code == 200 and r1.json()["data"]["status"] == "HEALTHY"
    print("  [PASS] Core ERP Backend (4000): HEALTHY")

    r2 = requests.get(f"{AI_BACKEND_BASE}/health", timeout=3)
    assert r2.status_code == 200 and r2.json()["data"]["status"] == "HEALTHY"
    print("  [PASS] AI Backend Service (8000): HEALTHY")

    r3 = requests.get(f"{VOICE_BACKEND_BASE}/health", timeout=3)
    assert r3.status_code == 200 and r3.json()["data"]["status"] == "HEALTHY"
    print("  [PASS] Voice Assistant Service (8050): HEALTHY")

    # Step 2: Core ERP Authentication & Token
    print("\n[Audit Test 2] Authenticating with Core ERP to get JWT...")
    login = requests.post(f"{CORE_ERP_BASE}/auth/login", json={
        "email": "admin@institution.edu",
        "password": "password123"
    }, timeout=3)
    assert login.status_code == 200
    token = login.json()["data"]["token"]
    auth_headers = {"Authorization": f"Bearer {token}"}
    print(f"  [PASS] JWT Token acquired for institution inst-001")

    # Step 3: Full Chain Student Risk Prediction
    # Client -> Core ERP (4000) -> AI Backend (8000) -> Core ERP -> Client
    print("\n[Audit Test 3] Full Chain: Client -> Core ERP Gateway -> AI Risk ML Model...")
    risk_res = requests.post(f"{CORE_ERP_BASE}/ai/predict/student-risk", headers=auth_headers, json={
        "studentId": "stu-102",
        "features": {
            "attendanceRate": 52.0,
            "midtermAvg": 41.0,
            "assignmentSubmissionRate": 0.35,
            "previousCgpa": 2.15,
            "feeDefaultDays": 40
        }
    }, timeout=5)
    assert risk_res.status_code == 200
    risk_data = risk_res.json()["data"]
    assert risk_data["risk_level"] in ["HIGH", "CRITICAL"]
    assert risk_data["model_version"] == "student_risk_rf_v1.2.0"
    print(f"  [PASS] Live ML Risk Score: {risk_data['risk_score']} ({risk_data['risk_level']})")
    print(f"  [PASS] Model Version: {risk_data['model_version']}")
    print(f"  [PASS] Recommendations: {risk_data['recommendations'][0]}")

    # Step 4: Full Chain GPA Trajectory Prediction
    # Client -> Core ERP (4000) -> AI Backend (8000) -> Core ERP -> Client
    print("\n[Audit Test 4] Full Chain: Client -> Core ERP Gateway -> AI GPA Regressor...")
    gpa_res = requests.post(f"{CORE_ERP_BASE}/ai/predict/gpa", headers=auth_headers, json={
        "studentId": "stu-101",
        "currentCgpa": 3.60,
        "currentSemesterCredits": 16.0,
        "quizAverage": 92.0,
        "midtermScore": 89.0
    }, timeout=5)
    assert gpa_res.status_code == 200
    gpa_data = gpa_res.json()["data"]
    assert 3.5 <= gpa_data["predicted_cgpa"] <= 4.0
    print(f"  [PASS] Predicted CGPA: {gpa_data['predicted_cgpa']} (Confidence: {gpa_data['confidence_interval']})")
    print(f"  [PASS] Trajectory: {gpa_data['projected_change']}")

    # Step 5: Full Chain Course RAG Assistant with Verified Citations
    # Client -> Core ERP (4000) -> AI Backend (8000) -> Core ERP -> Client
    print("\n[Audit Test 5] Full Chain: Client -> Core ERP Gateway -> AI RAG Engine...")
    rag_res = requests.post(f"{CORE_ERP_BASE}/ai/rag/query", headers=auth_headers, json={
        "courseId": "CSE-205",
        "query": "What is the time complexity of Dijkstra algorithm?"
    }, timeout=5)
    assert rag_res.status_code == 200
    rag_data = rag_res.json()["data"]
    assert "Dijkstra" in rag_data["answer"]
    assert len(rag_data["citations"]) > 0
    citation = rag_data["citations"][0]
    print(f"  [PASS] RAG Citation: {citation['document_name']} (Page {citation['page_number']})")
    print(f"  [PASS] Grounded Similarity: {citation['similarity']}")

    # Step 6: Full Chain Voice Call Simulation & Core ERP Auto-Ticketing
    # Client -> Core ERP Gateway (4000) -> Voice Backend (8050) -> Core ERP Objections (4000)
    print("\n[Audit Test 6] Full Chain: Client -> Core ERP -> Voice Simulation -> Auto-Ticketing...")
    voice_sim = requests.post(f"{CORE_ERP_BASE}/voice/simulate", headers=auth_headers, json={
        "callerPhone": "+8801999888777",
        "callerName": "Parent of STU-102",
        "channel": "TWILIO",
        "messages": [
            "Hello, I am calling because my son's grade was recorded incorrectly in the midterm exam.",
            "Please review his exam script immediately."
        ]
    }, timeout=8)
    assert voice_sim.status_code == 200
    sim_data = voice_sim.json()["data"]
    assert sim_data["objection_detected"] is True
    assert sim_data["objection_category"] == "GRADE_DISPUTE"
    ticket_id = sim_data["erp_ticket_id"]
    assert ticket_id is not None
    print(f"  [PASS] Voice Objection Detected: {sim_data['objection_category']}")
    print(f"  [PASS] Auto-Created ERP Ticket ID: {ticket_id}")

    # Step 7: Verify Ticket in Core ERP and Call History Gateway
    print("\n[Audit Test 7] Verifying Persisted Ticket & Call History Gateway...")
    calls_res = requests.get(f"{CORE_ERP_BASE}/voice/calls", headers=auth_headers, timeout=3)
    assert calls_res.status_code == 200
    call_list = calls_res.json()["data"]
    matching_call = [c for c in call_list if c["erp_ticket_id"] == ticket_id]
    assert len(matching_call) == 1
    print(f"  [PASS] Call Verified in Core ERP Call History Gateway (Session: {matching_call[0]['session_id']})")

    obj_res = requests.get(f"{CORE_ERP_BASE}/objections", headers=auth_headers, timeout=3)
    assert obj_res.status_code == 200
    obj_list = obj_res.json()["data"]
    matching_ticket = [t for t in obj_list if t["id"] == ticket_id]
    assert len(matching_ticket) == 1
    print(f"  [PASS] Ticket Verified in Core ERP Database: {matching_ticket[0]['title']} (Status: {matching_ticket[0]['status']})")

    print("\n==================================================================")
    print(">> ALL 7 FULL-CHAIN INTEGRATION TESTS PASSED WITH 100% SUCCESS!")
    print("==================================================================\n")

if __name__ == "__main__":
    run_audit_tests()

