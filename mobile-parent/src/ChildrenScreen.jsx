import { useCallback, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Image,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getChildren } from "./api";
import { ACCENT, INK, BG, BORDER, MUTED, OK } from "./theme";

export default function ChildrenScreen({ token, onLogout, navigation }) {
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My children</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate("Messages")}>
            <Text style={styles.link}>Messages</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout}>
            <Text style={styles.link}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {children === null && !error ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : children.length === 0 ? (
        <Text style={styles.empty}>No children linked to your account yet — contact your school.</Text>
      ) : (
        <FlatList
          data={children}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate("ChildDetail", { child: item })}>
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
                  <Text style={styles.badgeText}>Payment due</Text>
                </View>
              )}
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
    paddingTop: 56, paddingBottom: 14, paddingHorizontal: 20,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 20, fontWeight: "800", color: INK },
  headerActions: { flexDirection: "row", gap: 16 },
  link: { fontSize: 13, color: ACCENT, fontWeight: "600" },
  error: { color: ACCENT, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  empty: { color: MUTED, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  card: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 16,
    padding: 14, marginBottom: 12, borderWidth: 1, borderColor: BORDER, gap: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { backgroundColor: "#F4F4F5", alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 18, fontWeight: "800", color: MUTED },
  name: { fontSize: 16, fontWeight: "700", color: INK },
  code: { fontSize: 12, color: MUTED, marginTop: 2, fontFamily: "monospace" },
  badge: { backgroundColor: "#FEF2F2", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: ACCENT, fontSize: 11, fontWeight: "700" },
});
