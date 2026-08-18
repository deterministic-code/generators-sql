import { parse } from "yaml";
import {
  materializeReferenceTypes,
  type DatasourceTypes,
} from "./datasource-references.ts";
import {
  datasourceSettings,
  type SettingsDict,
} from "./datasource-settings.ts";

type SeedRows = unknown[];
type Named = Record<string, unknown>;

const isRecord = (value: unknown): value is Named =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const namedEntry = (
  value: unknown,
): [string, unknown] | undefined => {
  if (!isRecord(value)) return undefined;
  const pair = Object.entries(value)[0];
  return pair === undefined ? undefined : [pair[0], pair[1]];
};

/** Index `datasource_seeds.yaml` `seeds:` → table name → rows. */
const seedRowsByTable = (seedsYamlText: string): Map<string, SeedRows> => {
  const doc = parse(seedsYamlText);
  const list = isRecord(doc) && Array.isArray(doc.seeds) ? doc.seeds : [];
  const byTable = new Map<string, SeedRows>();
  for (const entry of list) {
    const pair = namedEntry(entry);
    if (pair !== undefined && Array.isArray(pair[1])) {
      byTable.set(pair[0], pair[1]);
    }
  }
  return byTable;
};

/** Fold companion seed rows onto each type def under `seeds`. */
const hydrateSeeds = (
  data: DatasourceTypes,
  seedsYamlText: string | null | undefined,
): DatasourceTypes => {
  if (!seedsYamlText) return data;
  const byTable = seedRowsByTable(seedsYamlText);
  if (byTable.size === 0) return data;
  for (const entry of data.types ?? []) {
    const pair = namedEntry(entry);
    if (pair === undefined || !isRecord(pair[1]) || !byTable.has(pair[0])) {
      continue;
    }
    pair[1].seeds = byTable.get(pair[0]);
  }
  return data;
};

/** Parse datasource_types YAML, resolve type-less `references`, optionally hydrate seeds. */
export const parseDatasourceTypes = (
  datasourceYamlText: string,
  settings: SettingsDict,
  seedsYamlText?: string | null,
): DatasourceTypes => {
  const { idType } = datasourceSettings(settings);
  const data = materializeReferenceTypes(
    parse(datasourceYamlText) as DatasourceTypes,
    idType,
  );
  return hydrateSeeds(data, seedsYamlText);
};
