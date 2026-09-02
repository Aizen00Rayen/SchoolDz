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

/** Only these schemes may come back from a stored, tenant-authored link
 * (a school's map URL or social profiles) that we render as an href. Without
 * the check a workspace owner could put `javascript:...` in Settings and have
 * it run in the browser of every parent visiting their public page. */
const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:)/i;

export function safeExternalUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (SAFE_URL_SCHEMES.test(trimmed)) return trimmed;
  // Bare "facebook.com/x" is a common way for owners to type these in.
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/** Opens a file that lives behind the authenticated /uploads/* routes
 * (teacher CVs and diplomas, medical excuse notes, quiz answer sheets). A
 * plain <a href> can't carry the Bearer token those paths now require, so
 * fetch it as a blob first — same approach as openInvoicePdf. */
export async function openPrivateFile(path) {
  const res = await api.get(resolveFileUrl(path), { responseType: "blob", baseURL: "" });
  const url = URL.createObjectURL(res.data);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
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

/** Opens the printable Session Sheet PDF (the group's whole course
 * planning, every session at once) for one or more groups — same auth'd-
 * blob approach as openInvoicePdf. `groupIds` may be one id or an array
 * (multiple groups print as separate pages in one document). */
export async function openSessionSheetPdf(groupIds) {
  const params = new URLSearchParams();
  (Array.isArray(groupIds) ? groupIds : [groupIds]).forEach((id) => params.append("group_id", id));
  const res = await api.get(`/groups/session-sheet/print?${params.toString()}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Opens the printable student ID card(s) PDF — one card sized to fit real
 * ID-card stock for a single student, or a paper-saving A4 grid when
 * several are selected. Same auth'd-blob approach as openInvoicePdf.
 * `studentIds` may be one id or an array. */
export async function openStudentIdCardsPdf(studentIds) {
  const params = new URLSearchParams();
  (Array.isArray(studentIds) ? studentIds : [studentIds]).forEach((id) => params.append("student_id", id));
  const res = await api.get(`/students/id-cards/print?${params.toString()}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Opens the printable monthly finance report PDF (same branded/RTL look
 * as the student invoice, but for the tenant's own totals + transaction
 * list for one month) — same auth'd-blob approach as openInvoicePdf.
 * `extraParams` carries the Reports page's own group_id/teacher_id filters
 * through, so the PDF matches whatever's currently on screen. */
export async function openFinanceReportPdf(month, extraParams = {}) {
  const params = new URLSearchParams({ month, ...extraParams });
  const res = await api.get(`/reports/finance/print?${params.toString()}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Downloads a CSV/XLSX export of a resource list (students/parents/teachers) —
 * same auth'd-blob approach as openInvoicePdf, since a plain <a href> can't
 * carry the Bearer token. Query param is named "type", not "format" — DRF
 * reserves ?format=... for its own content-negotiation and 404s when no
 * renderer matches "csv"/"xlsx". */
export async function downloadExport(resource, format) {
  return downloadFrom(`/${resource}/export`, format, resource);
}

/** Same download-a-blob dance as downloadExport, but for endpoints that
 * aren't a `<resource>/export` route — the reports and teacher-payments
 * summaries take their own filters and emit the file from the same URL the
 * page already reads. `path` may already carry a query string. */
export async function downloadFrom(path, format, filename) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await api.get(`${path}${sep}type=${format}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
