import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { login } from "./api";
import { ACCENT, INK, BG, BORDER, MUTED, CARD, RADIUS, SPACING, SHADOW_MD } from "./theme";

function FieldInput({ icon, secure, toggleSecure, ...props }) {
  return (
    <View style={styles.inputWrap}>
      <Feather name={icon} size={18} color={MUTED} style={styles.inputIcon} />
      <TextInput style={styles.input} placeholderTextColor="#A1A1AA" {...props} />
      {toggleSecure && (
        <TouchableOpacity onPress={toggleSecure} hitSlop={10}>
          <Feather name={secure ? "eye" : "eye-off"} size={18} color={MUTED} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function LoginScreen({ onLoggedIn }) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, { paddingTop: insets.top + SPACING.xxl }]}>
          <View style={styles.badge}>
            <Feather name="camera" size={26} color="#fff" />
          </View>
          <Text style={styles.title}>scolaris</Text>
          <Text style={styles.tagline}>Staff app</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in</Text>
          <Text style={styles.cardSubtitle}>Scan and verify student badges in a tap.</Text>

          <Text style={styles.label}>Email</Text>
          <FieldInput
            icon="mail"
            value={email}
            onChangeText={setEmail}
            placeholder="you@school.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />

          <Text style={styles.label}>Password</Text>
          <FieldInput
            icon="lock"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry={!showPassword}
            secure={showPassword}
            toggleSecure={() => setShowPassword((v) => !v)}
          />

          <Text style={styles.label}>Workspace URL (optional)</Text>
          <FieldInput
            icon="globe"
            value={tenantSlug}
            onChangeText={setTenantSlug}
            placeholder="my-school"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {!!error && (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={15} color={ACCENT} />
              <Text style={styles.error}>{error}</Text>
            </View>
          )}

          <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={busy} activeOpacity={0.85}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.buttonText}>Sign in</Text>
                <Feather name="arrow-right" size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: INK },
  scroll: { flexGrow: 1, backgroundColor: BG },
  hero: {
    backgroundColor: INK, paddingBottom: SPACING.xxl + 12, paddingHorizontal: SPACING.xl,
    alignItems: "center",
  },
  badge: {
    width: 56, height: 56, borderRadius: RADIUS.lg, backgroundColor: ACCENT,
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.md,
  },
  title: { fontSize: 28, fontWeight: "800", color: "#fff", letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 2, fontWeight: "600" },
  card: {
    flexGrow: 1, backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    marginTop: -20, paddingHorizontal: SPACING.xl, paddingTop: SPACING.xl, paddingBottom: SPACING.xxl,
    ...SHADOW_MD,
  },
  cardTitle: { fontSize: 22, fontWeight: "800", color: INK },
  cardSubtitle: { fontSize: 14, color: MUTED, marginTop: 4, marginBottom: SPACING.lg },
  label: { fontSize: 13, fontWeight: "600", color: INK, marginBottom: SPACING.xs, marginTop: SPACING.md },
  inputWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, paddingHorizontal: 14,
    backgroundColor: "#fff",
  },
  inputIcon: { marginTop: 1 },
  input: { flex: 1, paddingVertical: 13, fontSize: 15, color: INK },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: SPACING.md,
    backgroundColor: "#FEF2F2", borderRadius: RADIUS.sm, padding: 10,
  },
  error: { color: ACCENT, fontSize: 13, flex: 1 },
  button: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: ACCENT, borderRadius: RADIUS.md, paddingVertical: 15, marginTop: SPACING.xl,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
