/* eslint-disable react/prop-types */
import { Cookie as CookieIcon, Shield, Settings, Info, ArrowLeft, FileText } from 'lucide-react';
import { Button, Card, StatusBadge } from '../components/ui';

const PolicySection = ({ title, icon: Icon, children }) => (
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

const DataUsagePolicy = () => {
  return (
    <main className="mp-page" style={{ maxWidth: 840 }}>
      <div className="mp-section-heading">
        <div>
          <p className="mp-eyebrow">Legal & Compliance</p>
          <h1>Cookie & Data Usage Policy</h1>
          <p>How MediPulse utilizes browser storage, session cookies, and local identifiers.</p>
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
        <Button to="/terms" variant="secondary" size="small">
          <FileText size={14} /> Terms of Service
        </Button>
        <Button to="/cookiepolicy" variant="primary" size="small">
          <CookieIcon size={14} /> Cookie Policy
        </Button>
      </div>

      <PolicySection title="What Are Cookies & Web Storage" icon={CookieIcon}>
        <p style={{ margin: "0 0 10px" }}>
          Cookies and local storage tokens are small text fragments stored on your computing device when accessing web applications. 
          MediPulse utilizes secure cookies and encrypted browser session keys to maintain authenticated states and prevent CSRF vulnerabilities.
        </p>
      </PolicySection>

      <PolicySection title="How We Use Cookies" icon={Settings}>
        <p style={{ margin: "0 0 10px" }}>We employ web storage strictly for core platform functionality:</p>
        <ul style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <li><strong>Session Authentication:</strong> Keeping patients and healthcare providers securely signed in across page transitions.</li>
          <li><strong>CSRF Protection:</strong> Enforcing cross-site request forgery tokens to guard against malicious request injection.</li>
          <li><strong>Theme & Appearance:</strong> Remembering light/dark theme choices and accessible font scaling.</li>
          <li><strong>Queue Continuity:</strong> Retaining temporary token references during active OPD arrival flow.</li>
        </ul>
      </PolicySection>

      <PolicySection title="Cookie Classifications" icon={Shield}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ borderLeft: "3px solid var(--mp-primary)", paddingLeft: 12 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700 }}>Essential & Security Cookies</h3>
            <p style={{ margin: 0, color: "var(--mp-muted)", fontSize: "0.9rem" }}>
              Strictly necessary for user login, session validation, and hospital access gates. The platform cannot function without these cookies.
            </p>
          </div>
          <div style={{ borderLeft: "3px solid var(--mp-secondary, #64748b)", paddingLeft: 12 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700 }}>Functional & Preference Storage</h3>
            <p style={{ margin: 0, color: "var(--mp-muted)", fontSize: "0.9rem" }}>
              Saves user interface choices, language selection, and notification audio toggle settings.
            </p>
          </div>
          <div style={{ borderLeft: "3px solid var(--mp-success, #10b981)", paddingLeft: 12 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 700 }}>Operational Analytics</h3>
            <p style={{ margin: 0, color: "var(--mp-muted)", fontSize: "0.9rem" }}>
              Aggregated, non-personally identifiable metrics on page load latency, network retries, and API performance.
            </p>
          </div>
        </div>
      </PolicySection>

      <PolicySection title="Managing & Clearing Cookies" icon={Info}>
        <p style={{ margin: "0 0 10px" }}>
          You can clear or restrict cookies directly through your browser security settings:
        </p>
        <ul style={{ paddingLeft: 20, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <li><strong>Google Chrome:</strong> Settings → Privacy and security → Third-party cookies & Site data</li>
          <li><strong>Mozilla Firefox:</strong> Settings → Privacy & Security → Cookies and Site Data</li>
          <li><strong>Apple Safari:</strong> Preferences → Privacy → Manage Website Data</li>
          <li><strong>Microsoft Edge:</strong> Settings → Cookies and site permissions → Manage and delete cookies</li>
        </ul>
        <p className="mp-field-hint" style={{ margin: 0 }}>
          Note: Disabling essential cookies will prevent logging in to the patient portal, doctor queues, and hospital staff station.
        </p>
      </PolicySection>
    </main>
  );
};

export default DataUsagePolicy;