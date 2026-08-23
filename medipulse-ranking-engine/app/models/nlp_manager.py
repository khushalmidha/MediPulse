import torch
from transformers import pipeline

class NLPManager:
    def __init__(self):
        self.triage_model_id = "SHUB-8/Triage-BERT"
        self.specialty_model_id = "anaschahid/medical-specialty-classifier"
        self.disease_model_id = "DinaSalama/symptom_to_disease_distb"
        
        self.triage_pipeline = None
        self.specialty_pipeline = None
        self.disease_pipeline = None

    def load_models(self):
        """Load the BERT models into memory."""
        print(f"Loading Triage Model: {self.triage_model_id} ...")
        # Use CPU if CUDA is not available (for a realistic student project deployment)
        device = 0 if torch.cuda.is_available() else -1
        
        try:
            self.triage_pipeline = pipeline("text-classification", model=self.triage_model_id, device=device)
            print("Triage Model loaded successfully.")
        except Exception as e:
            print(f"Error loading Triage Model: {e}")
            self.triage_pipeline = None

        print(f"Loading Specialty Model: {self.specialty_model_id} ...")
        try:
            # return_all_scores=True is deprecated in modern transformers, use top_k=None for all probabilities
            self.specialty_pipeline = pipeline("text-classification", model=self.specialty_model_id, device=device, top_k=None)
            print("Specialty Model loaded successfully.")
        except Exception as e:
            print(f"Error loading Specialty Model: {e}")
            self.specialty_pipeline = None

        print(f"Loading Disease Model: {self.disease_model_id} ...")
        try:
            self.disease_pipeline = pipeline("text-classification", model=self.disease_model_id, device=device, top_k=None)
            print("Disease Model loaded successfully.")
        except Exception as e:
            print(f"Error loading Disease Model: {e}")
            self.disease_pipeline = None

    def predict_severity(self, text: str):
        """
        Predicts ESI severity and mapped application severity.
        Since SHUB-8/Triage-BERT outputs LABEL_0 to LABEL_4, we map it sequentially:
        LABEL_0 -> ESI 1 (Most severe)
        ...
        LABEL_4 -> ESI 5 (Least severe)
        """
        if not self.triage_pipeline:
            raise RuntimeError("Triage model is not loaded.")
        
        # Get the top prediction
        result = self.triage_pipeline(text)[0]
        label = result['label']
        confidence = result['score']
        
        # Assuming LABEL_0 -> ESI 1, LABEL_4 -> ESI 5
        label_num = int(label.split('_')[-1]) # e.g., 'LABEL_0' -> 0
        esi_level = label_num + 1
        
        if esi_level <= 2:
            severity = "HIGH"
        elif esi_level == 3:
            severity = "MEDIUM"
        else:
            severity = "LOW"
            
        return {
            "level": severity,
            "esi": esi_level,
            "confidence": float(confidence),
            "is_override": False
        }

    def predict_specialty(self, text: str):
        """Predicts medical specialty and returns the top class along with differentials."""
        if not self.specialty_pipeline:
            raise RuntimeError("Specialty model is not loaded.")
        
        # With top_k=None, result is a list of dictionaries sorted by score
        results = self.specialty_pipeline(text)
        
        # Pipeline returns a list of lists when top_k=None for a single string, or just a list. 
        # Usually it's a list of dicts. Let's ensure we get the sorted dicts.
        if isinstance(results[0], list):
            results = results[0]
            
        top_prediction = results[0]
        differentials = results[1:4] # Get top 3 runner-ups
        
        return {
            "name": top_prediction['label'],
            "confidence": float(top_prediction['score']),
            "differentials": [{"name": diff['label'], "confidence": float(diff['score'])} for diff in differentials]
        }

    def predict_disease(self, text: str):
        """Predicts the disease based on symptoms."""
        if not self.disease_pipeline:
            raise RuntimeError("Disease model is not loaded.")
        
        results = self.disease_pipeline(text)
        
        if isinstance(results[0], list):
            results = results[0]
            
        top_prediction = results[0]
        differentials = results[1:4]
        
        return {
            "disease": top_prediction['label'],
            "confidence": float(top_prediction['score']),
            "differentials": [{"disease": diff['label'], "confidence": float(diff['score'])} for diff in differentials]
        }

# Global instance for FastAPI lifecycle
nlp_manager = NLPManager()
