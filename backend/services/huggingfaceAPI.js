import axios from 'axios';

const HF_TOKEN = process.env.HF_TOKEN;

const TRIAGE_MODEL = "SHUB-8/Triage-BERT";
const SPECIALTY_MODEL = "anaschahid/medical-specialty-classifier";
const DISEASE_MODEL = "DinaSalama/symptom_to_disease_distb";

const headers = {
    'Authorization': `Bearer ${HF_TOKEN}`,
    'Content-Type': 'application/json'
};

async function hfPredict(modelId, text) {
    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${modelId}`,
            { inputs: text },
            { headers }
        );
        return response.data;
    } catch (error) {
        console.error(`Error predicting with model ${modelId}:`, error.response?.data || error.message);
        throw new Error(`Hugging Face API Error: ${error.response?.data?.error || error.message}`);
    }
}

export const nlpManager = {
    async predictSeverity(text) {
        if (!process.env.HF_TOKEN) throw new Error("HF_TOKEN is missing in environment variables.");
        
        const results = await hfPredict(TRIAGE_MODEL, text);
        // Result is usually [[{label: 'LABEL_X', score: Y}, ...]]
        const predictions = Array.isArray(results[0]) ? results[0] : results;
        
        // Find top prediction
        const topPrediction = predictions.reduce((prev, current) => (prev.score > current.score) ? prev : current);
        const label = topPrediction.label;
        const confidence = topPrediction.score;

        // Map LABEL_0 to ESI 1
        const labelNum = parseInt(label.split('_').pop());
        const esiLevel = labelNum + 1;

        let severity = "LOW";
        if (esiLevel <= 2) severity = "HIGH";
        else if (esiLevel === 3) severity = "MEDIUM";

        return {
            level: severity,
            esi: esiLevel,
            confidence: confidence,
            is_override: false
        };
    },

    async predictSpecialty(text) {
        if (!process.env.HF_TOKEN) throw new Error("HF_TOKEN is missing in environment variables.");

        const results = await hfPredict(SPECIALTY_MODEL, text);
        const predictions = Array.isArray(results[0]) ? results[0] : results;
        
        // Sort by confidence descending
        predictions.sort((a, b) => b.score - a.score);
        
        const topPrediction = predictions[0];
        const differentials = predictions.slice(1, 4);

        return {
            name: topPrediction.label,
            confidence: topPrediction.score,
            differentials: differentials.map(d => ({
                name: d.label,
                confidence: d.score
            }))
        };
    },

    async predictDisease(text) {
        if (!process.env.HF_TOKEN) throw new Error("HF_TOKEN is missing in environment variables.");

        const results = await hfPredict(DISEASE_MODEL, text);
        const predictions = Array.isArray(results[0]) ? results[0] : results;
        
        // Sort by confidence descending
        predictions.sort((a, b) => b.score - a.score);
        
        const topPrediction = predictions[0];
        const differentials = predictions.slice(1, 4);

        return {
            disease: topPrediction.label,
            confidence: topPrediction.score,
            differentials: differentials.map(d => ({
                disease: d.label,
                confidence: d.score
            }))
        };
    }
};
