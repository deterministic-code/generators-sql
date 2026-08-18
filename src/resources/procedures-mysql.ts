import { readFile } from "node:fs/promises";

const resource = (rel: string): Promise<string> =>
  readFile(
    new URL(`../templates/create-procedures/mysql/${rel}`, import.meta.url),
    "utf8",
  );

export const [
  createTmpl,
  findOneTmpl,
  findAllTmpl,
  findByTmpl,
  updateTmpl,
  deleteTmpl,
  deleteOccTmpl,
  migrationUpTmpl,
  migrationDownTmpl,
] = await Promise.all([
  resource("create.sql.tmpl"),
  resource("find-one.sql.tmpl"),
  resource("find-all.sql.tmpl"),
  resource("find-by.sql.tmpl"),
  resource("update.sql.tmpl"),
  resource("delete.sql.tmpl"),
  resource("delete-occ.sql.tmpl"),
  resource("migration-up.sql.tmpl"),
  resource("migration-down.sql.tmpl"),
]);
