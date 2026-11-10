from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from app.config import settings
from app.models import (
    StudentRiskRequest, StudentRiskResponse,
    GpaPredictionRequest, GpaPredictionResponse,
    RagQueryRequest, RagQueryResponse,
    NlpClassificationRequest, NlpClassificationResponse
)
from app.ml.risk_model import risk_predictor
from app.ml.gpa_model import gpa_predictor
from app.rag.engine import rag_engine
from app.nlp.classifier import nlp_classifier

app = FastAPI(
    title="Institution ERP — AI Backend Service",
    description="Independent ML, RAG, and NLP Engine for Multi-Institution ERP",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def verify_service_token(x_service_token: Optional[str] = Header(None)):
    if settings.ENVIRONMENT == "development":
        return True
    if not x_service_token or x_service_token != settings.SERVICE_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Service-Token")
    return True

@app.get("/api/v1/health")
def health_check():
    return {
        "success": True,
        "statusCode": 200,
        "data": {
            "service": "ai-backend-service",
            "version": "1.0.0",
            "status": "HEALTHY",
            "models_loaded": [
                risk_predictor.version,
                gpa_predictor.version
            ]
        }
    }

@app.post("/api/v1/ai/predict/student-risk", response_model=StudentRiskResponse)
def predict_student_risk(req: StudentRiskRequest, _=Depends(verify_service_token)):
    f = req.features
    prob, level, factors, recs = risk_predictor.predict(
        attendance=f.attendance_rate,
        midterm=f.midterm_avg,
        assignment_rate=f.assignment_submission_rate,
        cgpa=f.previous_cgpa,
        fee_days=f.fee_default_days
    )
    return StudentRiskResponse(
        student_id=req.student_id,
        institution_id=req.institution_id,
        risk_score=prob,
        risk_level=level,
        primary_factors=factors,
        model_version=risk_predictor.version,
        recommendations=recs
    )

@app.post("/api/v1/ai/predict/gpa", response_model=GpaPredictionResponse)
def predict_gpa(req: GpaPredictionRequest, _=Depends(verify_service_token)):
    new_cgpa, ci, trend = gpa_predictor.predict(
        current_cgpa=req.current_cgpa,
        credits=req.current_semester_credits,
        quiz_avg=req.quiz_average,
        midterm=req.midterm_score
    )
    return GpaPredictionResponse(
        student_id=req.student_id,
        predicted_cgpa=new_cgpa,
        confidence_interval=ci,
        projected_change=trend
    )

@app.post("/api/v1/ai/rag/query", response_model=RagQueryResponse)
def query_rag(req: RagQueryRequest, _=Depends(verify_service_token)):
    result = rag_engine.query(
        institution_id=req.institution_id,
        course_id=req.course_id,
        query_text=req.query
    )
    return RagQueryResponse(
        query=req.query,
        course_id=req.course_id,
        answer=result["answer"],
        citations=result["citations"],
        confidence=result["confidence"]
    )

@app.post("/api/v1/ai/nlp/classify-objection", response_model=NlpClassificationResponse)
def classify_text(req: NlpClassificationRequest, _=Depends(verify_service_token)):
    res = nlp_classifier.classify(req.text)
    return NlpClassificationResponse(
        category=res["category"],
        severity=res["severity"],
        is_objection=res["is_objection"],
        confidence=res["confidence"],
        extracted_entities=res["extracted_entities"],
        target_role=res["target_role"]
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.PORT, reload=True)

