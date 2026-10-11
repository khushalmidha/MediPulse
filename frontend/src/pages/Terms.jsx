/* eslint-disable react/prop-types */
import { FileText, Shield, UserCheck, AlertCircle, ArrowLeft, Cookie } from 'lucide-react';
import { Button, Card, StatusBadge } from '../components/ui';

const TermsSection = ({ title, icon: Icon, children }) => (
  <Card as="section" style={{ padding: 24, marginBottom: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <div style={{ background: "var(--mp-accent-soft)", color: "var(--mp-primary)", padding: 8, borderRadius: 8, display: "flex" }}>
        <Icon size={20} />
      </div>
      <h2 style={{ fontSize: "1.2rem", fontWeight: 750, margin: 0 }}>{title}</h2>
    </div>
    <div style={{ color: "var(--mp-text)", lineHeight: 1.65, fontSize: "0.95rem" }}>{children}</div>
  </Card>
);

const Terms = () => {
  return (
    <main className="mp-page" style={{ maxWidth: 840 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Legal & Compliance</p>
          <h1>Terms of Service</h1>
          <p>Rules and guidelines governing the use of the MediPulse care and hospital software.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge tone="positive">Effective October 2026</StatusBadge>
          <Button to="/" variant="secondary">
            <ArrowLeft size={16} /> Home
          </Button>
        </div>
      </div>

      {/* Policy Navigation Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <Button to="/privacy" variant="secondary" size="small">
          <Shield size={14} /> Privacy Policy
        </Button>
        <Button to="/terms" variant="primary" size="small">
          <FileText size={14} /> Terms of Service
        </Button>
        <Button to="/cookiepolicy" variant="secondary" size="small">
          <Cookie size={14} /> Cookie Policy
        </Button>
      </div>

      <TermsSection title="Agreement to Terms" icon={FileText}>
        <p style={{ margin: "0 0 10px" }}>
          By accessing or creating an account on MediPulse (as a patient, independent physician, or hospital staff member), 
          you agree to be bound by these Terms of Service. If you disagree with any part of these terms, you must not access the platform.
        </p>
      </TermsSection>

      <TermsSection title="Clinical Disclaimers & Emergency Notice" icon={AlertCircle}>
        <div style={{ background: "var(--mp-accent-soft)", padding: "12px 16px", borderRadius: "var(--mp-radius, 8px)", borderLeft: "4px solid var(--mp-warning)", marginBottom: 12 }}>
          <strong style={{ color: "var(--mp-warning)" }}>Emergency Situations:</strong> MediPulse is an outpatient scheduling and communication platform, NOT an emergency response dispatcher. If you are experiencing a life-threatening medical emergency, call your local emergency services (e.g. 112 / 911) immediately.
        </div>
        <p style={{ margin: 0 }}>
          AI triage recommendations, symptom assessments, and demand forecasts are algorithmic drafts provided solely to aid clinical planning. Final medical judgment remains the sole responsibility of the licensed attending physician.
        </p>
      </TermsSection>

      <TermsSection title="User & Staff Responsibilities" icon={UserCheck}>
        <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>Provide accurate demographic and contact information for clinical records and prescription verification.</li>
          <li>Maintain the security of your account credentials, one-time passwords (OTP), and session tokens.</li>
          <li>Hospital staff must use role-designated workspaces (Nursing Station, Doctor OPD, Admin) strictly according to authorized duties.</li>
          <li>Simulated virtual credits are intended purely for demonstration and workflow evaluation without cash surrender value.</li>
        </ul>
      </TermsSection>

      <TermsSection title="Platform Usage & Acceptable Conduct" icon={Shield}>
        <p style={{ margin: "0 0 8px" }}>Users must not:</p>
        <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>Attempt unauthorized horizontal access to medical records belonging to other patients or hospital tenants.</li>
          <li>Circumvent CSRF, rate-limiting, or session tokens through automated scraping or penetration tools.</li>
          <li>Post harmful, misleading, or fraudulent medical advice in public healthcare communities.</li>
        </ul>
      </TermsSection>
    </main>
  );
};

export default Terms;