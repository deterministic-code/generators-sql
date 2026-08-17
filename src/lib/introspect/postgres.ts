import {
  flattenForeignKeys,
  flattenIndexes,
  getOrCreate,
  loadDriver,
  normalizeLog,
  requireConnectionUrl,
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

interface PgQueryResult<T> {
  rows: T[];
}
interface PgClient {
  connect(): Promise<void>;
  query<T>(sql: string, params?: string[]): Promise<PgQueryResult<T>>;
  end(): Promise<void>;
}
interface PgClientCtor {
  new (config: { connectionString: string }): PgClient;
}
interface PgModule {
  Client: PgClientCtor;
}

interface PgTableRow {
  table_name: string;
}
interface PgColRow {
  column_name: string;
  data_type: string | null;
  udt_name: string | null;
  is_nullable: string;
  column_default: string | null | undefined;
  character_maximum_length: number | null;
}
interface PgIndexRow {
  index_name: string;
  is_unique: boolean;
  is_primary: boolean;
  backs_constraint: boolean;
  column_name: string;
  col_pos: number | null;
}
interface PgFkRow {
  constraint_name: string;
  column_name: string;
  ordinal_position: number;
  ref_table: string;
  ref_column: string;
}

function postgresType(r: PgColRow): string {
  const dt = String(r.data_type ?? "").toUpperCase();
  if (dt === "CHARACTER VARYING")
    return r.character_maximum_length != null
      ? `VARCHAR(${r.character_maximum_length})`
      : "VARCHAR";
  if (dt === "CHARACTER")
    return r.character_maximum_length != null
      ? `CHAR(${r.character_maximum_length})`
      : "CHAR";
  if (dt === "TIMESTAMP WITH TIME ZONE") return "TIMESTAMPTZ";
  if (dt === "TIMESTAMP WITHOUT TIME ZONE") return "TIMESTAMP";
  if (dt === "DOUBLE PRECISION") return "DOUBLE PRECISION";
  if (dt === "USER-DEFINED") return String(r.udt_name ?? "").toUpperCase();
  return dt;
}

async function columnsFor(
  client: PgClient,
  tableName: string,
  log: OnSql,
): Promise<IntrospectedColumn[]> {
  const colSql = `SELECT column_name, data_type, udt_name, is_nullable, column_default,
                character_maximum_length, numeric_precision, numeric_scale
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY column_name`;
  log(`columns ${tableName}`, `${colSql}  -- $1=${tableName}`);
  const res = await client.query<PgColRow>(colSql, [tableName]);
  return res.rows.map((r) => ({
    name: r.column_name,
    type: postgresType(r),
    nullable: r.is_nullable === "YES",
    default: r.column_default === undefined ? null : r.column_default,
  }));
}

async function indexesFor(
  client: PgClient,
  tableName: string,
  log: OnSql,
): Promise<IntrospectedIndex[]> {
  const idxSql = `SELECT i.relname AS index_name,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                a.attname AS column_name,
                array_position(ix.indkey, a.attnum) AS col_pos,
                EXISTS (
                  SELECT 1 FROM pg_constraint c
                   WHERE c.conindid = i.oid
                     AND c.contype IN ('u','p')
                ) AS backs_constraint
           FROM pg_class t
           JOIN pg_index ix ON t.oid = ix.indrelid
           JOIN pg_class i ON i.oid = ix.indexrelid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public'
            AND t.relname = $1
            AND t.relkind = 'r'`;
  log(`indexes ${tableName}`, `${idxSql}  -- $1=${tableName}`);
  const res = await client.query<PgIndexRow>(idxSql, [tableName]);
  const idxMap = new Map<string, IndexAccumulator>();
  for (const r of res.rows) {
    if (r.is_primary) continue;
    if (r.backs_constraint) continue;
    getOrCreate(idxMap, r.index_name, () => ({
      unique: r.is_unique,
      cols: [],
    })).cols.push({ pos: Number(r.col_pos), name: r.column_name });
  }
  return flattenIndexes(idxMap);
}

async function foreignKeysFor(
  client: PgClient,
  tableName: string,
  log: OnSql,
): Promise<IntrospectedForeignKey[]> {
  const fkSql = `SELECT tc.constraint_name,
                kcu.column_name,
                kcu.ordinal_position,
                ccu.table_name AS ref_table,
                ccu.column_name AS ref_column,
                kcu.position_in_unique_constraint AS ref_pos
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
            AND tc.table_name = $1
          ORDER BY tc.constraint_name, kcu.ordinal_position`;
  log(`foreign_keys ${tableName}`, `${fkSql}  -- $1=${tableName}`);
  const res = await client.query<PgFkRow>(fkSql, [tableName]);
  const fkMap = new Map<string, ForeignKeyAccumulator>();
  for (const r of res.rows) {
    getOrCreate(fkMap, r.constraint_name, () => ({
      refTable: r.ref_table,
      pairs: [],
    })).pairs.push({
      pos: Number(r.ordinal_position),
      col: r.column_name,
      refCol: r.ref_column,
    });
  }
  return flattenForeignKeys(fkMap);
}

export async function introspect(
  connectionUrl: string,
  { onSql }: IntrospectOptions = {},
): Promise<IntrospectionResult> {
  requireConnectionUrl(connectionUrl, "postgres");
  const log = normalizeLog(onSql);
  const { Client } = loadDriver<PgModule>("pg");
  const client = new Client({ connectionString: connectionUrl });
  await client.connect();
  try {
    const tablesSql = `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name`;
    log("list tables", tablesSql);
    const tableRes = await client.query<PgTableRow>(tablesSql);
    const tables: IntrospectedTable[] = [];
    for (const { table_name: tableName } of tableRes.rows) {
      tables.push({
        name: tableName,
        cols: await columnsFor(client, tableName, log),
        indexes: await indexesFor(client, tableName, log),
        fks: await foreignKeysFor(client, tableName, log),
      });
    }
    tables.sort((a, b) => a.name.localeCompare(b.name));
    return { tables };
  } finally {
    await client.end();
  }
}
