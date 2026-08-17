import {
  flattenForeignKeys,
  flattenIndexes,
  getOrCreate,
  loadDriver,
  normalizeLog,
  requireConnectionUrl,
  requireUrlPath,
} from "./shared.ts";
import type {
  ForeignKeyAccumulator,
  IndexAccumulator,
  IntrospectOptions,
  IntrospectedColumn,
  IntrospectedForeignKey,
  IntrospectedIndex,
  IntrospectedTable,
  IntrospectionResult,
  OnSql,
} from "./shared.ts";

interface MysqlField {
  name: string;
}
interface MysqlConnection {
  query<T>(sql: string, params?: string[]): Promise<[T[], MysqlField[]]>;
  end(): Promise<void>;
}
interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}
interface MysqlModule {
  createConnection(config: MysqlConfig): Promise<MysqlConnection>;
}
interface MysqlScope {
  conn: MysqlConnection;
  database: string;
}

interface MysqlTableRow {
  TABLE_NAME: string;
}
interface MysqlColRow {
  COLUMN_NAME: string;
  COLUMN_TYPE: string | null;
  IS_NULLABLE: string;
  COLUMN_DEFAULT: string | null | undefined;
}
interface MysqlIndexRow {
  INDEX_NAME: string;
  NON_UNIQUE: number;
  SEQ_IN_INDEX: number;
  COLUMN_NAME: string;
}
interface MysqlFkRow {
  CONSTRAINT_NAME: string;
  COLUMN_NAME: string;
  ORDINAL_POSITION: number;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
}

function parseMysqlUrl(connectionUrl: string): MysqlConfig {
  requireConnectionUrl(connectionUrl, "mysql");
  const u = new URL(connectionUrl);
  const database = u.pathname.replace(/^\//, "");
  requireUrlPath(database, "mysql", "database path");
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
}

async function columnsFor(
  scope: MysqlScope,
  tableName: string,
  log: OnSql,
): Promise<IntrospectedColumn[]> {
  const colSql = `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY COLUMN_NAME`;
  log(`columns ${tableName}`, `${colSql}  -- ?=${scope.database},${tableName}`);
  const [rows] = await scope.conn.query<MysqlColRow>(colSql, [
    scope.database,
    tableName,
  ]);
  return rows.map((r) => ({
    name: r.COLUMN_NAME,
    type: String(r.COLUMN_TYPE ?? "").toUpperCase(),
    nullable: r.IS_NULLABLE === "YES",
    default: r.COLUMN_DEFAULT === undefined ? null : r.COLUMN_DEFAULT,
  }));
}

async function indexesFor(
  scope: MysqlScope,
  tableName: string,
  log: OnSql,
): Promise<IntrospectedIndex[]> {
  const idxSql = `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY INDEX_NAME, SEQ_IN_INDEX`;
  log(`indexes ${tableName}`, `${idxSql}  -- ?=${scope.database},${tableName}`);
  const [rows] = await scope.conn.query<MysqlIndexRow>(idxSql, [
    scope.database,
    tableName,
  ]);
  const idxMap = new Map<string, IndexAccumulator>();
  for (const r of rows) {
    if (r.INDEX_NAME === "PRIMARY") continue;
    getOrCreate(idxMap, r.INDEX_NAME, () => ({
      unique: r.NON_UNIQUE === 0,
      cols: [],
    })).cols.push({ pos: Number(r.SEQ_IN_INDEX), name: r.COLUMN_NAME });
  }
  return flattenIndexes(idxMap);
}

async function foreignKeysFor(
  scope: MysqlScope,
  tableName: string,
  log: OnSql,
): Promise<IntrospectedForeignKey[]> {
  const fkSql = `SELECT CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION,
                REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = ?
            AND REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`;
  log(
    `foreign_keys ${tableName}`,
    `${fkSql}  -- ?=${scope.database},${tableName}`,
  );
  const [rows] = await scope.conn.query<MysqlFkRow>(fkSql, [
    scope.database,
    tableName,
  ]);
  const fkMap = new Map<string, ForeignKeyAccumulator>();
  for (const r of rows) {
    getOrCreate(fkMap, r.CONSTRAINT_NAME, () => ({
      refTable: r.REFERENCED_TABLE_NAME,
      pairs: [],
    })).pairs.push({
      pos: Number(r.ORDINAL_POSITION),
      col: r.COLUMN_NAME,
      refCol: r.REFERENCED_COLUMN_NAME,
    });
  }
  return flattenForeignKeys(fkMap);
}

export async function introspect(
  connectionUrl: string,
  { onSql }: IntrospectOptions = {},
): Promise<IntrospectionResult> {
  const log = normalizeLog(onSql);
  const mysql = loadDriver<MysqlModule>("mysql2/promise");
  const cfg = parseMysqlUrl(connectionUrl);
  const conn = await mysql.createConnection(cfg);
  const scope: MysqlScope = { conn, database: cfg.database };
  try {
    const tablesSql = `SELECT TABLE_NAME
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`;
    log("list tables", `${tablesSql}  -- ?=${cfg.database}`);
    const [tableRows] = await conn.query<MysqlTableRow>(tablesSql, [
      cfg.database,
    ]);
    const tables: IntrospectedTable[] = [];
    for (const row of tableRows) {
      const tableName = row.TABLE_NAME;
      tables.push({
        name: tableName,
        cols: await columnsFor(scope, tableName, log),
        indexes: await indexesFor(scope, tableName, log),
        fks: await foreignKeysFor(scope, tableName, log),
      });
    }
    tables.sort((a, b) => a.name.localeCompare(b.name));
    return { tables };
  } finally {
    await conn.end();
  }
}
