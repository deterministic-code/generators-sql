import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateSqlFor } from "./common/generate-sql.ts";
import { dialectsFromSettings } from "./common/sql-dialect.ts";

/** DDL + custom migrations (+ stored procedures when enabled) for each dialect in `backend.datasources`. */
export const generate = async (ctx: GenerateContext): Promise<GenerateEntry[]> => {
  const entries: GenerateEntry[] = [];
  for (const dialect of dialectsFromSettings(ctx.settings)) {
    entries.push(...(await generateSqlFor(dialect, ctx)));
  }
  return entries;
};
