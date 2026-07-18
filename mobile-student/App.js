import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import LookupScreen from "./src/LookupScreen";
import BadgeScreen from "./src/BadgeScreen";
import { loadProfile, saveProfile, clearProfile } from "./src/storage";

export default function App() {
  const [profile, setProfile] = useState(undefined); // undefined = still loading

  useEffect(() => {
    loadProfile().then(setProfile);
  }, []);

  const onFound = async (tenant_slug, student_code, student) => {
    const next = { tenant_slug, student_code, student };
    await saveProfile(next);
    setProfile(next);
  };

  const onSignOut = async () => {
    await clearProfile();
    setProfile(null);
  };

  if (profile === undefined) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FAFAFA" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      {profile ? <BadgeScreen profile={profile} onSignOut={onSignOut} /> : <LookupScreen onFound={onFound} />}
      <StatusBar style="dark" />
    </>
  );
}
