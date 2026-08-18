import type { GenerateContext } from "../common/generate-context.ts";
import type { GenerateEntry } from "../common/generate-entry.ts";

/** oracle has no stored procedures in this pack. */
export const generate = async (
  _ctx: GenerateContext,
): Promise<GenerateEntry[]> => [];
