"""SchoolDZ backend API tests.

No demo/seed data is created at startup, so every test provisions its own
tenant via /auth/register and operates only on data it created.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api/v1"

SUPER_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@schooldz.com")
SUPER_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


def new_tenant():
    slug = f"testcorp-{uuid.uuid4().hex[:8]}"
    payload = {
        "tenant_name": "Test Corp", "tenant_slug": slug, "center_type": "tutoring",
        "name": "T Owner", "email": f"owner-{slug}@example.com", "password": "password123",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def tenant():
    return new_tenant()


@pytest.fixture(scope="session")
def owner_token(tenant):
    return tenant["access_token"]


@pytest.fixture(scope="session")
def teacher_token(owner_token):
    email = f"teacher-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/users", json={
        "name": "T Teacher", "email": email, "password": "password123", "role": "teacher",
    }, headers=h(owner_token), timeout=15)
    assert r.status_code == 200, r.text
    r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "password123"}, timeout=15)
    assert r2.status_code == 200
    return r2.json()["access_token"]


@pytest.fixture(scope="session")
def super_token():
    if not SUPER_ADMIN_PASSWORD:
        pytest.skip("ADMIN_PASSWORD not set in environment")
    r = requests.post(f"{API}/auth/login",
                      json={"email": SUPER_ADMIN_EMAIL, "password": SUPER_ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


# ---------- Health ----------
def test_health():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------- Auth ----------
def test_owner_login_returns_token_and_user(tenant):
    assert "access_token" in tenant
    assert tenant["user"]["role"] == "owner"
    assert tenant["user"]["tenant_id"]


def test_me_returns_own_tenant(owner_token, tenant):
    r = requests.get(f"{API}/auth/me", headers=h(owner_token), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["email"] == tenant["user"]["email"]
    assert j["tenant"]["id"] == tenant["user"]["tenant_id"]


def test_login_wrong_password_rejected(tenant):
    r = requests.post(f"{API}/auth/login",
                      json={"email": tenant["user"]["email"], "password": "wrong-password"}, timeout=15)
    assert r.status_code == 401


def test_register_weak_password_rejected():
    r = requests.post(f"{API}/auth/register", json={
        "tenant_name": "X", "tenant_slug": f"weak-{uuid.uuid4().hex[:8]}",
        "name": "N", "email": f"a-{uuid.uuid4().hex[:6]}@e.com", "password": "short",
    }, timeout=15)
    assert r.status_code == 400


def test_register_invalid_slug():
    r = requests.post(f"{API}/auth/register", json={
        "tenant_name": "X", "tenant_slug": "X X",
        "name": "N", "email": f"a-{uuid.uuid4().hex[:6]}@e.com", "password": "password123",
    }, timeout=15)
    assert r.status_code == 400


def test_register_duplicate_slug():
    slug = f"dup-{uuid.uuid4().hex[:8]}"
    first = requests.post(f"{API}/auth/register", json={
        "tenant_name": "X", "tenant_slug": slug,
        "name": "N", "email": f"a-{uuid.uuid4().hex[:6]}@e.com", "password": "password123",
    }, timeout=15)
    assert first.status_code == 200, first.text
    r = requests.post(f"{API}/auth/register", json={
        "tenant_name": "X", "tenant_slug": slug,
        "name": "N", "email": f"a-{uuid.uuid4().hex[:6]}@e.com", "password": "password123",
    }, timeout=15)
    assert r.status_code == 409


# ---------- Dashboard ----------
def test_dashboard_summary(owner_token):
    r = requests.get(f"{API}/dashboard/summary", headers=h(owner_token), timeout=30)
    assert r.status_code == 200
    j = r.json()
    for k in ["students_total", "revenue_month", "sessions_today", "attendance_pct"]:
        assert k in j["kpis"], f"Missing kpi {k}"
    assert isinstance(j["today_sessions"], list)
    assert isinstance(j["upcoming_sessions"], list)
    assert len(j["revenue_trend"]) == 6


# ---------- Students CRUD ----------
def test_students_crud(owner_token):
    payload = {"first_name": "TEST_John", "last_name": "TEST_Doe"}
    r = requests.post(f"{API}/students", json=payload, headers=h(owner_token), timeout=30)
    assert r.status_code == 200, r.text
    s = r.json()
    sid = s["id"]
    r2 = requests.get(f"{API}/students/{sid}", headers=h(owner_token), timeout=15)
    assert r2.status_code == 200
    assert r2.json()["first_name"] == "TEST_John"
    r3 = requests.patch(f"{API}/students/{sid}", json={"first_name": "TEST_Jane"},
                       headers=h(owner_token), timeout=15)
    assert r3.status_code == 200
    assert r3.json()["first_name"] == "TEST_Jane"
    r4 = requests.delete(f"{API}/students/{sid}", headers=h(owner_token), timeout=15)
    assert r4.status_code == 200
    r5 = requests.get(f"{API}/students/{sid}", headers=h(owner_token), timeout=15)
    assert r5.status_code == 404


# ---------- Tenant isolation ----------
def test_tenant_isolation():
    t1 = new_tenant()
    r = requests.post(f"{API}/students", json={"first_name": "Iso", "last_name": "One"},
                      headers=h(t1["access_token"]), timeout=15)
    assert r.status_code == 200

    t2 = new_tenant()
    rs = requests.get(f"{API}/students", headers=h(t2["access_token"]), timeout=15)
    assert rs.status_code == 200
    assert rs.json()["total"] == 0


# ---------- RBAC ----------
def test_teacher_cannot_create_user(teacher_token):
    r = requests.get(f"{API}/students", headers=h(teacher_token), timeout=15)
    assert r.status_code == 200
    r2 = requests.post(f"{API}/users", json={
        "name": "X", "email": f"x-{uuid.uuid4().hex[:6]}@ex.com",
        "password": "password123", "role": "secretary",
    }, headers=h(teacher_token), timeout=15)
    assert r2.status_code == 403


def test_cannot_create_super_admin_from_tenant(owner_token):
    r = requests.post(f"{API}/users", json={
        "name": "X", "email": f"x-{uuid.uuid4().hex[:6]}@ex.com",
        "password": "password123", "role": "super_admin",
    }, headers=h(owner_token), timeout=15)
    assert r.status_code == 400


# ---------- Courses, groups, sessions, attendance ----------
def test_course_group_session_attendance_flow(owner_token):
    c = requests.post(f"{API}/courses", json={"title": "Test Course", "price": 100},
                      headers=h(owner_token), timeout=15)
    assert c.status_code == 200, c.text
    course_id = c.json()["id"]

    g = requests.post(f"{API}/groups", json={"course_id": course_id, "name": "Group A"},
                      headers=h(owner_token), timeout=15)
    assert g.status_code == 200, g.text
    group_id = g.json()["id"]

    s1 = requests.post(f"{API}/students", json={"first_name": "A", "last_name": "One"},
                       headers=h(owner_token), timeout=15).json()
    s2 = requests.post(f"{API}/students", json={"first_name": "B", "last_name": "Two"},
                       headers=h(owner_token), timeout=15).json()

    sess = requests.post(f"{API}/sessions", json={
        "group_id": group_id,
        "start_at": "2026-01-01T10:00:00+00:00",
        "end_at": "2026-01-01T11:00:00+00:00",
    }, headers=h(owner_token), timeout=15)
    assert sess.status_code == 200, sess.text
    session_id = sess.json()["id"]

    marks = [{"student_id": s1["id"], "status": "present"}, {"student_id": s2["id"], "status": "absent"}]
    r = requests.post(f"{API}/attendance/session/{session_id}", json={"marks": marks},
                      headers=h(owner_token), timeout=30)
    assert r.status_code == 200, r.text
    r2 = requests.get(f"{API}/attendance/session/{session_id}", headers=h(owner_token), timeout=15)
    assert r2.status_code == 200
    assert r2.json()["total"] >= len(marks)


# ---------- Search ----------
def test_global_search(owner_token):
    r = requests.get(f"{API}/search", params={"q": "a"}, headers=h(owner_token), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert "results" in j and isinstance(j["results"], list)


def test_search_query_is_escaped_not_treated_as_regex(owner_token):
    r = requests.get(f"{API}/search", params={"q": "("}, headers=h(owner_token), timeout=15)
    assert r.status_code == 200


# ---------- Admin platform endpoints ----------
def test_admin_platform_summary_super(super_token):
    r = requests.get(f"{API}/admin/platform-summary", headers=h(super_token), timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "kpis" in j and "tenants" in j
    for k in ["tenants_total", "tenants_active", "tenants_trial", "tenants_suspended",
              "users_total", "students_total", "payments_total", "platform_revenue"]:
        assert k in j["kpis"], f"Missing kpi {k}"
    assert isinstance(j["tenants"], list)


def test_admin_platform_summary_owner_forbidden(owner_token):
    r = requests.get(f"{API}/admin/platform-summary", headers=h(owner_token), timeout=15)
    assert r.status_code == 403


def test_admin_suspend_and_activate_tenant(super_token):
    t = new_tenant()
    tid = t["user"]["tenant_id"]
    r2 = requests.patch(f"{API}/admin/tenants/{tid}/status", json={"status": "suspended"},
                       headers=h(super_token), timeout=15)
    assert r2.status_code == 200, r2.text
    r3 = requests.get(f"{API}/admin/platform-summary", headers=h(super_token), timeout=15)
    row = next(x for x in r3.json()["tenants"] if x["id"] == tid)
    assert row["status"] == "suspended"
    r4 = requests.patch(f"{API}/admin/tenants/{tid}/status", json={"status": "active"},
                       headers=h(super_token), timeout=15)
    assert r4.status_code == 200


def test_admin_delete_tenant(super_token):
    t = new_tenant()
    tid = t["user"]["tenant_id"]
    d = requests.delete(f"{API}/admin/tenants/{tid}", headers=h(super_token), timeout=15)
    assert d.status_code in (200, 204), d.text
    summ = requests.get(f"{API}/admin/platform-summary", headers=h(super_token), timeout=15).json()
    assert not any(x["id"] == tid for x in summ["tenants"]), "tenant still present after delete"


def test_owner_cannot_edit_own_plan(owner_token, tenant):
    tid = tenant["user"]["tenant_id"]
    r = requests.patch(f"{API}/tenants/{tid}", json={"plan": "business", "max_users": 9999},
                       headers=h(owner_token), timeout=15)
    assert r.status_code in (200, 400)
    me = requests.get(f"{API}/auth/me", headers=h(owner_token), timeout=15).json()
    assert me["tenant"]["plan"] != "business"
    assert me["tenant"]["max_users"] != 9999
