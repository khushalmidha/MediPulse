
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import pickle
import json
import os

app = FastAPI(title="MediPulse v2 ML Engine")

# Load existing models and configs
DISEASE_MODEL_PATH = os.path.join(os.path.dirname(__file__), "../../medipulse-disease-prediction/lightweight_model.pkl")
MAPPING_PATH = os.path.join(os.path.dirname(__file__), "../../medipulse-disease-prediction/disease_to_specialty.json")

try:
    with open(DISEASE_MODEL_PATH, "rb") as f:
        disease_model = pickle.load(f)
except Exception as e:
    print(f"Warning: Could not load disease model: {e}")
    disease_model = None

try:
    with open(MAPPING_PATH, "r") as f:
        disease_to_specialty = json.load(f)
except Exception as e:
    print(f"Warning: Could not load specialty mapping: {e}")
    disease_to_specialty = {}

class PatientContext(BaseModel):
    symptoms: str
    vitals: dict = {}
    history: str = ""

class DoctorCandidate(BaseModel):
    id: str
    features: dict

class RankingRequest(BaseModel):
    patient: PatientContext
    doctors: List[DoctorCandidate]

@app.post("/v2/specialty")
def predict_specialty(req: PatientContext):
    if not disease_model:
        return {"disease": "Unknown", "specialty": "General Medicine", "confidence": 0.0}
    
    disease = disease_model.predict([req.symptoms])[0]
    probs = disease_model.predict_proba([req.symptoms])[0]
    conf = float(max(probs))
    specialty = disease_to_specialty.get(disease, "General Medicine")
    
    return {
        "disease": disease,
        "specialty": specialty,
        "confidence": conf
    }

@app.post("/v2/severity")
def predict_severity(req: PatientContext):
    # Stubbing the XGBoost model for MVP
    text = (req.symptoms + " " + req.history).lower()
    
    # Heuristic for MVP severity
    if "severe" in text or "pain" in text or "bleeding" in text:
        severity = "HIGH"
    elif "moderate" in text or "fever" in text:
        severity = "MEDIUM"
    else:
        severity = "LOW"
        
    return {
        "severity": severity,
        "esi_level": 3 if severity == "MEDIUM" else (2 if severity == "HIGH" else 4)
    }

@app.post("/v2/recommend-doctors")
def recommend_doctors(req: RankingRequest):
    # Stubbing LambdaMART for MVP - fall back to pointwise XGBoost simulation
    # We will score them deterministically for now based on some dummy logic
    scored_doctors = []
    for doc in req.doctors:
        score = 0.5
        scored_doctors.append({"id": doc.id, "score": score})
        
    scored_doctors.sort(key=lambda x: x["score"], reverse=True)
    return {"ranked_doctors": scored_doctors}

