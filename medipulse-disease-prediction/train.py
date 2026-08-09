import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import make_pipeline
import pickle
import os

# Extensive clinical symptom mapping for 30 common conditions
disease_symptoms = {
    "Common Cold": ["runny nose", "sore throat", "mild fever", "cough", "sneezing", "congestion"],
    "Influenza (Flu)": ["high fever", "chills", "muscle aches", "fatigue", "headache", "dry cough"],
    "COVID-19": ["loss of taste", "loss of smell", "shortness of breath", "dry cough", "fever", "fatigue"],
    "Dengue": ["high fever", "severe joint pain", "muscle pain", "headache", "rash", "eye pain"],
    "Malaria": ["chills", "high fever", "sweating", "headache", "nausea", "muscle pain"],
    "Typhoid": ["prolonged fever", "abdominal pain", "weakness", "headache", "constipation", "rash"],
    "Migraine": ["severe headache", "throbbing pain", "nausea", "light sensitivity", "sound sensitivity"],
    "Gastroenteritis": ["diarrhea", "vomiting", "stomach cramps", "nausea", "low-grade fever"],
    "Acid Reflux (GERD)": ["heartburn", "chest pain", "regurgitation", "acid taste", "difficulty swallowing"],
    "Asthma": ["wheezing", "shortness of breath", "chest tightness", "coughing especially at night"],
    "Pneumonia": ["chest pain", "cough with phlegm", "fever", "chills", "difficulty breathing"],
    "Tuberculosis": ["persistent cough", "chest pain", "coughing up blood", "fatigue", "night sweats", "weight loss"],
    "Diabetes": ["increased thirst", "frequent urination", "extreme hunger", "unexplained weight loss", "fatigue", "blurred vision"],
    "Hypertension": ["headache", "shortness of breath", "nosebleeds", "dizziness", "chest pain"],
    "Anemia": ["fatigue", "weakness", "pale skin", "chest pain", "cold hands and feet", "dizziness"],
    "Arthritis": ["joint pain", "stiffness", "swelling", "redness", "decreased range of motion"],
    "Hyperthyroidism": ["weight loss", "rapid heartbeat", "increased appetite", "nervousness", "tremor", "sweating"],
    "Hypothyroidism": ["fatigue", "weight gain", "cold intolerance", "joint pain", "muscle weakness", "dry skin"],
    "Urinary Tract Infection (UTI)": ["burning urination", "frequent urination", "cloudy urine", "pelvic pain", "strong smelling urine"],
    "Kidney Stones": ["severe lower back pain", "blood in urine", "nausea", "vomiting", "fever", "frequent urination"],
    "Appendicitis": ["sudden pain on right side of lower abdomen", "nausea", "vomiting", "loss of appetite", "fever"],
    "Chickenpox": ["itchy rash", "blisters", "fever", "fatigue", "loss of appetite"],
    "Measles": ["fever", "dry cough", "runny nose", "sore throat", "inflamed eyes", "koplik spots", "skin rash"],
    "Conjunctivitis (Pink Eye)": ["redness in eye", "itchiness in eye", "tearing", "discharge from eye", "crusting around eyes"],
    "Food Poisoning": ["nausea", "vomiting", "watery diarrhea", "abdominal cramps", "fever"],
    "Allergies": ["sneezing", "itchy nose", "watery eyes", "runny nose", "stuffy nose", "hives"],
    "Bronchitis": ["cough", "production of mucus", "fatigue", "shortness of breath", "slight fever", "chest discomfort"],
    "PCOS": ["irregular periods", "excess facial hair", "acne", "weight gain", "thinning hair", "darkening of skin"],
    "Depression": ["persistent sadness", "loss of interest", "fatigue", "changes in appetite", "sleep disturbances", "difficulty concentrating"],
    "Anxiety": ["feeling restless", "fatigue", "difficulty concentrating", "irritability", "muscle tension", "sleep problems"]
}

def generate_synthetic_data(samples_per_disease=50):
    data = []
    labels = []
    
    # Generate variations of symptoms for training robustness
    for disease, symptoms in disease_symptoms.items():
        for _ in range(samples_per_disease):
            # Randomly select 1 to 4 symptoms
            num_symptoms = np.random.randint(1, min(5, len(symptoms) + 1))
            selected = np.random.choice(symptoms, size=num_symptoms, replace=False)
            
            # Add some filler words to simulate real patient input
            fillers = ["I have ", "Suffering from ", "Experiencing ", "Got ", "Feeling ", "", "My "]
            prefix = np.random.choice(fillers)
            
            text = prefix + " and ".join(selected)
            data.append(text)
            labels.append(disease)
            
    return pd.DataFrame({'text': data, 'disease': labels})

def train_and_save_model():
    print("Generating synthetic clinical dataset...")
    df = generate_synthetic_data(samples_per_disease=100)
    
    print(f"Training Lightweight Naive Bayes Model on {len(df)} samples...")
    # Using a pipeline of TF-IDF and Naive Bayes (extremely fast, very small file size)
    model = make_pipeline(
        TfidfVectorizer(ngram_range=(1, 2), stop_words='english', lowercase=True),
        MultinomialNB()
    )
    
    model.fit(df['text'], df['disease'])
    
    # Test accuracy on training set
    accuracy = model.score(df['text'], df['disease'])
    print(f"Model Training Complete! Internal Accuracy: {accuracy*100:.2f}%")
    
    # Save the model
    save_path = os.path.join(os.path.dirname(__file__), 'lightweight_model.pkl')
    with open(save_path, 'wb') as f:
        pickle.dump(model, f)
        
    print(f"Model successfully saved to {save_path} (File size: {os.path.getsize(save_path)/1024:.2f} KB)")

if __name__ == "__main__":
    train_and_save_model()
