import {
  applyFieldMappingsToTable,
  generateCreateTable,
  generateIndexes,
  generateUpdatedTrigger,
  fieldMappingsForEntity,
  mappedTableNameForEntity,
  normalizeDialect,
  normalizeTable,
  SQL_DIALECTS,
  tableHasAuditColumns,
  topoSort,
} from "../../lib/generate-sql.ts";
import type {
  GenerateTableOptions,
  NormalizedTable,
  SchemaData,
  SqlDialect,
} from "../../lib/generate-sql.ts";
import { datasourceSettingsFor } from "./ts-datasource-settings.ts";

interface EntityStatementOptions {
  idType?: string;
  withUuidColumn: boolean;
  tableNameMappings: Map<string, string>;
}

function generateEntityStatements(
  key: SqlDialect,
  tableForDdl: NormalizedTable,
  { idType, withUuidColumn, tableNameMappings }: EntityStatementOptions,
): string[] {
  const statements = [
    generateCreateTable(key, tableForDdl, {
      idType,
      withUuidColumn,
      tableNameMappings,
      skipForeignKeys: true,
    }),
    ...generateIndexes(key, tableForDdl),
  ];
  if (tableHasAuditColumns(tableForDdl)) {
    statements.push(generateUpdatedTrigger(key, tableForDdl));
  }
  return statements;
}

/** Pure-function module — returns string[] of CREATE TABLE/INDEX/TRIGGER statements for every skip_migrations entity in `data`. The scaffold CLI stamps these into deterministic/custom/<dialect>/*_up.sql. */
export function scaffoldSkipMigrationsDdl(
  dialect: string,
  datasourceData: SchemaData,
  opts: GenerateTableOptions = {},
): string[] {
  const key = normalizeDialect(dialect);
  if (!key) {
    throw new Error(
      `Unknown SQL dialect "${dialect}". Valid: ${SQL_DIALECTS.join(", ")}.`,
    );
  }
  const idType = datasourceSettingsFor(opts).idType;
  const withUuidColumn = opts.withUuidColumn ?? true;
  const pluralizeTableNames = opts.pluralizeTableNames === true;

  const tables = (datasourceData?.types ?? []).map((t) =>
    normalizeTable(t, { pluralizeTableNames, data: datasourceData }),
  );
  const tableNameMappings = new Map<string, string>();
  for (const t of tables) {
    const mapped = mappedTableNameForEntity(datasourceData, t.entityName);
    if (mapped !== null) tableNameMappings.set(t.entityName, mapped);
  }

  return topoSort(tables)
    .filter((t) => t.skipMigrations)
    .flatMap((t) =>
      generateEntityStatements(
        key,
        applyFieldMappingsToTable(
          t,
          fieldMappingsForEntity(datasourceData, t.entityName),
        ),
        { idType, withUuidColumn, tableNameMappings },
      ),
    );
}
