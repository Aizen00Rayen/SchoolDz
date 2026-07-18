import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { lookupStudent } from "./api";

export default function LookupScreen({ onFound }) {
  const [tenantSlug, setTenantSlug] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async () => {
    if (!tenantSlug.trim() || !studentCode.trim()) {
      setError("Enter both your school code and your student code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const student = await lookupStudent(tenantSlug, studentCode);
      onFound(tenantSlug.trim().toLowerCase(), studentCode.trim(), student);
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
        <Text style={styles.subtitle}>Show your badge to your teacher — no account needed.</Text>

        <Text style={styles.label}>School code</Text>
        <TextInput
          style={styles.input}
          value={tenantSlug}
          onChangeText={setTenantSlug}
          placeholder="e.g. myschool"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Your student code</Text>
        <TextInput
          style={styles.input}
          value={studentCode}
          onChangeText={setStudentCode}
          placeholder="e.g. STU-00001"
          autoCapitalize="characters"
          autoCorrect={false}
        />

        {!!error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Get my badge</Text>}
        </TouchableOpacity>

        <Text style={styles.hint}>Ask your school's front desk if you don't know these codes.</Text>
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
  hint: { fontSize: 12, color: "#A1A1AA", marginTop: 18, textAlign: "center" },
});
