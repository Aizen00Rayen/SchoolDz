# SchoolDZ — Product Requirements Document

**Domain**: schooldz.com — multi-tenant SaaS ERP for private education centers  
**Started**: Jan 2026  
**Stack**: FastAPI + React (JS) + MongoDB + JWT (adapted from Laravel/PostgreSQL to fit Emergent env)

---

## Original problem statement (verbatim summary)
Multi-tenant cloud ERP for tutoring centers, language schools, coding academies, robotics/music/art schools, summer camps and professional training. Two applications: (1) main marketing/pricing site + tenant signup, (2) per-tenant isolated workspace. RBAC (super_admin, owner, director, secretary, accountant, teacher, parent, student). RESTful API `/api/v1`. Multi-language FR/EN/AR + RTL. Modern minimal UI inspired by Stripe/Linear/Notion/Vercel/Framer.

## User personas
- **Super Admin** — platform operator managing all tenants.
- **School Owner / Director** — full control over their tenant.
- **Secretary / Accountant** — student and payment management.
- **Teacher** — sessions, attendance, homework.
- **Parent** (scaffolded) — view attendance/pay invoices.
- **Student** (scaffolded).

## Architecture
- **Backend** `/app/backend/`: `server.py` (bootstrap, seed), `routes.py` (`/api/v1/*`), `core.py` (JWT + tenant scope + RBAC), `models.py` (Pydantic entities).
- **Frontend** `/app/frontend/`: React + Tailwind + shadcn/ui + TanStack Query + Recharts + Framer Motion + Sonner.
- **Auth**: JWT HS256 access (12h) + refresh (14d). Frontend uses `Authorization: Bearer` from localStorage.
- **Multi-tenant**: every non-super_admin user pinned to `tenant_id`; every scoped route filters by tenant.
- **Preview subdomain**: path-based `/app/*` (docs for real `slug.schooldz.com` provided).

## MVP — implemented (Jan 2026)
- ✅ Landing marketing page (Swiss-brutalism editorial style, FR/EN/AR toggle, dark/light).
- ✅ Auth: register (creates tenant + owner), login, forgot password (dev token), reset.
- ✅ Tenant workspace shell: sidebar, topbar with ⌘K global command palette, tenant switcher, theme + language switchers.
- ✅ Dashboard with KPIs, revenue trend area chart, today's sessions, recent students/payments.
- ✅ Students, Parents, Teachers, Courses, Groups, Sessions — full CRUD with search.
- ✅ Attendance — fast one-click marking (present/late/excused/absent) with bulk save.
- ✅ Payments — invoicing with auto invoice_number, status pills, kinds (registration/monthly/course/installment).
- ✅ Reports — KPIs + bar chart.
- ✅ Settings — workspace, branding (primary/accent color, logo, language, currency, timezone, prefixes).
- ✅ Users — team member management with roles.
- ✅ Global search across students/teachers/parents/courses/groups/payments.
- ✅ Seed data: 3 users (admin, owner, teacher), 3 parents, 3 teachers, 4 courses, 4 groups, 15 students, 32 sessions, ~60 attendance rows, 30 payments.
- ✅ RBAC enforcement (owner/director/staff/super_admin).
- ✅ Tenant isolation verified by testing agent.
- ✅ FR/EN/AR with RTL support.

## Backlog (P1)
- Timetable weekly calendar with drag & drop + conflict detection.
- Homework module + submissions.
- Grades & report cards.
- Summer Camp module (dedicated fields + daily check-in/out).
- Announcements center + notifications.
- Certificate generator (PDF export).
- Parent portal (view attendance, pay invoices, download receipts).
- QR-code Student ID cards.

## Backlog (P2)
- SMS / WhatsApp integration for notifications.
- Real Stripe / local gateway payments.
- Mobile apps (React Native).
- AI teaching assistant (using Emergent LLM key).
- Real subdomain routing (`slug.schooldz.com`) via nginx.

## Test credentials
See `/app/memory/test_credentials.md`.

## Test results (iteration_1)
- Backend: **100%** (18/18 pytest cases)
- Frontend: **90%** (all major flows work; 2 fixed issues: empty email on optional field, setState-in-render warning)
