import {
  contextFrom,
  type GenerateArg,
} from "./common/generate-context.ts";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateProceduresForDialect } from "./common/generate-procedures.ts";
import { dialectsFromSettings } from "./common/sql-dialect.ts";

/** Stored-procedure migrations for dialects in `backend.datasources` that support them. */
export const generate = async (arg: GenerateArg): Promise<GenerateEntry[]> => {
  const ctx = await contextFrom(arg);
  const entries: GenerateEntry[] = [];
  for (const dialect of dialectsFromSettings(ctx.settings)) {
    entries.push(...(await generateProceduresForDialect(dialect, ctx)));
  }
  return entries;
};
