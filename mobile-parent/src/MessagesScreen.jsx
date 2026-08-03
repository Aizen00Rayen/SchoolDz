import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getMessages, sendMessage } from "./api";
import { ACCENT, INK, BG, BORDER, MUTED, CARD, RADIUS, SPACING } from "./theme";

export default function MessagesScreen({ navigation, token }) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await getMessages(token);
      setMessages(data.items || []);
      setError("");
    } catch (e) {
      setError(e.message || "Could not load messages.");
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const onSend = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setBody("");
    try {
      const data = await sendMessage(token, text);
      setMessages(data.items || []);
    } catch (e) {
      setError(e.message || "Could not send that message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={8}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Messages</Text>
          <Text style={styles.headerSub}>Conversation with your school's staff</Text>
        </View>
      </View>

      {messages === null && !error ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={ACCENT} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: SPACING.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Feather name="message-circle" size={22} color={MUTED} />
              <Text style={styles.empty}>No messages yet — say hello!</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.bubbleWrap, item.sender_role === "parent" && styles.bubbleWrapMine]}>
              <View style={[styles.bubble, item.sender_role === "parent" ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={[styles.bubbleText, item.sender_role === "parent" && styles.bubbleTextMine]}>{item.body}</Text>
              </View>
              <Text style={styles.bubbleMeta}>
                {item.sender_role === "parent" ? "You" : item.sender_name || "Staff"} · {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </View>
          )}
        />
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
        <TextInput
          style={styles.input}
          value={body}
          onChangeText={setBody}
          placeholder="Write a message…"
          placeholderTextColor="#A1A1AA"
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={onSend} disabled={sending || !body.trim()} activeOpacity={0.85}>
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={17} color="#fff" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BG },
  header: {
    paddingBottom: SPACING.lg, paddingHorizontal: SPACING.xl, backgroundColor: INK,
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
  },
  backButton: {
    width: 34, height: 34, borderRadius: RADIUS.pill, backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff" },
  headerSub: { fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 2 },
  error: { color: ACCENT, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  emptyWrap: { alignItems: "center", marginTop: 40, gap: SPACING.sm },
  empty: { color: MUTED, textAlign: "center" },
  bubbleWrap: { marginBottom: SPACING.md, alignItems: "flex-start" },
  bubbleWrapMine: { alignItems: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleTheirs: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderBottomLeftRadius: 4 },
  bubbleMine: { backgroundColor: INK, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, color: INK },
  bubbleTextMine: { color: "#fff" },
  bubbleMeta: { fontSize: 10, color: MUTED, marginTop: 4 },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 10, padding: SPACING.md,
    backgroundColor: CARD, borderTopWidth: 1, borderTopColor: BORDER,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.pill, paddingHorizontal: 16,
    paddingVertical: 10, maxHeight: 100, fontSize: 14, backgroundColor: BG, color: INK,
  },
  sendButton: {
    width: 40, height: 40, borderRadius: RADIUS.pill, backgroundColor: ACCENT,
    alignItems: "center", justifyContent: "center",
  },
});
