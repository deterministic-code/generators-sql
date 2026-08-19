import type { GenerateContext } from "../common/generate-context.ts";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";

/** sqlite has no stored procedures. */
export const generate = async (
  _ctx: GenerateContext,
): Promise<GenerateEntry[]> => [];
