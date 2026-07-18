import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { verifyStudent } from "./api";

const ACCENT = "#E53935";
const OK = "#16A34A";
const INK = "#0A0A0B";

export default function ScannerScreen({ token, teacherName, onLogout }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false); // true while verifying or showing a result
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, data?, message? }

  const onScanned = async ({ data }) => {
    if (locked) return;
    setLocked(true);
    setBusy(true);
    try {
      const student = await verifyStudent(token, data);
      setResult({ ok: true, data: student });
    } catch (e) {
      setResult({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const scanAgain = () => {
    setResult(null);
    setLocked(false);
  };

  if (!permission) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera access is needed to scan student badges.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan a student badge</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logout}>Sign out ({teacherName})</Text>
        </TouchableOpacity>
      </View>

      {!locked ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScanned}
          />
          <View style={styles.frame} pointerEvents="none" />
          <Text style={styles.hint}>Line up the student's QR code inside the frame</Text>
        </View>
      ) : (
        <View style={styles.resultWrap}>
          {busy ? (
            <ActivityIndicator size="large" color={INK} />
          ) : result?.ok ? (
            <ResultCard student={result.data} />
          ) : (
            <View style={[styles.card, { borderColor: ACCENT }]}>
              <Text style={[styles.statusText, { color: ACCENT }]}>Not recognized</Text>
              <Text style={styles.statusSub}>{result?.message}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.button} onPress={scanAgain}>
            <Text style={styles.buttonText}>Scan next student</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function ResultCard({ student }) {
  const color = student.paid ? OK : ACCENT;
  return (
    <View style={[styles.card, { borderColor: color }]}>
      {student.photo_url ? (
        <Image source={{ uri: student.photo_url }} style={styles.photo} />
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}>
          <Text style={styles.photoInitial}>{student.first_name?.[0]?.toUpperCase()}</Text>
        </View>
      )}
      <Text style={styles.name}>{student.first_name} {student.last_name}</Text>
      <Text style={styles.code}>{student.student_code}</Text>

      <View style={[styles.badge, { backgroundColor: color }]}>
        <Text style={styles.badgeText}>{student.paid ? "✓ Enrolled & paid up" : "✕ Payment overdue"}</Text>
      </View>

      {!!student.groups?.length && (
        <Text style={styles.groups}>{student.groups.join(" · ")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#FAFAFA" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#FAFAFA" },
  permText: { fontSize: 15, color: INK, textAlign: "center", marginBottom: 20 },
  header: {
    paddingTop: 56, paddingBottom: 14, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E4E4E7",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: INK },
  logout: { fontSize: 12, color: "#71717A", textDecorationLine: "underline" },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  frame: {
    position: "absolute", top: "25%", left: "12%", right: "12%", bottom: "30%",
    borderWidth: 3, borderColor: "#fff", borderRadius: 24,
  },
  hint: {
    position: "absolute", bottom: 40, left: 0, right: 0, textAlign: "center",
    color: "#fff", fontSize: 14, fontWeight: "600", textShadowColor: "#000", textShadowRadius: 6,
  },
  resultWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%", maxWidth: 340, backgroundColor: "#fff", borderRadius: 20, borderWidth: 2,
    padding: 28, alignItems: "center",
  },
  photo: { width: 72, height: 72, borderRadius: 36, marginBottom: 14 },
  photoPlaceholder: { backgroundColor: "#F4F4F5", alignItems: "center", justifyContent: "center" },
  photoInitial: { fontSize: 26, fontWeight: "800", color: "#71717A" },
  name: { fontSize: 20, fontWeight: "800", color: INK, textAlign: "center" },
  code: { fontSize: 13, color: "#71717A", marginTop: 2, marginBottom: 18, fontFamily: "monospace" },
  badge: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  badgeText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  groups: { marginTop: 14, fontSize: 12, color: "#A1A1AA" },
  statusText: { fontSize: 20, fontWeight: "800" },
  statusSub: { fontSize: 13, color: "#71717A", marginTop: 8, textAlign: "center" },
  button: {
    backgroundColor: INK, borderRadius: 10, paddingVertical: 15, paddingHorizontal: 32,
    alignItems: "center", marginTop: 24,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
