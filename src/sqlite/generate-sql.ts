import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generateSqlFor } from "../common/generate-sql.ts";

export const generate = (ctx: GenerateContext): Promise<GenerateEntry[]> =>
  generateSqlFor("sqlite", ctx);
