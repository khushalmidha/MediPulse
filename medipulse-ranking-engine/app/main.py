import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict

from app.models.nlp_manager import nlp_manager
from app.models.ranker import ranker

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load BERT models on startup
    nlp_manager.load_models()
    yield
    # Clean up on shutdown
    nlp_manager.triage_pipeline = None
    nlp_manager.specialty_pipeline = None

app = FastAPI(title="MediPulse AI Engine", lifespan=lifespan)

# --- Pydantic Schemas ---

class PatientContext(BaseModel):
    symptoms: str
    vitals: dict = {}
    history: str = ""

class DoctorCandidate(BaseModel):
    id: str
    rating: float = 0.0
    experience_years: int = 0
    price: float = 1000.0
    is_available_today: bool = False

class RankingRequest(BaseModel):
    severity: str = "LOW"
    doctors: List[DoctorCandidate]

class AssessmentRequest(BaseModel):
    symptoms: str
    history: str = ""

class DiseasePredictRequest(BaseModel):
    text: str

# --- Endpoints ---

@app.post("/predict")
async def predict_disease(req: DiseasePredictRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    result = await asyncio.to_thread(nlp_manager.predict_disease, req.text)
    return result

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "triage_loaded": nlp_manager.triage_pipeline is not None,
        "specialty_loaded": nlp_manager.specialty_pipeline is not None
    }

@app.post("/v2/triage")
async def predict_severity(req: PatientContext):
    if not req.symptoms.strip():
        raise HTTPException(status_code=400, detail="Symptoms text cannot be empty.")
    
    text = f"{req.symptoms} {req.history}".strip()
    
    # Run in thread to prevent blocking the async event loop
    result = await asyncio.to_thread(nlp_manager.predict_severity, text)
    
    # Deterministic override rule for high-risk keywords
    text_lower = text.lower()
    if "severe" in text_lower or "bleeding" in text_lower or "heart attack" in text_lower:
        result["level"] = "HIGH"
        result["esi"] = min(result["esi"], 2) # Ensure ESI is 1 or 2
        result["is_override"] = True
        
    return result

@app.post("/v2/specialty")
async def predict_specialty(req: PatientContext):
    if not req.symptoms.strip():
        raise HTTPException(status_code=400, detail="Symptoms text cannot be empty.")
        
    text = f"{req.symptoms} {req.history}".strip()
    
    result = await asyncio.to_thread(nlp_manager.predict_specialty, text)
    return result

@app.post("/v2/rank")
def rank_doctors(req: RankingRequest):
    # Convert Pydantic models to dicts for the ranker
    doctor_dicts = [doc.model_dump() for doc in req.doctors]
    ranked = ranker.rank_doctors(doctor_dicts, patient_severity=req.severity)
    return {"ranked_doctors": ranked}

@app.post("/v2/assessment")
async def full_assessment(req: AssessmentRequest):
    """
    Combined endpoint to perform triage and specialty classification in one request.
    This is useful to minimize network roundtrips between the Node backend and FastAPI.
    """
    if not req.symptoms.strip():
        raise HTTPException(status_code=400, detail="Symptoms text cannot be empty.")
        
    text = f"{req.symptoms} {req.history}".strip()
    
    # Run both BERT inferences concurrently in thread pool
    triage_task = asyncio.to_thread(nlp_manager.predict_severity, text)
    specialty_task = asyncio.to_thread(nlp_manager.predict_specialty, text)
    
    triage_result, specialty_result = await asyncio.gather(triage_task, specialty_task)
    
    # Deterministic override rule for high-risk keywords
    text_lower = text.lower()
    if "severe" in text_lower or "bleeding" in text_lower or "heart attack" in text_lower:
        triage_result["level"] = "HIGH"
        triage_result["esi"] = min(triage_result["esi"], 2)
        triage_result["is_override"] = True
        specialty_result["name"] = "Emergency Medicine"
        specialty_result["confidence"] = 1.0

    return {
        "severity": triage_result,
        "specialty": specialty_result,
        "disclaimer": "This is an AI-assisted pre-triage tool, not a diagnostic system. Your reported symptoms may require urgent medical evaluation. We recommend consulting an appropriate medical professional."
    }
