class DoctorRanker {
    /**
     * Ranks a list of pre-filtered doctors based on structured features.
     * Expected doctor dictionary keys:
     * - id: str
     * - rating: float (0.0 to 5.0)
     * - experience_years: int
     * - price: float
     * - is_available_today: bool
     */
    rankDoctors(doctors, patientSeverity = "LOW") {
        const scoredDoctors = [];
        
        for (const doc of doctors) {
            // Extract features safely
            const rating = doc.rating || 0.0;
            const experience = doc.experience_years || 0;
            const price = doc.price || 1000.0; // default fallback price
            const isAvailable = doc.is_available_today || false;
            
            // Normalize features (heuristic min-max scaling for MVP)
            // Assuming max rating is 5.0, max reasonable experience is ~40 years, max price ~5000
            const normRating = Math.min(rating / 5.0, 1.0);
            const normExp = Math.min(experience / 40.0, 1.0);
            
            // For price, lower is better. We penalize high prices.
            const normPricePenalty = Math.min(price / 5000.0, 1.0);
            
            // Calculate heuristic score
            // Weights: Rating (40%), Experience (30%), Price (20%), Availability (10%)
            let score = (0.4 * normRating) + (0.3 * normExp) - (0.2 * normPricePenalty);
            
            if (isAvailable) {
                score += 0.1;
            }
                
            // If the patient severity is HIGH, experience should matter more
            if (patientSeverity === "HIGH") {
                score += (0.2 * normExp);
            }
                
            scoredDoctors.push({
                doctorId: doc.id || 'unknown',
                score: Number(score.toFixed(4)),
                features_used: {
                    rating: rating,
                    experience_years: experience,
                    price: price,
                    is_available_today: isAvailable
                }
            });
        }
            
        // Sort by score descending
        scoredDoctors.sort((a, b) => b.score - a.score);
        return scoredDoctors;
    }
}

export const ranker = new DoctorRanker();
