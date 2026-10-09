// Shared TypeScript types for the HKU ENGG Intranet React port.

export type Role = 'USER' | 'TASK_MANAGER' | 'ADMIN' | 'AUDITOR';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'HIGH' | 'NORMAL' | 'LOW';
export type LeaveType =
  | 'ANNUAL' | 'SICK' | 'UNPAID' | 'MATERNITY'
  | 'PATERNITY' | 'COMPASSIONATE' | 'STUDY';
export type LeaveStatus = 'APPROVED' | 'CANCELLED';
export type BookingStatus = 'CONFIRMED' | 'CANCELLED';

export interface User {
  id: number;
  username: string;
  displayName: string;
  team: string;
  title: string;
  role: Role;
  source: 'LOCAL' | 'DEMO';
  enabled: boolean;
  morningTeamDigestEnabled: boolean;
  mondayTwoWeekLeaveReportEnabled: boolean;
}

export interface Session {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  team: string;
  title: string;
  source: 'LOCAL' | 'DEMO';
  loggedInAt: string;
}

export interface Room {
  id: number;
  name: string;
  building: string;
  maxSeats: number;
  active: boolean;
  notes: string;
}

export interface Booking {
  id: number;
  ref: string;
  roomId: number;
  bookedById: number;
  date: string;
  startTime: string;
  endTime: string;
  purpose: string;
  status: BookingStatus;
  supportRequests: string;
  itSupport: boolean;
  cupsOfTea: number;
  warmWater: number;
  coolWater: number;
  iPads: number;
  createdAt?: string;
}

export interface Leave {
  id: number;
  userId: number;
  type: LeaveType;
  startDate: string;
  endDate: string;
  note: string;
  status?: LeaveStatus;
  createdAt?: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  assignedById: number;
  assigneeId: number;
  progressPercent: number;
  completionNote: string;
  completedAt: string | null;
  createdAt?: string;
}

export interface TaskProgress {
  id: number;
  taskId: number;
  fromPercent: number;
  toPercent: number;
  note: string;
  updatedById: number;
  createdAt: string;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  fileUrl: string;
  fileLabel: string;
  postedById: number;
  createdAt: string;
}

export interface Notification {
  id: number;
  recipientId: number;
  subject: string;
  message: string;
  channel: 'IN_APP' | 'EMAIL';
  link: string;
  read: boolean;
  createdAt: string;
}

export interface Holiday {
  date: string;
  name: string;
  /** Present iff this holiday was added via a file import. Used by
   *  Settings.removeImport to find and delete every holiday from a given
   *  import in one shot. Manual / seed holidays leave this undefined. */
  importId?: string;
}

export interface HolidayImport {
  /** Short hash of the source file content — same file re-imported updates
   *  the existing record (idempotent). Different file = different id. */
  importId: string;
  /** Original filename for the UI ("hk-holidays.json"). */
  filename: string;
  /** Which parser produced this import. */
  format: HolidayFormat;
  /** ISO timestamp of the most recent import. */
  importedAt: string;
  /** Holidays currently in this import. Re-imports refresh this. */
  count: number;
}

export type HolidayFormat = 'vcalendar' | 'json' | 'csv' | 'xlsx';

export interface SsoConfig {
  mode: string;
  directoryMode: string;
  tenantId: string;
  authorityUrl: string;
  clientId: string;
  clientSecretMasked: string;
  lastTestedAt: string | null;
  lastTestResult: string;
}

export interface DatabaseConfig {
  dbType: string;
  host: string;
  databaseName: string;
  port: number;
  username: string;
  passwordMasked: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  lastTestedAt: string | null;
  lastTestResult: string;
}

export interface BackupConfig {
  enabled: boolean;
  frequency: string;
  hourOfDay: number;
  dayOfWeek: number;
  customCron: string;
  retentionCount: number;
  targetDirectory: string;
  lastBackupAt: string;
  lastBackupResult: string;
}

export interface TaskSettings {
  taskDeadlineAlertDays: number;
}

export interface AuditEvent {
  id: number;
  createdAt: string;
  actorUsername: string;
  actorUserId: number | null;
  actionType: string;
  resourceType: string;
  resourceId: string;
  summary: string;
  ipAddress: string;
  success: boolean;
}

export interface SystemLog {
  id: number;
  createdAt: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  category: string;
  message: string;
  detail: string;
  resolved: boolean;
}

// ---- Backup ----
// A backup is a JSON snapshot of the React app's localStorage override keys
// (rooms, bookings, leave, tasks, announcements, holidays, settings, etc).
// Stored on the API server (:8092) as a file under server/backups/.
export interface BackupSnapshot {
  version: 1;
  app: 'hk-engg-intranet';
  createdAt: string;
  label: string;
  keys: Record<string, unknown>;
}

export interface BackupMeta {
  id: string;
  createdAt: string;
  label: string;
  sizeBytes: number;
  counts: Record<string, number>;
}
