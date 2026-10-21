import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Banner, Button, Card, EmptyState, Field, LoadingState } from "../components/ui";
import { AccountPage, Feedback, PasswordField } from "../components/account/AccountUI";
import useFormTask from "../hooks/useFormTask";
import { BACKEND_URL } from "../utils";

export default function HospitalAdminSetup() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";

  return <AdminSetupForm key={token} token={token} />;
}

/* eslint-disable react/prop-types */
function AdminSetupForm({ token }) {
  const [hospital, setHospital] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState({ name: "", password: "", confirmPassword: "" });
  const task = useFormTask();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Setup link is missing a required token.");
      setExpired(true);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    axios
      .get(`${BACKEND_URL}/api/saas/setup-link/verify/${encodeURIComponent(token)}`, {
        signal: controller.signal,
      })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (!response.data.hospital) {
          throw new Error("Hospital setup details are unavailable.");
        }
        setHospital(response.data.hospital);
        setForm((current) => ({
          ...current,
          name: current.name || response.data.hospital.name || "",
        }));
        setLoading(false);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          const status = failure.response?.status;
          const msg =
            failure.response?.data?.message ||
            "This setup link is invalid or has expired. Please contact support.";
          setError(msg);
          if ([400, 404, 409, 410].includes(status)) {
            setHospital(null);
            setExpired(true);
          }
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [token, attempt]);

  const update = (key) => (event) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();

    if (form.password.length < 8) {
      task.setFeedback({
        type: "error",
        message: "Password must be at least 8 characters long.",
      });
      return;
    }

    if (form.password !== form.confirmPassword) {
      task.setFeedback({
        type: "error",
        message: "Passwords do not match. Please re-enter your password.",
      });
      return;
    }

    void task.run(
      async (signal) => {
        try {
          return await axios.post(
            `${BACKEND_URL}/api/saas/setup-link/consume`,
            {
              token,
              adminPassword: form.password,
              name: form.name.trim(),
            },
            { signal }
          );
        } catch (failure) {
          if ([400, 404, 409, 410].includes(failure.response?.status)) {
            setExpired(true);
            setHospital(null);
          }
          throw failure;
        }
      },
      (response) => {
        if (!response.data.result) {
          throw new Error("Hospital setup response is incomplete.");
        }
        // Redirect to hospital staff admin workspace or login
        navigate("/hospital/admin", { replace: true });
      }
    );
  };

  return (
    <AccountPage
      wide
      title={hospital ? `Activate ${hospital.name}` : "Hospital administrator setup"}
      eyebrow="Hospital Workspace Activation"
      description="Create your administrator password to activate your hospital workspace and start configuring care operations."
    >
      <Feedback feedback={task.feedback} />

      {loading ? (
        <LoadingState>Verifying setup link...</LoadingState>
      ) : error && !expired ? (
        <Banner
          action={
            token ? (
              <Button onClick={() => setAttempt((v) => v + 1)}>Retry verification</Button>
            ) : undefined
          }
        >
          {error}
        </Banner>
      ) : null}

      {expired && (
        <Card>
          <EmptyState title="Setup link invalid or expired">
            {error ||
              "This setup link has expired or has already been used. Please request a new setup link from your platform administrator."}
          </EmptyState>
          <div className="mp-actions" style={{ marginTop: 16 }}>
            <Button to="/hospital/login" variant="secondary">
              Staff sign in
            </Button>
            <Button to="/hospitals" variant="ghost">
              Browse hospitals
            </Button>
          </div>
        </Card>
      )}

      {hospital && !expired && (
        <Card as="form" className="mp-stack" onSubmit={submit} aria-busy={task.busy}>
          <dl className="mp-details">
            <div>
              <dt>Hospital Name</dt>
              <dd>
                <strong>{hospital.name}</strong>
              </dd>
            </div>
            {hospital.slug && (
              <div>
                <dt>Workspace Slug</dt>
                <dd>{hospital.slug}</dd>
              </div>
            )}
            {hospital.type && (
              <div>
                <dt>Facility Type</dt>
                <dd style={{ textTransform: "capitalize" }}>{hospital.type.replace("-", " ")}</dd>
              </div>
            )}
            {hospital.email && (
              <div>
                <dt>Registered Email</dt>
                <dd>{hospital.email}</dd>
              </div>
            )}
          </dl>

          {!task.online && (
            <Banner>You are offline. Reconnect to complete your workspace setup.</Banner>
          )}

          <Field
            label="Administrator Name"
            value={form.name}
            onChange={update("name")}
            required
            pattern=".*[^ ].*"
            autoComplete="name"
            disabled={task.busy}
            hint="Your display name as primary workspace administrator."
          />

          <PasswordField
            label="Administrator Password"
            required
            minLength={8}
            hint="At least 8 characters."
            autoComplete="new-password"
            value={form.password}
            disabled={task.busy}
            onChange={update("password")}
          />

          <PasswordField
            label="Confirm Administrator Password"
            required
            minLength={8}
            hint="Re-enter the password to confirm."
            autoComplete="new-password"
            value={form.confirmPassword}
            disabled={task.busy}
            onChange={update("confirmPassword")}
          />

          <div className="mp-actions" style={{ marginTop: 8 }}>
            <Button type="submit" disabled={task.busy || !task.online}>
              {task.busy ? "Activating workspace..." : "Activate Administrator Workspace"}
            </Button>
            <Button to="/hospital/login" variant="secondary" disabled={task.busy}>
              Already activated? Sign in
            </Button>
          </div>
        </Card>
      )}
    </AccountPage>
  );
}
