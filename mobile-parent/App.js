import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "./src/LoginScreen";
import ChildrenScreen from "./src/ChildrenScreen";
import ChildDetailScreen from "./src/ChildDetailScreen";
import MessagesScreen from "./src/MessagesScreen";
import { loadSession, saveSession, clearSession } from "./src/storage";
import { INK } from "./src/theme";

const Stack = createNativeStackNavigator();

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
    <NavigationContainer>
      <StatusBar style="dark" />
      {!session ? (
        <LoginScreen onLoggedIn={onLoggedIn} />
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Children">
            {(props) => <ChildrenScreen {...props} token={session.token} onLogout={onLogout} />}
          </Stack.Screen>
          <Stack.Screen name="ChildDetail">
            {(props) => <ChildDetailScreen {...props} token={session.token} />}
          </Stack.Screen>
          <Stack.Screen name="Messages">
            {(props) => <MessagesScreen {...props} token={session.token} />}
          </Stack.Screen>
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
