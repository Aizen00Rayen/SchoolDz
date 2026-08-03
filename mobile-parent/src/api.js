import AsyncStorage from "@react-native-async-storage/async-storage";

// Points at the live Scolaris backend (Hostinger VPS, behind nginx + Let's
// Encrypt). Override via setApiBase() if you ever need to point a build at a
// local dev backend instead (e.g. http://192.168.1.20:8002/api/v1).
export const DEFAULT_API_BASE = "https://scolarisdz.duckdns.org/api/v1";

const API_BASE_KEY = "scolaris_parent_api_base";

export async function getApiBase() {
  const stored = await AsyncStorage.getItem(API_BASE_KEY);
  return stored || DEFAULT_API_BASE;
}

export async function setApiBase(url) {
  await AsyncStorage.setItem(API_BASE_KEY, url.trim());
}

async function request(token, path, options = {}) {
  const base = await getApiBase();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || "Something went wrong.");
  return data;
}

export async function login(email, password, tenantSlug) {
  const base = await getApiBase();
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email.trim(),
      password,
      tenant_slug: tenantSlug.trim() || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Invalid credentials.");
  return data; // { access_token, refresh_token, user }
}

export const getChildren = (token) => request(token, "/portal/children");
export const getChildAttendance = (token, id) => request(token, `/portal/children/${id}/attendance`);
export const getChildSessions = (token, id) => request(token, `/portal/children/${id}/sessions`);
export const getChildPayments = (token, id) => request(token, `/portal/children/${id}/payments`);
export const getChildGrades = (token, id) => request(token, `/portal/children/${id}/grades`);
export const getChildTeachers = (token, id) => request(token, `/portal/children/${id}/teachers`);

export const getConversation = (token) => request(token, "/portal/conversation");
export const getMessages = (token) => request(token, "/portal/conversation/messages");
export const sendMessage = (token, body) =>
  request(token, "/portal/conversation/messages", { method: "POST", body: JSON.stringify({ body }) });

// Returns the invoice endpoint's absolute URL — used by ChildDetailScreen to
// download the PDF (via expo-file-system, since it needs the Bearer header
// that a plain <a href>/WebView src can't attach on native).
export async function getInvoiceUrl(paymentId) {
  const base = await getApiBase();
  return `${base}/payments/${paymentId}/invoice`;
}
