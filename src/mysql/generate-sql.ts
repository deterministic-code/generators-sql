import type { GenerateContext } from "../common/generate-context.ts";
import type { GenerateEntry } from "../common/generate-entry.ts";
import { generateSqlFor } from "../common/generate-sql.ts";

export const generate = (ctx: GenerateContext): Promise<GenerateEntry[]> =>
  generateSqlFor("mysql", ctx);
