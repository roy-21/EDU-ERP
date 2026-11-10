import re
from typing import Dict, Any

class NlpObjectionClassifier:
    def __init__(self):
        # Intent & Objection rules supporting English and phonetic/Bengali terms
        self.categories = {
            "ATTENDANCE_DISPUTE": {
                "keywords": ["attendance", "absent", "present", "biometric", "rfid", "হাজিরা", "অনুপস্থিত", "উপস্থিত"],
                "severity": "MEDIUM",
                "target_role": "TEACHER"
            },
            "GRADE_DISPUTE": {
                "keywords": ["grade", "marks", "exam", "midterm", "result", "cgpa", "খাতা", "মার্কস", "পরীক্ষা", "ফলাফল"],
                "severity": "HIGH",
                "target_role": "EXAM_CONTROLLER"
            },
            "FEE_DISPUTE": {
                "keywords": ["fee", "tuition", "fine", "payment", "bursar", "account", "বেতন", "ফি", "টাকা"],
                "severity": "HIGH",
                "target_role": "FINANCE_OFFICER"
            },
            "HARASSMENT_DISCIPLINE": {
                "keywords": ["harass", "ragging", "fight", "abuse", "threat", "র‌্যাগিং", "মারামারি"],
                "severity": "URGENT",
                "target_role": "CAMPUS_ADMIN"
            }
        }

    def classify(self, text: str) -> Dict[str, Any]:
        text_lower = text.lower()
        matched_category = "GENERAL_INQUIRY"
        severity = "LOW"
        is_objection = False
        target_role = "ADMIN"
        confidence = 0.5

        # Check for specific person routing request
        person_match = re.search(r"(?:talk to|speak with|connect me to|কথা বলতে চাই)\s+([A-Za-z\s]+)", text, re.IGNORECASE)
        requested_person = person_match.group(1).strip() if person_match else None

        for cat, config in self.categories.items():
            for kw in config["keywords"]:
                if kw in text_lower:
                    matched_category = cat
                    severity = config["severity"]
                    is_objection = True
                    target_role = config["target_role"]
                    confidence = 0.91
                    break
            if is_objection:
                break

        return {
            "category": matched_category,
            "severity": severity,
            "is_objection": is_objection,
            "confidence": confidence,
            "target_role": target_role,
            "extracted_entities": {
                "requested_person": requested_person,
                "text_snippet": text[:120]
            }
        }

nlp_classifier = NlpObjectionClassifier()

