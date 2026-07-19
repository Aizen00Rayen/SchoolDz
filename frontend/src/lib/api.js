import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api/v1`;

// Resolves a stored relative path (e.g. tenant.logo_url = "/uploads/logos/x.png")
// into a fetchable absolute URL. Passes absolute URLs through unchanged.
export function resolveFileUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${BACKEND_URL}${path}`;
}

/** Fetches a payment's invoice PDF (auth'd — the endpoint needs the Bearer
 * token, so a plain <a href> won't carry it) and opens it in a new tab.
 * Used from both the staff Payments page and the parent portal. */
export async function openInvoicePdf(paymentId) {
  const res = await api.get(`/payments/${paymentId}/invoice`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// In-memory access token (also cookies are set httpOnly by backend)
let accessToken = null;
export const setAccessToken = (t) => {
  accessToken = t;
  if (t) localStorage.setItem("schooldz_access_token", t);
  else localStorage.removeItem("schooldz_access_token");
};
export const getAccessToken = () => {
  if (accessToken) return accessToken;
  const stored = localStorage.getItem("schooldz_access_token");
  if (stored) accessToken = stored;
  return accessToken;
};

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  const t = getAccessToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      const url = err?.config?.url || "";
      // Only clear the token if it came from an auth validation endpoint,
      // not from every protected endpoint — prevents race conditions where
      // a parallel un-authed request wipes a freshly stored token.
      const isAuthCheck = url.includes("/auth/me") || url.includes("/auth/refresh");
      // ...and only if THIS request actually sent a token that got rejected
      // (a genuinely invalid/expired one) — not a request that went out
      // anonymously before any token existed. Without this check, a slow
      // /auth/me fired before login (e.g. AuthProvider's mount-time loadMe())
      // can resolve *after* a fresh token was stored by a parallel login —
      // notably the Google OAuth callback, where AuthProvider's mount effect
      // and loginWithGoogleCode()'s own loadMe() both fire on the same page
      // load — and wipe out the just-stored valid token even though it was
      // never sent on the failing request.
      const requestHadToken = !!err?.config?.headers?.Authorization;
      if (isAuthCheck && requestHadToken) {
        setAccessToken(null);
      }
    }
    return Promise.reject(err);
  },
);

export function formatApiErrorDetail(detail) {
  if (detail == null) return null;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function extractError(err) {
  const data = err?.response?.data;
  // Backend returns either {detail: "..."} (DRF default) or {error: "..."} (our custom views).
  // Check detail first since it can carry richer shapes (validation error lists),
  // but fall through to error/message rather than a generic string the moment
  // detail is merely absent — {error: "..."} responses are common (guard-rail
  // 400s like "Cannot delete a super admin account") and were previously never
  // shown because "Something went wrong" is truthy and always won the `||` chain.
  const msg =
    formatApiErrorDetail(data?.detail) ||
    (data?.error && typeof data.error === "string" ? data.error : null) ||
    err?.message ||
    "Something went wrong. Please try again.";
  return msg;
}
