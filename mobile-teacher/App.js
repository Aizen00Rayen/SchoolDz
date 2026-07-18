import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import LoginScreen from "./src/LoginScreen";
import ScannerScreen from "./src/ScannerScreen";
import { loadSession, saveSession, clearSession } from "./src/storage";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still loading

  useEffect(() => {
    loadSession().then(setSession);
  }, []);

  const onLoggedIn = async (token, user) => {
    const next = { token, user };
    await saveSession(next);
    setSession(next);
  };

  const onLogout = async () => {
    await clearSession();
    setSession(null);
  };

  if (session === undefined) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FAFAFA" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      {session ? (
        <ScannerScreen token={session.token} teacherName={session.user?.name || session.user?.email} onLogout={onLogout} />
      ) : (
        <LoginScreen onLoggedIn={onLoggedIn} />
      )}
      <StatusBar style="dark" />
    </>
  );
}
