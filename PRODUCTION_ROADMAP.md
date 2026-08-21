# MediPulse v2 ML Architecture - Production Roadmap

## 1. Specialty Classification: PubMedBERT Fine-Tuning
**Current MVP State:** 
We use a two-stage pipeline: an existing TF-IDF + Naive Bayes disease classifier (`medipulse-disease-prediction`) followed by a curated, deterministic `disease_to_specialty.json` mapping table. This avoids the risk of using unsafe LLM-generated synthetic specialty labels.

**Production Goal:** 
Fine-tune a genuine biomedical transformer (`microsoft/BiomedNLP-PubMedBERT-base-uncased-abstract-fulltext`) directly for symptom-to-specialty classification.

**Prerequisites (Dataset Sourcing):**
Before writing any training code, we must solve the dataset problem:
1. **Option A (Organic Data):** Accumulate enough real MediPulse triage interaction data to derive labels from actual doctor-assigned specialties post-visit.
2. **Option B (Public Data + Clinical Review):** Source a public medical QA dataset (e.g., MedQA) that carries specialty metadata, and have clinicians validate a subset of the reformatted symptom-to-specialty mappings to ensure no synthetic noise.

*Do NOT generate synthetic labels via LLM.*

## 2. Ranking Upgrades: LightGBM LambdaMART
**Current MVP State:**
We use a pointwise ranking model (or a deterministic fallback) that scores doctors independently.

**Production Goal:**
Upgrade to **LightGBM LambdaMART**, a true pairwise/listwise learning-to-rank algorithm that optimizes directly for ranking quality (NDCG) rather than binary classification.

**Prerequisites:**
1. Collect relevance-graded data (e.g., clicks, bookings, successful consultation completions) instead of flat binary labels.
2. Group the data by a patient query ID (`qid`).
3. Define the evaluation metrics formally: NDCG@5, NDCG@10, MRR, Precision@K, Recall@K.

## 3. Severity Classification
**Current MVP State:**
We reuse the existing structured-feature gradient-boosted triage model (XGBoost) for severity (LOW/MEDIUM/HIGH), with a deterministic safety layer (`flagRedSymptoms`) overriding any ML outputs for red-flag symptoms.

**Production Goal:**
1. Extend the XGBoost model to full ESI-level (1-5) resolution if clinical requirements demand higher granularity.
2. Alternatively, share the fine-tuned PubMedBERT backbone (from the Specialty upgrade) with a second classification head for severity, to reduce serving overhead while improving NLP understanding.

