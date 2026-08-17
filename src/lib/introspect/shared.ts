import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);

/** Load a CommonJS DB driver by module name and view it through the caller's hand-written surface type `T`. Centralizes the `createRequire` bootstrap every dialect otherwise repeats. */
export function loadDriver<T>(name: string): T {
  return requireCjs(name) as T;
}

export type OnSql = (label: string, sql: string) => void;

export interface IntrospectOptions {
  onSql?: OnSql;
}

export interface IntrospectedColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface IntrospectedIndex {
  name: string;
  cols: string[];
  unique: boolean;
}

export interface IntrospectedForeignKey {
  name: string;
  cols: string[];
  refTable: string;
  refCols: string[];
}

export interface IntrospectedTable {
  name: string;
  cols: IntrospectedColumn[];
  indexes: IntrospectedIndex[];
  fks: IntrospectedForeignKey[];
}

export interface IntrospectionResult {
  tables: IntrospectedTable[];
}

interface IndexColumn {
  pos: number;
  name: string;
}

export interface IndexAccumulator {
  unique: boolean;
  cols: IndexColumn[];
}

interface ForeignKeyPair {
  pos: number;
  col: string;
  refCol: string;
}

export interface ForeignKeyAccumulator {
  refTable: string;
  pairs: ForeignKeyPair[];
}

export function requireConnectionUrl(
  connectionUrl: string,
  dialect: string,
): void {
  if (typeof connectionUrl !== "string" || connectionUrl.length === 0) {
    throw new Error(
      `${dialect} introspect: connectionUrl must be a non-empty string`,
    );
  }
}

export function requireUrlPath(
  value: string,
  dialect: string,
  what: string,
): void {
  if (value.length === 0) {
    throw new Error(
      `${dialect} introspect: connectionUrl must include a ${what}`,
    );
  }
}

export function normalizeLog(onSql?: OnSql): OnSql {
  return typeof onSql === "function" ? onSql : () => {};
}

/** Return the existing map value for `key`, or store and return `make()` when absent. Collapses the has/get/set trio every dialect uses to group index columns and FK pairs. */
export function getOrCreate<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = make();
  map.set(key, created);
  return created;
}

export function flattenIndexes(
  idxMap: Map<string, IndexAccumulator>,
): IntrospectedIndex[] {
  const indexes: IntrospectedIndex[] = [];
  for (const [name, info] of idxMap) {
    info.cols.sort((a, b) => a.pos - b.pos);
    indexes.push({
      name,
      cols: info.cols.map((c) => c.name),
      unique: info.unique,
    });
  }
  indexes.sort((a, b) => a.name.localeCompare(b.name));
  return indexes;
}

export function flattenForeignKeys(
  fkMap: Map<string, ForeignKeyAccumulator>,
): IntrospectedForeignKey[] {
  const fks: IntrospectedForeignKey[] = [];
  for (const [name, info] of fkMap) {
    info.pairs.sort((a, b) => a.pos - b.pos);
    fks.push({
      name,
      cols: info.pairs.map((p) => p.col),
      refTable: info.refTable,
      refCols: info.pairs.map((p) => p.refCol),
    });
  }
  fks.sort((a, b) => a.name.localeCompare(b.name));
  return fks;
}
