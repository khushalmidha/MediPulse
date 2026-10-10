/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { Banner, Button } from "../ui";
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
let scriptPromise;
const load = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (!script) { script = document.createElement("script"); script.src = "https://accounts.google.com/gsi/client"; script.async = true; document.body.appendChild(script); }
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => { script.remove(); scriptPromise = null; reject(new Error("Google sign-in unavailable")); }, { once: true });
  });
  return scriptPromise;
};
export default function GoogleButton({ disabled, onCredential, signup = false, role }) {
  const ref = useRef(null), callback = useRef(onCredential), blocked = useRef(disabled);
  callback.current = onCredential; blocked.current = disabled;
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!clientId) return undefined;
    let active = true; setFailed(false);
    load().then(() => {
      if (!active || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: response => { if (active && !blocked.current) callback.current(response); } });
      ref.current.replaceChildren(); window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", text: signup ? "signup_with" : "signin_with", shape: "rectangular", width: Math.min(360, ref.current.parentElement.clientWidth || 280) });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt, signup, role]);
  if (!clientId) return <p className="mp-field-hint">Google sign-in is currently unavailable. Continue with email.</p>;
  return <div className={disabled ? "mp-google-button mp-google-button--disabled" : "mp-google-button"} inert={disabled ? true : undefined}>{failed && <Banner action={<Button onClick={() => setAttempt(value => value + 1)}>Retry Google sign-in</Button>}>Google sign-in could not load. You can still use email.</Banner>}<div hidden={failed} ref={ref} aria-label={signup ? "Google signup" : "Google sign-in"} /></div>;
}
