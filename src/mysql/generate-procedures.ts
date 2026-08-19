import type { GenerateContext } from "../common/generate-context.ts";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateProceduresForDialect } from "../common/generate-procedures.ts";

export const generate = (ctx: GenerateContext): Promise<GenerateEntry[]> =>
  generateProceduresForDialect("mysql", ctx);
