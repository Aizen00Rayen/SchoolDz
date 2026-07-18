import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import QRCode from "react-native-qrcode-svg";

/** The whole point of this app: one big, easy-to-scan QR encoding the
 * student's id, so a teacher's scanner can look them up instantly. */
export default function BadgeScreen({ profile, onSignOut }) {
  const { width } = useWindowDimensions();
  const qrSize = Math.min(width - 80, 320);
  const { student, tenant_slug } = profile;

  return (
    <View style={styles.container}>
      <Text style={styles.tenant}>{student.tenant_name || tenant_slug}</Text>
      <Text style={styles.name}>{student.first_name} {student.last_name}</Text>
      <Text style={styles.code}>{student.student_code}</Text>

      <View style={styles.qrCard}>
        <QRCode value={student.id} size={qrSize} color="#0A0A0B" backgroundColor="#fff" />
      </View>

      <Text style={styles.hint}>Hold this up to your teacher's scanner.</Text>

      <TouchableOpacity style={styles.signOut} onPress={onSignOut}>
        <Text style={styles.signOutText}>Not you? Switch student</Text>
      </TouchableOpacity>
    </View>
  );
}

const INK = "#0A0A0B";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FAFAFA", alignItems: "center", justifyContent: "center", padding: 24 },
  tenant: { fontSize: 12, fontWeight: "700", color: "#71717A", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 },
  name: { fontSize: 26, fontWeight: "800", color: INK, letterSpacing: -0.5, textAlign: "center" },
  code: { fontSize: 14, color: "#71717A", marginTop: 4, marginBottom: 28, fontFamily: "monospace" },
  qrCard: {
    padding: 24, backgroundColor: "#fff", borderRadius: 24, borderWidth: 1, borderColor: "#E4E4E7",
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 3,
  },
  hint: { fontSize: 14, color: "#71717A", marginTop: 28 },
  signOut: { marginTop: 40, padding: 10 },
  signOutText: { fontSize: 13, color: "#A1A1AA", textDecorationLine: "underline" },
});
