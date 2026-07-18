import AsyncStorage from "@react-native-async-storage/async-storage";

// Points at the live Scolaris backend (Hostinger VPS, behind nginx + Let's
// Encrypt). Override via setApiBase() if you ever need to point a build at a
// local dev backend instead (e.g. http://192.168.1.20:8002/api/v1).
export const DEFAULT_API_BASE = "https://scolarisdz.duckdns.org/api/v1";

const API_BASE_KEY = "scolaris_teacher_api_base";

export async function getApiBase() {
  const stored = await AsyncStorage.getItem(API_BASE_KEY);
  return stored || DEFAULT_API_BASE;
}

export async function setApiBase(url) {
  await AsyncStorage.setItem(API_BASE_KEY, url.trim());
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

export async function verifyStudent(token, studentId) {
  const base = await getApiBase();
  const res = await fetch(`${base}/students/${studentId}/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || "That QR code isn't recognized here.");
  return data;
}
