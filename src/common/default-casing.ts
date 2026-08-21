import {
  createCasingStrategy,
  type ICasingStrategy,
} from "@deterministic-code/generators-common/casing-strategy";
import pluralize from "pluralize";

export const GENERATOR_LANGUAGE = "sql";

const DATASOURCE_CASING = "datasource.casing";
const LANGUAGE_SQL_CASING = "languages.sql.casing";
const CASING_LEAVES = [
  "file_names",
  "types",
  "fields",
  "directories",
] as const;

/** Pluralize only the last `_`-token (`backend_type` → `backend_types`). */
const lastTokenPluralize = (name: string): string =>
  name ? name.replace(/[^_]+$/, (token) => pluralize(token)) : name;

const settingsForStrategy = (
  settings: Record<string, string>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const leaf of CASING_LEAVES) {
    const value = settings[`${DATASOURCE_CASING}.${leaf}`];
    if (value !== undefined) out[`${LANGUAGE_SQL_CASING}.${leaf}`] = value;
  }
  return out;
};

export type PackCasing = ICasingStrategy & {
  tableName: (entity: string) => string
  pluralTableName: (entity: string) => string
  columnName: (field: string) => string
  constraintName: (entity: string, ...parts: string[]) => string
  triggerName: (entity: string) => string
  routineName: (stem: string) => string
  fileBase: (stem: string) => string
  filePath: (stem: string) => string
  directory: (entity: string) => string
};

const strategyFromSettings = (
  settings: Record<string, string>,
): ICasingStrategy => {
  try {
    return createCasingStrategy(
      GENERATOR_LANGUAGE,
      settingsForStrategy(settings),
    );
  } catch (error) {
    throw new Error(
      (error as Error).message.replaceAll(LANGUAGE_SQL_CASING, DATASOURCE_CASING),
    );
  }
};

/** Datasource casing + last-token table pluralization. Generators call this. */
export const createCasing = (
  settings: Record<string, string>,
): PackCasing => {
  const casing = strategyFromSettings(settings);
  const pluralizeTableNames =
    String(settings["datasource.pluralize_datatable_names"]) !== "false";
  const physicalStem = (entity: string): string =>
    pluralizeTableNames ? lastTokenPluralize(entity) : entity;
  const tableName = (entity: string): string =>
    casing.convertTypes(physicalStem(entity));
  const fileBase = (stem: string): string => casing.convertFileName(stem);
  return {
    convertFileName: (text: string) => casing.convertFileName(text),
    convertTypes: (text: string) => casing.convertTypes(text),
    convertFields: (text: string) => casing.convertFields(text),
    convertDirectories: (text: string) => casing.convertDirectories(text),
    tableName,
    pluralTableName: (entity: string) =>
      casing.convertTypes(lastTokenPluralize(entity)),
    columnName: (field: string) => casing.convertFields(field),
    constraintName: (entity: string, ...parts: string[]) =>
      casing.convertTypes([physicalStem(entity), ...parts].join("_")),
    triggerName: (entity: string) =>
      casing.convertTypes(`trg_${physicalStem(entity)}_updated_at`),
    routineName: (stem: string) => casing.convertTypes(stem),
    fileBase,
    filePath: (stem: string) => `${fileBase(stem)}.sql`,
    directory: (entity: string) => casing.convertDirectories(entity),
  };
};

export const defaultCasing = (
  settings: Record<string, string>,
): ICasingStrategy => createCasing(settings);
