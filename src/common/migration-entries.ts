import { content, type GenerateEntry } from "@deterministic-code/generators-common/generate-entry";

type MigrationChain = {
  up: { path: string; content: string };
  down: { path: string; content: string };
};

/** Up + down `content` entries under `<dialect>/migrations/`. */
export const chainMigrationEntries = (
  dialect: string,
  chain: MigrationChain,
): GenerateEntry[] => [
  content(`${dialect}/migrations/${chain.up.path}`, chain.up.content),
  content(`${dialect}/migrations/${chain.down.path}`, chain.down.content),
];
