// HKU ENGG Intranet — Mock data (port of static /assets/js/data.js)
// Mirrors the v0928 schema (EnggIntranetDB) + users.csv seed.
import type {
  User, Room, Booking, Leave, Task, TaskProgress,
  Announcement, Notification, Holiday,
  SsoConfig, DatabaseConfig, BackupConfig, TaskSettings,
  AuditEvent, SystemLog
} from './types';

// ---------------- HK public holidays ----------------
const HK_HOLIDAYS: Record<number, Holiday[]> = {
  2025: [
    { date: '2025-01-01', name: "New Year's Day" },
    { date: '2025-01-29', name: 'Lunar New Year' },
    { date: '2025-01-30', name: 'Lunar New Year' },
    { date: '2025-01-31', name: 'Lunar New Year' },
    { date: '2025-04-04', name: 'Ching Ming Festival' },
    { date: '2025-04-18', name: 'Good Friday' },
    { date: '2025-04-19', name: 'The day following Good Friday' },
    { date: '2025-04-21', name: 'Easter Monday' },
    { date: '2025-05-01', name: 'Labour Day' },
    { date: '2025-05-05', name: "Buddha's Birthday" },
    { date: '2025-05-31', name: 'Tuen Ng Festival' },
    { date: '2025-07-01', name: 'HKSAR Establishment Day' },
    { date: '2025-10-01', name: 'National Day' },
    { date: '2025-10-07', name: 'The day following the Chinese Mid-Autumn Festival' },
    { date: '2025-10-11', name: 'Chung Yeung Festival' },
    { date: '2025-12-25', name: 'Christmas Day' },
    { date: '2025-12-26', name: 'Boxing Day' }
  ],
  2026: [
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-02-19', name: 'Lunar New Year' },
    { date: '2026-02-20', name: 'Lunar New Year' },
    { date: '2026-02-21', name: 'Lunar New Year' },
    { date: '2026-02-23', name: 'The fourth day of Lunar New Year' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-04-04', name: 'The day following Good Friday' },
    { date: '2026-04-06', name: 'Easter Monday' },
    { date: '2026-05-01', name: 'Labour Day' },
    { date: '2026-05-25', name: 'The Birthday of the Buddha' },
    { date: '2026-06-19', name: 'Tuen Ng Festival' },
    { date: '2026-07-01', name: 'HKSAR Establishment Day' },
    { date: '2026-09-28', name: 'The day following the Chinese Mid-Autumn Festival (substitute day)' },
    { date: '2026-10-01', name: 'National Day' },
    { date: '2026-10-19', name: 'Chung Yeung Festival' },
    { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2026-12-26', name: 'Boxing Day' }
  ],
  2027: [
    { date: '2027-01-01', name: "New Year's Day" },
    { date: '2027-01-25', name: 'Lunar New Year' },
    { date: '2027-01-26', name: 'Lunar New Year' },
    { date: '2027-01-27', name: 'Lunar New Year' },
    { date: '2027-04-02', name: 'Good Friday' },
    { date: '2027-04-03', name: 'The day following Good Friday' },
    { date: '2027-04-05', name: 'Easter Monday' },
    { date: '2027-04-06', name: 'Ching Ming Festival' },
    { date: '2027-05-01', name: 'Labour Day' },
    { date: '2027-05-03', name: 'Labour Day (substitute day)' },
    { date: '2027-05-21', name: 'The Birthday of the Buddha' },
    { date: '2027-06-17', name: 'Tuen Ng Festival' },
    { date: '2027-07-01', name: 'HKSAR Establishment Day' },
    { date: '2027-09-22', name: 'The day following the Chinese Mid-Autumn Festival' },
    { date: '2027-10-01', name: 'National Day' },
    { date: '2027-10-25', name: 'Chung Yeung Festival' },
    { date: '2027-12-25', name: 'Christmas Day' },
    { date: '2027-12-26', name: 'Boxing Day' },
    { date: '2027-12-27', name: 'Christmas Day (substitute day)' }
  ]
};

export const HOLIDAYS_FLAT: Holiday[] = [
  ...HK_HOLIDAYS[2025], ...HK_HOLIDAYS[2026], ...HK_HOLIDAYS[2027]
];
const HOLIDAY_SET = new Set(HOLIDAYS_FLAT.map(h => h.date));
export function holidayName(date: string): string | null {
  return HOLIDAYS_FLAT.find(h => h.date === date)?.name ?? null;
}
export function isHoliday(date: string): boolean {
  return HOLIDAY_SET.has(date);
}

// ---------------- Users (20 + 1 auditor) ----------------
export const USERS: User[] = [
  { id: 1,  username: 'dean',     displayName: 'Prof. Alan Wong',  team: "Dean's Office", title: 'Dean',             role: 'TASK_MANAGER', source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: true },
  { id: 2,  username: 'sec1',     displayName: 'Marie Chan',       team: "Dean's Office", title: 'Faculty Secretary', role: 'TASK_MANAGER', source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: true },
  { id: 3,  username: 'sec2',     displayName: 'David Lee',        team: "Dean's Office", title: 'Faculty Secretary', role: 'TASK_MANAGER', source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: true },
  { id: 4,  username: 'it_lead',  displayName: 'Grace Ng',         team: 'IT Admin',      title: 'IT Team Lead',     role: 'ADMIN',         source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: true },
  { id: 5,  username: 'it1',      displayName: 'Carl Ho',          team: 'IT Admin',      title: 'System Admin',     role: 'ADMIN',         source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 6,  username: 'it2',      displayName: 'Betty Lam',        team: 'IT Admin',      title: 'System Admin',     role: 'ADMIN',         source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 7,  username: 'auditor1', displayName: 'Helen Audit',      team: 'IT Admin',      title: 'Compliance Auditor', role: 'AUDITOR',     source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 8,  username: 'acc_lead', displayName: 'Ivan Wu',          team: 'Accounts',      title: 'Accounts Lead',    role: 'TASK_MANAGER', source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: true },
  { id: 9,  username: 'acc1',     displayName: 'Joanna Tsang',     team: 'Accounts',      title: 'Accountant',       role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 10, username: 'acc2',     displayName: 'Ryan Cheung',      team: 'Accounts',      title: 'Clerk',            role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: false, mondayTwoWeekLeaveReportEnabled: false },
  { id: 11, username: 'oa_lead',  displayName: 'Sarah Lau',        team: 'OA Admin',      title: 'Office Lead',      role: 'TASK_MANAGER', source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: true },
  { id: 12, username: 'oa1',      displayName: 'Cherry Mak',       team: 'OA Admin',      title: 'Admin Officer',    role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 13, username: 'oa2',      displayName: 'Henry Yeung',      team: 'OA Admin',      title: 'Admin Officer',    role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 14, username: 'fac_lead', displayName: 'Leo Fung',         team: 'Facilities',    title: 'Facilities Lead',  role: 'TASK_MANAGER', source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: true },
  { id: 15, username: 'fac1',     displayName: 'Peter Lo',         team: 'Facilities',    title: 'Technician',       role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 16, username: 'fac2',     displayName: 'Wendy Kwok',       team: 'Facilities',    title: 'Technician',       role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 17, username: 'gen1',     displayName: 'Tony Cheng',       team: 'General Staff', title: 'Executive Officer', role: 'USER',         source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 18, username: 'gen2',     displayName: 'Lisa Wong',        team: 'General Staff', title: 'Executive Officer', role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 19, username: 'gen3',     displayName: 'Eric Lam',         team: 'General Staff', title: 'Executive Officer', role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: false, mondayTwoWeekLeaveReportEnabled: false },
  { id: 20, username: 'gen4',     displayName: 'Mandy Ho',         team: 'General Staff', title: 'Executive Officer', role: 'USER',          source: 'LOCAL', enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false },
  { id: 21, username: 'gen5',     displayName: 'Kelvin Yip',       team: 'General Staff', title: 'Executive Officer', role: 'USER',          source: 'DEMO',  enabled: true, morningTeamDigestEnabled: true, mondayTwoWeekLeaveReportEnabled: false }
];

// ---------------- Rooms ----------------
export const ROOMS: Room[] = [
  { id: 1, name: 'Meeting Room 1',  building: 'Main Building', maxSeats: 12, active: true, notes: 'AV screen + video bridge' },
  { id: 2, name: 'Meeting Room 2',  building: 'Main Building', maxSeats: 8,  active: true, notes: 'Whiteboard only' },
  { id: 3, name: 'Conference Room', building: 'Annex Building', maxSeats: 24, active: true, notes: 'Conference table, projector' }
];

// ---------------- Helper: dates relative to today ----------------
const _today = new Date();
const dPlus = (n: number): string => {
  const d = new Date(_today);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------------- Bookings ----------------
export const BOOKINGS: Booking[] = [
  { id: 1, ref: 'RB-0001', roomId: 1, bookedById: 8,  date: dPlus(1),  startTime: '10:00', endTime: '11:30', purpose: 'Budget review',           status: 'CONFIRMED', supportRequests: 'Projector, AV', itSupport: false, cupsOfTea: 6,  warmWater: 0, coolWater: 6,  iPads: 2 },
  { id: 2, ref: 'RB-0002', roomId: 2, bookedById: 11, date: dPlus(1),  startTime: '14:00', endTime: '15:00', purpose: 'OA weekly huddle',        status: 'CONFIRMED', supportRequests: '',            itSupport: false, cupsOfTea: 4,  warmWater: 4, coolWater: 0,  iPads: 0 },
  { id: 3, ref: 'RB-0003', roomId: 3, bookedById: 4,  date: dPlus(2),  startTime: '09:30', endTime: '12:00', purpose: 'IT steering meeting',     status: 'CONFIRMED', supportRequests: 'Video bridge', itSupport: true,  cupsOfTea: 8,  warmWater: 8, coolWater: 8,  iPads: 4 },
  { id: 4, ref: 'RB-0004', roomId: 1, bookedById: 14, date: dPlus(2),  startTime: '13:00', endTime: '14:00', purpose: 'Facilities sync',         status: 'CONFIRMED', supportRequests: '',            itSupport: false, cupsOfTea: 2,  warmWater: 0, coolWater: 2,  iPads: 0 },
  { id: 5, ref: 'RB-0005', roomId: 2, bookedById: 9,  date: dPlus(3),  startTime: '11:00', endTime: '12:00', purpose: 'Vendor call',             status: 'CONFIRMED', supportRequests: 'Whiteboard',   itSupport: false, cupsOfTea: 3,  warmWater: 0, coolWater: 3,  iPads: 1 },
  { id: 6, ref: 'RB-0006', roomId: 3, bookedById: 2,  date: dPlus(4),  startTime: '15:00', endTime: '17:00', purpose: 'Faculty Senate briefing', status: 'CONFIRMED', supportRequests: 'AV',           itSupport: false, cupsOfTea: 10, warmWater: 5, coolWater: 10, iPads: 0 },
  { id: 7, ref: 'RB-0007', roomId: 1, bookedById: 17, date: dPlus(7),  startTime: '09:00', endTime: '10:00', purpose: 'Project intake',          status: 'CONFIRMED', supportRequests: '',            itSupport: false, cupsOfTea: 2,  warmWater: 0, coolWater: 2,  iPads: 0 },
  { id: 8, ref: 'RB-0008', roomId: 2, bookedById: 8,  date: dPlus(8),  startTime: '14:30', endTime: '16:00', purpose: 'Audit prep',              status: 'CONFIRMED', supportRequests: '',            itSupport: false, cupsOfTea: 4,  warmWater: 4, coolWater: 4,  iPads: 2 }
];

// ---------------- Leave ----------------
export const LEAVE: Leave[] = [
  { id: 1, userId: 9,  type: 'SICK',      startDate: dPlus(-3), endDate: dPlus(-3),  note: 'Flu' },
  { id: 2, userId: 10, type: 'ANNUAL',    startDate: dPlus(2),  endDate: dPlus(5),   note: 'Family trip' },
  { id: 3, userId: 12, type: 'ANNUAL',    startDate: dPlus(4),  endDate: dPlus(6),   note: '' },
  { id: 4, userId: 15, type: 'SICK',      startDate: dPlus(1),  endDate: dPlus(2),   note: 'Doctor visit' },
  { id: 5, userId: 19, type: 'UNPAID',    startDate: dPlus(10), endDate: dPlus(12),  note: 'Personal' },
  { id: 6, userId: 17, type: 'MATERNITY', startDate: dPlus(30), endDate: dPlus(120), note: '' },
  { id: 7, userId: 8,  type: 'ANNUAL',    startDate: dPlus(7),  endDate: dPlus(14),  note: 'Annual leave' }
];

// ---------------- Tasks ----------------
export const TASKS: Task[] = [
  { id: 1,  title: 'Migrate intranet DB host to SQL Server', description: 'Plan migration, test connection, schedule downtime.', status: 'IN_PROGRESS', priority: 'HIGH',     dueDate: dPlus(5),  assignedById: 4,  assigneeId: 5,  progressPercent: 40,  completionNote: 'Test connection working on staging', completedAt: null },
  { id: 2,  title: 'Backup schedule — daily at 02:00',       description: 'Configure scheduler with retention 7.',                 status: 'DONE',        priority: 'NORMAL',   dueDate: dPlus(-1), assignedById: 4,  assigneeId: 5,  progressPercent: 100, completionNote: 'Live',                            completedAt: '2026-09-25T10:00:00' },
  { id: 3,  title: 'Room booking conflict tests',              description: 'Cover FCFS, holiday, same-room overlap.',                status: 'IN_PROGRESS', priority: 'NORMAL',   dueDate: dPlus(7),  assignedById: 11, assigneeId: 12, progressPercent: 60,  completionNote: 'FCFS + overlap tests pass; holiday pending', completedAt: null },
  { id: 4,  title: 'ICS feed for bookings',                    description: 'Add /bookings/calendar.ics endpoint.',                   status: 'OPEN',        priority: 'NORMAL',   dueDate: dPlus(10), assignedById: 4,  assigneeId: 6,  progressPercent: 0,   completionNote: '',                                  completedAt: null },
  { id: 5,  title: 'Identity & SSO admin review',              description: 'Validate Mixed + Graph diagnostics flow.',               status: 'OPEN',        priority: 'HIGH',     dueDate: dPlus(3),  assignedById: 4,  assigneeId: 4,  progressPercent: 20,  completionNote: 'Drafted tab structure',           completedAt: null },
  { id: 6,  title: 'Faculty Office facilities walkthrough',    description: 'Confirm projector, whiteboard setups.',                   status: 'OPEN',        priority: 'LOW',      dueDate: dPlus(14), assignedById: 14, assigneeId: 15, progressPercent: 0,   completionNote: '',                                  completedAt: null },
  { id: 7,  title: 'Quarterly inventory of iPads',             description: 'Count devices in storage vs issued.',                     status: 'IN_PROGRESS', priority: 'NORMAL',   dueDate: dPlus(20), assignedById: 14, assigneeId: 16, progressPercent: 30,  completionNote: 'Storage count done',              completedAt: null },
  { id: 8,  title: 'Onboarding doc refresh',                   description: 'Update IT onboarding one-pager for v0928 changes.',        status: 'OPEN',        priority: 'NORMAL',   dueDate: dPlus(8),  assignedById: 1,  assigneeId: 2,  progressPercent: 0,   completionNote: '',                                  completedAt: null },
  { id: 9,  title: 'Vendor proposal evaluation',               description: 'Score 3 vendors for AV refresh.',                         status: 'OPEN',        priority: 'NORMAL',   dueDate: dPlus(12), assignedById: 8,  assigneeId: 9,  progressPercent: 10,  completionNote: 'RFI sent',                        completedAt: null },
  { id: 10, title: 'Year-end accounts reconciliation',          description: 'Match invoices, prep handover binder.',                   status: 'DONE',        priority: 'HIGH',     dueDate: dPlus(-2), assignedById: 8,  assigneeId: 10, progressPercent: 100, completionNote: 'Submitted',                       completedAt: '2026-09-28T17:00:00' }
];

// ---------------- Task progress history ----------------
export const TASK_PROGRESS: TaskProgress[] = [
  { id: 1, taskId: 1, fromPercent: 0,  toPercent: 20, note: 'Drafted migration plan',              updatedById: 5,  createdAt: '2026-10-01T10:00:00' },
  { id: 2, taskId: 1, fromPercent: 20, toPercent: 40, note: 'Test connection working on staging',  updatedById: 5,  createdAt: '2026-10-04T15:30:00' },
  { id: 3, taskId: 3, fromPercent: 0,  toPercent: 30, note: 'FCFS test plan drafted',               updatedById: 12, createdAt: '2026-10-02T11:00:00' },
  { id: 4, taskId: 3, fromPercent: 30, toPercent: 60, note: 'FCFS + overlap tests pass',            updatedById: 12, createdAt: '2026-10-05T09:15:00' },
  { id: 5, taskId: 5, fromPercent: 0,  toPercent: 20, note: 'Drafted tab structure',                updatedById: 4,  createdAt: '2026-10-03T14:00:00' },
  { id: 6, taskId: 7, fromPercent: 0,  toPercent: 30, note: 'Storage count done',                   updatedById: 16, createdAt: '2026-10-03T10:00:00' },
  { id: 7, taskId: 9, fromPercent: 0,  toPercent: 10, note: 'RFI sent',                             updatedById: 9,  createdAt: '2026-10-04T16:45:00' }
];

// ---------------- Announcements ----------------
export const ANNOUNCEMENTS: Announcement[] = [
  { id: 1, title: 'IT maintenance window — 2026-10-12',         body: 'The intranet will be unavailable from 02:00 to 04:00 for scheduled DB migration. SSO login will be paused during this window.', fileUrl: 'https://intranet.engg.hku.hk/files/maintenance-2026-10-12.pdf', fileLabel: 'Maintenance plan (PDF)',  postedById: 4,  createdAt: '2026-10-01T09:00:00' },
  { id: 2, title: 'Quarterly all-staff town hall — 2026-10-20', body: 'Join the Dean for the Q4 town hall. Agenda includes the digital workspace refresh and the new task management workflow demo.', fileUrl: 'https://intranet.engg.hku.hk/files/townhall-q4-2026.pptx',     fileLabel: 'Town hall slides (PPTX)', postedById: 1,  createdAt: '2026-10-02T11:30:00' },
  { id: 3, title: 'New iPads available for booking',            body: 'Facilities has provisioned 8 new iPads. Add them to your room booking via the quantities field.',                                              fileUrl: '',                                                                          fileLabel: '',                     postedById: 14, createdAt: '2026-10-03T08:15:00' },
  { id: 4, title: 'Annual leave reminder — submit by 2026-11-15', body: 'Submit your annual leave requests by mid-November. Team leads will balance coverage.',                                                fileUrl: 'https://intranet.engg.hku.hk/files/leave-policy-2026.pdf',     fileLabel: 'Leave policy (PDF)',     postedById: 11, createdAt: '2026-09-28T16:00:00' }
];

// ---------------- Notifications ----------------
export const NOTIFICATIONS: Notification[] = [
  { id: 1, recipientId: 4,  subject: 'IT support requested — RB-3',          message: 'IT steering meeting flagged IT support.',                channel: 'IN_APP', link: '/bookings/detail.html?id=3', read: false, createdAt: '2026-10-05T09:35:00' },
  { id: 2, recipientId: 5,  subject: 'Daily leave report — 2026-10-06',     message: '3 staff on leave, 4 bookings today.',                   channel: 'EMAIL',  link: '/bookings/index.html',       read: false, createdAt: '2026-10-06T08:00:00' },
  { id: 3, recipientId: 5,  subject: 'Task due soon: Migrate intranet DB',   message: 'Due within 5 days.',                                    channel: 'IN_APP', link: '/tasks/mine.html',            read: false, createdAt: '2026-10-06T09:00:00' },
  { id: 4, recipientId: 5,  subject: 'Backup completed successfully',         message: 'Last backup at 02:00 (10 MB zip).',                     channel: 'IN_APP', link: '/admin/backup.html',          read: true,  createdAt: '2026-10-06T02:05:00' },
  { id: 5, recipientId: 11, subject: 'Monday two-week leave report',         message: 'OA Admin — 2 staff on leave next 14 days.',              channel: 'EMAIL',  link: '/leave/index.html',           read: false, createdAt: '2026-10-06T10:00:00' },
  { id: 6, recipientId: 4,  subject: 'Graph connection test: GOOD',          message: 'Tenant/Client/Secret/Token/Permissions all GOOD.',     channel: 'IN_APP', link: '/admin/sso.html',             read: true,  createdAt: '2026-09-29T14:00:00' },
  { id: 7, recipientId: 5,  subject: 'Task due soon: ICS feed for bookings', message: 'Due within 10 days.',                                   channel: 'IN_APP', link: '/tasks/mine.html',            read: false, createdAt: '2026-10-06T09:00:00' },
  { id: 8, recipientId: 7,  subject: 'Audit log ready',                      message: '12 audit events recorded in the last 24h.',            channel: 'IN_APP', link: '/admin/audit.html',           read: true,  createdAt: '2026-10-05T18:00:00' }
];

// ---------------- Singleton configs ----------------
export const SSO_CONFIG: SsoConfig = {
  mode: 'MIXED',
  directoryMode: 'GRAPH',
  tenantId: '11111111-2222-3333-4444-555555555555',
  authorityUrl: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555',
  clientId: 'hk-engg-intranet-app',
  clientSecretMasked: '***********abcd',
  lastTestedAt: '2026-09-29T14:00:00',
  lastTestResult: 'GOOD — Tenant/Client/Secret/Token/Permissions all passed.'
};

export const DATABASE_CONFIG: DatabaseConfig = {
  dbType: 'SQLITE',
  host: '',
  databaseName: '',
  port: 1433,
  username: '',
  passwordMasked: '',
  encrypt: true,
  trustServerCertificate: true,
  lastTestedAt: null,
  lastTestResult: ''
};

export const BACKUP_CONFIG: BackupConfig = {
  enabled: true,
  frequency: 'DAILY',
  hourOfDay: 2,
  dayOfWeek: 1,
  customCron: '',
  retentionCount: 7,
  targetDirectory: './data/backups',
  lastBackupAt: '2026-10-06T02:05:00',
  lastBackupResult: 'OK (10 MB)'
};

export const TASK_SETTINGS: TaskSettings = {
  taskDeadlineAlertDays: 14
};

// ---------------- Audit + system logs ----------------
export const AUDIT_EVENTS: AuditEvent[] = [
  { id: 1,  createdAt: '2026-10-06T10:00:00', actorUsername: 'oa_lead',  actorUserId: 11, actionType: 'LEAVE_CREATE',  resourceType: 'LeaveRecord', resourceId: '3',   summary: 'Marked annual leave',     ipAddress: '10.0.0.21', success: true },
  { id: 2,  createdAt: '2026-10-06T09:30:00', actorUsername: 'it_lead',  actorUserId: 4,  actionType: 'BOOKING_CREATE', resourceType: 'RoomBooking', resourceId: '3',   summary: 'IT steering meeting',     ipAddress: '10.0.0.5',  success: true },
  { id: 3,  createdAt: '2026-10-06T09:00:00', actorUsername: 'system',   actorUserId: null, actionType: 'TASK_DEADLINE_REMINDER', resourceType: 'Task', resourceId: '', summary: 'Daily task reminder sent', ipAddress: '', success: true },
  { id: 4,  createdAt: '2026-10-06T08:00:00', actorUsername: 'system',   actorUserId: null, actionType: 'MORNING_DIGEST', resourceType: 'Notification', resourceId: '', summary: 'Morning digest sent to enabled users', ipAddress: '', success: true },
  { id: 5,  createdAt: '2026-10-06T02:05:00', actorUsername: 'system',   actorUserId: null, actionType: 'BACKUP_RUN',     resourceType: 'Backup',      resourceId: '', summary: 'Scheduled backup OK (10 MB)', ipAddress: '', success: true },
  { id: 6,  createdAt: '2026-10-05T17:30:00', actorUsername: 'acc2',     actorUserId: 10, actionType: 'LOGIN',          resourceType: 'Session',      resourceId: '', summary: 'SSO login',              ipAddress: '', success: true },
  { id: 7,  createdAt: '2026-10-05T17:25:00', actorUsername: 'unknown',  actorUserId: null, actionType: 'LOGIN_FAIL',     resourceType: 'Session',      resourceId: '', summary: 'Invalid credentials',    ipAddress: '10.0.0.99', success: false },
  { id: 8,  createdAt: '2026-10-05T15:30:00', actorUsername: 'it1',      actorUserId: 5,  actionType: 'TASK_PROGRESS',  resourceType: 'Task',         resourceId: '1',   summary: '40% — test on staging',  ipAddress: '10.0.0.5', success: true },
  { id: 9,  createdAt: '2026-10-05T14:00:00', actorUsername: 'it_lead',  actorUserId: 4,  actionType: 'SSO_TEST',       resourceType: 'SsoConfig',    resourceId: '1',   summary: 'Graph connection GOOD',  ipAddress: '10.0.0.5', success: true },
  { id: 10, createdAt: '2026-10-05T09:00:00', actorUsername: 'dean',     actorUserId: 1,  actionType: 'ANNOUNCEMENT_CREATE', resourceType: 'Announcement', resourceId: '2', summary: 'Town hall notice',  ipAddress: '10.0.0.2', success: true },
  { id: 11, createdAt: '2026-10-04T15:30:00', actorUsername: 'it1',      actorUserId: 5,  actionType: 'TASK_PROGRESS',  resourceType: 'Task',         resourceId: '1',   summary: '20% — drafted plan',    ipAddress: '10.0.0.5', success: true },
  { id: 12, createdAt: '2026-10-04T11:00:00', actorUsername: 'it_lead',  actorUserId: 4,  actionType: 'ROOM_EDIT',      resourceType: 'Room',         resourceId: '1',   summary: 'Set max seats = 12',   ipAddress: '10.0.0.5', success: true },
  { id: 13, createdAt: '2026-10-03T14:00:00', actorUsername: 'it_lead',  actorUserId: 4,  actionType: 'DATABASE_TEST',  resourceType: 'DatabaseConfig', resourceId: '1', summary: 'SQLServer probe GOOD', ipAddress: '10.0.0.5', success: true },
  { id: 14, createdAt: '2026-10-02T18:00:00', actorUsername: 'auditor1', actorUserId: 7,  actionType: 'LOGIN',          resourceType: 'Session',      resourceId: '', summary: 'SSO login',              ipAddress: '10.0.0.7', success: true },
  { id: 15, createdAt: '2026-10-02T09:00:00', actorUsername: 'oa1',      actorUserId: 12, actionType: 'TASK_PROGRESS',  resourceType: 'Task',         resourceId: '3',   summary: '60% — overlap tests',   ipAddress: '10.0.0.21', success: true },
  { id: 16, createdAt: '2026-10-01T16:30:00', actorUsername: 'it_lead',  actorUserId: 4,  actionType: 'BACKUP_RESTORE', resourceType: 'Backup',      resourceId: '', summary: 'Restored from zip',      ipAddress: '10.0.0.5', success: true }
];

export const SYSTEM_LOGS: SystemLog[] = [
  { id: 1,  createdAt: '2026-10-06T10:00:00', level: 'INFO',     category: 'HTTP',     message: 'GET /dashboard → 200',                              detail: '',                                                resolved: false },
  { id: 2,  createdAt: '2026-10-06T09:30:00', level: 'INFO',     category: 'GENERAL',  message: 'Booking RB-0003 created by it_lead',                detail: 'IT support=true',                                  resolved: false },
  { id: 3,  createdAt: '2026-10-06T08:00:00', level: 'INFO',     category: 'GENERAL',  message: 'Morning team digest sent to 17 users',             detail: '',                                                resolved: false },
  { id: 4,  createdAt: '2026-10-06T02:05:00', level: 'INFO',     category: 'BACKUP',   message: 'Backup completed',                                  detail: '10 MB written to ./data/backups/intranet-2026-10-06.zip', resolved: false },
  { id: 5,  createdAt: '2026-10-05T17:25:00', level: 'WARN',     category: 'SECURITY', message: 'Failed login attempt for unknown user',            detail: 'ip=10.0.0.99',                                     resolved: true  },
  { id: 6,  createdAt: '2026-10-05T14:00:00', level: 'INFO',     category: 'ENTRA',    message: 'Graph connection test GOOD',                        detail: 'tenant/client/secret/token OK',                     resolved: false },
  { id: 7,  createdAt: '2026-10-04T17:00:00', level: 'WARN',     category: 'DB',       message: 'SQLServer probe timeout (probe not on net)',         detail: 'host=sqlserver.engg.hku.hk',                        resolved: true  },
  { id: 8,  createdAt: '2026-10-04T11:00:00', level: 'ERROR',    category: 'DB',       message: 'SQLServer unreachable; fell back to SQLite',        detail: '',                                                  resolved: true  },
  { id: 9,  createdAt: '2026-10-03T14:00:00', level: 'INFO',     category: 'DB',       message: 'DatabaseConfig.testConnection OK',                  detail: 'SQLServer 15.0.1800',                              resolved: false },
  { id: 10, createdAt: '2026-10-02T09:00:00', level: 'CRITICAL', category: 'SECURITY', message: 'Multiple failed login attempts from single IP',    detail: 'ip=10.0.0.99 — 5 fails in 60s',                    resolved: true  }
];

// ---------------- Lookup helpers ----------------
export const userById = (id: number | null | undefined) => USERS.find(u => u.id === id) || null;
export const userByName = (username: string) => USERS.find(u => u.username === username) || null;
export const roomById = (id: number | null | undefined) => ROOMS.find(r => r.id === id) || null;
