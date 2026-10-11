/* eslint-disable react/prop-types */
import { Lock, Shield, UserCheck, Bell, ArrowLeft, FileText, Cookie } from 'lucide-react';
import { Button, Card, StatusBadge } from '../components/ui';

const PrivacySection = ({ title, icon: Icon, children }) => (
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

const Privacy = () => {
  return (
    <main className="mp-page" style={{ maxWidth: 840 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Legal & Compliance</p>
          <h1>Privacy Policy</h1>
          <p>How MediPulse collects, protects, and handles personal and health data.</p>
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
        <Button to="/privacy" variant="primary" size="small">
          <Shield size={14} /> Privacy Policy
        </Button>
        <Button to="/terms" variant="secondary" size="small">
          <FileText size={14} /> Terms of Service
        </Button>
        <Button to="/cookiepolicy" variant="secondary" size="small">
          <Cookie size={14} /> Cookie Policy
        </Button>
      </div>

      <PrivacySection title="Introduction" icon={Lock}>
        <p style={{ margin: "0 0 10px" }}>
          At MediPulse, we prioritize the privacy and confidentiality of your sensitive health information. 
          This policy details how data is processed across our patient portals, doctor workspaces, and hospital SaaS modules.
        </p>
        <p style={{ margin: 0, color: "var(--mp-muted)", fontSize: "0.9rem" }}>
          By using MediPulse, you acknowledge the terms described herein and our adherence to applicable data privacy principles.
        </p>
      </PrivacySection>

      <PrivacySection title="Information We Collect" icon={Shield}>
        <p style={{ margin: "0 0 10px" }}>We collect information necessary to fulfill healthcare scheduling and communication:</p>
        <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <li><strong>Identity & Account Data:</strong> Name, phone number, email address, and family member profiles.</li>
          <li><strong>Clinical & Visit Data:</strong> Scheduled appointment times, OPD token sequences, clinician consultation notes, and vitals measurements.</li>
          <li><strong>Operational Records:</strong> Staff shift logs, role invitations, and department assignment manifests.</li>
          <li><strong>Simulated Ledger:</strong> Virtual wallet balances and demo transaction IDs. Real payment card numbers are never stored or collected.</li>
        </ul>
      </PrivacySection>

      <PrivacySection title="How We Use Your Information" icon={Bell}>
        <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>To issue queue tokens and notify patients of live arrival and consultation turns.</li>
          <li>To securely share clinical context with authorized attending physicians during active visits.</li>
          <li>To generate anonymized hospital operational forecasts (bed occupancy, blood bank inventory).</li>
          <li>To enforce session security, prevent unauthorized account takeovers, and maintain strict audit logs.</li>
        </ul>
      </PrivacySection>

      <PrivacySection title="Your Rights & Data Retention" icon={UserCheck}>
        <p style={{ margin: "0 0 10px" }}>You retain control over your health record information:</p>
        <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <li><strong>Access & Export:</strong> Request or download draft consultation summaries and health history at any time.</li>
          <li><strong>Rectification:</strong> Correct profile demographics, phone numbers, or doctor credentials.</li>
          <li><strong>Archival vs Deletion:</strong> Clinical visit logs are preserved under medical record regulations, but personal profiles may be deactivated and archived from active booking queues.</li>
        </ul>
      </PrivacySection>
    </main>
  );
};

export default Privacy;