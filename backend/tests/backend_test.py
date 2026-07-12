"""SchoolDZ backend API tests (iteration 2 - alpha-demo)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://academy-dash-36.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api/v1"

OWNER = {"email": "owner@alpha-demo.schooldz.com", "password": "Demo!2026"}
TEACHER = {"email": "teacher@alpha-demo.schooldz.com", "password": "Teacher!2026"}
SUPER = {"email": "admin@schooldz.com", "password": "adminSchool!2026"}

OLD_SUPER = {"email": "admin@schooldz.com", "password": "admin123"}
OLD_OWNER = {"email": "owner@dteduc.schooldz.com", "password": "owner123"}


@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def teacher_token():
    r = requests.post(f"{API}/auth/login", json=TEACHER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def super_token():
    r = requests.post(f"{API}/auth/login", json=SUPER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Health ----------
def test_health():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ---------- Auth: new credentials ----------
def test_owner_login_returns_token_and_user():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "access_token" in j
    assert j["user"]["role"] == "owner"
    assert j["user"]["tenant_id"]


def test_me_returns_alpha_demo_tenant(owner_token):
    r = requests.get(f"{API}/auth/me", headers=h(owner_token), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["email"] == OWNER["email"]
    assert j["tenant"]["slug"] == "alpha-demo"


def test_super_admin_login_new_password():
    r = requests.post(f"{API}/auth/login", json=SUPER, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["role"] == "super_admin"
    assert j["user"].get("tenant_id") in (None, "")


def test_super_admin_old_password_rejected():
    r = requests.post(f"{API}/auth/login", json=OLD_SUPER, timeout=30)
    assert r.status_code == 401, f"Old admin password must be rejected but got {r.status_code}"


def test_old_dteduc_owner_rejected():
    r = requests.post(f"{API}/auth/login", json=OLD_OWNER, timeout=30)
    assert r.status_code in (401, 404), f"Old owner must not exist, got {r.status_code}"


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


# ---------- Seeded lists ----------
@pytest.mark.parametrize("path,expected_min", [
    ("/students", 15),
    ("/teachers", 3),
    ("/courses", 4),
    ("/groups", 4),
    ("/sessions", 1),
    ("/payments", 20),
])
def test_seeded_lists(owner_token, path, expected_min):
    r = requests.get(f"{API}{path}", headers=h(owner_token), timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "items" in j and "total" in j
    assert j["total"] >= expected_min, f"{path} total={j['total']} < {expected_min}"


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
    slug = f"testcorp-{uuid.uuid4().hex[:8]}"
    payload = {
        "tenant_name": "Test Corp", "tenant_slug": slug, "center_type": "tutoring",
        "name": "T Owner", "email": f"owner-{slug}@example.com", "password": "password123",
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    rs = requests.get(f"{API}/students", headers=h(tok), timeout=15)
    assert rs.status_code == 200
    assert rs.json()["total"] == 0


# ---------- RBAC ----------
def test_teacher_cannot_create_user(teacher_token):
    r = requests.get(f"{API}/students", headers=h(teacher_token), timeout=15)
    assert r.status_code == 200
    r2 = requests.post(f"{API}/users", json={
        "name": "X", "email": f"x-{uuid.uuid4().hex[:6]}@ex.com",
        "password": "pw12345", "role": "secretary"
    }, headers=h(teacher_token), timeout=15)
    assert r2.status_code == 403


# ---------- Attendance ----------
def test_bulk_attendance(owner_token):
    sess = requests.get(f"{API}/sessions", headers=h(owner_token), timeout=15).json()
    assert sess["total"] > 0
    sid = sess["items"][0]["id"]
    students = requests.get(f"{API}/students", headers=h(owner_token), timeout=15).json()["items"][:2]
    marks = [{"student_id": s["id"], "status": "present"} for s in students]
    r = requests.post(f"{API}/attendance/session/{sid}", json={"marks": marks},
                     headers=h(owner_token), timeout=30)
    assert r.status_code == 200, r.text
    r2 = requests.get(f"{API}/attendance/session/{sid}", headers=h(owner_token), timeout=15)
    assert r2.status_code == 200
    assert r2.json()["total"] >= len(marks)


# ---------- Search ----------
def test_global_search(owner_token):
    r = requests.get(f"{API}/search", params={"q": "a"}, headers=h(owner_token), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert "results" in j and isinstance(j["results"], list)


# ---------- Register validation ----------
def test_register_invalid_slug():
    r = requests.post(f"{API}/auth/register", json={
        "tenant_name": "X", "tenant_slug": "X X",
        "name": "N", "email": f"a-{uuid.uuid4().hex[:6]}@e.com", "password": "pw12345"
    }, timeout=15)
    assert r.status_code == 400


def test_register_duplicate_slug():
    r = requests.post(f"{API}/auth/register", json={
        "tenant_name": "X", "tenant_slug": "alpha-demo",
        "name": "N", "email": f"a-{uuid.uuid4().hex[:6]}@e.com", "password": "pw12345"
    }, timeout=15)
    assert r.status_code == 409


# ---------- NEW: Admin platform endpoints ----------
def test_admin_platform_summary_super(super_token):
    r = requests.get(f"{API}/admin/platform-summary", headers=h(super_token), timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "kpis" in j and "tenants" in j
    for k in ["tenants_total", "tenants_active", "tenants_trial", "tenants_suspended",
              "users_total", "students_total", "payments_total", "platform_revenue"]:
        assert k in j["kpis"], f"Missing kpi {k}"
    assert isinstance(j["tenants"], list)
    assert len(j["tenants"]) >= 1
    t0 = j["tenants"][0]
    assert "users_count" in t0 and "students_count" in t0


def test_admin_platform_summary_owner_forbidden(owner_token):
    r = requests.get(f"{API}/admin/platform-summary", headers=h(owner_token), timeout=15)
    assert r.status_code == 403


def test_admin_suspend_and_activate_alpha_demo(super_token):
    r = requests.get(f"{API}/admin/platform-summary", headers=h(super_token), timeout=15)
    tenants = r.json()["tenants"]
    alpha = next((t for t in tenants if t.get("slug") == "alpha-demo"), None)
    assert alpha is not None, "alpha-demo tenant not found"
    tid = alpha["id"]
    # Suspend
    r2 = requests.patch(f"{API}/admin/tenants/{tid}/status", json={"status": "suspended"},
                       headers=h(super_token), timeout=15)
    assert r2.status_code == 200, r2.text
    # Verify
    r3 = requests.get(f"{API}/admin/platform-summary", headers=h(super_token), timeout=15)
    alpha2 = next(t for t in r3.json()["tenants"] if t["id"] == tid)
    assert alpha2["status"] == "suspended"
    # Reactivate
    r4 = requests.patch(f"{API}/admin/tenants/{tid}/status", json={"status": "active"},
                       headers=h(super_token), timeout=15)
    assert r4.status_code == 200


def test_admin_delete_tenant(super_token):
    slug = f"throwaway-{uuid.uuid4().hex[:8]}"
    reg = requests.post(f"{API}/auth/register", json={
        "tenant_name": "Throwaway", "tenant_slug": slug, "center_type": "tutoring",
        "name": "TA", "email": f"ta-{slug}@example.com", "password": "password123",
    }, timeout=30)
    assert reg.status_code == 200, reg.text
    # find id
    summ = requests.get(f"{API}/admin/platform-summary", headers=h(super_token), timeout=15).json()
    t = next((x for x in summ["tenants"] if x["slug"] == slug), None)
    assert t is not None
    tid = t["id"]
    # delete
    d = requests.delete(f"{API}/admin/tenants/{tid}", headers=h(super_token), timeout=15)
    assert d.status_code in (200, 204), d.text
    # confirm gone
    summ2 = requests.get(f"{API}/admin/platform-summary", headers=h(super_token), timeout=15).json()
    assert not any(x["id"] == tid for x in summ2["tenants"]), "tenant still present after delete"
