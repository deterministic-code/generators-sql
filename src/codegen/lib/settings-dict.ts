import type { ParsedSettings } from "../../read-settings.ts";
import type { CaseFormat } from "../../case.ts";

export type SettingsDict = Record<string, string>;

const SUPPORTED_LANGUAGES = ["typescript", "csharp", "rust"] as const;

interface CasingQuartet {
  fileNames: CaseFormat | undefined;
  types: CaseFormat | undefined;
  fields: CaseFormat | undefined;
  directories: CaseFormat | undefined;
}

export function flattenSettings(parsed: ParsedSettings): SettingsDict {
  const dict: SettingsDict = {};
  const put = (key: string, value: string | number | boolean | undefined) => {
    if (value === undefined || value === null || value === "") return;
    dict[key] =
      typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  };
  put("application_name", parsed.applicationName);
  put("application_tier", parsed.applicationTier);
  put("backend.datasources", parsed.backend.datasources.join(","));
  put("backend.languages", parsed.backend.languages.join(","));
  put("comments", parsed.commentStyle);
  put("datasource.id_type", parsed.datasource.idType);
  put("datasource.uuid", parsed.datasource.uuid);
  put("datasource.datetime", parsed.datasource.datetime);
  put(
    "datasource.pluralize_datatable_names",
    parsed.datasource.pluralizeDatatableNames,
  );
  put(
    "datasource.use_stored_procedures",
    parsed.datasource.useStoredProcedures,
  );
  put(
    "datasource.use_optimistic_concurrency",
    parsed.datasource.useOptimisticConcurrency,
  );
  put("codegen.schema_version", parsed.codegen.schemaVersion);
  put("codegen.create_index", parsed.codegen.createIndex);
  put("other.organize_by_feature", parsed.other.organizeByFeature);
  put("other.generate_file_hash_list", parsed.other.generateFileHashList);
  put("other.error_on_hash_overwrite", parsed.other.errorOnHashOverwrite);
  put("other.reverse_proxy", parsed.other.reverseProxy);
  put("other.proxy_backend", parsed.other.proxyBackend);
  put("frontend.framework", parsed.frontend.framework);
  put("frontend.language", parsed.frontend.language);
  put("frontend.generate_validators", parsed.frontend.generateValidators);
  for (const lang of SUPPORTED_LANGUAGES) {
    const entry = parsed.languages[lang];
    if (!entry) continue;
    put(`languages.${lang}.casing.file_names`, entry.casing.fileNames);
    put(`languages.${lang}.casing.types`, entry.casing.types);
    put(`languages.${lang}.casing.fields`, entry.casing.fields);
    put(`languages.${lang}.casing.directories`, entry.casing.directories);
    put(`languages.${lang}.library_reference_mode`, entry.libraryReferenceMode);
  }
  return dict;
}

export function settingsStr(
  settings: SettingsDict,
  key: string,
): string | undefined {
  return settings[key];
}

export function settingsBool(settings: SettingsDict, key: string): boolean {
  return settings[key] === "true";
}

export function settingsList(settings: SettingsDict, key: string): string[] {
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

/** Rehydrate the nested settings shape the installed generator-sdk helpers (`datasourceSettingsForSettings`, `resolveSchemaDialects`, `resolveProxyTopology`, `parseDatasourceTypes`) still read, from the flat `SettingsDict` the generate boundary now carries. Keeps the local shared generators byte-identical while the flat contract is the single source at the `generate({ inputs, settings })` seam. */
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

export function casingFromDict(
  settings: SettingsDict,
  language: string,
): CasingQuartet {
  const at = (leaf: string): CaseFormat | undefined =>
    settings[`languages.${language}.casing.${leaf}`] as CaseFormat | undefined;
  return {
    fileNames: at("file_names"),
    types: at("types"),
    fields: at("fields"),
    directories: at("directories"),
  };
}
