import type { GenerateContext } from "../common/generate-context.ts";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";

/** oracle has no stored procedures in this pack. */
export const generate = async (
  _ctx: GenerateContext,
): Promise<GenerateEntry[]> => [];
