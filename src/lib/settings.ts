// Settings module — task alert days, holidays, database, backup. LS persistence.
import type { TaskSettings, Holiday, DatabaseConfig, BackupConfig } from './types';
import { TASK_SETTINGS, HOLIDAYS_FLAT, DATABASE_CONFIG, BACKUP_CONFIG } from './data';

const LS_KEY_SETTINGS = 'engg_user_settings';
const LS_KEY_HOLIDAYS = 'engg_user_holidays';
const LS_KEY_DATABASE = 'engg_user_database_config';
const LS_KEY_BACKUP = 'engg_user_backup_config';

function loadUserSettings(): Partial<TaskSettings> | null {
  try { return JSON.parse(localStorage.getItem(LS_KEY_SETTINGS) || 'null'); } catch { return null; }
}
function persistUserSettings(s: Partial<TaskSettings>): void {
  try { localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
}

function loadUserHolidays(): Holiday[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY_HOLIDAYS) || '[]'); } catch { return []; }
}
function persistUserHolidays(list: Holiday[]): void {
  try { localStorage.setItem(LS_KEY_HOLIDAYS, JSON.stringify(list)); } catch { /* ignore */ }
}

function loadUserDatabase(): DatabaseConfig | null {
  try { return JSON.parse(localStorage.getItem(LS_KEY_DATABASE) || 'null'); } catch { return null; }
}
function loadUserBackup(): BackupConfig | null {
  try { return JSON.parse(localStorage.getItem(LS_KEY_BACKUP) || 'null'); } catch { return null; }
}

export const Settings = {
  // ---- Task settings ----
  taskSettings(): TaskSettings {
    const override = loadUserSettings();
    return { ...TASK_SETTINGS, ...(override || {}) };
  },
  setTaskDeadlineAlertDays(days: number): TaskSettings {
    const v = Math.max(1, Math.min(90, Math.round(days)));
    persistUserSettings({ taskDeadlineAlertDays: v });
    return this.taskSettings();
  },

  // ---- Holidays ----
  holidays(): Holiday[] {
    // Merge seed + user (added) + user (removed, by date)
    const removed: string[] = (() => {
      try { return JSON.parse(localStorage.getItem(LS_KEY_HOLIDAYS + '_removed') || '[]'); } catch { return []; }
    })();
    const added = loadUserHolidays();
    const removedSet = new Set(removed);
    return [
      ...HOLIDAYS_FLAT.filter(h => !removedSet.has(h.date)),
      ...added
    ].sort((a, b) => a.date.localeCompare(b.date));
  },

  holidaysForYear(year: number): Holiday[] {
    return this.holidays().filter(h => h.date.startsWith(String(year)));
  },

  addHoliday(date: string, name: string): Holiday | null {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    if (!name.trim()) return null;
    const trimmed = name.trim().slice(0, 100);
    const existing = this.holidays();
    if (existing.some(h => h.date === date)) return existing.find(h => h.date === date) || null;
    const h: Holiday = { date, name: trimmed };
    const list = loadUserHolidays();
    list.push(h);
    persistUserHolidays(list);
    return h;
  },

  removeHoliday(date: string): boolean {
    // Try removing from user-added list first
    const added = loadUserHolidays();
    const ai = added.findIndex(h => h.date === date);
    if (ai >= 0) {
      added.splice(ai, 1);
      persistUserHolidays(added);
      return true;
    }
    // Otherwise, mark the seed holiday as removed
    try {
      const removedRaw = localStorage.getItem(LS_KEY_HOLIDAYS + '_removed');
      const removed: string[] = removedRaw ? JSON.parse(removedRaw) : [];
      if (!removed.includes(date)) {
        removed.push(date);
        localStorage.setItem(LS_KEY_HOLIDAYS + '_removed', JSON.stringify(removed));
      }
      return true;
    } catch {
      return false;
    }
  },

  resetHolidays(): void {
    localStorage.removeItem(LS_KEY_HOLIDAYS);
    localStorage.removeItem(LS_KEY_HOLIDAYS + '_removed');
  },

  // ---- Database connection ----
  databaseConfig(): DatabaseConfig {
    const override = loadUserDatabase();
    return override ? { ...DATABASE_CONFIG, ...override } : DATABASE_CONFIG;
  },
  setDatabaseConfig(cfg: DatabaseConfig): DatabaseConfig {
    try { localStorage.setItem(LS_KEY_DATABASE, JSON.stringify(cfg)); } catch { /* ignore */ }
    return this.databaseConfig();
  },
  // Simulated connection test — real version would issue a SELECT 1; here we
  // set lastTestedAt and a result message so the UI feels live.
  testDatabaseConnection(cfg: DatabaseConfig): DatabaseConfig {
    const result = (() => {
      if (cfg.dbType === 'SQLITE') return 'GOOD — SQLite file reachable.';
      if (!cfg.host) return 'FAIL — host is required for SQL Server.';
      if (!cfg.databaseName) return 'FAIL — database name is required.';
      if (cfg.host.includes('localhost') || cfg.host.includes('127.0.0.1')) return 'GOOD — local SQL Server reachable.';
      if (cfg.host.includes('sqlserver.engg.hku')) return 'GOOD — SQLServer 15.0.1800 reachable.';
      if (/\.103(\b|$|:|\/)/.test(cfg.host) || cfg.host === '.103') return 'GOOD — production SQL Server reachable (.103).';
      return 'WARN — host probe timed out; verify network/VPN.';
    })();
    const next: DatabaseConfig = {
      ...cfg,
      lastTestedAt: new Date().toISOString(),
      lastTestResult: result
    };
    this.setDatabaseConfig(next);
    return next;
  },
  resetDatabase(): void {
    try { localStorage.removeItem(LS_KEY_DATABASE); } catch { /* ignore */ }
  },

  // ---- Backup schedule + actions ----
  backupConfig(): BackupConfig {
    const override = loadUserBackup();
    return override ? { ...BACKUP_CONFIG, ...override } : BACKUP_CONFIG;
  },
  setBackupConfig(cfg: BackupConfig): BackupConfig {
    try { localStorage.setItem(LS_KEY_BACKUP, JSON.stringify(cfg)); } catch { /* ignore */ }
    return this.backupConfig();
  },
  runBackupNow(): BackupConfig {
    const current = this.backupConfig();
    // Pseudo size — in a real app this comes from the backup engine.
    const sizeMb = 9 + Math.floor(Math.random() * 4);
    const next: BackupConfig = {
      ...current,
      lastBackupAt: new Date().toISOString(),
      lastBackupResult: `OK (${sizeMb} MB)`
    };
    this.setBackupConfig(next);
    return next;
  },
  resetBackup(): void {
    try { localStorage.removeItem(LS_KEY_BACKUP); } catch { /* ignore */ }
  }
};