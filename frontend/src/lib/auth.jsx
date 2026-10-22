import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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

  // One /auth/me (+ /owner/schools) at a time: concurrent callers (mount,
  // focus and visibilitychange all fire together when a tab comes back)
  // share the same in-flight request, and a background refresh within 30s
  // of the last one is skipped.
  const inFlight = useRef(null);
  const lastLoaded = useRef(0);

  const loadMe = useCallback(async ({ background = false, force = false } = {}) => {
    if (inFlight.current) {
      if (!force) return inFlight.current;
      // After login/switch the answer must reflect the new token.
      await inFlight.current.catch(() => {});
    }
    if (background && Date.now() - lastLoaded.current < 30_000) return undefined;
    inFlight.current = loadMeNow().finally(() => {
      inFlight.current = null;
      lastLoaded.current = Date.now();
    });
    return inFlight.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMeNow = async () => {
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
  };

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // Permission/role changes an owner makes from another tab/device don't
  // reach an already-open session on their own — /auth/me is only called
  // once on mount, so a staff member's stale `user.permissions` kept
  // gating their UI by the OLD grant until they happened to hard-refresh.
  // Backend enforcement was never actually behind (every request re-reads
  // the user row fresh), but the frontend's own gating and nav visibility
  // were — refetching whenever the tab regains focus closes that gap
  // without needing a logout/login, matching how most SaaS apps refresh
  // session state on tab-switch-back.
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === "visible" && getAccessToken()) loadMe({ background: true });
    };
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      document.removeEventListener("visibilitychange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, [loadMe]);

  const login = async (email, password, tenantSlug) => {
    const { data } = await api.post("/auth/login", {
      email,
      password,
      tenant_slug: tenantSlug || undefined,
    });
    if (data.access_token) setAccessToken(data.access_token);
    setUser(data.user);
    await loadMe({ force: true });
    return data.user;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    if (data.access_token) setAccessToken(data.access_token);
    setUser(data.user);
    await loadMe({ force: true });
    return data.user;
  };

  /** Used by the public self-enrollment page: the enroll endpoint already
   * returns a fresh access_token + user in one call, no separate /auth/login
   * round-trip needed. */
  const loginWithToken = async (token, initialUser) => {
    setAccessToken(token);
    if (initialUser) setUser(initialUser);
    await loadMe({ force: true });
  };

  const loginWithGoogleCode = async (code) => {
    const { data } = await api.post("/auth/google/exchange", { code });
    // Set the token FIRST before any other requests can fire
    if (data.access_token) setAccessToken(data.access_token);
    // Set user immediately from the exchange response — no need to race with /auth/me
    if (data.user) setUser(data.user);
    // Now fetch full profile (includes tenant) with the token already stored
    await loadMe({ force: true });
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
    await loadMe({ force: true });
  };

  /** Switches the caller's active school, then does a full hard navigation
   * rather than trying to invalidate every react-query cache key — nearly
   * every query in the app is tenant-scoped, so a targeted invalidation
   * would be both fragile (easy to miss a page) and no faster in practice. */
  const switchTenant = async (tenantId) => {
    await api.post("/auth/switch-tenant", { tenant_id: tenantId });
    window.location.href = "/app";
  };

  /** Adds another school under this same login and immediately switches to
   * it (the backend does both in one call) — the caller then lands on the
   * billing gate for the new, unpaid school via the same hard navigation. */
  const createSchool = async (payload) => {
    const { data } = await api.post("/owner/schools/new", payload);
    window.location.href = "/app";
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
