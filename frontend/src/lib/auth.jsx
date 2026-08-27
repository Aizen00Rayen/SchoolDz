import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setAccessToken, getAccessToken, extractError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [myTenants, setMyTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadMyTenants = useCallback(async (u) => {
    // Only owner/director ever hold a TenantMembership row — skip the
    // request entirely for staff/parent/student logins.
    if (!u || !["owner", "director"].includes(u.role)) {
      setMyTenants([]);
      return;
    }
    try {
      const { data } = await api.get("/owner/schools");
      setMyTenants(data.items || []);
    } catch (_e) {
      setMyTenants([]);
    }
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setTenant(data.tenant);
      await loadMyTenants(data.user);
    } catch (e) {
      // Only clear user state if we have no token stored — prevents a parallel
      // un-authed loadMe from wiping a freshly stored Google OAuth token.
      if (!getAccessToken()) {
        setUser(null);
        setTenant(null);
        setMyTenants([]);
      }
    } finally {
      setLoading(false);
    }
  }, [loadMyTenants]);

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

  /** Used by the public self-enrollment page: the enroll endpoint already
   * returns a fresh access_token + user in one call, no separate /auth/login
   * round-trip needed. */
  const loginWithToken = async (token, initialUser) => {
    setAccessToken(token);
    if (initialUser) setUser(initialUser);
    await loadMe();
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

  /** Switches the caller's active school, then does a full hard navigation
   * rather than trying to invalidate every react-query cache key — nearly
   * every query in the app is tenant-scoped, so a targeted invalidation
   * would be both fragile (easy to miss a page) and no faster in practice. */
  const switchTenant = async (tenantId) => {
    await api.post("/auth/switch-tenant", { tenant_id: tenantId });
    window.location.href = "/app/dashboard";
  };

  /** Adds another school under this same login and immediately switches to
   * it (the backend does both in one call) — the caller then lands on the
   * billing gate for the new, unpaid school via the same hard navigation. */
  const createSchool = async (payload) => {
    const { data } = await api.post("/owner/schools/new", payload);
    window.location.href = "/app/dashboard";
    return data;
  };

  return (
    <AuthContext.Provider
      value={{
        user, tenant, myTenants, loading, login, register, loginWithToken, loginWithGoogleCode,
        logout, refreshTenant, switchTenant, createSchool, extractError,
      }}
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
