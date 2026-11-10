# Role-Based Access Control (RBAC) Matrix

## 1. System Roles Hierarchy

```
SUPER_ADMIN (Multi-Tenant Platform Owner)
  └── INSTITUTION_ADMIN (Campus Executive / Registrar)
        ├── DEPARTMENT_HEAD (Faculty Lead)
        │     └── TEACHER (Instructor)
        ├── FINANCE_OFFICER (Bursar)
        ├── EXAM_CONTROLLER (Examination Board)
        └── STUDENT / GUARDIAN (End Users)
```

---

## 2. Granular Permissions Matrix

| Module / Operation | Super Admin | Institution Admin | Teacher | Student | Guardian | Finance Officer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **System Dynamic Form/Table Builder** | FULL | READ/WRITE | NONE | NONE | NONE | NONE |
| **Institution/Campus Setup** | FULL | FULL | READ | NONE | NONE | NONE |
| **User & Role Provisioning** | FULL | FULL | NONE | NONE | NONE | NONE |
| **Student Profiles & Records** | FULL | FULL | READ/EDIT (Own Class) | READ (Self) | READ (Ward) | READ |
| **Attendance Entry & Override** | FULL | FULL | WRITE (Assigned Course) | READ (Self) | READ (Ward) | NONE |
| **Exam Marks Entry & Grading** | FULL | FULL | WRITE (Assigned Course) | READ (Published) | READ (Published) | NONE |
| **AI Risk & Performance Predictions** | FULL | FULL | READ (Assigned Students) | NONE | NONE | NONE |
| **RAG Course Material Ingestion** | FULL | FULL | WRITE (Assigned Course) | NONE | NONE | NONE |
| **RAG AI Assistant Querying** | FULL | FULL | FULL | FULL (Enrolled Course) | NONE | NONE |
| **Objection / Complaint Ticketing** | FULL | FULL | RESOLVE (Assigned) | CREATE / READ (Self) | CREATE / READ | READ (Billing) |
| **Voice Call Logs & Transcripts** | FULL | FULL | READ (Mentions self) | NONE | NONE | NONE |

---

## 3. Enforcement Strategy
- **JWT Claims:** Tokens include `userId`, `institutionId`, `role`, and assigned scope (e.g. `departmentId`).
- **Middleware Guards:** Every Core ERP endpoint runs `JwtAuthGuard` and `RolesGuard([Role.INSTITUTION_ADMIN, ...])`.
- **Tenant Scope Guard:** Validates that `req.params.institutionId` or `req.body.institutionId` strictly matches `req.user.institutionId`. Cross-tenant ID tampering immediately aborts with `403 Forbidden`.

