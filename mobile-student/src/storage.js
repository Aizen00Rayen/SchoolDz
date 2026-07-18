import AsyncStorage from "@react-native-async-storage/async-storage";

const PROFILE_KEY = "scolaris_student_profile";

/** Persisted shape: { tenant_slug, student_code, student: {...lookup response} } */
export async function saveProfile(profile) {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function loadProfile() {
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearProfile() {
  await AsyncStorage.removeItem(PROFILE_KEY);
}
