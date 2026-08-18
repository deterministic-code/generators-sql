import { DEFAULT_SQL_DIALECT, normalizeDialect } from "../sql.ts";

interface CliArgs {
  dialects?: string[];
  [flag: string]: unknown;
}

interface ProjectSettings {
  backend?: { datasources?: unknown };
  datasource?: unknown;
}

/** The dialect axis for a datasource SQL step: an explicit `--dialects` wins, else the project-wide `settings.backend.datasources` list, else a single default dialect. */
export function resolveDatasourceDialects(
  args: CliArgs,
  settings?: ProjectSettings,
): string[] {
  if (args.dialects?.length) return args.dialects;
  if (Array.isArray(settings?.backend?.datasources)) {
    return settings.backend.datasources;
  }
  return [DEFAULT_SQL_DIALECT];
}

/** The dialect list with sqlite appended when absent. The integration and verify tiers always boot on sqlite (`--provider sqlite`, `sql/sqlite/migrations`) regardless of configured dialects, so the generated schema and the migrate runner's dispatch/driver lanes must both carry sqlite. */
function withSqliteDialect(dialects: string[]): string[] {
  return dialects.some((d) => normalizeDialect(d) === "sqlite")
    ? dialects
    : [...dialects, "sqlite"];
}

/** The sqlite-inclusive schema dialects resolved from settings — see `withSqliteDialect`. */
export function resolveSchemaDialects(
  args: CliArgs,
  settings?: ProjectSettings,
): string[] {
  return withSqliteDialect(resolveDatasourceDialects(args, settings));
}
