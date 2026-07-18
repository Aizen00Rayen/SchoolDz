import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { login } from "./api";

export default function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await login(email, password, tenantSlug);
      if (data.user?.role === "parent") {
        throw new Error("This app is for staff — parents should use the parent portal instead.");
      }
      onLoggedIn(data.access_token, data.user);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logoDot} />
        <Text style={styles.title}>scolaris</Text>
        <Text style={styles.subtitle}>Sign in to scan and verify student badges.</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@school.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
        />

        <Text style={styles.label}>Workspace URL (optional)</Text>
        <TextInput
          style={styles.input}
          value={tenantSlug}
          onChangeText={setTenantSlug}
          placeholder="my-school"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ACCENT = "#E53935";
const INK = "#0A0A0B";

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#FAFAFA" },
  container: { flexGrow: 1, padding: 28, justifyContent: "center" },
  logoDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: ACCENT, marginBottom: 12 },
  title: { fontSize: 32, fontWeight: "800", color: INK, letterSpacing: -1, marginBottom: 4 },
  subtitle: { fontSize: 15, color: "#71717A", marginBottom: 32 },
  label: { fontSize: 13, fontWeight: "600", color: INK, marginBottom: 6, marginTop: 16 },
  input: {
    borderWidth: 1, borderColor: "#E4E4E7", borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 16, backgroundColor: "#fff", color: INK,
  },
  error: { color: ACCENT, marginTop: 14, fontSize: 13 },
  button: {
    backgroundColor: ACCENT, borderRadius: 10, paddingVertical: 15, alignItems: "center", marginTop: 28,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
