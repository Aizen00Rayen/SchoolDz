import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setAccessToken, getAccessToken, extractError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setTenant(data.tenant);
    } catch (e) {
      // Only clear user state if we have no token stored — prevents a parallel
      // un-authed loadMe from wiping a freshly stored Google OAuth token.
      if (!getAccessToken()) {
        setUser(null);
        setTenant(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = async (email, password, tenantSlug) => {
    const { data } = await api.post("/auth/login", {
      email,
      password,
      tenant_slug: tenantSlug || undefined,
    });
    if (data.access_token) setAccessToken(data.access_token);
    setUser(data.user);
    await loadMe();
    return data.user;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    if (data.access_token) setAccessToken(data.access_token);
    setUser(data.user);
    await loadMe();
    return data.user;
  };

  const loginWithGoogleCode = async (code) => {
    const { data } = await api.post("/auth/google/exchange", { code });
    // Set the token FIRST before any other requests can fire
    if (data.access_token) setAccessToken(data.access_token);
    // Set user immediately from the exchange response — no need to race with /auth/me
    if (data.user) setUser(data.user);
    // Now fetch full profile (includes tenant) with the token already stored
    await loadMe();
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (_e) {
      // ignore
    }
    setAccessToken(null);
    setUser(null);
    setTenant(null);
  };

  const refreshTenant = async () => {
    await loadMe();
  };

  return (
    <AuthContext.Provider
      value={{ user, tenant, loading, login, register, loginWithGoogleCode, logout, refreshTenant, extractError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
