import { readFile } from "node:fs/promises";

const resource = (rel: string): Promise<string> =>
  readFile(new URL(`../templates/create-sql/${rel}`, import.meta.url), "utf8");

export const [
  createTableTmpl,
  createIndexTmpl,
  insertSeedTmpl,
  migrationUpTmpl,
  migrationDownTmpl,
] = await Promise.all([
  resource("create-table.sql.tmpl"),
  resource("create-index.sql.tmpl"),
  resource("insert-seed.sql.tmpl"),
  resource("migration-up.sql.tmpl"),
  resource("migration-down.sql.tmpl"),
]);
