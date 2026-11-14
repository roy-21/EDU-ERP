from fastapi.testclient import TestClient
from app.config import settings
from app.main import app

# The service token is required whenever NODE_ENV is not development, as in production.
client = TestClient(app, headers={"X-Service-Token": settings.SERVICE_SECRET})

def test_ai_health():
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    data = res.json()
    assert data["data"]["status"] == "HEALTHY"
    assert "student_risk_rf_v1.2.0" in data["data"]["models_loaded"]

def test_student_risk_prediction():
    payload = {
        "institution_id": "inst-001",
        "student_id": "stu-102",
        "features": {
            "attendance_rate": 52.0,
            "midterm_avg": 42.0,
            "assignment_submission_rate": 0.40,
            "previous_cgpa": 2.10,
            "fee_default_days": 45
        }
    }
    res = client.post("/api/v1/ai/predict/student-risk", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["student_id"] == "stu-102"
    assert data["risk_level"] in ["HIGH", "CRITICAL"]
    assert data["risk_score"] > 0.50
    assert len(data["primary_factors"]) > 0

def test_gpa_prediction():
    payload = {
        "institution_id": "inst-001",
        "student_id": "stu-101",
        "current_cgpa": 3.65,
        "current_semester_credits": 15.0,
        "quiz_average": 90.0,
        "midterm_score": 88.0
    }
    res = client.post("/api/v1/ai/predict/gpa", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert 3.5 <= data["predicted_cgpa"] <= 4.0
    assert len(data["confidence_interval"]) == 2

def test_rag_query_with_citations():
    payload = {
        "institution_id": "inst-001",
        "course_id": "CSE-205",
        "query": "What is the time complexity of Dijkstra algorithm?"
    }
    res = client.post("/api/v1/ai/rag/query", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "Dijkstra" in data["answer"]
    assert len(data["citations"]) > 0
    assert data["citations"][0]["document_name"] == "Data_Structures_Algorithms_Lec4.pdf"

def test_nlp_objection_classification():
    payload = {
        "institution_id": "inst-001",
        "text": "My son was marked absent in yesterday's attendance even though he attended class."
    }
    res = client.post("/api/v1/ai/nlp/classify-objection", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["is_objection"] is True
    assert data["category"] == "ATTENDANCE_DISPUTE"
    assert data["target_role"] == "TEACHER"

