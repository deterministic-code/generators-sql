import { DatasourceSettings } from "../datasource-settings.ts";

type DatasourceInput = NonNullable<
  ConstructorParameters<typeof DatasourceSettings>[0]
>;

interface SettingsWithDatasource {
  datasource?: DatasourceInput;
}

export interface DatasourceOptions {
  idType?: string;
  uuid?: string;
  datetime?: string;
  pluralizeTableNames?: boolean;
  useStoredProcedures?: boolean;
  useOptimisticConcurrency?: boolean;
}

/** `DatasourceSettings` from loader-resolved settings — wraps `settings.datasource`. */
export function datasourceSettingsForSettings(
  settings: SettingsWithDatasource,
): DatasourceSettings {
  return new DatasourceSettings(settings.datasource);
}

/** `DatasourceSettings` from a generic (possibly partial) generate-options object. Absent knobs fall back to the class defaults (integer / string uuid / native datetime). */
export function datasourceSettingsFor(
  opts: DatasourceOptions = {},
): DatasourceSettings {
  return new DatasourceSettings({
    idType: opts.idType,
    uuid: opts.uuid,
    datetime: opts.datetime,
    pluralizeDatatableNames: opts.pluralizeTableNames,
    useStoredProcedures: opts.useStoredProcedures,
    useOptimisticConcurrency: opts.useOptimisticConcurrency,
  });
}
