import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { verifyStudent } from "./api";
import { ACCENT, OK, INK, MUTED, BG, BORDER, CARD, RADIUS, SPACING, SHADOW_MD } from "./theme";

export default function ScannerScreen({ token, teacherName, onLogout }) {
  const insets = useSafeAreaInsets();
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
    return <View style={styles.center}><ActivityIndicator color={ACCENT} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <View style={styles.permIcon}><Feather name="camera-off" size={28} color={MUTED} /></View>
        <Text style={styles.permText}>Camera access is needed to scan student badges.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission} activeOpacity={0.85}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <View>
          <Text style={styles.headerTitle}>Scan a badge</Text>
          <Text style={styles.headerSub}>{teacherName}</Text>
        </View>
        <TouchableOpacity onPress={onLogout} style={styles.logoutButton} hitSlop={8}>
          <Feather name="log-out" size={18} color={MUTED} />
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
          <View style={styles.frameWrap} pointerEvents="none">
            <View style={styles.frame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <Text style={styles.hint}>Line up the student's QR code inside the frame</Text>
          </View>
        </View>
      ) : (
        <View style={styles.resultWrap}>
          {busy ? (
            <ActivityIndicator size="large" color={INK} />
          ) : result?.ok ? (
            <ResultCard student={result.data} />
          ) : (
            <View style={[styles.card, styles.cardError]}>
              <View style={[styles.statusIcon, { backgroundColor: ACCENT }]}>
                <Feather name="x" size={22} color="#fff" />
              </View>
              <Text style={[styles.statusText, { color: ACCENT }]}>Not recognized</Text>
              <Text style={styles.statusSub}>{result?.message}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.button} onPress={scanAgain} activeOpacity={0.85}>
            <Feather name="camera" size={17} color="#fff" />
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
    <View style={[styles.card, { borderTopColor: color }]}>
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
        <Feather name={student.paid ? "check-circle" : "alert-circle"} size={14} color="#fff" />
        <Text style={styles.badgeText}>{student.paid ? "Enrolled & paid up" : "Payment overdue"}</Text>
      </View>

      {!!student.groups?.length && (
        <View style={styles.groupsRow}>
          <Feather name="users" size={13} color={MUTED} />
          <Text style={styles.groups}>{student.groups.join(" · ")}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: BG },
  permIcon: {
    width: 64, height: 64, borderRadius: RADIUS.pill, backgroundColor: "#F4F4F5",
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.lg,
  },
  permText: { fontSize: 15, color: INK, textAlign: "center", marginBottom: 20 },
  header: {
    paddingBottom: SPACING.md, paddingHorizontal: SPACING.xl,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: INK,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 },
  logoutButton: {
    width: 34, height: 34, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frame: { width: "72%", aspectRatio: 1, position: "relative" },
  corner: { position: "absolute", width: 32, height: 32, borderColor: "#fff" },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
  hint: {
    position: "absolute", bottom: -56, left: 0, right: 0, textAlign: "center",
    color: "#fff", fontSize: 14, fontWeight: "600", textShadowColor: "#000", textShadowRadius: 6,
  },
  resultWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%", maxWidth: 340, backgroundColor: CARD, borderRadius: RADIUS.xl, borderTopWidth: 4,
    padding: 28, alignItems: "center", ...SHADOW_MD,
  },
  cardError: { borderTopColor: ACCENT },
  statusIcon: {
    width: 48, height: 48, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  photo: { width: 76, height: 76, borderRadius: 38, marginBottom: SPACING.md },
  photoPlaceholder: { backgroundColor: "#F4F4F5", alignItems: "center", justifyContent: "center" },
  photoInitial: { fontSize: 28, fontWeight: "800", color: MUTED },
  name: { fontSize: 20, fontWeight: "800", color: INK, textAlign: "center" },
  code: { fontSize: 13, color: MUTED, marginTop: 2, marginBottom: SPACING.lg, fontFamily: "monospace" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.pill,
  },
  badgeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  groupsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: SPACING.md },
  groups: { fontSize: 12, color: MUTED },
  statusText: { fontSize: 20, fontWeight: "800" },
  statusSub: { fontSize: 13, color: MUTED, marginTop: 8, textAlign: "center" },
  button: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: INK, borderRadius: RADIUS.md, paddingVertical: 15, paddingHorizontal: 32,
    marginTop: SPACING.xl,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
