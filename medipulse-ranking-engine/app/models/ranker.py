from typing import List, Dict

class DoctorRanker:
    """
    MVP Implementation for Doctor Ranking.
    Currently uses a heuristic scoring algorithm.
    This will be replaced by a LightGBM LambdaMART model once enough interaction data
    (clicks, bookings, reviews) is collected to create pairwise/listwise training sets.
    """
    
    def __init__(self):
        # We don't load a LightGBM model yet since we lack interaction data for the cold start.
        pass

    def rank_doctors(self, doctors: List[Dict], patient_severity: str = "LOW") -> List[Dict]:
        """
        Ranks a list of pre-filtered doctors based on structured features.
        Expected doctor dictionary keys:
        - id: str
        - rating: float (0.0 to 5.0)
        - experience_years: int
        - price: float
        - is_available_today: bool
        """
        scored_doctors = []
        
        for doc in doctors:
            # Extract features safely
            rating = doc.get('rating', 0.0)
            experience = doc.get('experience_years', 0)
            price = doc.get('price', 1000.0) # default fallback price
            is_available = doc.get('is_available_today', False)
            
            # Normalize features (heuristic min-max scaling for MVP)
            # Assuming max rating is 5.0, max reasonable experience is ~40 years, max price ~5000
            norm_rating = min(rating / 5.0, 1.0)
            norm_exp = min(experience / 40.0, 1.0)
            
            # For price, lower is better. We penalize high prices.
            norm_price_penalty = min(price / 5000.0, 1.0)
            
            # Calculate heuristic score
            # Weights: Rating (40%), Experience (30%), Price (20%), Availability (10%)
            score = (0.4 * norm_rating) + (0.3 * norm_exp) - (0.2 * norm_price_penalty)
            
            if is_available:
                score += 0.1
                
            # If the patient severity is HIGH, experience should matter more
            if patient_severity == "HIGH":
                score += (0.2 * norm_exp)
                
            scored_doctors.append({
                "doctorId": doc.get('id', 'unknown'),
                "score": round(score, 4),
                "features_used": {
                    "rating": rating,
                    "experience_years": experience,
                    "price": price,
                    "is_available_today": is_available
                }
            })
            
        # Sort by score descending
        scored_doctors.sort(key=lambda x: x['score'], reverse=True)
        return scored_doctors

# Global ranker instance
ranker = DoctorRanker()
