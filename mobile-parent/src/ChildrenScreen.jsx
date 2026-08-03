import { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Image,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getChildren } from "./api";
import { ACCENT, INK, BG, BORDER, MUTED, CARD, RADIUS, SPACING, SHADOW_SM } from "./theme";

export default function ChildrenScreen({ token, onLogout, navigation }) {
  const insets = useSafeAreaInsets();
  const [children, setChildren] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await getChildren(token);
      setChildren(data.items || []);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load your children.");
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <View>
          <Text style={styles.headerTitle}>My children</Text>
          <Text style={styles.headerSub}>{children?.length || 0} linked</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate("Messages")} style={styles.iconButton} hitSlop={8}>
            <Feather name="message-circle" size={19} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout} style={styles.iconButton} hitSlop={8}>
            <Feather name="log-out" size={19} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {children === null && !error ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={ACCENT} />
      ) : error ? (
        <View style={styles.centerMsg}>
          <Feather name="alert-circle" size={22} color={ACCENT} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : children.length === 0 ? (
        <View style={styles.centerMsg}>
          <Feather name="users" size={22} color={MUTED} />
          <Text style={styles.empty}>No children linked to your account yet — contact your school.</Text>
        </View>
      ) : (
        <FlatList
          data={children}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: SPACING.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card} activeOpacity={0.7}
              onPress={() => navigation.navigate("ChildDetail", { child: item })}
            >
              {item.photo_url ? (
                <Image source={{ uri: item.photo_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitial}>{item.first_name?.[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.first_name} {item.last_name}</Text>
                <Text style={styles.code}>{item.student_code}</Text>
              </View>
              {item.has_overdue_payment && (
                <View style={styles.badge}>
                  <Feather name="alert-triangle" size={11} color={ACCENT} />
                  <Text style={styles.badgeText}>Payment due</Text>
                </View>
              )}
              <Feather name="chevron-right" size={18} color={MUTED} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BG },
  header: {
    paddingBottom: SPACING.lg, paddingHorizontal: SPACING.xl,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: INK,
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 },
  headerActions: { flexDirection: "row", gap: 10 },
  iconButton: {
    width: 36, height: 36, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  centerMsg: { alignItems: "center", justifyContent: "center", marginTop: 60, paddingHorizontal: SPACING.xxl, gap: SPACING.sm },
  error: { color: ACCENT, textAlign: "center" },
  empty: { color: MUTED, textAlign: "center" },
  card: {
    flexDirection: "row", alignItems: "center", backgroundColor: CARD, borderRadius: RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: BORDER, gap: SPACING.md,
    ...SHADOW_SM,
  },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarPlaceholder: { backgroundColor: "#F4F4F5", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 18, fontWeight: "800", color: MUTED },
  name: { fontSize: 16, fontWeight: "700", color: INK },
  code: { fontSize: 12, color: MUTED, marginTop: 2, fontFamily: "monospace" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF2F2", borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 5,
  },
  badgeText: { color: ACCENT, fontSize: 11, fontWeight: "700" },
});
