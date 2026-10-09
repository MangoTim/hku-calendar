// DB inspector client — read-only browser-side wrapper around /api/db/*.
// Reuses jsonFetch from ./fetch.ts (same pattern as audit + holidays clients).
import { jsonFetch } from './fetch';

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
}

export interface TableMeta {
  name: string;
  kind: 'table' | 'view';
  rowCount: number;
  columns: ColumnMeta[];
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

export interface OverviewResult {
  tables: TableMeta[];
  fkEdges: ForeignKey[];
  schema: string;
  allowListSize: number;
}

export interface SampleResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  returned: number;
}

export const Db = {
  async overview(): Promise<OverviewResult> {
    return jsonFetch<OverviewResult>('/api/db/overview');
  },
  async sampleRows(table: string, opts: { limit?: number; offset?: number } = {}): Promise<SampleResult> {
    const qs = new URLSearchParams();
    if (opts.limit != null) qs.set('limit', String(Math.min(50, Math.max(1, opts.limit))));
    if (opts.offset != null) qs.set('offset', String(Math.max(0, opts.offset)));
    return jsonFetch<SampleResult>(
      `/api/db/tables/${encodeURIComponent(table)}/sample?${qs.toString()}`
    );
  },
  async count(table: string): Promise<{ count: number }> {
    return jsonFetch<{ count: number }>(`/api/db/tables/${encodeURIComponent(table)}/count`);
  }
};
