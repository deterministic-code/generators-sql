import {
  getOrCreate,
  loadDriver,
  normalizeLog,
  requireConnectionUrl,
} from "./shared.ts";
import type {
  ForeignKeyAccumulator,
  IntrospectOptions,
  IntrospectedColumn,
  IntrospectedForeignKey,
  IntrospectedIndex,
  IntrospectedTable,
  IntrospectionResult,
  OnSql,
} from "./shared.ts";

interface SqliteStatement {
  all<T>(): T[];
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteDatabaseCtor {
  new (
    path: string,
    opts: { readonly: boolean; fileMustExist: boolean },
  ): SqliteDatabase;
}

interface SqliteTableRow {
  name: string;
}
interface SqliteColRow {
  name: string;
  type: string | null;
  notnull: number;
  pk: number;
  dflt_value: string | null | undefined;
}
interface SqliteIndexRow {
  name: string;
  origin: string;
  unique: number;
}
interface SqliteIndexInfoRow {
  seqno: number;
  name: string;
}
interface SqliteFkRow {
  id: number;
  table: string;
  seq: number;
  from: string;
  to: string;
}

function resolveDbPath(connectionUrl: string): string {
  requireConnectionUrl(connectionUrl, "sqlite");
  if (connectionUrl.startsWith("sqlite://"))
    return connectionUrl.slice("sqlite://".length);
  if (connectionUrl.startsWith("sqlite:"))
    return connectionUrl.slice("sqlite:".length);
  if (connectionUrl.startsWith("file:"))
    return connectionUrl.slice("file:".length);
  return connectionUrl;
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function columnsFor(
  db: SqliteDatabase,
  tableName: string,
  log: OnSql,
): IntrospectedColumn[] {
  const colSql = `PRAGMA table_info(${quoteIdent(tableName)})`;
  log(`columns ${tableName}`, colSql);
  return db
    .prepare(colSql)
    .all<SqliteColRow>()
    .map((r) => ({
      name: r.name,
      type: String(r.type ?? "").toUpperCase(),
      // PRAGMA reports notnull=0 for INTEGER PRIMARY KEY AUTOINCREMENT; PK is implicitly NOT NULL.
      nullable: r.pk !== 0 ? false : r.notnull === 0,
      default: r.dflt_value === undefined ? null : r.dflt_value,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function indexesFor(
  db: SqliteDatabase,
  tableName: string,
  log: OnSql,
): IntrospectedIndex[] {
  const idxListSql = `PRAGMA index_list(${quoteIdent(tableName)})`;
  log(`indexes ${tableName}`, idxListSql);
  const idxRows = db.prepare(idxListSql).all<SqliteIndexRow>();
  const indexes: IntrospectedIndex[] = [];
  for (const idx of idxRows) {
    if (idx.origin === "pk") continue;
    if (typeof idx.name === "string" && idx.name.startsWith("sqlite_"))
      continue;
    const idxInfoSql = `PRAGMA index_info(${quoteIdent(idx.name)})`;
    log(`index_info ${idx.name}`, idxInfoSql);
    const colInfo = db.prepare(idxInfoSql).all<SqliteIndexInfoRow>();
    const idxCols = colInfo
      .slice()
      .sort((a, b) => a.seqno - b.seqno)
      .map((c) => c.name);
    indexes.push({ name: idx.name, cols: idxCols, unique: idx.unique === 1 });
  }
  indexes.sort((a, b) => a.name.localeCompare(b.name));
  return indexes;
}

function foreignKeysFor(
  db: SqliteDatabase,
  tableName: string,
  log: OnSql,
): IntrospectedForeignKey[] {
  const fkSql = `PRAGMA foreign_key_list(${quoteIdent(tableName)})`;
  log(`foreign_keys ${tableName}`, fkSql);
  const fkRows = db.prepare(fkSql).all<SqliteFkRow>();
  const fkGroups = new Map<number, ForeignKeyAccumulator>();
  for (const fk of fkRows) {
    getOrCreate(fkGroups, fk.id, () => ({
      refTable: fk.table,
      pairs: [],
    })).pairs.push({ pos: fk.seq, col: fk.from, refCol: fk.to });
  }
  const fks: IntrospectedForeignKey[] = [];
  for (const [id, group] of fkGroups) {
    group.pairs.sort((a, b) => a.pos - b.pos);
    fks.push({
      name: `fk_${tableName}_${id}`,
      cols: group.pairs.map((p) => p.col),
      refTable: group.refTable,
      refCols: group.pairs.map((p) => p.refCol),
    });
  }
  fks.sort((a, b) => a.name.localeCompare(b.name));
  return fks;
}

export async function introspect(
  connectionUrl: string,
  { onSql }: IntrospectOptions = {},
): Promise<IntrospectionResult> {
  const log = normalizeLog(onSql);
  const Database = loadDriver<SqliteDatabaseCtor>("better-sqlite3");
  const dbPath = resolveDbPath(connectionUrl);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tablesSql =
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
    log("list tables", tablesSql);
    const tableRows = db.prepare(tablesSql).all<SqliteTableRow>();
    const tables: IntrospectedTable[] = tableRows.map((row) => ({
      name: row.name,
      cols: columnsFor(db, row.name, log),
      indexes: indexesFor(db, row.name, log),
      fks: foreignKeysFor(db, row.name, log),
    }));
    tables.sort((a, b) => a.name.localeCompare(b.name));
    return { tables };
  } finally {
    db.close();
  }
}
