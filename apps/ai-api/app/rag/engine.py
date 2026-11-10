from typing import List, Dict, Any
import numpy as np

class CourseRagEngine:
    def __init__(self):
        # In-memory document chunk index scoped by (institution_id, course_id)
        # In production deployment, backed by PostgreSQL pgvector table ai_document_chunks
        self.knowledge_base: Dict[str, List[Dict[str, Any]]] = {
            "inst-001:CSE-205": [
                {
                    "doc_name": "Data_Structures_Algorithms_Lec4.pdf",
                    "page": 12,
                    "content": "Dijkstra's Algorithm finds the shortest path from a single source node to all other nodes in a weighted graph with non-negative edge weights. Its time complexity using a binary min-heap is O((V + E) log V). If a graph contains negative cycles, the algorithm can produce incorrect results or loop indefinitely.",
                    "keywords": ["dijkstra", "shortest path", "complexity", "graph", "negative weights"]
                },
                {
                    "doc_name": "Data_Structures_Algorithms_Lec5.pdf",
                    "page": 7,
                    "content": "Bellman-Ford Algorithm solves the single-source shortest path problem in graphs containing negative weight edges. It relaxes all edges V-1 times and detects negative weight cycles with a total time complexity of O(V * E).",
                    "keywords": ["bellman-ford", "negative edges", "negative cycles", "relaxation"]
                },
                {
                    "doc_name": "Data_Structures_Algorithms_Lec8.pdf",
                    "page": 19,
                    "content": "Red-Black Trees are self-balancing binary search trees ensuring that no path from the root to a leaf is more than twice as long as any other path, guaranteeing O(log n) time for search, insertion, and deletion.",
                    "keywords": ["red-black tree", "binary search tree", "balancing", "log n"]
                }
            ]
        }

    def query(self, institution_id: str, course_id: str, query_text: str) -> Dict[str, Any]:
        key = f"{institution_id}:{course_id}"
        docs = self.knowledge_base.get(key, [])

        if not docs:
            return {
                "answer": f"No syllabus or course materials have been indexed for course {course_id} in your institution.",
                "citations": [],
                "confidence": 0.0
            }

        # Match query terms against indexed chunk keywords and contents
        scored_chunks = []
        q_words = set(query_text.lower().split())

        for chunk in docs:
            score = 0.0
            content_lower = chunk["content"].lower()
            
            # Exact keyword match
            for kw in chunk["keywords"]:
                if kw in query_text.lower():
                    score += 0.4
            
            # Word overlap match
            for word in q_words:
                if len(word) > 3 and word in content_lower:
                    score += 0.15

            if score > 0:
                scored_chunks.append((min(0.98, round(score, 2)), chunk))

        scored_chunks.sort(key=lambda x: x[0], reverse=True)

        if not scored_chunks:
            return {
                "answer": f"The indexed syllabus materials for {course_id} do not contain specific information matching your question.",
                "citations": [],
                "confidence": 0.1
            }

        best_score, top_chunk = scored_chunks[0]

        # Synthesize grounded answer
        answer = (
            f"According to course lecture notes ({top_chunk['doc_name']}, Page {top_chunk['page']}):\n"
            f"{top_chunk['content']}"
        )

        citations = [
            {
                "document_name": top_chunk["doc_name"],
                "page_number": top_chunk["page"],
                "similarity": best_score,
                "snippet": top_chunk["content"][:160] + "..."
            }
        ]

        return {
            "answer": answer,
            "citations": citations,
            "confidence": best_score
        }

rag_engine = CourseRagEngine()

