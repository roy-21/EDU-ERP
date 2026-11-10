import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../database/db";
import { requirePermissionKey } from "../../middleware/auth.middleware";

export const institutionRouter = Router();

// Campuses
institutionRouter.get("/campuses", requirePermissionKey("institution.read"), (req: Request, res: Response): void => {
  const instId = req.institutionId || "inst-001";
  const campuses = db.campuses.filter(c => c.institutionId === instId);
  res.status(200).json({ success: true, statusCode: 200, data: campuses });
});

institutionRouter.post("/campuses", requirePermissionKey("institution.create"), (req: Request, res: Response): void => {
  const instId = req.institutionId || "inst-001";
  const { code, name, address, lat, lng } = req.body;

  if (!code || !name) {
    res.status(400).json({ success: false, statusCode: 400, error: "Code and name required." });
    return;
  }

  const newCampus = {
    id: uuidv4(),
    institutionId: instId,
    code,
    name,
    address: address || "",
    lat: lat ? parseFloat(lat) : undefined,
    lng: lng ? parseFloat(lng) : undefined
  };

  db.campuses.push(newCampus);
  res.status(201).json({ success: true, statusCode: 201, data: newCampus });
});

// Dynamic metadata endpoints for faculties, departments, batches, sections, courses
institutionRouter.get("/institution/metadata/:slug", requirePermissionKey("institution.read"), (req: Request, res: Response): void => {
  const { slug } = req.params;
  const instId = req.institutionId || "inst-001";

  // Respond according to slug
  if (slug === "campus") {
    res.status(200).json({
      success: true,
      statusCode: 200,
      data: db.campuses.filter(c => c.institutionId === instId)
    });
    return;
  }

  // Sample defaults for other institution slugs
  const sampleData: Record<string, any[]> = {
    faculty: [
      { id: "fac-1", name: "Science", code: "SCI" },
      { id: "fac-2", name: "Engineering & Technology", code: "ENG" },
      { id: "fac-3", name: "Business Administration", code: "BBA" }
    ],
    department: [
      { id: "dept-1", name: "Computer Science & Engineering", code: "CSE", program: "B.Sc Engg", duration: "4 Years" },
      { id: "dept-2", name: "Electrical & Electronic Engineering", code: "EEE", program: "B.Sc Engg", duration: "4 Years" }
    ],
    batch: [
      { id: "batch-1", year: 2026, session: "Spring", batchNumber: "64th Batch", semester: "4th" },
      { id: "batch-2", year: 2025, session: "Fall", batchNumber: "63rd Batch", semester: "5th" }
    ],
    section: [
      { id: "sec-1", name: "Section A", capacity: 60, room: "Lab 301", teacher: "Dr. Rafiqul Islam" },
      { id: "sec-2", name: "Section B", capacity: 60, room: "Lab 302", teacher: "Prof. Sarah Khan" }
    ],
    course: [
      { id: "crs-1", code: "CSE-101", title: "Structured Programming Language", credit: 3.0, prerequisite: "None" },
      { id: "crs-2", code: "CSE-205", title: "Data Structures & Algorithms", credit: 4.0, prerequisite: "CSE-101" }
    ]
  };

  res.status(200).json({
    success: true,
    statusCode: 200,
    data: sampleData[slug] || []
  });
});

