import type { GenerateContext } from "../common/generate-context.ts";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateSqlFor } from "../common/generate-sql.ts";

export const generate = (ctx: GenerateContext): Promise<GenerateEntry[]> =>
  generateSqlFor("sqlserver", ctx);
