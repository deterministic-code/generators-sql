import {
  contextFrom,
  type GenerateArg,
} from "./common/generate-context.ts";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateProceduresForDialect } from "./common/generate-procedures.ts";
import { dialectsFromSettings } from "./common/sql-dialect.ts";

export {
  generateProceduresForDialect,
  generateStoredProceduresMigration,
} from "./common/generate-procedures.ts";

/** Stored-procedure migrations for every dialect that supports them. */
export const generate = async (arg: GenerateArg): Promise<GenerateEntry[]> => {
  const ctx = await contextFrom(arg);
  const entries: GenerateEntry[] = [];
  for (const dialect of dialectsFromSettings(ctx.settings)) {
    entries.push(...(await generateProceduresForDialect(dialect, ctx)));
  }
  return entries;
};
