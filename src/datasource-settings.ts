interface ReferenceShape {
  type: string;
  size: number | undefined;
}

/** The datasource field/column shape a `references: X.id` FK inherits from its parent primary key under each id_type. Integer ids present as `number` (matching the sample convention), NOT `integer`; both map to the same SQL column, but only `number` matches the id's field type. */
const REFERENCE_SHAPE: Record<string, ReferenceShape> = {
  integer: { type: "number", size: undefined },
  biginteger: { type: "biginteger", size: undefined },
  uuid: { type: "uuid", size: undefined },
  string: { type: "string", size: 64 },
};

const DEFAULTS = { idType: "integer" };

interface DatasourceInput {
  idType?: string;
  uuid?: string;
  datetime?: string;
  pluralizeDatatableNames?: boolean;
  useStoredProcedures?: boolean;
  useOptimisticConcurrency?: boolean;
}

/** The resolved `settings.datasource` block the SQL lanes read. Construct from settings via `datasourceSettingsForSettings`; `datasourceSettingsFor(opts)` is the direct-call adapter. */
export class DatasourceSettings {
  idType: string;
  pluralizeTableNames: boolean;
  useStoredProcedures: boolean;
  useOptimisticConcurrency: boolean;

  constructor(datasource: DatasourceInput = {}) {
    this.idType = datasource.idType ?? DEFAULTS.idType;
    this.pluralizeTableNames = datasource.pluralizeDatatableNames !== false;
    this.useStoredProcedures = datasource.useStoredProcedures === true;
    this.useOptimisticConcurrency =
      datasource.useOptimisticConcurrency === true;
  }

  /** A uuid primary key IS the uuid, so no separate system `uuid` column is carried. */
  get withUuidColumn(): boolean {
    return this.idType !== "uuid";
  }

  /** The `{ type, size }` a `references:` FK takes from the parent primary key it points at. */
  referenceFieldShape(): ReferenceShape {
    return REFERENCE_SHAPE[this.idType] ?? REFERENCE_SHAPE.integer;
  }
}
