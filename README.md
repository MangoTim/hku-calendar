# HKU ENGG Intranet — React + Vite + TypeScript demo

This is the React port of the HKU ENGG Faculty Intranet faculty intranet demo. The original static build runs on **port 8090** (`products/Demo_hku/webpage/`); this React port runs on **port 8091** with a small Express + pg backend on **port 8092** that persists the audit trail + system logs to PostgreSQL on **`192.168.147.103`** (`engg_intranet` DB).

## Quick start

```bash
# Install (one time)
bun install
cd server && bun install && cd ..

# Start the audit API (port 8092 — talks to .103 PostgreSQL)
cd server && bun run src/index.ts

# Start the Vite dev server (port 8091 — proxies /api to 8092)
bun run dev
```

Open <http://localhost:8091/login> in a browser. Hard-refresh after the API stops/starts so `/admin` reflects the new ONLINE/OFFLINE state.

## Demo users

All seeded in `src/lib/data.ts` (`USERS`). Login is a one-click picker — no password required:

| Username | Role | Team |
|---|---|---|
| `dean` | TASK_MANAGER | Dean's Office |
| `sec1` / `sec2` | TASK_MANAGER | Dean's Office |
| `it_lead` (Grace Ng) | ADMIN | IT Admin |
| `it1` (Carl Ho) | ADMIN | IT Admin |
| `it2` (Betty Lam) | ADMIN | IT Admin |
| `auditor1` (Helen Audit) | AUDITOR | IT Admin |
| `acc_lead` / `oa_lead` / `fac_lead` | TASK_MANAGER | various |
| everyone else | USER | various |

Demo is single-user — only one session at a time per browser.

## Architecture

```
Browser (8091)  →  Vite proxy  →  Express + pg  →  PostgreSQL
                                   (8092)         (.103 / engg_intranet)
       │                                  
       ├── React app (8091)
       │   ├── Auth context (session)
       │   ├── AppShell + Sidebar + Topbar
       │   ├── Module pages (Dashboard, Tasks, Bookings, Leave,
       │   │                Announcements, Notifications, Profile)
       │   └── Admin pages (Home, Rooms, Users, Task settings,
       │                    Holidays, Database, Backup,
       │                    Audit, System Logs)
       │
       └── localStorage keys (per-browser overrides)
            encmq_user_rooms, _tasks, _bookings, _leave,
            _announcements, _notification_state, _settings,
            _holidays, _database_config, _backup_config,
            _user_overrides
```

| Layer | Storage | Notes |
|---|---|---|
| Users (auth) | seed only | No LS override for credentials (login is one-click) |
| User role/enable overrides | LS `engg_user_user_overrides` | Admin Users page |
| Rooms / Bookings / Leave / Tasks / Announcements | seed + LS override | Last-writer-wins merge by id |
| Notifications (read state) | LS per-user state map | Per-user, not per-record |
| Holidays | seed + LS added + LS removed (date set) | Reset to seed clears LS keys |
| Task alert window | LS `engg_user_settings` | |
| DB + Backup config | LS | Last-writer-wins merge |
| **Audit events** | **`.103/engg_intranet/audit_events`** | API server on 8092 |
| **System logs** | **`.103/engg_intranet/system_logs`** | API server on 8092 |

## Audit + Backup API (port 8092)

```
GET  /health                 → { status: "ok", db: "ok" }
GET  /api/audit-events       → AuditEvent[]
POST /api/audit-events       → AuditEvent (201)
GET  /api/system-logs        → SystemLog[]
POST /api/system-logs        → SystemLog (201)
PATCH /api/system-logs/:id   → SystemLog (toggles `resolved`)
GET  /api/backups            → BackupMeta[] (newest first; sizeBytes + per-key item counts)
POST /api/backups            → BackupMeta (201) — body: { label, keys, retention }
GET  /api/backups/:id        → BackupSnapshot (full JSON incl. all captured LS keys)
DELETE /api/backups/:id      → 204
```

Backups are stored as standalone JSON files under `server/backups/` — each snapshot is one file keyed by ISO timestamp + sanitised label. Retention is enforced on every save (oldest pruned past the limit).

Auto-bootstraps on first start:
- Creates `engg_intranet` DB on `192.168.147.103:5432` if missing
- Creates `audit_events` + `system_logs` tables (with `created_at DESC` indexes)
- Seeds from `src/lib/data.ts` (`AUDIT_EVENTS` + `SYSTEM_LOGS`) only if tables are empty
- Re-syncs the SERIAL past the max seeded id so subsequent inserts don't collide

Override host/user/password via env vars:
```bash
DB_HOST=... DB_USER=... DB_PASSWORD=... bun run db.server.ts
```

## Module map

| Module | Lib | Pages |
|---|---|---|
| Auth | `lib/auth` (in `contexts/`) | `Login` |
| Dashboard | — | `Dashboard` |
| Bookings | `lib/bookings` | `Bookings`, `BookingForm`, `BookingDetail` |
| Leave | `lib/leave` | `Leave`, `LeaveForm`, `LeaveDetail` |
| Tasks | `lib/tasks` | `Tasks`, `TasksMy`, `TaskForm`, `TaskDetail` |
| Announcements | `lib/announcements` | `Announcements`, `AnnouncementForm`, `AnnouncementDetail` |
| Notifications | `lib/notifications` | `Notifications` |
| Profile | — | `Profile` |
| Admin: Rooms | `lib/rooms` | `AdminRooms`, `AdminRoomForm` |
| Admin: Users | `lib/userAdmin` | `AdminUsers` |
| Admin: Holidays + Task settings + Database + Backup | `lib/settings` | `AdminHolidays`, `AdminTaskSettings`, `AdminDatabase`, `AdminBackup` |
| Admin: Audit + System Logs | `lib/audit` (remote API) | `AdminAudit`, `AdminSystemLogs` |
| Admin: SSO + Database + Backup + Audit + System Logs + Identity | — | `AdminHome` + placeholders |

## Roles

```ts
ROLE.isAdmin()       // ADMIN — full access
ROLE.isTaskManager() // TASK_MANAGER + ADMIN — task CRUD
ROLE.canSeeAudit()   // ADMIN + AUDITOR — /admin/audit, /admin/system-logs
```

Users without ADMIN role are redirected from `/admin/*` to `/dashboard`.

## Phases (build history)

| Phase | Scope |
|---|---|
| 1 | Skeleton + design system + sidebar |
| 2 | Bookings (calendar + new/edit/detail + ICS + team filter) |
| 3 | Leave (month + new + ICS + holiday block) |
| 4 | Tasks (list + new + detail + progress + due-soon + history) |
| 5 | Announcements + Notifications + Profile |
| 6 | Admin overview + Rooms + Users + Task settings + Holidays |
| 7a | Admin: Database + Backup (UI demo, LS-backed) |
| 7b | Admin: SSO + Identity providers — **on hold** awaiting network team input |
| 8 | Admin: Audit + System Logs (real `.103` PostgreSQL via API on :8092) |
| 9 | Polish (README, a11y, responsive, disabled-room fix) |
| 10 | **Real backup wiring** (POST /api/backups + restore reloads) |

## Gotchas (worth knowing)

- **`/admin/sso` is a placeholder** — awaiting specs from your network team
- **Database admin page is UI-only** — connection config stored in LS; the probe returns canned messages for `.103` / `sqlserver.engg.hku` / localhost. No real connection.
- **Backup** — Run now POSTs a snapshot of all `engg_user_*` localStorage keys to `:8092/api/backups`; restore GETs the snapshot and writes the keys back, then reloads. Auto-scheduling is UI-only (cron field accepts input but no scheduler runs).
- **Audit events are not auto-generated** — only seed + manual POSTs. CRUD on rooms/tasks/bookings/leave does NOT currently emit audit events. (Could be wired if needed.)
- **Vite proxy** — `/api` + `/health` on :8091 forward to :8092 (configured in `vite.config.ts`). Restart Vite after changing the proxy.
- **localStorage is per-browser** — open in a fresh browser/private window to see the seed state (no overrides).
- **Browser tabs share LS** — `Ctrl+Shift+R` (hard-refresh) is required after switching modules or restarting Vite to avoid seeing stale JS modules.
- **DB credentials are hardcoded** in `server/src/db.ts` (defaults to `postgres/redhat@192.168.147.103`). Override via env vars before sharing.