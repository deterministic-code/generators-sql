import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateProceduresForDialect } from "./common/generate-procedures.ts";
import { dialectsFromSettings } from "./common/sql-dialect.ts";

/** Stored-procedure migrations for dialects in `backend.datasources` that support them. */
export const generate = async (ctx: GenerateContext): Promise<GenerateEntry[]> => {
  const entries: GenerateEntry[] = [];
  for (const dialect of dialectsFromSettings(ctx.settings)) {
    entries.push(...(await generateProceduresForDialect(dialect, ctx)));
  }
  return entries;
};
