import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getMessages, sendMessage } from "./api";
import { ACCENT, INK, BG, BORDER, MUTED } from "./theme";

export default function MessagesScreen({ navigation, token }) {
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        <Text style={styles.headerSub}>Conversation with your school's staff</Text>
      </View>

      {messages === null && !error ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.empty}>No messages yet — say hello!</Text>}
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

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={body}
          onChangeText={setBody}
          placeholder="Write a message…"
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={onSend} disabled={sending || !body.trim()}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: BG },
  header: { paddingTop: 56, paddingBottom: 14, paddingHorizontal: 20, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: BORDER },
  backButton: { marginBottom: 8 },
  backButtonText: { fontSize: 14, color: ACCENT, fontWeight: "600" },
  headerTitle: { fontSize: 20, fontWeight: "800", color: INK },
  headerSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  error: { color: ACCENT, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
  empty: { color: MUTED, textAlign: "center", marginTop: 40 },
  bubbleWrap: { marginBottom: 12, alignItems: "flex-start" },
  bubbleWrapMine: { alignItems: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleTheirs: { backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER, borderBottomLeftRadius: 4 },
  bubbleMine: { backgroundColor: INK, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, color: INK },
  bubbleTextMine: { color: "#fff" },
  bubbleMeta: { fontSize: 10, color: MUTED, marginTop: 4 },
  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12,
    backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: BORDER,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingHorizontal: 16,
    paddingVertical: 10, maxHeight: 100, fontSize: 14, backgroundColor: BG,
  },
  sendButton: { backgroundColor: ACCENT, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 11 },
  sendButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
