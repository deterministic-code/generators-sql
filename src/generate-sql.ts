import {
  contextFrom,
  type GenerateArg,
} from "./common/generate-context.ts";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateSqlFor } from "./common/generate-sql.ts";
import { dialectsFromSettings } from "./common/sql-dialect.ts";

export {
  generateInitialMigration,
  generateSqlFor,
} from "./common/generate-sql.ts";
export { buildCustomMigrationFiles } from "./common/generate-custom-migrations.ts";

/** DDL + custom migrations for every configured SQL dialect. */
export const generate = async (arg: GenerateArg): Promise<GenerateEntry[]> => {
  const ctx = await contextFrom(arg);
  const entries: GenerateEntry[] = [];
  for (const dialect of dialectsFromSettings(ctx.settings)) {
    entries.push(...(await generateSqlFor(dialect, ctx)));
  }
  return entries;
};
