import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";

/** sqlite has no stored procedures. */
export const generate = async (
  _ctx: GenerateContext,
): Promise<GenerateEntry[]> => [];
