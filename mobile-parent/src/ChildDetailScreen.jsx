import { useEffect, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import {
  getChildGrades, getChildAttendance, getChildSessions, getChildPayments, getChildTeachers,
} from "./api";
import { ACCENT, INK, BG, BORDER, MUTED, OK, WARN } from "./theme";

const TABS = ["Grades", "Calendar", "Attendance", "Payments", "Teachers"];

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const ATTENDANCE_COLOR = { present: OK, late: WARN, excused: "#2563EB", absent: ACCENT };
const PAYMENT_COLOR = { paid: OK, pending: WARN, partial: WARN, refunded: MUTED, cancelled: MUTED };

export default function ChildDetailScreen({ route, navigation, token }) {
  const { child } = route.params;
  const [tab, setTab] = useState("Grades");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{child.first_name} {child.last_name}</Text>
        <Text style={styles.headerSub}>{child.student_code}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={{ paddingHorizontal: 12 }}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={data[tab] || []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
          renderItem={({ item }) => <Row tab={tab} item={item} />}
        />
      )}
    </View>
  );
}

function Row({ tab, item }) {
  if (tab === "Grades") {
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowSub}>{fmtDate(item.date)}</Text>
        </View>
        <Text style={styles.scoreText}>{item.score}/{item.max_score}</Text>
      </View>
    );
  }
  if (tab === "Attendance") {
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{fmtDateTime(item.marked_at)}</Text>
          {!!item.note && <Text style={styles.rowSub}>{item.note}</Text>}
        </View>
        <View style={[styles.pill, { backgroundColor: (ATTENDANCE_COLOR[item.status] || MUTED) + "20" }]}>
          <Text style={[styles.pillText, { color: ATTENDANCE_COLOR[item.status] || MUTED }]}>{item.status}</Text>
        </View>
      </View>
    );
  }
  if (tab === "Calendar") {
    return (
      <View style={styles.row}>
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
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{item.invoice_number || item.kind}</Text>
          <Text style={styles.rowSub}>
            {item.amount} {item.due_date ? `· due ${fmtDate(item.due_date)}` : ""}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: (PAYMENT_COLOR[item.status] || MUTED) + "20" }]}>
          <Text style={[styles.pillText, { color: PAYMENT_COLOR[item.status] || MUTED }]}>{item.status}</Text>
        </View>
      </View>
    );
  }
  // Teachers
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.first_name} {item.last_name}</Text>
        <Text style={styles.rowSub}>{(item.subjects || []).join(", ") || item.email}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BG },
  header: { paddingTop: 56, paddingBottom: 14, paddingHorizontal: 20, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: BORDER },
  backButton: { marginBottom: 8 },
  backButtonText: { fontSize: 14, color: ACCENT, fontWeight: "600" },
  headerTitle: { fontSize: 20, fontWeight: "800", color: INK },
  headerSub: { fontSize: 12, color: MUTED, marginTop: 2, fontFamily: "monospace" },
  tabBar: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 10, flexGrow: 0 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginRight: 8, backgroundColor: "#F4F4F5" },
  tabActive: { backgroundColor: INK },
  tabText: { fontSize: 13, fontWeight: "600", color: MUTED },
  tabTextActive: { color: "#fff" },
  error: { color: ACCENT, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  empty: { color: MUTED, textAlign: "center", marginTop: 40 },
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14,
    padding: 14, marginBottom: 10, borderWidth: 1, borderColor: BORDER, gap: 10,
  },
  rowTitle: { fontSize: 15, fontWeight: "700", color: INK },
  rowSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  scoreText: { fontSize: 16, fontWeight: "800", color: INK, fontFamily: "monospace" },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
});
