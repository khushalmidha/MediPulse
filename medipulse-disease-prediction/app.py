from fastapi import FastAPI
from pydantic import BaseModel
import pickle
import os
import train

app = FastAPI(title="MediPulse Disease Prediction API")

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'lightweight_model.pkl')

class PredictionRequest(BaseModel):
    text: str

def load_model():
    if not os.path.exists(MODEL_PATH):
        print("Model not found. Training a new lightweight model on startup...")
        train.train_and_save_model()
        
    with open(MODEL_PATH, 'rb') as f:
        return pickle.load(f)

# Load model globally when server starts
model = load_model()

@app.get("/")
def health_check():
    return {"status": "healthy", "service": "MediPulse ML Engine"}

@app.post("/predict")
def predict_disease(request: PredictionRequest):
    try:
        # Predict the disease based on the input transcript/symptoms
        prediction = model.predict([request.text])[0]
        
        # Get probability/confidence
        probabilities = model.predict_proba([request.text])[0]
        confidence = float(max(probabilities))
        
        return {
            "disease": prediction,
            "confidence": confidence,
            "status": "success"
        }
    except Exception as e:
        return {
            "disease": "Unknown",
            "error": str(e),
            "status": "failed"
        }
