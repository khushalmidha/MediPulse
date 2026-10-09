// Preserve a request across lost responses/reloads without storing medical input.
export const bookingRequestKey = async (scope, payload) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  const signature = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const storage = `medipulse.booking.${scope}`;
  let prior;
  try { prior = JSON.parse(localStorage.getItem(storage)); } catch { prior = null; }
  if (prior?.signature === signature && prior.key) return prior.key;
  const key = crypto.randomUUID();
  localStorage.setItem(storage, JSON.stringify({ key, signature }));
  return key;
};
export const clearBookingRequest = (scope) => localStorage.removeItem(`medipulse.booking.${scope}`);
