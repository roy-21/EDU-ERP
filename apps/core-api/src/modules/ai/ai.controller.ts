import { Router, Request, Response } from "express";
import { config } from "../../config/environment";

export const aiGatewayRouter = Router();

// Student Risk Prediction Gateway
aiGatewayRouter.post("/ai/predict/student-risk", async (req: Request, res: Response): Promise<void> => {
  try {
    const institutionId = req.institutionId || "inst-001";
    const { studentId, features } = req.body;

    if (!features) {
      res.status(400).json({ success: false, statusCode: 400, error: "Features object is required." });
      return;
    }

    const payload = {
      institution_id: institutionId,
      student_id: studentId || "stu-unknown",
      features: {
        attendance_rate: features.attendanceRate ?? features.attendance_rate ?? 80.0,
        midterm_avg: features.midtermAvg ?? features.midterm_avg ?? 50.0,
        assignment_submission_rate: features.assignmentSubmissionRate ?? features.assignment_submission_rate ?? 0.70,
        previous_cgpa: features.previousCgpa ?? features.previous_cgpa ?? 2.80,
        fee_default_days: features.feeDefaultDays ?? features.fee_default_days ?? 0
      }
    };

    const aiRes = await fetch(`${config.aiApiUrl}/ai/predict/student-risk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": config.serviceSecretAi,
        "X-Institution-Id": institutionId
      },
      body: JSON.stringify(payload)
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      res.status(aiRes.status).json({ success: false, statusCode: aiRes.status, error: `AI Service Error: ${errText}` });
      return;
    }

    const data = await aiRes.json();
    res.status(200).json({ success: true, statusCode: 200, data });
  } catch (err: any) {
    console.error("AI Risk Prediction Gateway Error:", err);
    res.status(502).json({ success: false, statusCode: 502, error: `Failed to connect to AI Backend: ${err.message}` });
  }
});

// GPA Prediction Gateway
aiGatewayRouter.post("/ai/predict/gpa", async (req: Request, res: Response): Promise<void> => {
  try {
    const institutionId = req.institutionId || "inst-001";
    const { studentId, currentCgpa, currentSemesterCredits, quizAverage, midtermScore } = req.body;

    const payload = {
      institution_id: institutionId,
      student_id: studentId || "stu-unknown",
      current_cgpa: currentCgpa ?? 3.0,
      current_semester_credits: currentSemesterCredits ?? 15.0,
      quiz_average: quizAverage ?? 75.0,
      midterm_score: midtermScore ?? 70.0
    };

    const aiRes = await fetch(`${config.aiApiUrl}/ai/predict/gpa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": config.serviceSecretAi,
        "X-Institution-Id": institutionId
      },
      body: JSON.stringify(payload)
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      res.status(aiRes.status).json({ success: false, statusCode: aiRes.status, error: `AI Service Error: ${errText}` });
      return;
    }

    const data = await aiRes.json();
    res.status(200).json({ success: true, statusCode: 200, data });
  } catch (err: any) {
    console.error("AI GPA Prediction Gateway Error:", err);
    res.status(502).json({ success: false, statusCode: 502, error: `Failed to connect to AI Backend: ${err.message}` });
  }
});

// RAG Course Learning Assistant Gateway
aiGatewayRouter.post("/ai/rag/query", async (req: Request, res: Response): Promise<void> => {
  try {
    const institutionId = req.institutionId || "inst-001";
    const { courseId, query } = req.body;

    if (!query) {
      res.status(400).json({ success: false, statusCode: 400, error: "Query parameter is required." });
      return;
    }

    const payload = {
      institution_id: institutionId,
      course_id: courseId || "CSE-205",
      query
    };

    const aiRes = await fetch(`${config.aiApiUrl}/ai/rag/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": config.serviceSecretAi,
        "X-Institution-Id": institutionId
      },
      body: JSON.stringify(payload)
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      res.status(aiRes.status).json({ success: false, statusCode: aiRes.status, error: `AI Service Error: ${errText}` });
      return;
    }

    const data = await aiRes.json();
    res.status(200).json({ success: true, statusCode: 200, data });
  } catch (err: any) {
    console.error("AI RAG Gateway Error:", err);
    res.status(502).json({ success: false, statusCode: 502, error: `Failed to connect to AI Backend: ${err.message}` });
  }
});

