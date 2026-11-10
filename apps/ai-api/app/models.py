from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class StudentRiskFeatures(BaseModel):
    attendance_rate: float = Field(..., ge=0.0, le=100.0, description="Attendance percentage (0-100)")
    midterm_avg: float = Field(..., ge=0.0, le=100.0, description="Midterm examination average score")
    assignment_submission_rate: float = Field(..., ge=0.0, le=1.0, description="Assignment submission ratio (0.0-1.0)")
    previous_cgpa: float = Field(..., ge=0.0, le=4.0, description="Cumulative Grade Point Average (0.0-4.0)")
    fee_default_days: int = Field(0, ge=0, description="Days tuition or institutional fees are past due")

class StudentRiskRequest(BaseModel):
    institution_id: str
    student_id: str
    features: StudentRiskFeatures

class StudentRiskResponse(BaseModel):
    student_id: str
    institution_id: str
    risk_score: float
    risk_level: str  # LOW, MEDIUM, HIGH, CRITICAL
    primary_factors: List[str]
    model_version: str
    recommendations: List[str]

class GpaPredictionRequest(BaseModel):
    institution_id: str
    student_id: str
    current_cgpa: float = Field(..., ge=0.0, le=4.0)
    current_semester_credits: float = Field(..., ge=1.0, le=30.0)
    quiz_average: float = Field(..., ge=0.0, le=100.0)
    midterm_score: float = Field(..., ge=0.0, le=100.0)

class GpaPredictionResponse(BaseModel):
    student_id: str
    predicted_cgpa: float
    confidence_interval: List[float]
    projected_change: str

class RagQueryRequest(BaseModel):
    institution_id: str
    course_id: str
    query: str

class Citation(BaseModel):
    document_name: str
    page_number: int
    similarity: float
    snippet: str

class RagQueryResponse(BaseModel):
    query: str
    course_id: str
    answer: str
    citations: List[Citation]
    confidence: float

class NlpClassificationRequest(BaseModel):
    institution_id: str
    text: str
    caller_phone: Optional[str] = None

class NlpClassificationResponse(BaseModel):
    category: str
    severity: str
    is_objection: bool
    confidence: float
    extracted_entities: Dict[str, Any]
    target_role: str

