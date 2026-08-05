const isBrowser = typeof window !== "undefined";
const isLocalhost = isBrowser && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
const productionBackendUrl = "https://medipulse-4fi1.onrender.com";

// FIXED: Deployed builds without VITE_BACKEND_URL were calling localhost, causing hospital OPD booking to fail with "Failed to fetch".
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || (isLocalhost ? "http://localhost:8080" : productionBackendUrl);
const MAPS_API = import.meta.env.VITE_GOOGLE_MAPS_API;
const CLOUDINARY_API = import.meta.env.VITE_CLOUDINARY_API;

export { BACKEND_URL, MAPS_API, CLOUDINARY_API };
