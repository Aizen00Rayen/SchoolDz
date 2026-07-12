import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api/v1`;

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
      // don't clear on /auth/me since AuthProvider handles it
    }
    return Promise.reject(err);
  },
);

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
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
  return formatApiErrorDetail(err?.response?.data?.detail) || err?.message || "Unknown error";
}
