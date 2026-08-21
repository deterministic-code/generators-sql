import {
  createCasingStrategy,
  type ICasingStrategy,
} from "@deterministic-code/generators-common/casing-strategy";
import pluralize from "pluralize";
import { applyKeywordCasing } from "./sql-keywords.ts";

export const GENERATOR_LANGUAGE = "sql";

const DATASOURCE_CASING = "datasource.casing";
const LANGUAGE_SQL_CASING = "languages.sql.casing";
const CASING_LEAVES = [
  "file_names",
  "types",
  "fields",
  "directories",
] as const;
const UPPER_LOWER = ["upper", "lower"] as const;
type UpperLower = (typeof UPPER_LOWER)[number];
type ObjectFormat = UpperLower | "preserve";

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
  keyword: (text: string) => string
  applyKeywords: (sql: string) => string
};

const parseUpperLower = (
  raw: string | undefined,
  path: string,
  fallback: UpperLower | "preserve",
): UpperLower | "preserve" => {
  if (raw === undefined || raw === "") return fallback;
  const parsed = raw.toLowerCase();
  if (parsed === "auto") return fallback;
  if (parsed === "upper" || parsed === "lower") return parsed;
  throw new Error(
    `${path} must be one of [${UPPER_LOWER.join(", ")}] (got "${raw}").`,
  );
};

const letterCase = (
  text: string,
  format: UpperLower | "preserve",
): string => {
  if (format === "upper") return text.toUpperCase();
  if (format === "lower") return text.toLowerCase();
  return text;
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
  const keywordFormat = parseUpperLower(
    settings[`${DATASOURCE_CASING}.keywords`],
    `${DATASOURCE_CASING}.keywords`,
    "upper",
  ) as UpperLower;
  const objectFormat = parseUpperLower(
    settings[`${DATASOURCE_CASING}.objects`],
    `${DATASOURCE_CASING}.objects`,
    "preserve",
  ) as ObjectFormat;
  const keyword = (text: string): string => letterCase(text, keywordFormat);
  const objectName = (text: string): string => letterCase(text, objectFormat);
  const pluralizeTableNames =
    String(settings["datasource.pluralize_datatable_names"]) !== "false";
  const physicalStem = (entity: string): string =>
    pluralizeTableNames ? lastTokenPluralize(entity) : entity;
  const tableName = (entity: string): string =>
    objectName(casing.convertTypes(physicalStem(entity)));
  const fileBase = (stem: string): string => casing.convertFileName(stem);
  return {
    convertFileName: (text: string) => casing.convertFileName(text),
    convertTypes: (text: string) => casing.convertTypes(text),
    convertFields: (text: string) => casing.convertFields(text),
    convertDirectories: (text: string) => casing.convertDirectories(text),
    tableName,
    pluralTableName: (entity: string) =>
      objectName(casing.convertTypes(lastTokenPluralize(entity))),
    columnName: (field: string) => casing.convertFields(field),
    constraintName: (entity: string, ...parts: string[]) =>
      objectName(
        casing.convertTypes([physicalStem(entity), ...parts].join("_")),
      ),
    triggerName: (entity: string) =>
      objectName(
        casing.convertTypes(`trg_${physicalStem(entity)}_updated_at`),
      ),
    routineName: (stem: string) => objectName(casing.convertTypes(stem)),
    fileBase,
    filePath: (stem: string) => `${fileBase(stem)}.sql`,
    directory: (entity: string) => casing.convertDirectories(entity),
    keyword,
    applyKeywords: (sql: string) =>
      keywordFormat === "lower" ? applyKeywordCasing(sql, keyword) : sql,
  };
};

export const defaultCasing = (
  settings: Record<string, string>,
): ICasingStrategy => createCasing(settings);
