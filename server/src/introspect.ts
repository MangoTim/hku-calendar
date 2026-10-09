// Read-only database introspection — schema/tables/columns/relationships +
// sample rows. Exposed via /api/db/* in index.ts. Schema scope defaults to
// 'public' and is overridable via DB_INSPECT_SCHEMA. SQL injection is guarded
// by an allow-list cache that is refreshed on every /api/db/overview call and
// consulted BEFORE any table-name identifier is interpolated.
import { getPool } from './db.ts';

export interface TableMeta {
  name: string;
  kind: 'table' | 'view';
  /** Approximate row count from pg_class.reltuples (refreshed by ANALYZE). */
  rowCount: number;
  columns: ColumnMeta[];
}

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
}

export interface IndexMeta {
  name: string;
  definition: string;
  columns: string[];
}

export interface ForeignKey {
  constraintName: string;
  fromSchema: string;
  fromTable: string;
  fromColumns: string[];
  toSchema: string;
  toTable: string;
  toColumns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface SampleResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  returned: number;
}

const SCHEMA = process.env.DB_INSPECT_SCHEMA || 'public';

// ---- allow-list cache ----
// Refreshed on every /api/db/overview call. The cache is consulted BEFORE
// any table-name identifier is interpolated on the sample/count endpoints,
// so a crafted `?table=…` param cannot reach the SQL layer.
let allowList: Set<string> = new Set();
let allowListAt: number = 0;
const ALLOWLIST_STALE_MS = 60_000;

export function isAllowedTable(name: string): boolean {
  return allowList.has(name);
}
export function allowListSize(): number {
  return allowList.size;
}

export async function refreshAllowList(): Promise<void> {
  const tables = await listTables(SCHEMA);
  allowList = new Set(tables.map(t => t.name));
  allowListAt = Date.now();
}

async function ensureAllowList(): Promise<void> {
  if (Date.now() - allowListAt > ALLOWLIST_STALE_MS || allowList.size === 0) {
    await refreshAllowList();
  }
}

// ---- tables ----
export async function listTables(schema = SCHEMA): Promise<TableMeta[]> {
  const pool = getPool();
  // pg_class.reltuples is an estimate kept up-to-date by ANALYZE. For the
  // demo DB it's accurate enough; for exact counts use /api/db/tables/:t/count.
  const r = await pool.query<{ table_name: string; table_type: string; n_live_tup: string | null }>(
    `SELECT t.table_name,
            t.table_type,
            c.reltuples::bigint::text AS n_live_tup
       FROM information_schema.tables t
       LEFT JOIN pg_class c
              ON c.relname = t.table_name
             AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.table_schema)
      WHERE t.table_schema = $1
        AND t.table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY t.table_name ASC`,
    [schema]
  );
  return r.rows.map(row => ({
    name: row.table_name,
    kind: row.table_type === 'VIEW' ? 'view' : 'table',
    // pg_class.reltuples is -1 for any relation that has never been ANALYZE'd.
    // Pass that signal through so the frontend can render "?" instead of
    // misleading "~0 rows". The Math.max(0, …) clamp previously hid this.
    rowCount: row.n_live_tup == null ? -1 : Number(row.n_live_tup),
    columns: []
  }));
}

/**
 * listAllTablesWithColumns — adds per-table column metadata (one roundtrip
 * per table) AND exact row counts (COUNT(*)). For the demo's ~6 user tables
 * this is cheap. Used by the /api/db/overview response so the React
 * inspector can render the whole tree without per-expand network calls.
 *
 * We use COUNT(*) rather than pg_class.reltuples because reltuples is -1
 * for any relation that has never been ANALYZE'd, and for a small demo DB
 * autovacuum may never have run on a freshly-imported table — the user
 * sees "~0 rows" for a table that actually has 200 rows. For huge tables
 * the frontend can fall back to /api/db/tables/:t/count on demand.
 */
export async function listAllTablesWithColumns(schema = SCHEMA): Promise<TableMeta[]> {
  const tables = await listTables(schema);
  await Promise.all(tables.map(async t => {
    t.columns = await listColumns(schema, t.name);
    try {
      t.rowCount = await countRows(t.name);
    } catch {
      // countRows may throw if the table is in the allow-list but no longer
      // queryable (e.g. dropped between refresh and now). Leave rowCount as
      // -1 so the frontend renders "?" instead of misleading "~0 rows".
    }
  }));
  return tables;
}

// ---- columns ----
export async function listColumns(schema = SCHEMA, table: string): Promise<ColumnMeta[]> {
  await ensureAllowList();
  if (!allowList.has(table)) {
    throw new Error(`table not in allow-list: ${table}`);
  }
  const pool = getPool();
  const cols = await pool.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    ordinal_position: number;
  }>(
    `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position ASC`,
    [schema, table]
  );
  const pk = await pool.query<{ column_name: string }>(
    `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'PRIMARY KEY'`,
    [schema, table]
  );
  const pkCols = new Set(pk.rows.map(r => r.column_name));
  return cols.rows.map(r => ({
    name: r.column_name,
    type: r.data_type,
    nullable: r.is_nullable === 'YES',
    default: r.column_default,
    isPrimaryKey: pkCols.has(r.column_name)
  }));
}

// ---- indexes ----
export async function listIndexes(schema = SCHEMA, table: string): Promise<IndexMeta[]> {
  await ensureAllowList();
  if (!allowList.has(table)) {
    throw new Error(`table not in allow-list: ${table}`);
  }
  const pool = getPool();
  const r = await pool.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = $1 AND tablename = $2
      ORDER BY indexname ASC`,
    [schema, table]
  );
  return r.rows.map(row => {
    const cols = extractIndexColumns(row.indexdef);
    return { name: row.indexname, definition: row.indexdef, columns: cols };
  });
}

function extractIndexColumns(def: string): string[] {
  // Capture the LAST parenthesised token of the CREATE INDEX statement —
  // good enough for plain btree on (col1, col2) and functional expressions
  // like (LOWER(col)).
  const m = def.match(/\(([^)]+)\)\s*$/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map(s => s.trim())
    .map(s => s.replace(/^"(.*)"$/, '$1').replace(/\s+COLLATE\s+"[^"]+"/i, ''));
}

// ---- FKs (across the whole schema, one roundtrip) ----
export async function listForeignKeys(schema = SCHEMA): Promise<ForeignKey[]> {
  const pool = getPool();
  // PostgreSQL doesn't aggregate key columns inside a single information_schema
  // row, so use string_agg over a correlated sub-select.
  const r = await pool.query<{
    constraint_name: string;
    from_schema: string;
    from_table: string;
    from_columns: string | null;
    to_schema: string;
    to_table: string;
    to_columns: string | null;
    on_delete: string;
    on_update: string;
  }>(
    `SELECT
       tc.constraint_name,
       tc.table_schema AS from_schema,
       tc.table_name   AS from_table,
       (SELECT string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position)
          FROM information_schema.key_column_usage kcu
         WHERE kcu.constraint_name = tc.constraint_name
           AND kcu.table_schema = tc.table_schema) AS from_columns,
       ccu.table_schema AS to_schema,
       ccu.table_name   AS to_table,
       (SELECT string_agg(kcu2.column_name, ',' ORDER BY kcu2.ordinal_position)
          FROM information_schema.key_column_usage kcu2
         WHERE kcu2.constraint_name = ccu.constraint_name
           AND kcu2.table_schema = ccu.table_schema) AS to_columns,
       rc.delete_rule AS on_delete,
       rc.update_rule AS on_update
     FROM information_schema.table_constraints tc
     JOIN information_schema.referential_constraints rc
            ON tc.constraint_name = rc.constraint_name
           AND tc.table_schema = rc.constraint_schema
     JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = rc.unique_constraint_name
           AND ccu.table_schema = rc.unique_constraint_schema
     WHERE tc.table_schema = $1
       AND tc.constraint_type = 'FOREIGN KEY'
     ORDER BY tc.table_name, tc.constraint_name`,
    [schema]
  );
  return r.rows.map(row => ({
    constraintName: row.constraint_name,
    fromSchema: row.from_schema,
    fromTable: row.from_table,
    fromColumns: (row.from_columns || '').split(',').filter(Boolean),
    toSchema: row.to_schema,
    toTable: row.to_table,
    toColumns: (row.to_columns || '').split(',').filter(Boolean),
    onDelete: row.on_delete,
    onUpdate: row.on_update
  }));
}

// ---- sample rows ----
// allow-list gate happens BEFORE any identifier interpolation. The "table"
// arg is double-quoted manually — `replace(/"/g, '""')` — for extra safety,
// but the allow-list check is the actual SQL-injection firewall.
export async function sampleRows(table: string, limit: number, offset: number): Promise<SampleResult> {
  await ensureAllowList();
  if (!allowList.has(table)) {
    throw new Error(`table not in allow-list: ${table}`);
  }
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const ident = `"${table.replace(/"/g, '""')}"`;
  const pool = getPool();
  // ORDER BY 1: PostgreSQL column ordering is stable within a session. For
  // the demo DB the first column is always a small fixed type (id, date,
  // name). If the schema ever changes shape, the preview order shifts —
  // acceptable for a read-only inspector on a static demo DB.
  const data = await pool.query(`SELECT * FROM ${ident} ORDER BY 1 LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]);
  const meta = await pool.query<{ name: string; type: string }>(
    `SELECT column_name AS name, data_type AS type
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position ASC`,
    [SCHEMA, table]
  );
  return {
    columns: meta.rows,
    rows: data.rows.map(row => {
      // Marshal Date → ISO string so JSON serialisation is clean. Numbers,
      // strings, booleans, nulls pass through verbatim.
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v instanceof Date ? v.toISOString() : v;
      }
      return out;
    }),
    returned: data.rowCount ?? 0
  };
}

// ---- count ----
export async function countRows(table: string): Promise<number> {
  await ensureAllowList();
  if (!allowList.has(table)) {
    throw new Error(`table not in allow-list: ${table}`);
  }
  const ident = `"${table.replace(/"/g, '""')}"`;
  const pool = getPool();
  const r = await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${ident}`);
  return Number(r.rows[0].c);
}
