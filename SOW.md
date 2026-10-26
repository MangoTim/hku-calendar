# Statement of Work — HKU ENGG Intranet (React) Proof of Concept

| | |
|---|---|
| **Project** | HKU ENGG Faculty Intranet — React proof of concept |
| **Document** | SOW-POC-ENGG-INTRANET-001, Version 1.0 |
| **Date** | 2026-10-26 |
| **POC period** | 2 weeks from the date the container image is handed over |
| **Deployment target** | Customer RHEL VM, container runtime (podman or Docker) |
| **Deliverable** | Prebuilt container image + deployment runbook + configuration spec |
| **Parties** | [Provider] and [Customer] |

---

## 1. Purpose

This Statement of Work defines a proof-of-concept (POC) engagement for the HKU ENGG Faculty Intranet, delivered as a containerised React application. The POC's purpose is to allow the Customer to evaluate the application's functional scope, user experience, and integration readiness **in the Customer's own environment** — using the Customer's own server, database, and Microsoft Entra ID (Azure AD) identity provider — prior to any commitment to productionisation.

The POC is an evaluation exercise. It is **not** a production deployment, and Section 8 (Limitations) forms part of this agreement.

## 2. Objectives

1. Allow the Customer to run the application on Customer-controlled infrastructure without requiring Provider access to that infrastructure.
2. Validate the functional scope against the Customer's requirements for an engineering faculty intranet: room booking, leave management, task tracking, announcements, notifications, and administrative control.
3. Validate the end-to-end single sign-on integration against the Customer's Entra ID tenant, including role-based access control and user lifecycle (allowlist) management.
4. Identify the gap between POC-grade and production-grade readiness, and produce a costed path to production.

## 3. Scope

### 3.1 In scope

The POC covers evaluation of the following functional areas:

| Area | Functionality covered |
|---|---|
| **Authentication & access** | Entra ID authorisation-code sign-in, session cookie, role model (USER / TASK_MANAGER / ADMIN / AUDITOR), SSO user allowlist and directory administration, dual local/SSO admin access |
| **Room booking** | Month / week / day calendar views, three-column day timetable, team filter, create / edit / cancel, room administration, ICS export, IT-support flag |
| **Leave management** | Leave request, approval state, monthly view, public-holiday awareness, ICS export, weekly reporting input |
| **Task management** | Task list, create / edit, progress tracking, due-soon view, per-task history, task settings |
| **Announcements & notifications** | Announcement publishing, per-user read state, notification feed |
| **Administration** | Rooms, users, task settings, holidays (incl. iCalendar / CSV / XLSX import), email templates, database inspector, backup & restore, audit trail, system logs, SSO configuration, digest configuration |
| **Email** | IT-support request emails, daily leave digest, weekly leave report, admin-editable templates with live preview, configurable SMTP |
| **Auditability** | Audit event and system log tables, queryable via the admin UI, persisted in the Customer's database |
| **Deployment** | Container image, run command, environment variable specification, health endpoint, backup volume |

### 3.2 Out of scope

The following are **excluded** from the POC and are not delivered, tested, or supported during the POC period:

- Production hardening, performance tuning, load or soak testing, and capacity sizing.
- High availability, multi-node clustering, disaster recovery, and database replication.
- Server-side backup and restore of the PostgreSQL database. (The provided backup feature captures browser-side state only — see Section 8.)
- Migration of any Customer production data into the application.
- Redesign of the visual identity, or implementation of Customer branding beyond the existing theme.
- Native mobile applications, offline mode, or multi-language / bilingual interface.
- Integration with any system not listed in Section 3.1, including HR, calendar (Microsoft 365 / Google), or student-record systems.
- Formal penetration testing, security accreditation, or compliance certification.
- Procurement, licensing, or support subscriptions for third-party components.
- Ongoing maintenance, feature development, or SLA-bearing support beyond the POC period (Section 7).

## 4. Deliverables

| # | Deliverable | Format | Contents |
|---|---|---|---|
| D1 | Container image | `hku-intranet:latest` (OCI image, loadable by podman or Docker) | Complete application — React bundle, API server, schema bootstrap, seed data |
| D2 | Deployment runbook | Markdown | Image transfer, container run command, environment variable reference, health check, backup volume, upgrade and rollback procedure, troubleshooting |
| D3 | Configuration specification | Markdown (Section 6 of this document) | Every required and optional environment variable, with purpose, default, and whether it must be overridden |
| D4 | Prerequisite checklist | Markdown (Section 5) | Customer-supplied infrastructure, database, and identity requirements, stated in advance so the environment can be prepared before the image is deployed |
| D5 | POC support | Remote, during the POC period | Ad-hoc assistance with deployment, configuration, and defect triage (Section 7) |
| D6 | POC findings report | Markdown, issued at POC close | Findings against each acceptance criterion in Section 10, an itemised list of defects and observations, and a production-readiness gap assessment with indicative effort to close it |

## 5. Customer prerequisites and responsibilities

**These must be in place before the POC deployment.** The Provider's support during the POC period is limited to the application; the Provider does not administer the Customer's infrastructure, database, or identity tenant.

### 5.1 Infrastructure

- One RHEL (or equivalent) VM reachable by the Provider's test users, with:
  - `podman` or Docker installed and the current user able to run rootless or rootful containers.
  - A persistent host directory for backups (e.g. `/home/<user>/hku-intranet/backups`) mounted into the container at `/app/backups`.
- Outbound network access from the VM to the Customer's PostgreSQL server (TCP 5432) and to `login.microsoftonline.com` (HTTPS 443) for the Entra ID redirect.
- Inbound access to the application on TCP port **8093** from the Provider's test network, and from the Customer's users' network.
- A TLS-terminating reverse proxy in front of the application, with a stable public URL. The Entra ID redirect URI must match this URL exactly (Section 5.3).

### 5.2 Database

- A PostgreSQL instance, version 13 or later, reachable from the VM.
- A database owner account that can **create databases and create tables** within them. The application auto-creates the database if absent and creates all 11 of its own tables on first start.
- A dedicated application role and password, supplied to the Provider via a secure channel. **The application will create the database and schema as the supplied role**, so the role needs `CREATEDB` on the target server, or the database may be pre-created by the DBA and the role granted ownership.
- A decision on the connection string, supplied at deployment (Section 6).

### 5.3 Identity — Microsoft Entra ID (Azure AD)

- An **App registration** in the Customer's Entra ID tenant:
  - **Authentication type:** Web.
  - **Redirect URI:** `https://<your-public-url>/api/sso/callback` — must match the deployed `SSO_REDIRECT_URI` exactly, including scheme and path.
  - **API permissions (Microsoft Graph):** `openid`, `profile`, `email`, `User.Read` (delegated).
  - A **client secret** for the confidential client.
- A **group or role design** mapped to the application's four roles: USER, TASK_MANAGER, ADMIN, AUDITOR. The application maps users by email address, so the Customer must decide the mapping rule before UAT.
- **An initial list of users to allowlist.** The application does **not** auto-provision users from Entra ID — a user must exist in the application before they can sign in. The allowlist is managed in **Admin → Identity & SSO**, or seeded on first start via `SSO_SEED_ADMIN_EMAIL` (Section 6).
- If the application will sit behind an existing identity gateway, the Customer must confirm whether direct Entra ID redirect is permitted, or whether the redirect must be rewritten to the gateway.

### 5.4 Optional, if email is in scope for the POC

- An SMTP relay the VM can reach, plus a permitted sender address. The Provider will be given host, port, optional credentials, and from-address.
- Confirmation of the **digest recipient** — a single mailbox, since per-user digest subscription is not implemented in this release (Section 8).

### 5.5 Other

- A named Customer POC coordinator, and a nominated test user in each of the four roles, with a two-day turnaround expectation on access and data issues raised through the Provider's support channel.

## 6. Configuration specification

All configuration is by environment variable at container start. No configuration file is shipped.

### 6.1 Required — must be overridden

| Variable | Purpose | Notes |
|---|---|---|
| `DB_HOST` | PostgreSQL hostname | The image default points at the Provider's development host — **must be overridden** |
| `DB_PORT` | PostgreSQL port | Default `5432` |
| `DB_USER` | PostgreSQL role | Default `postgres` — **should be overridden** to a dedicated application role |
| `DB_PASSWORD` | PostgreSQL password | The image default is a development password — **must be overridden** |
| `DB_NAME` | Database name | Default `engg_intranet`. The application creates it if the role has `CREATEDB` |
| `AZURE_TENANT_ID` | Entra ID tenant | From the Customer's app registration |
| `AZURE_CLIENT_ID` | Application (client) ID | From the Customer's app registration |
| `AZURE_CLIENT_SECRET` | Client secret | From the Customer's app registration. Stored server-side; supplied at container start only |
| `SSO_REDIRECT_URI` | OAuth redirect URI | Must exactly match the app registration entry. **Environment-only — deliberately not editable in the UI** |
| `SSO_COOKIE_SECRET` | Signs the session cookie | **Must be set.** The built-in default is a known development value and is not acceptable for anything beyond a smoke test. Use a long random string |
| `HOST` | Bind address | Default `0.0.0.0` |
| `PORT` | Listen port | Default `8093` |

### 6.2 Optional

| Variable | Purpose | Default |
|---|---|---|
| `NODE_ENV` | Runtime mode | `production` |
| `SSO_SEED_ADMIN_EMAIL` | Creates an ADMIN allowlist row on first start | unset |
| `SSO_SEED_ADMIN_NAME` | Display name for that user | unset |
| `SSO_POST_LOGIN_REDIRECT` | Landing page after sign-in | `/dashboard` |
| `SMTP_HOST` | SMTP relay | `127.0.0.1` |
| `SMTP_PORT` | SMTP port | `25` |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP credentials, if the relay requires auth | unset |
| `SMTP_FROM` | Envelope sender | `ENGG Intranet <noreply@intranet.engg.hku.hk>` |

### 6.3 Volumes

| Path | Purpose |
|---|---|
| `/app/backups` | Backup snapshots (JSON files). Mount a persistent host directory here, or backups will be lost on container replacement |

## 7. Deployment approach

The application is delivered as a single container serving both the API and the React bundle on one port, so no reverse-proxy path rewriting is required.

**Receiving the image**

```bash
# Provider: export
podman save hku-intranet:latest | gzip > hku-intranet-latest.tar.gz

# Customer: import
gunzip -c hku-intranet-latest.tar.gz | podman load
```

**Running (reference)**

```bash
podman run -d --name hku-intranet --net=host --restart=unless-stopped \
  -v /home/<user>/hku-intranet/backups:/app/backups \
  -e HOST=0.0.0.0 -e PORT=8093 \
  -e DB_HOST=<customer-pg-host> -e DB_PORT=5432 \
  -e DB_USER=<app-role> -e DB_PASSWORD=<app-password> -e DB_NAME=engg_intranet \
  -e NODE_ENV=production \
  -e AZURE_TENANT_ID=<tenant> \
  -e AZURE_CLIENT_ID=<client-id> \
  -e AZURE_CLIENT_SECRET='<client-secret>' \
  -e SSO_REDIRECT_URI=https://<public-url>/api/sso/callback \
  -e SSO_COOKIE_SECRET='<long-random-string>' \
  hku-intranet:latest
```

**Health check** — `GET /health` returns HTTP 200 with `{"status":"ok","db":"ok"}` once the process is listening. The container's own healthcheck polls this every 30 seconds. Note that the `db` field is a static literal and does not reflect a live database probe; use `GET /api/db/connection` for a real reachability check.

**Upgrade path** — the image is rebuilt from source; the customer redeploys with the same run command. The database schema is created with `IF NOT EXISTS` and is forward-compatible, so upgrades do not require manual migration for the schema as it stands at POC entry. A restore from backup is a manual procedure during the POC (Section 8).

## 8. Limitations

These are known and accepted characteristics of the POC build. They are listed so that POC findings are interpreted correctly and so the productionisation scope can be estimated accurately.

**Data persistence and multi-user behaviour**

1. **Business data lives in the browser, not the database.** Bookings, leave, tasks, announcements, rooms, holidays, notifications, and user role overrides are stored in the browser's localStorage. The PostgreSQL database holds only: `audit_events`, `system_logs`, `holidays` (+ import and removal records), `sso_config`, `sso_users`, `email_templates`, `app_config`, `leave_records`, `booking_records`, and `digest_runs`.
2. **Leave and bookings are mirrored to the database one way**, best-effort, after the browser write. The mirror exists so the email scheduler can compose digests; the application does **not** read the mirror back for display. It is a derivative, not a source of truth.
3. **Data is per-browser, not per-user.** Two signed-in users on two different browsers do not see each other's tasks, bookings, leave, or announcements. The POC is therefore a functional and UX evaluation, not a multi-user collaboration evaluation. Concurrent sign-in itself is supported — the session is a stateless signed token, so parallel users each hold their own identity.
4. **Browser state is lost if localStorage is cleared**, and is not shared between browsers or machines. The backup feature (Section 8, item 7) is the only protection.

**Access control**

5. **Most API routes are unauthenticated.** Role enforcement for administrative pages is performed in the browser, not at the API boundary. The API is intended to be reachable only from the application server's own network. This is acceptable for a POC on a private network and **is not acceptable for exposure to end users or the public internet** without the hardening in Section 8, item 11.
6. **Entra ID users are not auto-provisioned.** A user must be added to the allowlist before they can sign in. This is intentional — it prevents uncontrolled directory access — but it is an onboarding task the Customer must perform.

**Email**

7. **Backups capture browser-side state only.** The backup feature snapshots the `engg_user_*` localStorage keys. It does **not** back up the PostgreSQL database, and there is no server-side restore endpoint — restore is a client-side procedure. The Customer's own PostgreSQL backup regime is the Customer's responsibility and is out of scope.
8. **The digest goes to a single mailbox.** Per-user digest subscription is not implemented; the recipient falls back to one configured address. Profile-page digest toggles are cosmetic in this release and do not affect delivery.
9. **The scheduler runs on UTC.** The "08:00" daily digest and the Monday weekly report are computed in UTC — approximately 16:00 Hong Kong time. The hour is configurable.

**Operational**

10. **The `SSO_COOKIE_SECRET` default is a known development value.** It must be overridden; see Section 6.1.
11. **The Entra ID client secret is stored in clear text** in the `sso_config` database row (it is masked when read through the admin API, but not encrypted at rest).
12. **The sign-in flow uses a client secret rather than PKCE.**
13. **Audit events are not generated by ordinary CRUD.** Room, task, booking, and leave changes do not currently emit audit events; the audit table is populated by seed data and manual entries. The audit trail is therefore a UI and storage demonstration rather than a compliance record.
14. **The database inspector exposes table names and sample rows without an authentication check** and is intended for evaluation use only.
15. **No performance, load, or resilience testing has been performed**, and the Provider makes no performance or capacity commitment at this stage.
16. **The `/health` endpoint does not probe the database** — it returns a static `{"status":"ok","db":"ok"}` once the process is listening. A live check is available at `GET /api/db/connection`.

## 9. POC period and timeline

The POC period is 2 weeks, commencing on the date the image is handed over.

| Phase | Days | Activity | Owner |
|---|---|---|---|
| 1 — Prerequisites | 1–2 | Customer provisions the VM, PostgreSQL, and Entra ID app registration, and supplies the configuration values | Customer |
| 2 — Deployment | 3 | Image imported and started; health check confirmed; schema auto-creation verified; SSO allowlist seeded | Joint |
| 3 — SSO integration | 3–4 | Entra ID sign-in verified per role; redirect URI and cookie secret validated | Joint |
| 4 — Functional evaluation | 4–10 | Customer exercises the Section 3.1 functional scope; defects and observations logged | Customer, supported by Provider |
| 5 — Fix cycle | 8–11 | Provider triages and addresses defects; re-deploys the image where required | Provider |
| 6 — Close-out | 12–14 | Acceptance review against Section 10; findings report (D6) issued; productionisation gap assessment | Joint |

Timescales assume Customer action within two working days on items in Phase 1. Delays in prerequisite provisioning extend the POC period correspondingly.

## 10. Acceptance criteria

The POC is accepted when each criterion below is demonstrated in the Customer's environment and recorded in the findings report.

| # | Criterion | Verification |
|---|---|---|
| A1 | The container starts and reports healthy | `GET /health` returns HTTP 200; container healthcheck reports healthy |
| A2 | The application schema is created in the Customer's database | All 11 tables present in the target database, populated with the reference dataset where applicable |
| A3 | Sign-in through the Customer's Entra ID tenant succeeds | At least one user in each of the four roles signs in via the Customer's identity provider and reaches the dashboard |
| A4 | Access control behaves as designed | A USER cannot reach administrative pages; an ADMIN can; an AUDITOR can reach audit and system logs but not user administration |
| A5 | The allowlist is operable | The Customer's admin adds a user, changes a role, disables a user, and the change takes effect on next sign-in |
| A6 | Room booking is complete | A booking is created from the day timetable, appears on the month and week views, is edited, is cancelled, and is exported as ICS |
| A7 | Leave, tasks, announcements, and notifications are complete | One end-to-end flow per area, including progress tracking and per-user read state |
| A8 | Administrative areas are complete | Holidays import, email template edit and preview, database inspector, backup creation, audit and system log review |
| A9 | Backup and restore work | A backup snapshot is created, the application state is reset, and the snapshot is restored successfully |
| A10 | Email functions | An IT-support email is sent, and the daily digest is generated and delivered to the agreed mailbox |
| A11 | No unresolved severity-1 defect | No defect that blocks a documented functional flow remains open at close-out |
| A12 | Findings report issued | D6 delivered, including the production-readiness gap assessment |

Severity-1 is defined as: a defect that prevents a user from signing in, or prevents an entire functional area in Section 3.1 from being used at all.

## 11. Support during the POC

- **Channel:** a single named contact on each side, with email as the primary channel and a working telephone number for severity-1 issues.
- **Response targets** during the POC period:

| Severity | Definition | Response |
|---|---|---|
| 1 | Sign-in unavailable, or a functional area in Section 3.1 entirely unusable | 4 business hours |
| 2 | A functional flow is degraded but a workaround exists | 1 business day |
| 3 | Cosmetic, or a defect in a secondary flow | 2 business days |

- **Response targets are best-effort during a POC** and do not constitute an availability or service-level commitment. No uptime guarantee, on-call roster, or 24×7 coverage is provided during the POC period.
- Defect fixes are delivered as a rebuilt container image, using the same import and redeploy procedure as Section 7. The Provider does not require access to the Customer's environment to produce a fix.
- The Provider will not modify the Customer's database, identity configuration, or host outside the container's own schema bootstrap and the documented image upgrade, without written authorisation.

## 12. Post-POC

On expiry of the POC period, support under Section 11 ceases. The Customer retains all rights to the delivered image and documentation. Any productionisation work — including the hardening items in Section 8, feature development, and ongoing support — is subject to a separate agreement. The findings report (D6) is intended to be the input to that scoping.

## 13. Assumptions

1. The Customer provisions the infrastructure, database, and identity provider as described in Section 5, and provides the configuration values in a usable form before Phase 2.
2. The Customer's Entra ID tenant permits the redirect flow in Section 5.3, and no additional identity gateway is interposed without prior agreement.
3. The Customer's PostgreSQL server is reachable from the application VM and permits the required database and table creation.
4. The test users nominated by the Customer represent real usage patterns for the functional areas under evaluation.
5. All testing during the POC is performed against non-production data. The application is not certified for handling production or personal data at POC readiness — Section 8, items 5, 10, 11, and 14 apply.
6. The POC period is otherwise as stated in Section 9, with the delay provision in that section applying.

## 14. Sign-off

| | Name | Title | Signature | Date |
|---|---|---|---|---|
| For the Provider | | | | |
| For the Customer | | | | |
