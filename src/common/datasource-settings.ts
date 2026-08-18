import type { SettingsDict } from "./generate-context.ts";

export type { SettingsDict };

export type DatasourceSettings = {
  idType: string;
  withUuidColumn: boolean;
  pluralizeTableNames: boolean;
  useStoredProcedures: boolean;
  useOptimisticConcurrency: boolean;
};

/** Generate-options knobs SQL helpers already carry (id type, pluralize, OCC). */
export type DatasourceOptions = {
  idType?: string;
  pluralizeTableNames?: boolean;
  useStoredProcedures?: boolean;
  useOptimisticConcurrency?: boolean;
};

const fromIdType = (
  idType: string,
  extras: Omit<DatasourceSettings, "idType" | "withUuidColumn">,
): DatasourceSettings => ({
  idType,
  withUuidColumn: idType !== "uuid",
  ...extras,
});

/** Resolved datasource knobs from the flat generate-boundary dict. */
export const datasourceSettings = (
  settings: SettingsDict,
): DatasourceSettings =>
  fromIdType(settings["datasource.id_type"] ?? "integer", {
    pluralizeTableNames:
      settings["datasource.pluralize_datatable_names"] === "true",
    useStoredProcedures:
      settings["datasource.use_stored_procedures"] === "true",
    useOptimisticConcurrency:
      settings["datasource.use_optimistic_concurrency"] === "true",
  });

/** `DatasourceSettings` from a generate-options object. Absent knobs fall back to defaults. */
export const datasourceSettingsFor = (
  opts: DatasourceOptions = {},
): DatasourceSettings => {
  const { idType = "integer", ...rest } = opts;
  return fromIdType(idType, {
    pluralizeTableNames: true,
    useStoredProcedures: false,
    useOptimisticConcurrency: false,
    ...rest,
  });
};

/** Spec field shape a type-less `references: X.id` inherits from `datasource.id_type`. */
export const referenceFieldShape = (
  idType: string,
): { type: string; size: number | undefined } =>
  idType === "string"
    ? { type: "string", size: 64 }
    : {
        type: idType === "biginteger" || idType === "uuid" ? idType : "number",
        size: undefined,
      };

export type OptimisticConcurrencyEligible = {
  datasourceType?: string;
  optimisticConcurrency?: boolean;
};

/** Junction/readonly-lookup never OCC; per-type flag wins; else inherit global. */
export const entityUsesOptimisticConcurrency = (
  table: OptimisticConcurrencyEligible,
  globalFlag: boolean,
): boolean =>
  table.datasourceType !== "many-to-many" &&
  table.datasourceType !== "readonly-lookup" &&
  (table.optimisticConcurrency ?? globalFlag);

type AuditColumnsTable = OptimisticConcurrencyEligible & {
  fields: { name: string; primaryKey: boolean }[];
};

/** Readonly-lookup omits audit; custom-PK keeps `updated` only when OCC needs it. */
export const tableHasAuditColumns = (
  table: AuditColumnsTable,
  opts: { useOptimisticConcurrency?: boolean } = {},
): boolean => {
  if (table.datasourceType === "readonly-lookup") return false;
  const hasCustomPk = table.fields.some(
    (f) => f.primaryKey && f.name !== "id",
  );
  const occ = entityUsesOptimisticConcurrency(
    table,
    opts.useOptimisticConcurrency === true,
  );
  if (hasCustomPk) return occ;
  return true;
};
