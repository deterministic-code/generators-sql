import type { GenerateContext } from "../common/generate-context.ts";
import type { GenerateEntry } from "../common/generate-entry.ts";

/** sqlite has no stored procedures. */
export const generate = async (
  _ctx: GenerateContext,
): Promise<GenerateEntry[]> => [];
