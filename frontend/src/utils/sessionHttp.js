import axios from "axios";
import { BACKEND_URL } from "../utils";
import { disconnectSocket } from "../socket";

let generation = 0;
const csrf = { account: null, staff: null };
const api = new URL(BACKEND_URL, window.location.origin);
const apiPrefix = api.pathname.replace(/\/$/, "");
const isApi = target => target.origin === api.origin && (!apiPrefix || target.pathname === apiPrefix || target.pathname.startsWith(`${apiPrefix}/`));
export const csrfHeaders = (scope = "account") => csrf[scope] ? { "X-CSRF-Token": csrf[scope] } : {};
export const clearSessionState = () => { generation++; csrf.account = null; csrf.staff = null; disconnectSocket(); };
const scopeForPath = path => /\/staff(?:\/|$)|\/api\/(?:staff-messages|forecast|opd-ai|copilot|hospitals)(?:\/|$)/.test(path)
  || (/\/api\/opd\//.test(path) && !/\/(?:book|my-token)$/.test(path)) ? "staff" : "account";
axios.interceptors.request.use(config => {
  const target = new URL(config.url, config.baseURL || window.location.origin);
  if (!isApi(target)) return config;
  config.withCredentials = true;
  config.medipulseSessionGeneration = generation;
  if (!["get", "head", "options"].includes((config.method || "get").toLowerCase())) {
    Object.assign(config.headers, csrfHeaders(scopeForPath(target.pathname)));
  }
  return config;
});
axios.interceptors.response.use(response => {
  const target = new URL(response.config.url, response.config.baseURL || window.location.origin);
  if (!isApi(target) || !response.data?.csrfToken) return response;
  const scope = scopeForPath(target.pathname);
  const switching = /\/(?:login|signup|google-auth|set-password|register)$/.test(target.pathname);
  if (!switching && response.config.medipulseSessionGeneration !== generation) return response;
  if (switching) clearSessionState();
  csrf[scope] = response.data.csrfToken;
  if (switching) window.dispatchEvent(new CustomEvent("medipulse:session", { detail: { scope, payload: response.data } }));
  return response;
});
