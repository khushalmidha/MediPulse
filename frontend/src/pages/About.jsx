import { Github, Linkedin, Twitter, ArrowLeft, HeartPulse, Sparkles, ShieldCheck, Users } from 'lucide-react';
import { Button, Card } from '../components/ui';

const About = () => {
  return (
    <main className="mp-page" style={{ maxWidth: 1040 }}>
      {/* Hero Header */}
      <div className="mp-section-heading" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <p className="mp-eyebrow">About the Platform</p>
        <h1 style={{ fontSize: "2.4rem", fontWeight: 850 }}>
          Transforming Healthcare Operations & Access
        </h1>
        <p style={{ maxWidth: 680, fontSize: "1.05rem", lineHeight: 1.6, color: "var(--mp-muted)" }}>
          MediPulse is a modern digital health infrastructure connecting patients, clinicians, and hospital networks. 
          From decentralized outpatient token tracking to intelligent clinical queues, our focus is seamless, transparent care.
        </p>
      </div>

      {/* Core Values */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, margin: "24px 0 32px" }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ background: "var(--mp-accent-soft)", color: "var(--mp-primary)", padding: 8, borderRadius: 8 }}>
              <HeartPulse size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 750 }}>Patient First</h3>
          </div>
          <p style={{ margin: 0, color: "var(--mp-muted)", fontSize: "0.92rem", lineHeight: 1.55 }}>
            Empowering patients with live queue positions, verified doctor schedules, family health profiles, and transparent OPD arrival guidance.
          </p>
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ background: "var(--mp-accent-soft)", color: "var(--mp-primary)", padding: 8, borderRadius: 8 }}>
              <ShieldCheck size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 750 }}>Clinical Reliability</h3>
          </div>
          <p style={{ margin: 0, color: "var(--mp-muted)", fontSize: "0.92rem", lineHeight: 1.55 }}>
            Staff-isolated nursing workflows, role-guarded prescriptions, tamper-proof audit trails, and strict medical identity preservation.
          </p>
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ background: "var(--mp-accent-soft)", color: "var(--mp-primary)", padding: 8, borderRadius: 8 }}>
              <Sparkles size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 750 }}>Hospital SaaS</h3>
          </div>
          <p style={{ margin: 0, color: "var(--mp-muted)", fontSize: "0.92rem", lineHeight: 1.55 }}>
            Multi-department operational consoles, walk-in token issuance, verified branding microsites, and live bed and blood reserve forecasts.
          </p>
        </Card>
      </div>

      {/* Engineering & Leadership Team */}
      <div style={{ margin: "32px 0 16px" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <p className="mp-eyebrow">Engineering & Leadership</p>
          <h2 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "4px 0" }}>Meet Our Team</h2>
          <p className="mp-field-hint">The developers and architects behind the MediPulse platform.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
          {/* Lakshya */}
          <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "32px 24px" }}>
            <div style={{ position: "relative", marginBottom: 16 }}>
              <img
                src="lakshya.jpeg"
                alt="Lakshya Agarwal"
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "4px solid var(--mp-border)",
                  boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
                }}
              />
            </div>
            <h3 style={{ margin: "0 0 4px", fontSize: "1.3rem", fontWeight: 800 }}>Lakshya Agarwal</h3>
            <p style={{ margin: "0 0 12px", color: "var(--mp-primary)", fontWeight: 650, fontSize: "0.95rem" }}>
              Full Stack Developer
            </p>
            <p style={{ margin: "0 0 20px", color: "var(--mp-muted)", fontSize: "0.9rem", lineHeight: 1.55, maxWidth: 360 }}>
              Passionate about creating seamless user experiences, real-time socket infrastructure, and robust backend micro-flows.
            </p>
            <div style={{ display: "flex", gap: 16 }}>
              <a href="https://github.com/Lakshya0000" target="_blank" rel="noopener noreferrer" className="mp-icon-link" aria-label="Lakshya on GitHub" style={{ color: "var(--mp-text)" }}>
                <Github size={20} />
              </a>
              <a href="https://www.linkedin.com/in/lakshya-agarwal-98341b287/" target="_blank" rel="noopener noreferrer" className="mp-icon-link" aria-label="Lakshya on LinkedIn" style={{ color: "var(--mp-text)" }}>
                <Linkedin size={20} />
              </a>
              <a href="https://x.com/Lakshya81001405" target="_blank" rel="noopener noreferrer" className="mp-icon-link" aria-label="Lakshya on X" style={{ color: "var(--mp-text)" }}>
                <Twitter size={20} />
              </a>
            </div>
          </Card>

          {/* Khushal */}
          <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "32px 24px" }}>
            <div style={{ position: "relative", marginBottom: 16 }}>
              <img
                src="Khushal_img.jpeg"
                alt="Khushal Midha"
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "4px solid var(--mp-border)",
                  boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
                }}
              />
            </div>
            <h3 style={{ margin: "0 0 4px", fontSize: "1.3rem", fontWeight: 800 }}>Khushal Midha</h3>
            <p style={{ margin: "0 0 12px", color: "var(--mp-primary)", fontWeight: 650, fontSize: "0.95rem" }}>
              Full Stack Developer & Founder
            </p>
            <p style={{ margin: "0 0 20px", color: "var(--mp-muted)", fontSize: "0.9rem", lineHeight: 1.55, maxWidth: 360 }}>
              Specialized in scalable distributed architectures, healthcare data pipelines, and mission-critical hospital workflows.
            </p>
            <div style={{ display: "flex", gap: 16 }}>
              <a href="https://github.com/khushalmidha" target="_blank" rel="noopener noreferrer" className="mp-icon-link" aria-label="Khushal on GitHub" style={{ color: "var(--mp-text)" }}>
                <Github size={20} />
              </a>
              <a href="https://www.linkedin.com/in/khushal-midha-260bb3288/" target="_blank" rel="noopener noreferrer" className="mp-icon-link" aria-label="Khushal on LinkedIn" style={{ color: "var(--mp-text)" }}>
                <Linkedin size={20} />
              </a>
              <a href="https://x.com/Khushal_Midha" target="_blank" rel="noopener noreferrer" className="mp-icon-link" aria-label="Khushal on X" style={{ color: "var(--mp-text)" }}>
                <Twitter size={20} />
              </a>
            </div>
          </Card>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 24 }}>
        <Button to="/" variant="secondary">
          <ArrowLeft size={16} /> Return to Home
        </Button>
        <Button to="/communities" variant="secondary">
          <Users size={16} /> Browse Communities
        </Button>
      </div>
    </main>
  );
};

export default About;