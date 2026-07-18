import AsyncStorage from "@react-native-async-storage/async-storage";

// Points at the Django backend's /api/v1 root. `localhost` only resolves to
// the phone/simulator itself, not your dev machine — on a physical device or
// most emulators you must change this to your machine's LAN IP
// (e.g. http://192.168.1.20:8002/api/v1). Editable at runtime in Settings so
// testers don't need to rebuild the app for this.
export const DEFAULT_API_BASE = "http://localhost:8002/api/v1";

const API_BASE_KEY = "scolaris_student_api_base";

export async function getApiBase() {
  const stored = await AsyncStorage.getItem(API_BASE_KEY);
  return stored || DEFAULT_API_BASE;
}

export async function setApiBase(url) {
  await AsyncStorage.setItem(API_BASE_KEY, url.trim());
}

export async function lookupStudent(tenantSlug, studentCode) {
  const base = await getApiBase();
  const params = new URLSearchParams({ tenant_slug: tenantSlug.trim(), student_code: studentCode.trim() });
  const res = await fetch(`${base}/public/student-lookup?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not find that student.");
  return data;
}
