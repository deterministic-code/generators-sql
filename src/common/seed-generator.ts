import { createHash } from "node:crypto";
import { sqlStringLiteral } from "../base-type-converter.ts";
import { fill } from "@deterministic-code/generators-common/fill";
import type {
  DatasourceField,
  SeedRow,
  SeedValue,
} from "@deterministic-code/generators-common/specification";
import { dialectConverter, q, sqlDefault, type SqlDialect } from "./sql-dialect.ts";
import {
  datasourceSettingsFor,
  type DatasourceOptions,
  type LiveTable,
} from "./sql-schema.ts";
import {
  insertSeedTmpl,
} from "../resources/sql.ts";
import { renderSeedAfter, renderSeedBefore } from "./render-ddl.ts";

type SeedCell = {
  row: Record<string, unknown>;
  col: string;
};

const SEED_UUID_NAMESPACE = "9b3a8e6c-2f1d-4a5b-8c9d-1e2f3a4b5c6d";

const SEED_VALUE: Record<
  string,
  (dialect: SqlDialect, value: SeedValue) => string
> = {
  boolean: (dialect, value) =>
    dialectConverter(dialect).conversions.boolean.defaults.Boolean(
      value ? "true" : "false",
    ),
  number: (_dialect, value) => String(value),
  reference: (_dialect, value) => String(value),
};

const SEED_ID: Record<string, (source: string, id: number) => string> = {
  uuid: (source, id) => sqlStringLiteral(seedUuid(source, id)),
  string: (_source, id) => sqlStringLiteral(String(id)),
};

const uuidStringToBytes = (uuid: string): Buffer => {
  const hex = uuid.replace(/-/g, "");
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const bytesToUuidString = (bytes: Buffer): string => {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const seedUuid = (tableName: string, id: number): string => {
  const ns = uuidStringToBytes(SEED_UUID_NAMESPACE);
  const name = Buffer.from(`${tableName}:${id}`, "utf8");
  const hash = createHash("sha1")
    .update(Buffer.concat([ns, name]))
    .digest();
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuidString(bytes);
};

const hasAuditColumns = (table: LiveTable, occ: boolean): boolean => {
  if (table.datasourceType === "readonly-lookup") return false;
  const hasCustomPk = table.fields.some(
    (f) => f.isPrimaryKey && f.name !== "id",
  );
  if (!hasCustomPk) return true;
  if (table.datasourceType === "many-to-many") return false;
  return table.optimisticConcurrency ?? occ;
};

/** INSERT seed rows (and sequenced-id wraps) for one dialect. */
class SeedGenerator {
  readonly dialect: SqlDialect;
  readonly idType: string;
  readonly withUuidColumn: boolean;
  readonly occ: boolean;

  constructor(dialect: SqlDialect, opts: DatasourceOptions = {}) {
    const settings = datasourceSettingsFor(opts);
    this.dialect = dialect;
    this.idType = settings.idType;
    this.withUuidColumn = opts.withUuidColumn ?? settings.withUuidColumn;
    this.occ = opts.useOptimisticConcurrency === true;
  }

  generate(table: LiveTable, seeds: SeedRow[]): string[] {
    if (seeds.length === 0) return [];
    const out: string[] = [];
    const sequenced = this.idType !== "uuid" && this.idType !== "string";
    const quoted = q(this.dialect, table.tableName);

    if (sequenced) {
      const before = renderSeedBefore(this.dialect, quoted);
      if (before) out.push(before);
    }
    for (const seed of seeds) {
      out.push(this.insert(table, seed));
    }
    if (sequenced) {
      const after = renderSeedAfter(
        this.dialect,
        table.tableName,
        quoted,
      );
      if (after) out.push(after);
    }
    return out;
  }

  private insert(table: LiveTable, seed: SeedRow): string {
    const { id, row } = seed;
    const { cols, fieldByName } = this.colsForRow(table, row);
    const values = cols.map((c) => {
      if (c === "id") return this.idValue(table.name, id);
      if (c === "uuid") return sqlStringLiteral(seedUuid(table.name, id));
      return this.colValue(fieldByName.get(c), { row, col: c });
    });
    return fill(insertSeedTmpl, {
      quotedTable: q(this.dialect, table.tableName),
      colList: cols.map((c) => q(this.dialect, c)).join(", "),
      valueList: values.join(", "),
    }).trimEnd();
  }

  private colsForRow(
    table: LiveTable,
    row: Record<string, unknown>,
  ): { cols: string[]; fieldByName: Map<string, DatasourceField> } {
    const withAudit = hasAuditColumns(table, this.occ);
    const colNames = new Set<string>();
    if (this.withUuidColumn && withAudit) colNames.add("uuid");
    colNames.add("id");
    for (const k of Object.keys(row)) {
      if (k !== "id" && k !== "uuid") colNames.add(k);
    }
    return {
      cols: Array.from(colNames),
      fieldByName: new Map(
        table.fields.map((f): [string, DatasourceField] => [f.name, f]),
      ),
    };
  }

  private colValue(
    field: DatasourceField | undefined,
    cell: SeedCell,
  ): string | null {
    const { row, col } = cell;
    if (col === "id") return null;
    if (!field) return "NULL";
    const v = Object.prototype.hasOwnProperty.call(row, col) ? row[col] : null;
    if (v === null || v === undefined) {
      const dv = sqlDefault(this.dialect, field);
      return dv !== null ? dv : "NULL";
    }
    return this.renderValue(field, v as SeedValue);
  }

  private renderValue(field: DatasourceField, value: SeedValue): string {
    if (value === null || value === undefined) return "NULL";
    const render = SEED_VALUE[field.type];
    return render ? render(this.dialect, value) : sqlStringLiteral(value);
  }

  private idValue(source: string, id: number): string {
    const render = SEED_ID[this.idType];
    return render ? render(source, id) : String(id);
  }
}

/** Per-table seed SQL blocks for the initial migration (`-- Seeds: <table>`). */
export const seedSections = (
  dialect: SqlDialect,
  tables: LiveTable[],
  seeds: Map<string, SeedRow[]>,
  seedOpts: DatasourceOptions,
): string[] => {
  const gen = new SeedGenerator(dialect, seedOpts);
  const lines: string[] = [];
  for (const t of tables) {
    const sql = gen.generate(t, seeds.get(t.name) ?? []);
    if (sql.length === 0) continue;
    lines.push(`-- Seeds: ${t.tableName}`, sql.join("\n"), "");
  }
  return lines;
};
