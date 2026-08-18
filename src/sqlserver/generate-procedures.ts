import type { GenerateContext } from "../common/generate-context.ts";
import type { GenerateEntry } from "../common/generate-entry.ts";
import { generateProceduresForDialect } from "../common/generate-procedures.ts";

export const generate = (ctx: GenerateContext): Promise<GenerateEntry[]> =>
  generateProceduresForDialect("sqlserver", ctx);
