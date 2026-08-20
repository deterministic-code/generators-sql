import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateProceduresForDialect } from "../common/generate-procedures.ts";

export const generate = (ctx: GenerateContext): Promise<GenerateEntry[]> =>
  generateProceduresForDialect("postgres", ctx);
