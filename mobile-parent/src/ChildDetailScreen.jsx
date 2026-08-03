import { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  getChildGrades, getChildAttendance, getChildSessions, getChildPayments, getChildTeachers, getInvoiceUrl,
} from "./api";
import { ACCENT, OK, INFO, INK, BG, BORDER, MUTED, CARD, RADIUS, SPACING, SHADOW_SM } from "./theme";

const TABS = [
  { key: "Grades", icon: "award" },
  { key: "Calendar", icon: "calendar" },
  { key: "Attendance", icon: "check-square" },
  { key: "Payments", icon: "credit-card" },
  { key: "Teachers", icon: "users" },
];

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const ATTENDANCE_COLOR = { present: OK, late: "#D97706", excused: INFO, absent: ACCENT };
const PAYMENT_COLOR = { paid: OK, pending: "#D97706", partial: "#D97706", refunded: MUTED, cancelled: MUTED };

export default function ChildDetailScreen({ route, navigation, token }) {
  const insets = useSafeAreaInsets();
  const { child } = route.params;
  const [tab, setTab] = useState("Grades");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [grades, attendance, sessions, payments, teachers] = await Promise.all([
          getChildGrades(token, child.id),
          getChildAttendance(token, child.id),
          getChildSessions(token, child.id),
          getChildPayments(token, child.id),
          getChildTeachers(token, child.id),
        ]);
        if (cancelled) return;
        setData({
          Grades: grades.items || [],
          Attendance: attendance.items || [],
          Calendar: sessions.items || [],
          Payments: payments.items || [],
          Teachers: teachers.items || [],
        });
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load this child's data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, child.id]);

  const onDownloadInvoice = async (payment) => {
    if (downloadingId) return;
    setDownloadingId(payment.id);
    try {
      const canShare = await Sharing.isAvailableAsync();
      const url = await getInvoiceUrl(payment.id);
      const filename = `${payment.invoice_number || payment.id}.pdf`;
      const file = await File.downloadFileAsync(url, new File(Paths.cache, filename), {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      });
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: filename });
      } else {
        Alert.alert("Invoice downloaded", `Saved as ${filename}`);
      }
    } catch (e) {
      Alert.alert("Could not open invoice", e.message || "Something went wrong.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={8}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{child.first_name} {child.last_name}</Text>
        <Text style={styles.headerSub}>{child.student_code}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={{ paddingHorizontal: SPACING.md, gap: SPACING.sm }}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]} activeOpacity={0.8}>
            <Feather name={t.icon} size={14} color={tab === t.key ? "#fff" : MUTED} />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.key}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={ACCENT} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={data[tab] || []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: SPACING.lg }}
          ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
          renderItem={({ item }) => (
            <Row tab={tab} item={item} onDownloadInvoice={onDownloadInvoice} downloading={downloadingId === item.id} />
          )}
        />
      )}
    </View>
  );
}

function Row({ tab, item, onDownloadInvoice, downloading }) {
  if (tab === "Grades") {
    return (
      <View style={styles.row}>
        <RowIcon icon="award" color={INFO} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowSub}>{fmtDate(item.date)}</Text>
        </View>
        <Text style={styles.scoreText}>{item.score}/{item.max_score}</Text>
      </View>
    );
  }
  if (tab === "Attendance") {
    const color = ATTENDANCE_COLOR[item.status] || MUTED;
    return (
      <View style={styles.row}>
        <RowIcon icon="check-square" color={color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{fmtDateTime(item.marked_at)}</Text>
          {!!item.note && <Text style={styles.rowSub}>{item.note}</Text>}
        </View>
        <View style={[styles.pill, { backgroundColor: color + "20" }]}>
          <Text style={[styles.pillText, { color }]}>{item.status}</Text>
        </View>
      </View>
    );
  }
  if (tab === "Calendar") {
    return (
      <View style={styles.row}>
        <RowIcon icon="calendar" color={INFO} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{item.topic || "Session"}</Text>
          <Text style={styles.rowSub}>
            {fmtDateTime(item.start_at)}{item.room ? ` · Room ${item.room}` : ""}
          </Text>
        </View>
        <Text style={styles.rowSub}>{item.status}</Text>
      </View>
    );
  }
  if (tab === "Payments") {
    const color = PAYMENT_COLOR[item.status] || MUTED;
    return (
      <View style={styles.row}>
        <RowIcon icon="credit-card" color={color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{item.invoice_number || item.kind}</Text>
          <Text style={styles.rowSub}>
            {item.amount} {item.due_date ? `· due ${fmtDate(item.due_date)}` : ""}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: color + "20" }]}>
          <Text style={[styles.pillText, { color }]}>{item.status}</Text>
        </View>
        <TouchableOpacity
          onPress={() => onDownloadInvoice(item)} disabled={downloading}
          style={styles.downloadButton} hitSlop={8}
        >
          {downloading ? <ActivityIndicator size="small" color={INK} /> : <Feather name="download" size={17} color={INK} />}
        </TouchableOpacity>
      </View>
    );
  }
  // Teachers
  return (
    <View style={styles.row}>
      <RowIcon icon="users" color={INFO} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.first_name} {item.last_name}</Text>
        <Text style={styles.rowSub}>{(item.subjects || []).join(", ") || item.email}</Text>
      </View>
    </View>
  );
}

function RowIcon({ icon, color }) {
  return (
    <View style={[styles.rowIcon, { backgroundColor: color + "18" }]}>
      <Feather name={icon} size={15} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BG },
  header: { paddingBottom: SPACING.lg, paddingHorizontal: SPACING.xl, backgroundColor: INK },
  backButton: {
    width: 34, height: 34, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center", marginBottom: SPACING.sm,
  },
  headerTitle: { fontSize: 20, fontWeight: "800", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2, fontFamily: "monospace" },
  tabBar: { backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: SPACING.sm, flexGrow: 0 },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: "#F4F4F5",
  },
  tabActive: { backgroundColor: INK },
  tabText: { fontSize: 13, fontWeight: "600", color: MUTED },
  tabTextActive: { color: "#fff" },
  error: { color: ACCENT, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  empty: { color: MUTED, textAlign: "center", marginTop: 40 },
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: CARD, borderRadius: RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.sm + 2, borderWidth: 1, borderColor: BORDER, gap: SPACING.sm + 2,
    ...SHADOW_SM,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: "center", justifyContent: "center",
  },
  rowTitle: { fontSize: 15, fontWeight: "700", color: INK },
  rowSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  scoreText: { fontSize: 16, fontWeight: "800", color: INK, fontFamily: "monospace" },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  pillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  downloadButton: {
    width: 32, height: 32, borderRadius: RADIUS.sm, backgroundColor: "#F4F4F5",
    alignItems: "center", justifyContent: "center",
  },
});
