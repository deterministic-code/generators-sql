import { parseDatasourceTypes } from "./codegen/lib/parse-datasource-types.ts";
import { datasourceSettingsForSettings } from "./codegen/lib/ts-datasource-settings.ts";
import {
  buildLiveTables,
  normalizeDialect,
  supportsProcedures,
  type SchemaData,
} from "./lib/generate-sql.ts";
import {
  generateStoredProcedureSections,
  type SpOpts,
} from "./codegen/lib/generate-stored-procedures.ts";
import { byFieldsFromDatasource } from "./lib/datasource-by-fields.ts";
import { resolveDatasourceDialects } from "./codegen/lib/deterministic-project.ts";
import { chainMigrationEntries } from "./codegen/lib/migration-entries.ts";
import {
  INITIAL_MIGRATION_SEQUENCE,
  migrationStem,
} from "./lib/migration-sequence.ts";
import type { GenerateEntry } from "./codegen/lib/generate-result.ts";
import {
  structuredSettingsFromDict,
  type SettingsDict,
} from "./codegen/lib/settings-dict.ts";

interface BuildEntriesOptions {
  spOpts: SpOpts;
  tableOpts: Parameters<typeof buildLiveTables>[2];
}

interface StoredProceduresGenerateInput {
  inputs: { all: () => Promise<{ datasourceYamlText: string }> };
  settings: SettingsDict;
}

function migrationContent(lines: string[]): string {
  const joined = lines.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

function buildEntries(
  dialects: string[],
  data: SchemaData,
  { spOpts, tableOpts }: BuildEntriesOptions,
): GenerateEntry[] {
  const stem = migrationStem(
    INITIAL_MIGRATION_SEQUENCE + 1,
    "stored_procedures",
  );
  const entries: GenerateEntry[] = [];
  for (const lang of dialects) {
    const dialect = normalizeDialect(lang)!;
    if (!supportsProcedures(dialect)) continue;
    const liveTables = buildLiveTables(lang, data, tableOpts);
    const { up, down } = generateStoredProcedureSections({
      dialect,
      liveTables,
      spOpts,
    });
    if (up.length === 0) continue;
    const chain = {
      up: { path: `${stem}_up.sql`, content: migrationContent(up) },
      down: { path: `${stem}_down.sql`, content: migrationContent(down) },
    };
    entries.push(...chainMigrationEntries(dialect, chain));
  }
  return entries;
}

/** Shared stored-procedures step: fan the proc generator over the settings-resolved dialects (sqlite/oracle skipped — no stored procedures) into the migration that rides right after the initial schema (`0002_stored_procedures_{up,down}.sql`), so the normal migrate runner applies procedures for every language. Filed via `chainMigrationEntries` — the same `<dialect>/migrations/` owner as the initial migration — into the shared `sql/` tree. A no-op unless `settings.datasource.use_stored_procedures` is on. byField find/update variants come from the datasource's own `is_unique` fields + single-column unique indexes — never routes. */
export async function generate({
  inputs,
  settings,
}: StoredProceduresGenerateInput): Promise<GenerateEntry[]> {
  const project = structuredSettingsFromDict(settings);
  const ds = datasourceSettingsForSettings(project);
  if (!ds.useStoredProcedures) return [];

  const { datasourceYamlText } = await inputs.all();
  // parseDatasourceTypes yields DatasourceTypes; generate-sql consumes the same runtime object as SchemaData.
  const data = parseDatasourceTypes(
    datasourceYamlText,
    project,
  ) as unknown as SchemaData;
  const dialects = resolveDatasourceDialects({}, project);

  const idType = ds.idType;
  const pluralizeTableNames = ds.pluralizeTableNames;

  const spOpts = {
    enabled: true,
    useOptimisticConcurrency: ds.useOptimisticConcurrency,
    byFieldsByEntity: byFieldsFromDatasource(data),
    idType,
  };

  const entries = buildEntries(dialects, data, {
    spOpts,
    tableOpts: { pluralizeTableNames, idType },
  });
  return entries;
}
