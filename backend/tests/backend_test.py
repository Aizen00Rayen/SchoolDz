"""SchoolDZ backend API tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://academy-dash-36.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api/v1"

OWNER = {"email": "owner@dteduc.schooldz.com", "password": "owner123"}
TEACHER = {"email": "teacher@dteduc.schooldz.com", "password": "teacher123"}
SUPER = {"email": "admin@schooldz.com", "password": "admin123"}


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
    j = r.json()
    assert j["status"] == "ok"


# ---------- Auth ----------
def test_owner_login_returns_token_and_user():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "access_token" in j
    assert j["user"]["role"] == "owner"
    assert j["user"]["tenant_id"]


def test_me_returns_user_and_tenant(owner_token):
    r = requests.get(f"{API}/auth/me", headers=h(owner_token), timeout=15)
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["email"] == OWNER["email"]
    assert j["tenant"]["slug"] == "dteduc"


def test_super_admin_login():
    r = requests.post(f"{API}/auth/login", json=SUPER, timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert j["user"]["role"] == "super_admin"
    assert j["user"].get("tenant_id") in (None, "")


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
    assert s["student_code"].startswith("STU-") or "-" in s["student_code"]
    # GET
    r2 = requests.get(f"{API}/students/{sid}", headers=h(owner_token), timeout=15)
    assert r2.status_code == 200
    assert r2.json()["first_name"] == "TEST_John"
    # PATCH
    r3 = requests.patch(f"{API}/students/{sid}", json={"first_name": "TEST_Jane"},
                       headers=h(owner_token), timeout=15)
    assert r3.status_code == 200
    assert r3.json()["first_name"] == "TEST_Jane"
    # DELETE
    r4 = requests.delete(f"{API}/students/{sid}", headers=h(owner_token), timeout=15)
    assert r4.status_code == 200
    r5 = requests.get(f"{API}/students/{sid}", headers=h(owner_token), timeout=15)
    assert r5.status_code == 404


# ---------- Tenant isolation ----------
def test_tenant_isolation():
    slug = f"testcorp-{uuid.uuid4().hex[:8]}"
    payload = {
        "tenant_name": "Test Corp",
        "tenant_slug": slug,
        "center_type": "tutoring",
        "name": "T Owner",
        "email": f"owner-{slug}@example.com",
        "password": "password123",
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
    assert "results" in j
    assert isinstance(j["results"], list)


# ---------- Register validation ----------
def test_register_invalid_slug():
    r = requests.post(f"{API}/auth/register", json={
        "tenant_name": "X", "tenant_slug": "X X",
        "name": "N", "email": f"a-{uuid.uuid4().hex[:6]}@e.com", "password": "pw12345"
    }, timeout=15)
    assert r.status_code == 400


def test_register_duplicate_slug():
    r = requests.post(f"{API}/auth/register", json={
        "tenant_name": "X", "tenant_slug": "dteduc",
        "name": "N", "email": f"a-{uuid.uuid4().hex[:6]}@e.com", "password": "pw12345"
    }, timeout=15)
    assert r.status_code == 409
