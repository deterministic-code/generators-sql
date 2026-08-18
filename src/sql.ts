import { createHash } from "node:crypto";
import { effectiveTableName } from "./effective-table-name.ts";
import {
  datasourceSettingsFor,
  type DatasourceOptions,
} from "./common/ts-datasource-settings.ts";
import { resolveReferenceParentType } from "./datasource-references.ts";
import { CONVERTER_MODULES } from "./field-converter.ts";
import {
  nativeTypeFor,
  renderSqlDefault,
  sqlStringLiteral,
} from "./field-converters/base.ts";

export type SqlDialect =
  | "sqlite"
  | "mysql"
  | "postgres"
  | "sqlserver"
  | "oracle";
export type CanonicalDialect =
  | "Sqlite"
  | "MySql"
  | "Postgres"
  | "SqlServer"
  | "Oracle";

export interface FieldLike {
  type: string;
}

/** A single YAML/JSON seed cell — the scalar leaf of a parsed datasource seed row. */
export type SeedValue = string | number | boolean | null;

export type RawFieldDef = {
  type?: string;
  size?: number;
  is_nullable?: boolean;
  is_unique?: boolean;
  default_value?: SeedValue;
  references?: string;
  primary_key?: boolean;
};
type RawFieldEntry = Record<string, RawFieldDef>;

export type RawIndexDef = {
  fields: string[];
  is_unique?: boolean;
};

export type RawTableDef = {
  fields: RawFieldEntry[];
  indexes?: Record<string, RawIndexDef>[];
  seeds?: Record<string, Record<string, SeedValue>>[];
  datasource_type?: string;
  skip_migrations?: boolean;
  use_optimistic_concurrency?: boolean;
};
export type RawTableEntry = Record<string, RawTableDef>;

export type SchemaData = {
  types: RawTableEntry[];
  datasource_mappings?: unknown;
  datasource?: unknown;
};

export interface NormalizedField {
  name: string;
  type: string;
  size?: number;
  isNullable: boolean;
  isUnique: boolean;
  defaultValue?: SeedValue;
  references?: string;
  primaryKey: boolean;
  referencesType?: string;
  referencesSize?: number;
  logicalName?: string;
}

export interface NormalizedIndex {
  name: string;
  fields: string[];
  isUnique: boolean;
}

export interface NormalizedSeed {
  id: number;
  row: Record<string, SeedValue>;
}

export interface NormalizedTable {
  name: string;
  entityName: string;
  pluralizeTableNames: boolean;
  datasourceType?: string;
  skipMigrations: boolean;
  optimisticConcurrency?: boolean;
  fields: NormalizedField[];
  indexes: NormalizedIndex[];
  seeds: NormalizedSeed[];
}

export interface GenerateTableOptions extends DatasourceOptions {
  data?: SchemaData;
  withUuidColumn?: boolean;
  tableNameMappings?: Map<string, string>;
  skipForeignKeys?: boolean;
}

interface ColumnLinesOptions {
  pluralize: boolean;
  withAudit: boolean;
  tableNameMappings?: Map<string, string>;
  skipForeignKeys: boolean;
}

interface TableNameOptions {
  pluralizeTableNames?: boolean;
  tableNameMappings?: Map<string, string>;
}

interface SeedCell {
  row: Record<string, unknown>;
  col: string;
}

export interface SqlFile {
  path: string;
  content: string;
}

const DIALECT_ALIASES: Record<string, SqlDialect> = {
  sqlite: "sqlite",
  sqlite3: "sqlite",
  mysql: "mysql",
  mariadb: "mysql",
  postgres: "postgres",
  postgresql: "postgres",
  pg: "postgres",
  sqlserver: "sqlserver",
  mssql: "sqlserver",
  "ms-sql-server": "sqlserver",
  oracle: "oracle",
  ora: "oracle",
};

export const SQL_DIALECTS: CanonicalDialect[] = [
  "Sqlite",
  "MySql",
  "Postgres",
  "SqlServer",
  "Oracle",
];
export const DEFAULT_SQL_DIALECT: CanonicalDialect = "Sqlite";

export function normalizeDialect(
  raw: string | null | undefined,
): SqlDialect | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s_\-]/g, "");
  return DIALECT_ALIASES[key] ?? null;
}

const DIALECTS_WITH_PROCEDURES = new Set<string>([
  "postgres",
  "mysql",
  "sqlserver",
]);

/** Whether a dialect has stored procedures at all — sqlite and oracle don't, so the SP generators skip them and fall back to dynamic SQL. Accepts raw or normalized dialect names. */
export function supportsProcedures(dialect: string): boolean {
  return DIALECTS_WITH_PROCEDURES.has(normalizeDialect(dialect) ?? dialect);
}

const CANONICAL_DIALECT: Record<SqlDialect, CanonicalDialect> = {
  sqlite: "Sqlite",
  mysql: "MySql",
  postgres: "Postgres",
  sqlserver: "SqlServer",
  oracle: "Oracle",
};

function canonicalDialectName(key: string): CanonicalDialect {
  const name = CANONICAL_DIALECT[key as SqlDialect];
  if (name === undefined) throw new Error(`Unknown dialect key: ${key}`);
  return name;
}

export function q(dialect: string, ident: string): string {
  if (dialect === "mysql") return `\`${ident}\``;
  if (dialect === "sqlserver") return `[${ident}]`;
  return `"${ident}"`;
}

/** The native column type for a field in one SQL dialect — delegates to the dialect's field-converter module. */
export function mapColumnType(dialect: string, field: FieldLike): string {
  const mod = CONVERTER_MODULES[dialect];
  if (!mod) throw new Error(`Unknown dialect "${dialect}"`);
  return nativeTypeFor(mod, field);
}

function booleanLiteral(dialect: string, value: boolean): string {
  if (dialect === "postgres") return value ? "TRUE" : "FALSE";
  return value ? "1" : "0";
}

/** The SQL `DEFAULT` expression for a field's `default_value` (null when absent) — delegates to the dialect's field-converter module. */
function renderDefault(
  dialect: string,
  field: FieldLike,
): string | null {
  const mod = CONVERTER_MODULES[dialect];
  if (!mod) throw new Error(`Unknown dialect "${dialect}"`);
  return renderSqlDefault(mod, field);
}

const ID_COLUMN_SUFFIX: Record<string, Record<SqlDialect, string>> = {
  integer: {
    sqlite: "INTEGER PRIMARY KEY AUTOINCREMENT",
    postgres: "SERIAL PRIMARY KEY",
    sqlserver: "INT IDENTITY(1,1) PRIMARY KEY",
    mysql: "INT AUTO_INCREMENT PRIMARY KEY",
    oracle: "NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
  },
  biginteger: {
    sqlite: "INTEGER PRIMARY KEY AUTOINCREMENT",
    postgres: "BIGSERIAL PRIMARY KEY",
    sqlserver: "BIGINT IDENTITY(1,1) PRIMARY KEY",
    mysql: "BIGINT AUTO_INCREMENT PRIMARY KEY",
    oracle: "NUMBER(19) GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
  },
  uuid: {
    sqlite: "TEXT PRIMARY KEY",
    postgres: "UUID PRIMARY KEY DEFAULT gen_random_uuid()",
    sqlserver: "UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID()",
    mysql: "CHAR(36) PRIMARY KEY DEFAULT (UUID())",
    oracle: "VARCHAR2(36) DEFAULT SYS_GUID() NOT NULL PRIMARY KEY",
  },
  string: {
    sqlite: "VARCHAR(64) NOT NULL PRIMARY KEY",
    postgres: "VARCHAR(64) NOT NULL PRIMARY KEY",
    sqlserver: "NVARCHAR(64) NOT NULL PRIMARY KEY",
    mysql: "VARCHAR(64) NOT NULL PRIMARY KEY",
    oracle: "VARCHAR2(64) NOT NULL PRIMARY KEY",
  },
};

function idColumnDef(
  dialect: SqlDialect,
  idType = "integer",
): string | undefined {
  const suffix = ID_COLUMN_SUFFIX[idType]?.[dialect];
  return suffix === undefined ? undefined : `${q(dialect, "id")} ${suffix}`;
}

const UUID_COLUMN_SUFFIX: Record<SqlDialect, string> = {
  sqlite: "VARCHAR(36) NOT NULL UNIQUE",
  postgres: "UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()",
  sqlserver: "UNIQUEIDENTIFIER NOT NULL UNIQUE DEFAULT NEWID()",
  mysql: "VARCHAR(36) NOT NULL UNIQUE DEFAULT (UUID())",
  oracle: "VARCHAR2(36) DEFAULT SYS_GUID() NOT NULL UNIQUE",
};

function uuidColumnDef(dialect: SqlDialect): string {
  return `${q(dialect, "uuid")} ${UUID_COLUMN_SUFFIX[dialect]}`;
}

/** SQLite has no UUID() builtin — SqliteCrudRepository.add fills it client-side, so no server DEFAULT. */
const UUID_DEFAULT_EXPR: Partial<Record<SqlDialect, string>> = {
  postgres: "gen_random_uuid()",
  sqlserver: "NEWID()",
  mysql: "(UUID())",
  oracle: "SYS_GUID()",
};

function uuidDefaultExpr(dialect: SqlDialect): string | null {
  return UUID_DEFAULT_EXPR[dialect] ?? null;
}

const TIMESTAMP_DEFAULT: Record<SqlDialect, string> = {
  sqlite: "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
  postgres: "(NOW() AT TIME ZONE 'UTC')",
  sqlserver: "GETUTCDATE()",
  mysql: "(UTC_TIMESTAMP(3))", // MySQL 8.0.13+ requires parens around non-constant DEFAULT expressions
  oracle: "SYS_EXTRACT_UTC(SYSTIMESTAMP)",
};

function timestampColumnDef(dialect: SqlDialect, name: string): string {
  const type = mapColumnType(dialect, { type: "datetime" });
  return `${q(dialect, name)} ${type} NOT NULL DEFAULT ${TIMESTAMP_DEFAULT[dialect]}`;
}

export function normalizeField(entry: RawFieldEntry): NormalizedField {
  const [name, def] = Object.entries(entry)[0];
  return {
    name,
    type: def.type as string,
    size: def.size,
    isNullable: def.is_nullable === true,
    isUnique: def.is_unique === true,
    defaultValue: def.default_value,
    references: def.references,
    primaryKey: def.primary_key === true,
  };
}

/** Resolve a field's `references` to its parent PK type in place — a FK to a uuid id becomes UUID, integer parents resolve back to integer (byte-identical). */
function applyReferenceType(
  field: NormalizedField,
  data: SchemaData,
  defaultIdType: string,
): void {
  const parent = resolveReferenceParentType(
    field.references,
    data.types,
    defaultIdType,
  );
  if (parent) {
    field.type = "reference";
    field.referencesType = parent.type;
    field.referencesSize = parent.size;
  }
}

export function normalizeTable(
  entry: RawTableEntry,
  opts: GenerateTableOptions = {},
): NormalizedTable {
  const pluralize = opts.pluralizeTableNames === true;
  const defaultIdType = datasourceSettingsFor(opts).idType;
  const [name, def] = Object.entries(entry)[0];
  const fields = def.fields.map(normalizeField);
  for (const f of fields) {
    if (f.references && opts.data)
      applyReferenceType(f, opts.data, defaultIdType);
  }
  const indexes: NormalizedIndex[] = (def.indexes ?? []).map((idx) => {
    const [iname, idef] = Object.entries(idx)[0];
    return {
      name: iname,
      fields: idef.fields,
      isUnique: idef.is_unique === true,
    };
  });
  const seeds: NormalizedSeed[] = (def.seeds ?? []).map((row) => {
    const [key, values] = Object.entries(row)[0];
    return { id: parseSeedKey(key), row: values };
  });
  const mapped =
    opts.data !== undefined && opts.data !== null
      ? mappedTableNameForEntity(opts.data, name)
      : null;
  return {
    name: mapped !== null ? mapped : effectiveTableName(name, pluralize),
    entityName: name,
    pluralizeTableNames: pluralize,
    datasourceType: def.datasource_type,
    skipMigrations: def.skip_migrations === true,
    optimisticConcurrency:
      def.use_optimistic_concurrency === undefined
        ? undefined
        : def.use_optimistic_concurrency === true,
    fields,
    indexes,
    seeds,
  };
}

function buildTableDeps(
  tables: NormalizedTable[],
  byName: Map<string, NormalizedTable>,
): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  for (const t of tables) {
    const set = new Set<string>();
    for (const f of t.fields) {
      if (f.references) {
        const depTable = String(f.references).split(".")[0];
        if (byName.has(depTable) && depTable !== t.entityName)
          set.add(depTable);
      }
    }
    deps.set(t.entityName, set);
  }
  return deps;
}

// Keyed on the schema entityName, not the physical table name: `references` resolve to schema names, so a pluralized table (service → services) would otherwise never match its FK targets and every dependency would drop.
function topoSort(tables: NormalizedTable[]): NormalizedTable[] {
  const byName = new Map(
    tables.map((t): [string, NormalizedTable] => [t.entityName, t]),
  );
  const deps = buildTableDeps(tables, byName);
  const out: NormalizedTable[] = [];
  const generated = new Set<string>();
  const pending = tables.slice();
  let safety = pending.length * pending.length + 10;
  while (pending.length > 0 && safety-- > 0) {
    const idx = pending.findIndex((t) => {
      const ds = deps.get(t.entityName) ?? new Set<string>();
      for (const d of ds) if (!generated.has(d)) return false;
      return true;
    });
    if (idx === -1) {
      for (const t of pending) {
        out.push(t);
        generated.add(t.entityName);
      }
      break;
    }
    const [t] = pending.splice(idx, 1);
    out.push(t);
    generated.add(t.entityName);
  }
  return out;
}

export function columnDefForField(
  dialect: SqlDialect,
  field: NormalizedField,
): string {
  const type = mapColumnType(dialect, field);
  const parts = [`${q(dialect, field.name)} ${type}`];
  if (!field.isNullable) parts.push("NOT NULL");
  if (field.isUnique) parts.push("UNIQUE");
  if (field.primaryKey) parts.push("PRIMARY KEY");
  const def = renderDefault(dialect, field);
  if (def !== null) {
    parts.push(`DEFAULT ${def}`);
  } else {
    const logicalName = field.logicalName ?? field.name;
    if (logicalName === "uuid") {
      const uuidDef = uuidDefaultExpr(dialect);
      if (uuidDef !== null) parts.push(`DEFAULT ${uuidDef}`);
    }
  }
  return parts.join(" ");
}

function foreignKeyClause(
  dialect: SqlDialect,
  field: NormalizedField,
  opts: TableNameOptions = {},
): string {
  const pluralize = opts.pluralizeTableNames === true;
  const [refTable, refCol] = String(field.references).split(".");
  const mappedName =
    opts.tableNameMappings instanceof Map
      ? (opts.tableNameMappings.get(refTable) ?? null)
      : null;
  const effectiveRef = mappedName ?? effectiveTableName(refTable, pluralize);
  return `FOREIGN KEY (${q(dialect, field.name)}) REFERENCES ${q(dialect, effectiveRef)}(${q(dialect, refCol)})`;
}

export interface OptimisticConcurrencyEligible {
  datasourceType?: string | null;
  optimisticConcurrency?: boolean;
}

/** The single decision of whether one entity participates in optimistic concurrency: junction and readonly-lookup tables never do, an explicit per-type `use_optimistic_concurrency` wins over the datasource-wide flag, and everything else inherits it. Router, DDL/audit-columns, tests, and the coverage validator all resolve through here so they can never disagree. */
export function entityUsesOptimisticConcurrency(
  table: OptimisticConcurrencyEligible | null | undefined,
  globalFlag: boolean,
): boolean {
  if (table?.datasourceType === "many-to-many") return false;
  if (table?.datasourceType === "readonly-lookup") return false;
  if (table?.optimisticConcurrency !== undefined)
    return table.optimisticConcurrency;
  return globalFlag === true;
}

/** Readonly-lookup tables hold seeded enum-like data with no audit signals, so the migration generator omits uuid/created/updated to match the OpenAPI view schema. custom-PK tables keep `updated` only when OCC needs a row-version column. */
export function tableHasAuditColumns(
  table: NormalizedTable | null | undefined,
  opts: { useOptimisticConcurrency?: boolean } = {},
): boolean {
  if (table?.datasourceType === "readonly-lookup") return false;
  const fields = Array.isArray(table?.fields) ? table!.fields : [];
  const hasCustomPk = fields.some((f) => f && f.primaryKey && f.name !== "id");
  const occ = entityUsesOptimisticConcurrency(
    table,
    opts.useOptimisticConcurrency === true,
  );
  if (hasCustomPk && occ) return true;
  if (hasCustomPk) return false;
  return true;
}

function generateCreateTable(
  dialect: SqlDialect,
  table: NormalizedTable,
  opts: GenerateTableOptions = {},
): string {
  const idType = datasourceSettingsFor(opts).idType;
  const withUuidColumn = opts.withUuidColumn ?? true;
  const withAudit = tableHasAuditColumns(table, {
    useOptimisticConcurrency: opts.useOptimisticConcurrency === true,
  });
  const pluralize = table.pluralizeTableNames === true;

  const lines: string[] = [];
  if (!table.fields.some((f) => f.primaryKey)) {
    lines.push(idColumnDef(dialect, idType)!);
  }
  const userHasUuidField = table.fields.some((f) => f.name === "uuid");
  if (withUuidColumn && withAudit && !userHasUuidField) {
    lines.push(uuidColumnDef(dialect));
  }
  lines.push(
    ...generateColumnAndFkLines(dialect, table, {
      pluralize,
      withAudit,
      tableNameMappings: opts.tableNameMappings,
      skipForeignKeys: opts.skipForeignKeys === true,
    }),
  );
  const body = lines.map((l) => `  ${l}`).join(",\n");
  return `CREATE TABLE ${q(dialect, table.name)} (\n${body}\n);`;
}

/** The column definitions for an entity's own fields, its `created`/`updated` audit columns, then the FK clauses last — the interior of a CREATE TABLE (after any id/uuid system columns). */
function generateColumnAndFkLines(
  dialect: SqlDialect,
  table: NormalizedTable,
  opts: ColumnLinesOptions,
): string[] {
  const { pluralize, withAudit, tableNameMappings, skipForeignKeys } = opts;
  const lines: string[] = [];
  const fks: string[] = [];
  for (const f of table.fields) {
    lines.push(columnDefForField(dialect, f));
    if (f.references && !skipForeignKeys) {
      fks.push(
        foreignKeyClause(dialect, f, {
          pluralizeTableNames: pluralize,
          tableNameMappings,
        }),
      );
    }
  }
  if (withAudit) {
    lines.push(timestampColumnDef(dialect, "created"));
    lines.push(timestampColumnDef(dialect, "updated"));
  }
  return [...lines, ...fks];
}

function generateDrop(dialect: SqlDialect, table: { name: string }): string {
  if (dialect === "oracle") {
    return `BEGIN EXECUTE IMMEDIATE 'DROP TABLE ${q(dialect, table.name)} CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;\n/`;
  }
  return `DROP TABLE IF EXISTS ${q(dialect, table.name)};`;
}

function generateCreateIndex(
  dialect: SqlDialect,
  tableName: string,
  idx: NormalizedIndex,
): string {
  const unique = idx.isUnique ? "UNIQUE " : "";
  const cols = idx.fields.map((c) => q(dialect, c)).join(", ");
  return `CREATE ${unique}INDEX ${q(dialect, idx.name)} ON ${q(dialect, tableName)} (${cols});`;
}

function generateIndexes(
  dialect: SqlDialect,
  table: NormalizedTable,
): string[] {
  return table.indexes.map((idx) => generateCreateIndex(dialect, table.name, idx));
}

/** Read `datasource_mappings: - <entity>: { source: <tableName> }` at codegen so test DDL creates the table under the same name runtime queries; strict — typos throw, not no-op; empty map when no mappings. */
function buildTableNameMappings(data: SchemaData): Map<string, string> {
  const out = new Map<string, string>();
  if (data == null || typeof data !== "object") return out;
  const raw = data.datasource_mappings;
  if (raw === undefined || raw === null) return out;
  if (!Array.isArray(raw)) return out;
  for (const mapping of raw) {
    if (mapping === null || typeof mapping !== "object") continue;
    for (const entityName of Object.keys(mapping)) {
      const mapped = mappedTableNameForEntity(data, entityName);
      if (mapped !== null) out.set(entityName, mapped);
    }
  }
  return out;
}

function requireDatasourceMappings(data: SchemaData): unknown[] | null {
  if (data == null || typeof data !== "object") {
    throw new Error(
      `mappedTableNameForEntity: expected datasourceData object, got ${typeof data}`,
    );
  }
  const raw = data.datasource_mappings;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    throw new Error(
      `datasource_mappings must be a list of single-key entity maps; got ${typeof raw}`,
    );
  }
  return raw;
}

export function mappedTableNameForEntity(
  data: SchemaData,
  entityName: string,
): string | null {
  const raw = requireDatasourceMappings(data);
  if (raw === null) return null;
  for (let i = 0; i < raw.length; i++) {
    const mapping = raw[i];
    if (mapping === null || typeof mapping !== "object") {
      throw new Error(
        `datasource_mappings[${i}] must be a single-key entity map (e.g. \`- notification: { source: notifications }\`); got ${typeof mapping}`,
      );
    }
    if (!(entityName in mapping)) continue;
    const entry = (mapping as Record<string, unknown>)[entityName];
    if (entry === null || typeof entry !== "object") {
      throw new Error(
        `datasource_mappings[${i}].${entityName} must be an object; got ${typeof entry}`,
      );
    }
    if (!("source" in entry)) return null;
    const source = (entry as Record<string, unknown>).source;
    if (typeof source !== "string" || source.length === 0) {
      throw new Error(
        `datasource_mappings[${i}].${entityName}.source must be a non-empty string; got ${typeof source}: ${JSON.stringify(source)}`,
      );
    }
    return source;
  }
  return null;
}

/** The `{ t, trg }` quoted table + updated-at trigger identifiers shared by every dialect's trigger generator. */
function triggerNames(
  dialect: SqlDialect,
  table: NormalizedTable,
): { t: string; trg: string } {
  return {
    t: q(dialect, table.name),
    trg: q(dialect, `trg_${table.name}_updated_at`),
  };
}

function generateUpdatedTriggerSqlite(table: NormalizedTable): string {
  const { t, trg } = triggerNames("sqlite", table);
  const pkField = table.fields.find((f) => f.primaryKey);
  const pkCol = q("sqlite", pkField ? pkField.name : "id");
  return `CREATE TRIGGER ${trg}
AFTER UPDATE ON ${t}
FOR EACH ROW
BEGIN
  UPDATE ${t} SET ${q("sqlite", "updated")} = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE ${pkCol} = OLD.${pkCol};
END;`;
}

function generateUpdatedTriggerPostgresShared(): string {
  return `CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW."updated" = NOW() AT TIME ZONE 'UTC';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`;
}

function generateUpdatedTriggerPostgres(table: NormalizedTable): string {
  const { t, trg } = triggerNames("postgres", table);
  return `CREATE TRIGGER ${trg} BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION set_updated_at();`;
}

function generateUpdatedTriggerSqlServer(table: NormalizedTable): string {
  const { t, trg } = triggerNames("sqlserver", table);
  return `CREATE TRIGGER ${trg} ON ${t}
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE ${t} SET ${q("sqlserver", "updated")} = GETUTCDATE()
  FROM ${t} t INNER JOIN inserted i ON t.${q("sqlserver", "id")} = i.${q("sqlserver", "id")};
END;`;
}

function generateUpdatedTriggerMysql(table: NormalizedTable): string {
  const { t, trg } = triggerNames("mysql", table);
  return `CREATE TRIGGER ${trg} BEFORE UPDATE ON ${t}
FOR EACH ROW SET NEW.${q("mysql", "updated")} = UTC_TIMESTAMP(3);`;
}

function generateUpdatedTriggerOracle(table: NormalizedTable): string {
  const { t, trg } = triggerNames("oracle", table);
  return `CREATE OR REPLACE TRIGGER ${trg}
BEFORE UPDATE ON ${t}
FOR EACH ROW
BEGIN
  :NEW."updated" := SYS_EXTRACT_UTC(SYSTIMESTAMP);
END;
/`;
}

const UPDATED_TRIGGER_GENERATORS: Record<
  SqlDialect,
  (table: NormalizedTable) => string
> = {
  sqlite: generateUpdatedTriggerSqlite,
  postgres: generateUpdatedTriggerPostgres,
  sqlserver: generateUpdatedTriggerSqlServer,
  mysql: generateUpdatedTriggerMysql,
  oracle: generateUpdatedTriggerOracle,
};

function generateUpdatedTrigger(
  dialect: SqlDialect,
  table: NormalizedTable,
): string {
  return UPDATED_TRIGGER_GENERATORS[dialect](table);
}

const SEED_UUID_NAMESPACE = "9b3a8e6c-2f1d-4a5b-8c9d-1e2f3a4b5c6d";

function uuidStringToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToUuidString(bytes: Buffer): string {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function seedUuid(tableName: string, id: number): string {
  const ns = uuidStringToBytes(SEED_UUID_NAMESPACE);
  const name = Buffer.from(`${tableName}:${id}`, "utf8");
  const hash = createHash("sha1")
    .update(Buffer.concat([ns, name]))
    .digest();
  const bytes = Buffer.from(hash.slice(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuidString(bytes);
}

function renderSeedValue(
  dialect: SqlDialect,
  field: NormalizedField,
  value: SeedValue,
): string {
  if (value === null || value === undefined) return "NULL";
  if (field.type === "boolean") return booleanLiteral(dialect, Boolean(value));
  if (field.type === "number" || field.type === "reference")
    return String(value);
  return sqlStringLiteral(value);
}

function parseSeedKey(rowKey: string): number {
  const m = /^id(\d+)$/.exec(rowKey);
  if (!m) {
    throw new Error(
      `Invalid seed row key "${rowKey}": expected pattern /^id\\d+$/`,
    );
  }
  return Number(m[1]);
}

export function extractSeedRows(
  rawTableDef: RawTableDef | null | undefined,
): Map<number, Record<string, SeedValue>> {
  const map = new Map<number, Record<string, SeedValue>>();
  for (const entry of rawTableDef?.seeds ?? []) {
    const [key, values] = Object.entries(entry)[0];
    map.set(parseSeedKey(key), values);
  }
  return map;
}

function seedColsForRow(
  table: NormalizedTable,
  row: Record<string, unknown>,
  opts: { withUuidColumn?: boolean } = {},
): { cols: string[]; fieldByName: Map<string, NormalizedField> } {
  const withUuidColumn = opts.withUuidColumn ?? true;
  const withAudit = tableHasAuditColumns(table);
  const colNames = new Set<string>();
  if (withUuidColumn && withAudit) colNames.add("uuid");
  colNames.add("id");
  for (const k of Object.keys(row)) {
    if (k !== "id" && k !== "uuid") colNames.add(k);
  }
  const cols = Array.from(colNames);
  const fieldByName = new Map(
    table.fields.map((f): [string, NormalizedField] => [f.name, f]),
  );
  return { cols, fieldByName };
}

function seedColValue(
  dialect: SqlDialect,
  field: NormalizedField | undefined,
  cell: SeedCell,
): string | null {
  const { row, col } = cell;
  if (col === "id") return null;
  if (!field) return "NULL";
  const v = Object.prototype.hasOwnProperty.call(row, col) ? row[col] : null;
  if (v === null || v === undefined) {
    const dv = renderDefault(dialect, field);
    if (dv !== null) return dv;
    return "NULL";
  }
  return renderSeedValue(dialect, field, v as SeedValue);
}

/** Render the `id` column value for a seed row per id_type — uuid/string are quoted, integer/biginteger generate the bare number. */
function seedIdValue(
  uuidSourceName: string,
  id: number,
  idType: string,
): string {
  if (idType === "uuid") return sqlStringLiteral(seedUuid(uuidSourceName, id));
  if (idType === "string") return sqlStringLiteral(String(id));
  return String(id);
}

interface SeedTarget {
  dialect: SqlDialect;
  table: NormalizedTable;
  idType?: string;
  withUuidColumn?: boolean;
}

interface SeedRow {
  id: number;
  row: Record<string, SeedValue>;
}

export function renderSeedInsert(target: SeedTarget, seed: SeedRow): string {
  const { dialect, table } = target;
  const { id, row } = seed;
  const idType = target.idType ?? "integer";
  const withUuidColumn = target.withUuidColumn ?? true;
  const { cols, fieldByName } = seedColsForRow(table, row, { withUuidColumn });
  const uuidSourceName = table.entityName ?? table.name;
  const values = cols.map((c) => {
    if (c === "id") return seedIdValue(uuidSourceName, id, idType);
    if (c === "uuid") return sqlStringLiteral(seedUuid(uuidSourceName, id));
    return seedColValue(dialect, fieldByName.get(c), { row, col: c });
  });
  const colList = cols.map((c) => q(dialect, c)).join(", ");
  return `INSERT INTO ${q(dialect, table.name)} (${colList}) VALUES (${values.join(", ")});`;
}

export function renderSeedUpdate(target: SeedTarget, seed: SeedRow): string {
  const { dialect, table } = target;
  const { id, row } = seed;
  const fieldByName = new Map(
    table.fields.map((f): [string, NormalizedField] => [f.name, f]),
  );
  const assignments = Object.keys(row)
    .map(
      (col) =>
        `${q(dialect, col)} = ${seedColValue(dialect, fieldByName.get(col), { row, col })}`,
    )
    .join(", ");
  return `UPDATE ${q(dialect, table.name)} SET ${assignments} WHERE ${q(dialect, "id")} = ${id};`;
}

export function renderSeedDelete(
  dialect: SqlDialect,
  table: NormalizedTable,
  id: number,
): string {
  return `DELETE FROM ${q(dialect, table.name)} WHERE ${q(dialect, "id")} = ${id};`;
}

export function generateSeeds(
  dialect: SqlDialect,
  table: NormalizedTable,
  opts: GenerateTableOptions = {},
): string[] {
  if (!table.seeds || table.seeds.length === 0) return [];
  const idType = datasourceSettingsFor(opts).idType;
  const withUuidColumn = opts.withUuidColumn ?? true;
  const out: string[] = [];
  const sequenced = idType !== "uuid" && idType !== "string";

  if (dialect === "sqlserver" && sequenced) {
    out.push(`SET IDENTITY_INSERT ${q(dialect, table.name)} ON;`);
  }
  const seedTarget: SeedTarget = { dialect, table, idType, withUuidColumn };
  for (const { id, row } of table.seeds) {
    out.push(renderSeedInsert(seedTarget, { id, row }));
  }
  if (dialect === "sqlserver" && sequenced) {
    out.push(`SET IDENTITY_INSERT ${q(dialect, table.name)} OFF;`);
  }
  if (dialect === "postgres" && sequenced) {
    out.push(
      `SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), (SELECT MAX("id") FROM ${q(dialect, table.name)}));`,
    );
  }
  return out;
}

/** Single source of truth for the proc generator + migration generator — both must filter skipMigrations and topo-sort identically. */
export function buildLiveTables(
  language: string,
  data: SchemaData,
  opts: GenerateTableOptions = {},
): NormalizedTable[] {
  const idType = datasourceSettingsFor(opts).idType;
  const pluralizeTableNames = opts.pluralizeTableNames === true;
  const key = normalizeDialect(language);
  if (!key) {
    throw new Error(
      `Unknown SQL dialect "${language}". Valid: ${SQL_DIALECTS.join(", ")}.`,
    );
  }
  const tables = data.types.map((t) =>
    normalizeTable(t, { pluralizeTableNames, data, idType }),
  );
  const ordered = topoSort(tables);
  return ordered.filter((t) => !t.skipMigrations);
}

/** The per-table CREATE + index + audit-trigger blocks, in order — shared by the initial-migration and full-schema generators. */
function generateCreateTableSections(
  key: SqlDialect,
  tables: NormalizedTable[],
  createOpts: GenerateTableOptions,
): string[] {
  const sections: string[] = [];
  for (const t of tables) {
    sections.push(generateCreateTable(key, t, createOpts));
    const indexes = generateIndexes(key, t);
    if (indexes.length > 0) sections.push(indexes.join("\n"));
    if (tableHasAuditColumns(t)) sections.push(generateUpdatedTrigger(key, t));
    sections.push("");
  }
  return sections;
}

/** The `-- Seeds: <table>` blocks for every table that has seed rows. */
function generateSeedSections(
  key: SqlDialect,
  tables: NormalizedTable[],
  seedOpts: GenerateTableOptions,
): string[] {
  const seedLines: string[] = [];
  for (const t of tables) {
    const seeds = generateSeeds(key, t, seedOpts);
    if (seeds.length > 0) {
      seedLines.push(`-- Seeds: ${t.name}`);
      seedLines.push(seeds.join("\n"));
      seedLines.push("");
    }
  }
  return seedLines;
}

interface SqlGenerateContext {
  key: SqlDialect;
  idType: string;
  withUuidColumn: boolean;
  pluralizeTableNames: boolean;
}

/** The `{ key, idType, withUuidColumn, pluralizeTableNames }` common to both SQL generators — id representation from the shared `DatasourceSettings` owner, dialect validated. */
function resolveSqlGenerateContext(
  language: string,
  opts: GenerateTableOptions,
): SqlGenerateContext {
  const key = normalizeDialect(language);
  if (!key) {
    throw new Error(
      `Unknown SQL dialect "${language}". Valid: ${SQL_DIALECTS.join(", ")}.`,
    );
  }
  return {
    key,
    idType: datasourceSettingsFor(opts).idType,
    withUuidColumn: opts.withUuidColumn ?? true,
    pluralizeTableNames: opts.pluralizeTableNames === true,
  };
}

function dropTablesSql(key: SqlDialect, tables: NormalizedTable[]): string {
  return tables
    .slice()
    .reverse()
    .map((t) => generateDrop(key, t))
    .join("\n");
}

function postgresTriggerHeader(key: SqlDialect): string[] {
  if (key !== "postgres") return [];
  return [
    "-- Shared updated_at function",
    generateUpdatedTriggerPostgresShared(),
    "",
  ];
}

function finalizeSql(sections: string[]): string {
  const content = sections.join("\n").replace(/\n{3,}/g, "\n\n");
  return content.endsWith("\n") ? content : content + "\n";
}

export function generateInitialMigration(
  language: string,
  data: SchemaData,
  opts: GenerateTableOptions = {},
): { up: SqlFile; down: SqlFile } {
  const { key, idType, withUuidColumn, pluralizeTableNames } =
    resolveSqlGenerateContext(language, opts);
  const live = buildLiveTables(language, data, { pluralizeTableNames, idType });
  const createOpts: GenerateTableOptions = {
    idType,
    withUuidColumn,
    tableNameMappings: buildTableNameMappings(data),
  };

  const upSections = [
    `-- Generated initial migration for ${canonicalDialectName(key)}`,
    "",
    ...postgresTriggerHeader(key),
    "-- Create added tables",
    ...generateCreateTableSections(key, live, createOpts),
  ];
  const seedLines = generateSeedSections(key, live, { idType, withUuidColumn });
  if (seedLines.length > 0) {
    upSections.push("-- Seed data", seedLines.join("\n"));
  }

  const downSections = [
    `-- Rollback initial migration for ${canonicalDialectName(key)}`,
    "",
    "-- DROP tables (reverse dependency order)",
    dropTablesSql(key, live),
    "",
  ];

  return {
    up: { path: "0001_initial_up.sql", content: finalizeSql(upSections) },
    down: { path: "0001_initial_down.sql", content: finalizeSql(downSections) },
  };
}
