import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

// expo-secure-store has no web implementation (no OS keychain to back it),
// so fall back to AsyncStorage there — used only by `expo start --web` during
// development, native builds always use SecureStore.
const setItemAsync = Platform.OS === "web" ? AsyncStorage.setItem : SecureStore.setItemAsync;
const getItemAsync = Platform.OS === "web" ? AsyncStorage.getItem : SecureStore.getItemAsync;
const deleteItemAsync = Platform.OS === "web" ? AsyncStorage.removeItem : SecureStore.deleteItemAsync;

const SESSION_KEY = "scolaris_parent_session";

/** Persisted shape: { token, user } */
export async function saveSession(session) {
  await setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession() {
  const raw = await getItemAsync(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearSession() {
  await deleteItemAsync(SESSION_KEY);
}
