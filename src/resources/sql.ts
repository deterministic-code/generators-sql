import { readFile } from "node:fs/promises";
import type { SqlDialect } from "../common/sql-dialect.ts";

const resource = (rel: string): Promise<string> =>
  readFile(new URL(`../templates/create-sql/${rel}`, import.meta.url), "utf8");

const optionalResource = async (rel: string): Promise<string> => {
  try {
    return await resource(rel);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
};

type DialectSqlTmpls = {
  dropTable: string;
  updatedTrigger: string;
  preamble: string;
  seedBefore: string;
  seedAfter: string;
  idColumn: string;
  uuidColumn: string;
};

const loadDialect = async (dialect: SqlDialect): Promise<DialectSqlTmpls> => ({
  dropTable: await resource(`${dialect}/drop-table.sql.tmpl`),
  updatedTrigger: await resource(`${dialect}/updated-trigger.sql.tmpl`),
  preamble: await optionalResource(`${dialect}/preamble.sql.tmpl`),
  seedBefore: await optionalResource(`${dialect}/seed-before.sql.tmpl`),
  seedAfter: await optionalResource(`${dialect}/seed-after.sql.tmpl`),
  idColumn: await resource(`${dialect}/id-column.sql.tmpl`),
  uuidColumn: await resource(`${dialect}/uuid-column.sql.tmpl`),
});

export const [
  createTableTmpl,
  createIndexTmpl,
  insertSeedTmpl,
  columnTmpl,
  foreignKeyTmpl,
  uniqueConstraintTmpl,
  migrationUpTmpl,
  migrationDownTmpl,
  dialectSql,
] = await Promise.all([
  resource("create-table.sql.tmpl"),
  resource("create-index.sql.tmpl"),
  resource("insert-seed.sql.tmpl"),
  resource("column.sql.tmpl"),
  resource("foreign-key.sql.tmpl"),
  resource("unique-constraint.sql.tmpl"),
  resource("migration-up.sql.tmpl"),
  resource("migration-down.sql.tmpl"),
  Promise.all(
    (["sqlite", "mysql", "postgres", "sqlserver", "oracle"] as const).map(
      async (d) => [d, await loadDialect(d)] as const,
    ),
  ).then(
    (entries) => Object.fromEntries(entries) as Record<SqlDialect, DialectSqlTmpls>,
  ),
]);
