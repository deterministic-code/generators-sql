import {
  flattenForeignKeys,
  flattenIndexes,
  getOrCreate,
  loadDriver,
  requireConnectionUrl,
  requireUrlPath,
} from "./shared.ts";
import type {
  ForeignKeyAccumulator,
  IndexAccumulator,
  IntrospectedColumn,
  IntrospectedForeignKey,
  IntrospectedIndex,
  IntrospectedTable,
  IntrospectionResult,
} from "./shared.ts";

interface MssqlSqlType {
  readonly name: string;
}
interface MssqlQueryResult<T> {
  recordset: T[];
}
interface MssqlRequest {
  input(name: string, type: MssqlSqlType, value: string): MssqlRequest;
  query<T>(sql: string): Promise<MssqlQueryResult<T>>;
}
interface MssqlPool {
  request(): MssqlRequest;
  close(): Promise<void>;
}
interface MssqlModule {
  NVarChar: MssqlSqlType;
  connect(config: MssqlConfig): Promise<MssqlPool>;
}
interface MssqlOptions {
  encrypt: boolean;
  trustServerCertificate: boolean;
}
interface MssqlConfig {
  server: string;
  port: number;
  user: string;
  password: string;
  database: string;
  options: MssqlOptions;
}
interface SqlServerScope {
  pool: MssqlPool;
  driver: MssqlModule;
}

interface SqlServerTableRow {
  table_name: string;
}
interface SqlServerColRow {
  column_name: string;
  type_name: string | null;
  max_length: number;
  precision: number;
  scale: number | null;
  is_nullable: boolean;
  default_value: string | null | undefined;
}
interface SqlServerIndexRow {
  index_name: string;
  is_unique: boolean;
  is_primary_key: boolean;
  key_ordinal: number;
  column_name: string;
}
interface SqlServerFkRow {
  fk_name: string;
  col_pos: number;
  col_name: string;
  ref_table: string;
  ref_col: string;
}

function parseSqlserverUrl(connectionUrl: string): MssqlConfig {
  requireConnectionUrl(connectionUrl, "sqlserver");
  const u = new URL(connectionUrl);
  const database = u.pathname.replace(/^\//, "");
  requireUrlPath(database, "sqlserver", "database path");
  const encrypt = u.searchParams.get("encrypt");
  const trust = u.searchParams.get("trustServerCertificate");
  return {
    server: u.hostname,
    port: u.port ? Number(u.port) : 1433,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    options: {
      encrypt: encrypt === null ? false : encrypt === "true",
      trustServerCertificate: trust === null ? true : trust === "true",
    },
  };
}

function sqlserverType(r: SqlServerColRow): string {
  const t = String(r.type_name ?? "").toUpperCase();
  if (t === "NVARCHAR" || t === "NCHAR") {
    if (r.max_length === -1) return `${t}(MAX)`;
    const chars = Number(r.max_length) / 2;
    return `${t}(${chars})`;
  }
  if (t === "VARCHAR" || t === "CHAR" || t === "VARBINARY" || t === "BINARY") {
    if (r.max_length === -1) return `${t}(MAX)`;
    return `${t}(${Number(r.max_length)})`;
  }
  if (t === "DECIMAL" || t === "NUMERIC") {
    return `${t}(${r.precision},${r.scale})`;
  }
  if (t === "DATETIME2") {
    return r.scale != null ? `DATETIME2(${r.scale})` : "DATETIME2";
  }
  return t;
}

async function columnsFor(
  scope: SqlServerScope,
  tableName: string,
): Promise<IntrospectedColumn[]> {
  const res = await scope.pool
    .request()
    .input("tname", scope.driver.NVarChar, tableName)
    .query<SqlServerColRow>(
      `SELECT c.name AS column_name,
                  ty.name AS type_name,
                  c.max_length,
                  c.precision,
                  c.scale,
                  c.is_nullable,
                  c.is_identity,
                  dc.definition AS default_value
             FROM sys.columns c
             JOIN sys.tables t ON t.object_id = c.object_id
             JOIN sys.schemas s ON s.schema_id = t.schema_id
             JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
            WHERE s.name = 'dbo' AND t.name = @tname
            ORDER BY c.name`,
    );
  return res.recordset.map((r) => ({
    name: r.column_name,
    type: sqlserverType(r),
    nullable: r.is_nullable === true,
    default: r.default_value === undefined ? null : r.default_value,
  }));
}

async function indexesFor(
  scope: SqlServerScope,
  tableName: string,
): Promise<IntrospectedIndex[]> {
  const res = await scope.pool
    .request()
    .input("tname", scope.driver.NVarChar, tableName)
    .query<SqlServerIndexRow>(
      `SELECT i.name AS index_name,
                  i.is_unique,
                  i.is_primary_key,
                  ic.key_ordinal,
                  c.name AS column_name
             FROM sys.indexes i
             JOIN sys.tables t ON t.object_id = i.object_id
             JOIN sys.schemas s ON s.schema_id = t.schema_id
             JOIN sys.index_columns ic
               ON ic.object_id = i.object_id AND ic.index_id = i.index_id
             JOIN sys.columns c
               ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE s.name = 'dbo'
              AND t.name = @tname
              AND i.is_hypothetical = 0
              AND i.type <> 0
            ORDER BY i.name, ic.key_ordinal`,
    );
  const idxMap = new Map<string, IndexAccumulator>();
  for (const r of res.recordset) {
    if (r.is_primary_key) continue;
    getOrCreate(idxMap, r.index_name, () => ({
      unique: r.is_unique,
      cols: [],
    })).cols.push({ pos: Number(r.key_ordinal), name: r.column_name });
  }
  return flattenIndexes(idxMap);
}

async function foreignKeysFor(
  scope: SqlServerScope,
  tableName: string,
): Promise<IntrospectedForeignKey[]> {
  const res = await scope.pool
    .request()
    .input("tname", scope.driver.NVarChar, tableName)
    .query<SqlServerFkRow>(
      `SELECT fk.name AS fk_name,
                  fkc.constraint_column_id AS col_pos,
                  pc.name AS col_name,
                  rt.name AS ref_table,
                  rc.name AS ref_col
             FROM sys.foreign_keys fk
             JOIN sys.tables t ON t.object_id = fk.parent_object_id
             JOIN sys.schemas s ON s.schema_id = t.schema_id
             JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
             JOIN sys.columns pc
               ON pc.object_id = fkc.parent_object_id
              AND pc.column_id = fkc.parent_column_id
             JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
             JOIN sys.columns rc
               ON rc.object_id = fkc.referenced_object_id
              AND rc.column_id = fkc.referenced_column_id
            WHERE s.name = 'dbo' AND t.name = @tname
            ORDER BY fk.name, fkc.constraint_column_id`,
    );
  const fkMap = new Map<string, ForeignKeyAccumulator>();
  for (const r of res.recordset) {
    getOrCreate(fkMap, r.fk_name, () => ({
      refTable: r.ref_table,
      pairs: [],
    })).pairs.push({
      pos: Number(r.col_pos),
      col: r.col_name,
      refCol: r.ref_col,
    });
  }
  return flattenForeignKeys(fkMap);
}

export async function introspect(
  connectionUrl: string,
): Promise<IntrospectionResult> {
  const mssql = loadDriver<MssqlModule>("mssql");
  const cfg = parseSqlserverUrl(connectionUrl);
  const pool = await mssql.connect(cfg);
  const scope: SqlServerScope = { pool, driver: mssql };
  try {
    const tableRes = await pool.request().query<SqlServerTableRow>(
      `SELECT t.name AS table_name
         FROM sys.tables t
         JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo'
        ORDER BY t.name`,
    );
    const tables: IntrospectedTable[] = [];
    for (const { table_name: tableName } of tableRes.recordset) {
      tables.push({
        name: tableName,
        cols: await columnsFor(scope, tableName),
        indexes: await indexesFor(scope, tableName),
        fks: await foreignKeysFor(scope, tableName),
      });
    }
    tables.sort((a, b) => a.name.localeCompare(b.name));
    return { tables };
  } finally {
    await pool.close();
  }
}
