# Operations Core Platform (MVP) — Supabase + React

An internal **Operations Hub** for multi-department companies:
- Requests/Tickets with a clear workflow: **Create → Assign → Execute → Approve → Forward/Close**
- Cross-department routing with the ability to **return** work backward (with mandatory notes)
- **Role-based access control** (Admin / CEO / Department Manager / Employee)
- Full **audit trail** (best practices) + event log
- **Outbox pattern** for reliable email notifications (Edge Function worker)
- UI built with **Bootstrap + Gestalt principles** (clarity, hierarchy, proximity, similarity)

> Designed to be efficient and realistic for the Supabase **$25** tier: Postgres-first, RLS for security, RPCs for controlled mutations, minimal infra.

---

## Roles & visibility model

### Roles
- **Admin**: full access + admin console (role management, request type management, audit rollback).
- **CEO**: can view everything across the company, but **cannot** perform Admin-only actions (role changes/rollback).
- **Manager**: department-scoped access:
  - sees all requests **originating** from their department
  - sees all requests **currently assigned to** their department
  - sees their department employees and their workloads
  - can approve / auto-approve rules per request type (department automation)
  - cannot browse other departments’ employees (names/emails) except what appears on step snapshots.
- **Employee**:
  - can see requests they created
  - can see requests where they are assigned to the current step

### Key workflow behaviors
- A step marked **done** becomes **done_pending_approval**.
- A **manager approval** is required before forwarding/closing (unless auto-approval rules apply for that department + request type).
- Receiving department can **return** the request backward, but must enter a reason; it is logged and visible.

---

## Local run (Docker + Supabase CLI + Node)

### 1) Prerequisites
- Docker Desktop
- Node.js 18+ (or 20+)
- Supabase CLI

### 2) Install web dependencies
```bash
cd web
npm install
```

### 3) Start Supabase locally
```bash
cd ..
supabase start
```

### 4) Apply migrations + seed
```bash
supabase db reset
```

This creates:
- Demo Company + branches + departments
- Request types + department settings
- Storage bucket + policies

### 5) Configure env
Web app:
```bash
cp web/.env.example web/.env
```
Paste `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from `supabase start` output.

Edge function worker:
```bash
cp supabase/.env.example supabase/.env.local
```
Paste `SUPABASE_SERVICE_ROLE_KEY` from `supabase start`.

### 6) Run Edge Function worker (email outbox)
```bash
supabase functions serve send-outbox-emails --no-verify-jwt --env-file supabase/.env.local
```

By default `DRY_RUN=true` so it prints emails to console and still marks outbox rows as sent.

### 7) Run the web app
```bash
cd web
npm run dev
```

Open the app (Vite will print the local URL).

---

## First user bootstrap (important)

The first user who signs up in a fresh DB becomes **Admin** automatically.

This happens in the Postgres trigger:
- `auth.users` insert → `public.handle_new_user()` → creates `profiles` + `memberships`.

After that, Admin can promote/demote users from **Admin Console**.

---

## Email notifications (Outbox pattern)

Database writes notifications to:
- `public.notification_outbox` with status = `queued`

The worker (`send-outbox-emails`) reads `queued` rows, sends email (or prints it in DRY_RUN), and updates:
- `sent` / `failed` with retries.

Events that generate notifications:
- request created
- step assigned
- step completed
- step approved/forwarded
- request closed
- request returned

---

## Attachments (Supabase Storage)

Bucket: `request-attachments` (private)

Path convention:
```
requests/<request_id>/<timestamp>_<filename>
```

Policies enforce:
- user must be able to access the request (`public.can_select_request(request_id)`).

---

## Project structure

```
supabase/
  config.toml
  migrations/
    20260130000100_init.sql
    20260130000200_seed.sql
  functions/
    send-outbox-emails/
      index.ts

web/
  src/
    components/
    lib/
    pages/
```

---

## What to change next (recommended)

1) Add richer KPI views (SLA, cycle time by type/department/user).
2) Add “Company / Branch / Department” scoping beyond MVP.
3) Add structured “rejection reasons” and standardized handoff checklists.
4) Add integration layer:
   - Webhooks table and edge worker
   - External API endpoints

---

## Notes

- This MVP focuses on correctness, RLS, auditability, and predictable workflow.
- UI is intentionally designed with clear hierarchy and modular components to support rapid iteration.

