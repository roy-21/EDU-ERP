import numpy as np
from sklearn.linear_model import Ridge
from typing import Tuple, List

class GpaPredictor:
    def __init__(self):
        self.version = "gpa_ridge_regressor_v1.0.0"
        self.model = self._train_model()

    def _train_model(self) -> Ridge:
        np.random.seed(42)
        n = 800
        prior_cgpa = np.random.uniform(2.0, 4.0, n)
        quizzes = np.random.uniform(40, 100, n)
        midterm = np.random.uniform(40, 100, n)

        # Semester GPA formula with realistic academic correlation
        sem_gpa = (
            0.30 * prior_cgpa
            + 0.015 * quizzes
            + 0.020 * midterm
            + np.random.normal(0, 0.15, n)
        )
        sem_gpa = np.clip(sem_gpa, 0.0, 4.0)

        X = np.column_stack([prior_cgpa, quizzes, midterm])
        reg = Ridge(alpha=1.0)
        reg.fit(X, sem_gpa)
        return reg

    def predict(self, current_cgpa: float, credits: float, quiz_avg: float, midterm: float) -> Tuple[float, List[float], str]:
        X_sample = np.array([[current_cgpa, quiz_avg, midterm]])
        predicted_term_gpa = float(self.model.predict(X_sample)[0])
        predicted_term_gpa = max(0.0, min(4.0, predicted_term_gpa))

        # Recompute cumulative GPA trajectory
        # Weighted average of prior credits (e.g. 60 credits completed) and new term credits
        assumed_prior_credits = 45.0
        total_credits = assumed_prior_credits + credits
        new_projected_cgpa = (current_cgpa * assumed_prior_credits + predicted_term_gpa * credits) / total_credits
        new_projected_cgpa = round(float(np.clip(new_projected_cgpa, 0.0, 4.0)), 2)

        ci_low = round(max(0.0, new_projected_cgpa - 0.15), 2)
        ci_high = round(min(4.0, new_projected_cgpa + 0.15), 2)

        diff = new_projected_cgpa - current_cgpa
        if diff > 0.05:
            trend = f"Upward trajectory (+{diff:.2f})"
        elif diff < -0.05:
            trend = f"Downward trajectory ({diff:.2f})"
        else:
            trend = f"Stable trajectory ({diff:+.2f})"

        return new_projected_cgpa, [ci_low, ci_high], trend

gpa_predictor = GpaPredictor()

