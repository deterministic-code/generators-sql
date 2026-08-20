import { readFile } from "node:fs/promises";

const resource = (rel: string): Promise<string> =>
  readFile(
    new URL(`../templates/create-procedures/${rel}`, import.meta.url),
    "utf8",
  );

export const [paramsTmpl, updateBodyTmpl, dropRoutineTmpl] = await Promise.all([
  resource("params.sql.tmpl"),
  resource("update-body.sql.tmpl"),
  resource("drop-routine.sql.tmpl"),
]);
