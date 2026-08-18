export type SettingsDict = Record<string, string>;

function settingsStr(
  settings: SettingsDict,
  key: string,
): string | undefined {
  return settings[key];
}

function settingsBool(settings: SettingsDict, key: string): boolean {
  return settings[key] === "true";
}

function settingsList(settings: SettingsDict, key: string): string[] {
  const raw = settings[key];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface StructuredDatasource {
  idType: string | undefined;
  uuid: string | undefined;
  datetime: string | undefined;
  pluralizeDatatableNames: boolean;
  useStoredProcedures: boolean;
  useOptimisticConcurrency: boolean;
}

export interface StructuredSettings {
  applicationTier: string | undefined;
  backend: { datasources: string[]; languages: string[] };
  datasource: StructuredDatasource;
  other: {
    reverseProxy: string | undefined;
    proxyBackend: string | undefined;
    organizeByFeature: boolean;
  };
}

/** Rehydrate the nested settings shape helpers (`datasourceSettingsForSettings`, `resolveSchemaDialects`, `parseDatasourceTypes`) still read, from the flat `SettingsDict` the generate boundary carries. */
export function structuredSettingsFromDict(
  settings: SettingsDict,
): StructuredSettings {
  return {
    applicationTier: settingsStr(settings, "application_tier"),
    backend: {
      datasources: settingsList(settings, "backend.datasources"),
      languages: settingsList(settings, "backend.languages"),
    },
    datasource: {
      idType: settingsStr(settings, "datasource.id_type"),
      uuid: settingsStr(settings, "datasource.uuid"),
      datetime: settingsStr(settings, "datasource.datetime"),
      pluralizeDatatableNames: settingsBool(
        settings,
        "datasource.pluralize_datatable_names",
      ),
      useStoredProcedures: settingsBool(
        settings,
        "datasource.use_stored_procedures",
      ),
      useOptimisticConcurrency: settingsBool(
        settings,
        "datasource.use_optimistic_concurrency",
      ),
    },
    other: {
      reverseProxy: settingsStr(settings, "other.reverse_proxy"),
      proxyBackend: settingsStr(settings, "other.proxy_backend"),
      organizeByFeature: settingsBool(settings, "other.organize_by_feature"),
    },
  };
}
