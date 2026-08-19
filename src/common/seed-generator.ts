import { createHash } from "node:crypto";
import { converterFor } from "../field-converters/index.ts";
import {
  renderSqlDefault,
  sqlStringLiteral,
} from "../field-converters/base.ts";
import { fill } from "@deterministic-code/generators-common/fill";
import { q, type SqlDialect } from "./sql-dialect.ts";
import {
  datasourceSettingsFor,
  tableHasAuditColumns,
  type GenerateTableOptions,
  type NormalizedField,
  type NormalizedTable,
  type SeedValue,
} from "./sql-schema.ts";
import { insertSeedTmpl } from "../resources/sql.ts";

type SeedCell = {
  row: Record<string, unknown>;
  col: string;
};

type SeedRow = {
  id: number;
  row: Record<string, SeedValue>;
};

const SEED_UUID_NAMESPACE = "9b3a8e6c-2f1d-4a5b-8c9d-1e2f3a4b5c6d";

const SEED_VALUE: Record<
  string,
  (dialect: SqlDialect, value: SeedValue) => string
> = {
  boolean: (dialect, value) =>
    converterFor(dialect).defaults.Boolean(Boolean(value))!,
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

/** INSERT/UPDATE/DELETE (and sequenced-id wraps) for one dialect's seed rows. */
export class SeedGenerator {
  readonly dialect: SqlDialect;
  readonly idType: string;
  readonly withUuidColumn: boolean;

  constructor(dialect: SqlDialect, opts: GenerateTableOptions = {}) {
    const settings = datasourceSettingsFor(opts);
    this.dialect = dialect;
    this.idType = settings.idType;
    this.withUuidColumn = opts.withUuidColumn ?? settings.withUuidColumn;
  }

  generate(table: NormalizedTable): string[] {
    if (!table.seeds || table.seeds.length === 0) return [];
    const out: string[] = [];
    const sequenced = this.idType !== "uuid" && this.idType !== "string";
    const quoted = q(this.dialect, table.name);
    const conv = converterFor(this.dialect);

    if (sequenced) {
      const before = conv.seedBefore(quoted);
      if (before) out.push(before);
    }
    for (const { id, row } of table.seeds) {
      out.push(this.insert(table, { id, row }));
    }
    if (sequenced) {
      const after = conv.seedAfter(table.name, quoted);
      if (after) out.push(after);
    }
    return out;
  }

  insert(table: NormalizedTable, seed: SeedRow): string {
    const { id, row } = seed;
    const { cols, fieldByName } = this.colsForRow(table, row);
    const uuidSourceName = table.entityName ?? table.name;
    const values = cols.map((c) => {
      if (c === "id") return this.idValue(uuidSourceName, id);
      if (c === "uuid") return sqlStringLiteral(seedUuid(uuidSourceName, id));
      return this.colValue(fieldByName.get(c), { row, col: c });
    });
    return fill(insertSeedTmpl, {
      quotedTable: q(this.dialect, table.name),
      colList: cols.map((c) => q(this.dialect, c)).join(", "),
      valueList: values.join(", "),
    }).trimEnd();
  }

  update(table: NormalizedTable, seed: SeedRow): string {
    const { id, row } = seed;
    const fieldByName = new Map(
      table.fields.map((f): [string, NormalizedField] => [f.name, f]),
    );
    const assignments = Object.keys(row)
      .map(
        (col) =>
          `${q(this.dialect, col)} = ${this.colValue(fieldByName.get(col), { row, col })}`,
      )
      .join(", ");
    return `UPDATE ${q(this.dialect, table.name)} SET ${assignments} WHERE ${q(this.dialect, "id")} = ${id};`;
  }

  delete(table: NormalizedTable, id: number): string {
    return `DELETE FROM ${q(this.dialect, table.name)} WHERE ${q(this.dialect, "id")} = ${id};`;
  }

  private colsForRow(
    table: NormalizedTable,
    row: Record<string, unknown>,
  ): { cols: string[]; fieldByName: Map<string, NormalizedField> } {
    const withAudit = tableHasAuditColumns(table);
    const colNames = new Set<string>();
    if (this.withUuidColumn && withAudit) colNames.add("uuid");
    colNames.add("id");
    for (const k of Object.keys(row)) {
      if (k !== "id" && k !== "uuid") colNames.add(k);
    }
    return {
      cols: Array.from(colNames),
      fieldByName: new Map(
        table.fields.map((f): [string, NormalizedField] => [f.name, f]),
      ),
    };
  }

  private colValue(
    field: NormalizedField | undefined,
    cell: SeedCell,
  ): string | null {
    const { row, col } = cell;
    if (col === "id") return null;
    if (!field) return "NULL";
    const v = Object.prototype.hasOwnProperty.call(row, col) ? row[col] : null;
    if (v === null || v === undefined) {
      const dv = renderSqlDefault(converterFor(this.dialect), field);
      return dv !== null ? dv : "NULL";
    }
    return this.renderValue(field, v as SeedValue);
  }

  private renderValue(field: NormalizedField, value: SeedValue): string {
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
  tables: NormalizedTable[],
  seedOpts: GenerateTableOptions,
): string[] => {
  const gen = new SeedGenerator(dialect, seedOpts);
  const lines: string[] = [];
  for (const t of tables) {
    const seeds = gen.generate(t);
    if (seeds.length === 0) continue;
    lines.push(`-- Seeds: ${t.name}`, seeds.join("\n"), "");
  }
  return lines;
};
