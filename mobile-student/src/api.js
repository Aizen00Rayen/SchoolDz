import AsyncStorage from "@react-native-async-storage/async-storage";

// Points at the live Scolaris backend (Hostinger VPS, behind nginx + Let's
// Encrypt). Override via setApiBase() if you ever need to point a build at a
// local dev backend instead (e.g. http://192.168.1.20:8002/api/v1).
export const DEFAULT_API_BASE = "https://scolarisdz.duckdns.org/api/v1";

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
