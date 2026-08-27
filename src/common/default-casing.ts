import {
  createCasingStrategy,
  type ICasingStrategy,
} from "@deterministic-code/generators-common/casing-strategy";
import { createDatasourceNaming } from "@deterministic-code/generators-common/datasource-naming";
import { applyKeywordCasing } from "./sql-keywords.ts";

export const GENERATOR_LANGUAGE = "sql";

const DATASOURCE_CASING = "datasource.casing";
const UPPER_LOWER = ["upper", "lower"] as const;
type UpperLower = (typeof UPPER_LOWER)[number];
type ObjectFormat = UpperLower | "preserve";

export type PackCasing = ICasingStrategy & {
  isVerbatim: (mapping: string) => boolean
  tableName: (entity: string) => string
  /** Always-plural routine English (`find_contacts`); ignores the table flag. */
  pluralTableName: (entity: string) => string
  columnName: (field: string) => string
  constraintName: (entity: string, ...parts: string[]) => string
  triggerName: (entity: string) => string
  occTriggerName: (entity: string) => string
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

const letterCase = (text: string, format: ObjectFormat): string =>
  format === "upper"
    ? text.toUpperCase()
    : format === "lower"
      ? text.toLowerCase()
      : text;

/** Datasource naming + SQL-only keyword/object letter-case. */
export const createCasing = (
  settings: Record<string, string>,
): PackCasing => {
  const naming = createDatasourceNaming(settings);
  const alwaysPlural = createDatasourceNaming({
    ...settings,
    "datasource.pluralize_datatable_names": "true",
  });
  const casing = createCasingStrategy("sql", settings, {
    prefix: DATASOURCE_CASING,
  });
  const keywordFormat = parseUpperLower(
    settings[`${DATASOURCE_CASING}.keywords`],
    `${DATASOURCE_CASING}.keywords`,
    "upper",
  ) as UpperLower;
  const objectFormat = parseUpperLower(
    settings[`${DATASOURCE_CASING}.objects`],
    `${DATASOURCE_CASING}.objects`,
    "preserve",
  );
  const keyword = (text: string): string => letterCase(text, keywordFormat);
  const objectName = (text: string): string => letterCase(text, objectFormat);
  const objectIdent = (stem: string, converted: string): string =>
    naming.isVerbatim(stem) ? converted : objectName(converted);
  const fileBase = (stem: string): string => casing.convertFileName(stem);
  const trigger = (entity: string, suffix: string): string => {
    const stem = naming.physicalStem(entity);
    return naming.isVerbatim(entity)
      ? `trg_${entity}_${suffix}`
      : objectName(naming.tableName(`trg_${stem}_${suffix}`));
  };
  return {
    convertFileName: (text) => casing.convertFileName(text),
    convertTypes: (text) => casing.convertTypes(text),
    convertFields: (text) => casing.convertFields(text),
    convertDirectories: (text) => casing.convertDirectories(text),
    isVerbatim: naming.isVerbatim,
    tableName: (entity) => objectIdent(entity, naming.resolveTable(entity)),
    pluralTableName: (entity) =>
      objectIdent(entity, alwaysPlural.resolveTable(entity)),
    columnName: (field) => naming.resolveColumn(field),
    constraintName: (entity, ...parts) =>
      naming.isVerbatim(entity)
        ? [entity, ...parts].join("_")
        : objectName(
            naming.tableName([naming.physicalStem(entity), ...parts].join("_")),
          ),
    triggerName: (entity) => trigger(entity, "updated_at"),
    occTriggerName: (entity) => trigger(entity, "occ"),
    routineName: (stem) => objectIdent(stem, naming.tableName(stem)),
    fileBase,
    filePath: (stem) => `${fileBase(stem)}.sql`,
    directory: (entity) => casing.convertDirectories(entity),
    keyword,
    applyKeywords: (sql) =>
      keywordFormat === "lower" ? applyKeywordCasing(sql, keyword) : sql,
  };
};

export const defaultCasing = (
  settings: Record<string, string>,
): ICasingStrategy => createCasing(settings);
