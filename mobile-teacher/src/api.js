import AsyncStorage from "@react-native-async-storage/async-storage";

// Points at the Django backend's /api/v1 root. `localhost` only resolves to
// the phone/simulator itself, not your dev machine — on a physical device or
// most emulators you must change this to your machine's LAN IP
// (e.g. http://192.168.1.20:8002/api/v1). Editable at runtime in Settings so
// testers don't need to rebuild the app for this.
export const DEFAULT_API_BASE = "http://localhost:8002/api/v1";

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
