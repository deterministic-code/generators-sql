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

interface OracleExecuteResult<T> {
  rows: T[];
}
interface OracleBinds {
  tname: string;
}
interface OracleConnection {
  outFormat: number;
  execute<T>(sql: string, binds?: OracleBinds): Promise<OracleExecuteResult<T>>;
  close(): Promise<void>;
}
interface OracleConfig {
  user: string;
  password: string;
  connectString: string;
}
interface OracleModule {
  OUT_FORMAT_OBJECT: number;
  getConnection(config: OracleConfig): Promise<OracleConnection>;
}

interface OracleTableRow {
  TABLE_NAME: string;
}
interface OracleColRow {
  COLUMN_NAME: string;
  DATA_TYPE: string | null;
  DATA_LENGTH: number | null;
  DATA_PRECISION: number | null;
  DATA_SCALE: number | null;
  NULLABLE: string;
  DATA_DEFAULT: string | null | undefined;
}
interface OracleIndexRow {
  INDEX_NAME: string;
  UNIQUENESS: string;
  COLUMN_POSITION: number;
  COLUMN_NAME: string;
}
interface OracleFkRow {
  CONSTRAINT_NAME: string;
  COL_NAME: string;
  COL_POS: number;
  REF_TABLE: string;
  REF_COL: string;
}

function parseOracleUrl(connectionUrl: string): OracleConfig {
  requireConnectionUrl(connectionUrl, "oracle");
  const u = new URL(connectionUrl);
  const serviceName = u.pathname.replace(/^\//, "");
  requireUrlPath(serviceName, "oracle", "service name path");
  const port = u.port ? Number(u.port) : 1521;
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    connectString: `${u.hostname}:${port}/${serviceName}`,
  };
}

function oracleType(r: OracleColRow): string {
  const t = String(r.DATA_TYPE ?? "").toUpperCase();
  if (
    t === "VARCHAR2" ||
    t === "NVARCHAR2" ||
    t === "CHAR" ||
    t === "NCHAR" ||
    t === "RAW"
  ) {
    return `${t}(${Number(r.DATA_LENGTH)})`;
  }
  if (t === "NUMBER") {
    if (
      r.DATA_PRECISION != null &&
      r.DATA_SCALE != null &&
      Number(r.DATA_SCALE) !== 0
    ) {
      return `NUMBER(${r.DATA_PRECISION},${r.DATA_SCALE})`;
    }
    if (r.DATA_PRECISION != null) {
      return `NUMBER(${r.DATA_PRECISION})`;
    }
    return "NUMBER";
  }
  return t;
}

async function columnsFor(
  conn: OracleConnection,
  tableName: string,
): Promise<IntrospectedColumn[]> {
  const res = await conn.execute<OracleColRow>(
    `SELECT column_name, data_type, data_length, data_precision, data_scale,
                nullable, data_default
           FROM user_tab_columns
          WHERE table_name = :tname
          ORDER BY column_name`,
    { tname: tableName },
  );
  return res.rows.map((r) => ({
    name: r.COLUMN_NAME,
    type: oracleType(r),
    nullable: r.NULLABLE === "Y",
    default:
      r.DATA_DEFAULT === undefined || r.DATA_DEFAULT === null
        ? null
        : String(r.DATA_DEFAULT).trim(),
  }));
}

async function indexesFor(
  conn: OracleConnection,
  tableName: string,
): Promise<IntrospectedIndex[]> {
  const res = await conn.execute<OracleIndexRow>(
    `SELECT i.index_name, i.uniqueness, ic.column_position, ic.column_name
           FROM user_indexes i
           JOIN user_ind_columns ic ON ic.index_name = i.index_name
          WHERE i.table_name = :tname
            AND i.index_type = 'NORMAL'
            AND NOT EXISTS (
                  SELECT 1 FROM user_constraints uc
                   WHERE uc.index_name = i.index_name AND uc.constraint_type = 'P'
                )
          ORDER BY i.index_name, ic.column_position`,
    { tname: tableName },
  );
  const idxMap = new Map<string, IndexAccumulator>();
  for (const r of res.rows) {
    getOrCreate(idxMap, r.INDEX_NAME, () => ({
      unique: r.UNIQUENESS === "UNIQUE",
      cols: [],
    })).cols.push({ pos: Number(r.COLUMN_POSITION), name: r.COLUMN_NAME });
  }
  return flattenIndexes(idxMap);
}

async function foreignKeysFor(
  conn: OracleConnection,
  tableName: string,
): Promise<IntrospectedForeignKey[]> {
  const res = await conn.execute<OracleFkRow>(
    `SELECT uc.constraint_name,
                ucc.column_name AS col_name,
                ucc.position AS col_pos,
                rcc.table_name AS ref_table,
                rcc.column_name AS ref_col,
                rcc.position AS ref_pos
           FROM user_constraints uc
           JOIN user_cons_columns ucc
             ON ucc.constraint_name = uc.constraint_name
           JOIN user_cons_columns rcc
             ON rcc.constraint_name = uc.r_constraint_name
            AND rcc.position = ucc.position
          WHERE uc.constraint_type = 'R'
            AND uc.table_name = :tname
          ORDER BY uc.constraint_name, ucc.position`,
    { tname: tableName },
  );
  const fkMap = new Map<string, ForeignKeyAccumulator>();
  for (const r of res.rows) {
    getOrCreate(fkMap, r.CONSTRAINT_NAME, () => ({
      refTable: r.REF_TABLE,
      pairs: [],
    })).pairs.push({
      pos: Number(r.COL_POS),
      col: r.COL_NAME,
      refCol: r.REF_COL,
    });
  }
  return flattenForeignKeys(fkMap);
}

export async function introspect(
  connectionUrl: string,
): Promise<IntrospectionResult> {
  const oracledb = loadDriver<OracleModule>("oracledb");
  const cfg = parseOracleUrl(connectionUrl);
  const conn = await oracledb.getConnection(cfg);
  try {
    conn.outFormat = oracledb.OUT_FORMAT_OBJECT;
    const tableRes = await conn.execute<OracleTableRow>(
      `SELECT table_name FROM user_tables ORDER BY table_name`,
    );
    const tables: IntrospectedTable[] = [];
    for (const row of tableRes.rows) {
      const tableName = row.TABLE_NAME;
      tables.push({
        name: tableName,
        cols: await columnsFor(conn, tableName),
        indexes: await indexesFor(conn, tableName),
        fks: await foreignKeysFor(conn, tableName),
      });
    }
    tables.sort((a, b) => a.name.localeCompare(b.name));
    return { tables };
  } finally {
    await conn.close();
  }
}
