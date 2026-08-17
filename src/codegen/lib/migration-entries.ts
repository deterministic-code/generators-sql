import { CONTENT } from "@deterministic-code/generator-sdk/codegen/lib/generate-result";
import type { GenerateEntry } from "@deterministic-code/generator-sdk/codegen/lib/generate-result";

interface MigrationChain {
  up: { path: string; content: string };
  down: { path: string; content: string };
}

/** The up + down `content` entries for one dialect's initial-migration chain, each filed under `<dialect>/migrations/`. Shared by the console path and the shared datasource-objects generator so both build the pair one way. */
export function chainMigrationEntries(
  dialect: string,
  chain: unknown,
): GenerateEntry[] {
  const c = chain as MigrationChain;
  return [
    {
      kind: CONTENT,
      filename: `${dialect}/migrations/${c.up.path}`,
      contents: c.up.content,
    },
    {
      kind: CONTENT,
      filename: `${dialect}/migrations/${c.down.path}`,
      contents: c.down.content,
    },
  ];
}
