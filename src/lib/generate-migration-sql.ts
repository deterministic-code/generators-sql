import { diffValues } from "./deterministic-diff.ts";
import { effectiveTableName } from "./effective-table-name.ts";
import { topoSortEntities } from "./entity-topo-sort.ts";
import {
  SQL_DIALECTS,
  buildTableNameMappings,
  canonicalDialectName,
  columnDefForField,
  generateAddColumnUnique,
  generateCreateIndex,
  generateCreateTable,
  generateDrop,
  generateDropColumnUnique,
  generateDropIndex,
  generateIndexes,
  generateSeeds,
  generateUpdatedTrigger,
  generateUpdatedTriggerSqlite,
  extractSeedRows,
  mappedTableNameForEntity,
  tableHasAuditColumns,
  normalizeDialect,
  normalizeField,
  normalizeTable,
  q,
  renderSeedDelete,
  renderSeedInsert,
  renderSeedUpdate,
} from "./generate-sql.ts";
import type {
  SqlDialect,
  SchemaData,
  SeedValue,
  RawTableDef,
  RawFieldDef,
  RawIndexDef,
  RawTableEntry,
  NormalizedTable,
  NormalizedField,
} from "./generate-sql.ts";
import { loadFieldTypeCatalog } from "./field-type-catalog.ts";
import { fieldConverterFor } from "./field-converter.ts";

type SeedRow = Record<string, SeedValue>;
type RawIndexEntry = Record<string, RawIndexDef>;

/** The dialects that ALTER a column in place — every SQL dialect except sqlite, which rebuilds the table (`generateSqliteRebuilds`) and so never reaches `generateAlterColumn`. */
type AlterDialect = Exclude<SqlDialect, "sqlite">;

/** The heterogeneous payload a diff op carries, discriminated by its path: a table def (`types/<t>`), a field def (`types/<t>/fields/<f>`), the whole `indexes` collection, or a scalar seed/datasource cell. Each path-routed handler narrows to the shape its segment implies. */
type DiffValue = RawTableDef | RawFieldDef | RawIndexEntry[] | SeedValue;
interface DiffAdd {
  op: "add";
  path: string;
  value: DiffValue;
}
interface DiffRemove {
  op: "remove";
  path: string;
  from_value: DiffValue;
}
interface DiffReplace {
  op: "replace";
  path: string;
  value: DiffValue;
  from_value: DiffValue;
}
type DiffOp = DiffAdd | DiffRemove | DiffReplace;

interface FieldReplace {
  tableName: string;
  fieldName: string;
}

interface MigrationState {
  key: SqlDialect;
  beforeSchema: SchemaData;
  afterSchema: SchemaData;
  pluralizeTableNames: boolean;
  effective: (name: string, schemaForLookup?: SchemaData) => string;
  tableNameMappings: Map<string, string>;
  drops: string[];
  removedTables: RawTableEntry[];
  creates: string[];
  alters: string[];
  seedSection: string[];
  todos: string[];
  fieldReplaces: Map<string, FieldReplace>;
  seedDirtyTables: Set<string>;
  indexDirty: Set<string>;
}

interface SeedDiffEntry {
  table: NormalizedTable;
  beforeRows: Map<number, SeedRow>;
  afterRows: Map<number, SeedRow>;
  removeIds: number[];
  addIds: number[];
  updateIds: number[];
}

interface MigrationResult {
  path: string;
  content: string;
  todos: string[];
  isEmpty: boolean;
}

interface GenerateMigrationSqlOptions {
  dialect: string;
  beforeSchema: SchemaData;
  afterSchema: SchemaData;
  pluralizeTableNames?: boolean;
}

type SqlFieldConverter = ReturnType<typeof fieldConverterFor>;

const CATALOG = await loadFieldTypeCatalog();
const SQL_CONVERTERS = new Map<SqlDialect, SqlFieldConverter>();

/** The registered SQL converter for a dialect, cached — column types flow through the catalog-registered dialect converter so an unregistered dialect fails loudly. */
function sqlConverter(dialect: SqlDialect): SqlFieldConverter {
  const cached = SQL_CONVERTERS.get(dialect);
  if (cached) return cached;
  const converter = fieldConverterFor({
    targetKind: "dialect",
    target: dialect,
    catalog: CATALOG,
    datetimeRepr: undefined,
  });
  SQL_CONVERTERS.set(dialect, converter);
  return converter;
}

export function generateMigrationSql({
  dialect,
  beforeSchema,
  afterSchema,
  pluralizeTableNames = true,
}: GenerateMigrationSqlOptions): MigrationResult {
  const key = normalizeDialect(dialect);
  if (!key) {
    throw new Error(
      `Unknown SQL dialect "${dialect}". Valid: ${SQL_DIALECTS.join(", ")}.`,
    );
  }
  const state = makeState({
    key,
    beforeSchema,
    afterSchema,
    pluralizeTableNames,
  });
  const sections = [
    `-- Generated migration for ${canonicalDialectName(key)}`,
    "",
  ];

  for (const op of diffValues(beforeSchema, afterSchema) as DiffOp[]) {
    dispatchDiffOp(op, state);
  }

  const seedPerTable = buildSeedPerTable(state);
  generateSeedSections(state, seedPerTable);
  const sqliteRebuildTables = generateFieldReplaces(state);
  const indexChanges = generateIndexChanges(state, sqliteRebuildTables);
  generateDrops(state);

  assembleSections(sections, state, indexChanges);
  return finalizeResult(sections, state, indexChanges);
}

interface MakeStateArgs {
  key: SqlDialect;
  beforeSchema: SchemaData;
  afterSchema: SchemaData;
  pluralizeTableNames: boolean;
}

/** The migration generator applies pluralize_datatable_names to every generated identifier (CREATE/ALTER/DROP/INDEX/seed) as a one-time project decision — flipping it mid-project needs a manual RENAME migration; runtime resolves via datasource_mappings so the generator must agree. */
function makeState({
  key,
  beforeSchema,
  afterSchema,
  pluralizeTableNames,
}: MakeStateArgs): MigrationState {
  const effective = (
    name: string,
    schemaForLookup: SchemaData = afterSchema,
  ) => {
    const mapped = mappedTableNameForEntity(schemaForLookup, name);
    return mapped !== null
      ? mapped
      : effectiveTableName(name, pluralizeTableNames);
  };
  return {
    key,
    beforeSchema,
    afterSchema,
    pluralizeTableNames,
    effective,
    tableNameMappings: buildTableNameMappings(afterSchema),
    drops: [],
    removedTables: [],
    creates: [],
    alters: [],
    seedSection: [],
    todos: [],
    fieldReplaces: new Map(),
    seedDirtyTables: new Set(),
    indexDirty: new Set(),
  };
}

function dispatchDiffOp(op: DiffOp, state: MigrationState) {
  const segs = pathSegments(op.path);
  if (segs[0] === "types" && applyTypesDiff(op, segs, state)) return;
  // Any untranslated diff shape (non-`types` path, datatable-def scalar like skip_migrations, unknown collection) becomes a manual-migration TODO rather than a silent drop.
  state.todos.push(commentForUnknown(op));
}

/** Route a `types/<entity>/…` diff to its handler, returning false for any shape the generator leaves to the TODO tail. `diffValues` only ever generates add/remove at the entity and field-collection levels (property changes are `len >= 5` replaces), so there is no table- or field-level `replace` case to handle. */
function applyTypesDiff(
  op: DiffOp,
  segs: string[],
  state: MigrationState,
): boolean {
  const kind = segs[2];
  if (segs.length === 2) return applyEntityDiff(op, segs, state);
  if (kind === "fields") return applyFieldDiff(op, segs, state);
  if (kind === "seeds") return markSeedDirty(segs, state);
  if (kind === "indexes") return handleIndexDiff(op, segs, state);
  if (segs.length === 3 && kind === "datasource_type")
    return markDatasourceTypeTodo(op, state);
  return false;
}

// A `types/<entity>` diff is only ever add or remove (diffValues never generates a table-level replace), so `remove` is the else.
function applyEntityDiff(
  op: DiffOp,
  segs: string[],
  state: MigrationState,
): boolean {
  if (op.op === "add") return handleAddTable(op, segs, state);
  return handleRemoveTable(op, segs, state);
}

// A `types/<entity>/fields/…` diff is a field add/remove (len 4) or a field-property replace (len ≥ 5, the else).
function applyFieldDiff(
  op: DiffOp,
  segs: string[],
  state: MigrationState,
): boolean {
  if (segs.length === 4 && op.op === "add")
    return handleAddField(op, segs, state);
  if (segs.length === 4 && op.op === "remove")
    return handleRemoveField(segs, state);
  return markFieldReplace(segs, state);
}

function markFieldReplace(segs: string[], state: MigrationState): boolean {
  state.fieldReplaces.set(`${segs[1]}::${segs[3]}`, {
    tableName: segs[1],
    fieldName: segs[3],
  });
  return true;
}

function markSeedDirty(segs: string[], state: MigrationState): boolean {
  state.seedDirtyTables.add(segs[1]);
  return true;
}

function markDatasourceTypeTodo(op: DiffOp, state: MigrationState): boolean {
  state.todos.push(
    `-- TODO: manual migration required for datasource_type change at ${op.path}`,
  );
  return true;
}

function handleAddTable(
  op: DiffAdd,
  segs: string[],
  state: MigrationState,
): boolean {
  const tableName = segs[1];
  const def = op.value as RawTableDef;
  if (def.skip_migrations === true) return true;
  const table = normalizeTable(
    { [tableName]: def },
    { pluralizeTableNames: state.pluralizeTableNames, data: state.afterSchema },
  );
  // Mirror generateInitialMigration: CREATE TABLE → indexes → updated-at trigger.
  const block = [
    generateCreateTable(state.key, table, {
      tableNameMappings: state.tableNameMappings,
    }),
  ];
  const idx = generateIndexes(state.key, table);
  if (idx.length > 0) block.push(idx.join("\n"));
  if (tableHasAuditColumns(table))
    block.push(generateUpdatedTrigger(state.key, table));
  state.creates.push(block.join("\n"));
  const seedLines = generateSeeds(state.key, table);
  if (seedLines.length > 0) {
    state.seedSection.push(`-- Seeds: ${tableName}`);
    state.seedSection.push(seedLines.join("\n"));
    state.seedSection.push("");
  }
  return true;
}

function handleRemoveTable(
  op: DiffRemove | DiffReplace,
  segs: string[],
  state: MigrationState,
): boolean {
  const def = op.from_value as RawTableDef;
  if (def.skip_migrations === true) return true;
  state.removedTables.push({ [segs[1]]: def });
  return true;
}

function handleAddField(
  op: DiffAdd,
  segs: string[],
  state: MigrationState,
): boolean {
  const field = normalizeField({ [segs[3]]: op.value as RawFieldDef });
  const colDef = columnDefForField(state.key, field);
  // why: TSQL rejects "ADD COLUMN"; every other dialect requires it.
  const addKw = state.key === "sqlserver" ? "ADD" : "ADD COLUMN";
  state.alters.push(
    `ALTER TABLE ${q(state.key, state.effective(segs[1]))} ${addKw} ${colDef};`,
  );
  return true;
}

function handleRemoveField(segs: string[], state: MigrationState): boolean {
  state.alters.push(
    `ALTER TABLE ${q(state.key, state.effective(segs[1]))} DROP COLUMN ${q(state.key, segs[3])};`,
  );
  return true;
}

function handleIndexDiff(
  op: DiffOp,
  segs: string[],
  state: MigrationState,
): boolean {
  const tableName = segs[1];
  const indexName = segs[3];
  if (indexName) {
    state.indexDirty.add(`${tableName}::${indexName}`);
    return true;
  }
  // Parent-level add/remove of the entire `indexes` collection (`types/<t>/indexes`) — its value is the single-key index maps; dirty each so the drop/create runs.
  const arr = (op.op === "add" ? op.value : op.from_value) as RawIndexEntry[];
  for (const entry of arr) {
    state.indexDirty.add(`${tableName}::${Object.keys(entry)[0]}`);
  }
  return true;
}

function buildSeedPerTable(state: MigrationState): Map<string, SeedDiffEntry> {
  const seedPerTable = new Map<string, SeedDiffEntry>();
  for (const tableName of state.seedDirtyTables) {
    const entry = computeSeedDiff(state, tableName);
    if (entry) seedPerTable.set(tableName, entry);
  }
  return seedPerTable;
}

function computeSeedDiff(
  state: MigrationState,
  tableName: string,
): SeedDiffEntry | null {
  const beforeRaw = lookupRawTable(state.beforeSchema, tableName);
  const afterRaw = lookupRawTable(state.afterSchema, tableName);
  const table = normalizeTable(
    { [tableName]: afterRaw },
    { pluralizeTableNames: state.pluralizeTableNames, data: state.afterSchema },
  );
  if (table.skipMigrations) return null;
  const beforeRows = extractSeedRows(beforeRaw);
  const afterRows = extractSeedRows(afterRaw);
  const removeIds = [...beforeRows.keys()]
    .filter((id) => !afterRows.has(id))
    .sort((a, b) => a - b);
  const addIds = [...afterRows.keys()]
    .filter((id) => !beforeRows.has(id))
    .sort((a, b) => a - b);
  const updateIds = [...afterRows.keys()]
    .filter(
      (id) =>
        beforeRows.has(id) &&
        !rowsEqual(beforeRows.get(id)!, afterRows.get(id)!),
    )
    .sort((a, b) => a - b);
  if (removeIds.length === 0 && addIds.length === 0 && updateIds.length === 0) {
    return null;
  }
  return { table, beforeRows, afterRows, removeIds, addIds, updateIds };
}

/** FK-safe ordering: DELETEs run children-first, INSERTs parents-first, UPDATEs (FK-neutral) in between; topoSortEntities is parents-first, reversed for DELETEs. */
function generateSeedSections(
  state: MigrationState,
  seedPerTable: Map<string, SeedDiffEntry>,
) {
  const parentsFirst = topoSortEntities(state.afterSchema);
  const childrenFirst = [...parentsFirst].reverse();
  generateSeedDeletes(state, seedPerTable, childrenFirst);
  generateSeedUpdates(state, seedPerTable, parentsFirst);
  generateSeedInserts(state, seedPerTable, parentsFirst);
}

function pushSeedSection(
  state: MigrationState,
  tableName: string,
  lines: string[],
) {
  if (lines.length === 0) return;
  state.seedSection.push(`-- Seeds: ${tableName}`);
  state.seedSection.push(lines.join("\n"));
  state.seedSection.push("");
}

function generateSeedDeletes(
  state: MigrationState,
  seedPerTable: Map<string, SeedDiffEntry>,
  childrenFirst: string[],
) {
  for (const tableName of childrenFirst) {
    const entry = seedPerTable.get(tableName);
    if (!entry) continue;
    const lines = entry.removeIds.map((id) =>
      renderSeedDelete(state.key, entry.table, id),
    );
    pushSeedSection(state, tableName, lines);
  }
}

function generateSeedUpdates(
  state: MigrationState,
  seedPerTable: Map<string, SeedDiffEntry>,
  parentsFirst: string[],
) {
  for (const tableName of parentsFirst) {
    const entry = seedPerTable.get(tableName);
    if (!entry) continue;
    const lines = entry.updateIds.map((id) => {
      const changed = changedColumns(
        entry.beforeRows.get(id)!,
        entry.afterRows.get(id)!,
      );
      return renderSeedUpdate(
        { dialect: state.key, table: entry.table },
        { id, row: changed },
      );
    });
    pushSeedSection(state, tableName, lines);
  }
}

function generateSeedInserts(
  state: MigrationState,
  seedPerTable: Map<string, SeedDiffEntry>,
  parentsFirst: string[],
) {
  for (const tableName of parentsFirst) {
    const entry = seedPerTable.get(tableName);
    if (!entry || entry.addIds.length === 0) continue;
    pushSeedSection(
      state,
      tableName,
      buildInsertLines(state, tableName, entry),
    );
  }
}

function buildInsertLines(
  state: MigrationState,
  tableName: string,
  entry: SeedDiffEntry,
): string[] {
  const effectiveTable = state.effective(tableName);
  const lines: string[] = [];
  if (state.key === "sqlserver") {
    lines.push(`SET IDENTITY_INSERT ${q(state.key, effectiveTable)} ON;`);
  }
  for (const id of entry.addIds) {
    lines.push(
      renderSeedInsert(
        { dialect: state.key, table: entry.table },
        { id, row: entry.afterRows.get(id)! },
      ),
    );
  }
  if (state.key === "sqlserver") {
    lines.push(`SET IDENTITY_INSERT ${q(state.key, effectiveTable)} OFF;`);
  }
  if (state.key === "postgres") {
    lines.push(
      `SELECT setval(pg_get_serial_sequence('${effectiveTable}', 'id'), (SELECT MAX("id") FROM ${q(state.key, effectiveTable)}));`,
    );
  }
  return lines;
}

/** SQLite cannot ALTER COLUMN in place — each field-shape change becomes a full table rebuild (recreating indexes and the trigger inside), so indexDirty skips those tables. Other dialects ALTER the column and toggle column-level UNIQUE directly. */
function generateFieldReplaces(state: MigrationState): Set<string> {
  if (state.key === "sqlite") return generateSqliteRebuilds(state);
  generateAlterColumnReplaces(state, state.key);
  return new Set();
}

function generateSqliteRebuilds(state: MigrationState): Set<string> {
  const sqliteRebuildTables = new Set<string>();
  const tablesWithReplaces = new Set<string>();
  for (const { tableName } of state.fieldReplaces.values()) {
    tablesWithReplaces.add(tableName);
  }
  for (const tableName of tablesWithReplaces) {
    if (appendSqliteRebuild(state, tableName)) {
      sqliteRebuildTables.add(tableName);
    }
  }
  return sqliteRebuildTables;
}

function appendSqliteRebuild(
  state: MigrationState,
  tableName: string,
): boolean {
  const afterRaw = lookupRawTable(state.afterSchema, tableName);
  if (afterRaw.skip_migrations === true) return false;
  const beforeRaw = lookupRawTable(state.beforeSchema, tableName);
  const opts = { pluralizeTableNames: state.pluralizeTableNames };
  const afterTable = normalizeTable(
    { [tableName]: afterRaw },
    { ...opts, data: state.afterSchema },
  );
  const beforeTable = normalizeTable(
    { [tableName]: beforeRaw },
    { ...opts, data: state.beforeSchema },
  );
  state.alters.push(
    buildSqliteRebuildBlock({
      tableName: state.effective(tableName),
      afterTable,
      beforeTable,
      tableNameMappings: state.tableNameMappings,
    }),
  );
  return true;
}

function generateAlterColumnReplaces(state: MigrationState, key: AlterDialect) {
  for (const { tableName, fieldName } of state.fieldReplaces.values()) {
    // `key` is non-sqlite, so the unique-toggle generators never return null.
    const afterField = lookupField(state.afterSchema, tableName, fieldName);
    const beforeField = lookupField(state.beforeSchema, tableName, fieldName);
    const table = state.effective(tableName);
    if (beforeField.isUnique && !afterField.isUnique) {
      state.alters.push(generateDropColumnUnique(key, table, fieldName)!);
    } else if (!beforeField.isUnique && afterField.isUnique) {
      state.alters.push(generateAddColumnUnique(key, table, fieldName)!);
    }
    state.alters.push(generateAlterColumn(key, table, afterField));
  }
}

function generateIndexChanges(
  state: MigrationState,
  sqliteRebuildTables: Set<string>,
): string[] {
  const indexChanges: string[] = [];
  for (const dirty of state.indexDirty) {
    indexChanges.push(...indexChangesFor(state, dirty, sqliteRebuildTables));
  }
  return indexChanges;
}

function indexChangesFor(
  state: MigrationState,
  dirty: string,
  sqliteRebuildTables: Set<string>,
): string[] {
  const sep = dirty.indexOf("::");
  const tableName = dirty.slice(0, sep);
  const indexName = dirty.slice(sep + 2);
  if (sqliteRebuildTables.has(tableName)) return [];
  const beforeIdx = lookupIndex(state.beforeSchema, tableName, indexName);
  const afterIdx = lookupIndex(state.afterSchema, tableName, indexName);
  const table = state.effective(tableName);
  if (beforeIdx && afterIdx) {
    return [
      generateDropIndex(state.key, table, indexName),
      generateCreateIndex(state.key, table, afterIdx),
    ];
  }
  if (beforeIdx) return [generateDropIndex(state.key, table, indexName)];
  // A dirty index is always present in at least one schema, so `afterIdx` is the create side here.
  return [generateCreateIndex(state.key, table, afterIdx!)];
}

/** Drops run children-first: dropping a parent while junction rows still reference it trips FK enforcement (observed on sqlite with foreign_keys=ON). */
function generateDrops(state: MigrationState) {
  if (state.removedTables.length === 0) return;
  const removedParentsFirst = topoSortEntities({ types: state.removedTables });
  for (const tableName of removedParentsFirst.reverse()) {
    state.drops.push(
      generateDrop(state.key, {
        name: state.effective(tableName, state.beforeSchema),
      }),
    );
  }
}

interface SectionSpec {
  header: string;
  body: string[];
  joiner: string;
}

function appendSection(
  sections: string[],
  { header, body, joiner }: SectionSpec,
) {
  if (body.length === 0) return;
  sections.push(header);
  sections.push(body.join(joiner));
  sections.push("");
}

function assembleSections(
  sections: string[],
  state: MigrationState,
  indexChanges: string[],
) {
  appendSection(sections, {
    header: "-- Drop removed tables",
    body: state.drops,
    joiner: "\n",
  });
  appendSection(sections, {
    header: "-- Create added tables",
    body: state.creates,
    joiner: "\n\n",
  });
  appendSection(sections, {
    header: "-- Alter existing tables",
    body: state.alters,
    joiner: "\n",
  });
  appendSection(sections, {
    header: "-- Index changes",
    body: indexChanges,
    joiner: "\n",
  });
  appendSection(sections, {
    header: "-- Seed data",
    body: state.seedSection,
    joiner: "\n",
  });
  appendSection(sections, {
    header: "-- Unsupported diffs (manual migration required)",
    body: state.todos,
    joiner: "\n",
  });
}

function finalizeResult(
  sections: string[],
  state: MigrationState,
  indexChanges: string[],
): MigrationResult {
  const content = sections.join("\n").replace(/\n{3,}/g, "\n\n");
  const path = `migration.${canonicalDialectName(state.key).toLowerCase()}.sql`;
  const isEmpty =
    state.drops.length === 0 &&
    state.creates.length === 0 &&
    state.alters.length === 0 &&
    indexChanges.length === 0 &&
    state.seedSection.length === 0 &&
    state.todos.length === 0;
  return {
    path,
    // `sections` always ends with a "" entry (the header seed and every appendSection push one), so the joined content already ends in a newline.
    content,
    todos: state.todos,
    isEmpty,
  };
}

function pathSegments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

// The datatable/field lookups are only ever called for a datatable (and, for fields, a field) the diff proved present in `schema` — a removed datatable is an atomic `remove /types/<t>` op the diff never descends into — so the match always exists.
function lookupRawTable(schema: SchemaData, tableName: string): RawTableDef {
  const entry = schema.types.find((e) => Object.keys(e)[0] === tableName)!;
  return Object.values(entry)[0];
}

function lookupField(
  schema: SchemaData,
  tableName: string,
  fieldName: string,
): NormalizedField {
  const def = lookupRawTable(schema, tableName);
  const field = def.fields.find((f) => Object.keys(f)[0] === fieldName)!;
  const [fname, fdef] = Object.entries(field)[0];
  return normalizeField({ [fname]: fdef });
}

function lookupIndex(schema: SchemaData, tableName: string, indexName: string) {
  const raw = lookupRawTable(schema, tableName);
  const table = normalizeTable({ [tableName]: raw }, { data: schema });
  return table.indexes.find((idx) => idx.name === indexName) ?? null;
}

function rowsEqual(a: SeedRow, b: SeedRow): boolean {
  return Object.keys(changedColumns(a, b)).length === 0;
}

function changedColumns(before: SeedRow, after: SeedRow): SeedRow {
  const out: SeedRow = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    const bv: SeedValue | undefined = before[k];
    const av: SeedValue | undefined = after[k];
    if (bv === av) continue;
    if (bv === undefined && av === null) continue;
    if (av === undefined && bv === null) continue;
    out[k] = av === undefined ? null : av;
  }
  return out;
}

interface SqliteRebuildArgs {
  tableName: string;
  afterTable: NormalizedTable;
  beforeTable: NormalizedTable;
  tableNameMappings: Map<string, string>;
}

// SQLite has no in-place ALTER COLUMN / DROP CONSTRAINT, so any field-shape change is realized by creating a fresh table from the after-state, copying rows for fields that exist in both before and after, dropping the old table, and renaming the new one into place. Indexes and the updated-at trigger are recreated from the after-state because DROP TABLE destroys them with the original.
function buildSqliteRebuildBlock({
  tableName,
  afterTable,
  beforeTable,
  tableNameMappings,
}: SqliteRebuildArgs): string {
  const newName = `${tableName}__new`;
  const newTable = { ...afterTable, name: newName };
  const beforeFieldNames = new Set(beforeTable.fields.map((f) => f.name));
  const withAudit = tableHasAuditColumns(afterTable);
  const commonCols = withAudit ? ["id", "uuid"] : ["id"];
  for (const f of afterTable.fields) {
    if (beforeFieldNames.has(f.name)) commonCols.push(f.name);
  }
  if (withAudit) commonCols.push("created", "updated");
  const carryQuoted = commonCols.map((c) => q("sqlite", c)).join(", ");
  const lines = [
    `PRAGMA foreign_keys = OFF;`,
    generateCreateTable("sqlite", newTable, { tableNameMappings }),
    `INSERT INTO ${q("sqlite", newName)} (${carryQuoted})\n  SELECT ${carryQuoted} FROM ${q("sqlite", tableName)};`,
    `DROP TABLE ${q("sqlite", tableName)};`,
    `ALTER TABLE ${q("sqlite", newName)} RENAME TO ${q("sqlite", tableName)};`,
  ];
  for (const idx of afterTable.indexes) {
    lines.push(generateCreateIndex("sqlite", tableName, idx));
  }
  if (withAudit) {
    lines.push(generateUpdatedTriggerSqlite(afterTable));
  }
  lines.push(`PRAGMA foreign_keys = ON;`);
  return lines.join("\n");
}

function generateAlterColumn(
  dialect: AlterDialect,
  tableName: string,
  field: NormalizedField,
): string {
  const type = sqlConverter(dialect).nativeType(field);
  const tbl = q(dialect, tableName);
  const col = q(dialect, field.name);
  const nullClause = field.isNullable ? "NULL" : "NOT NULL";

  switch (dialect) {
    case "postgres": {
      const lines = [`ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${type};`];
      lines.push(
        field.isNullable
          ? `ALTER TABLE ${tbl} ALTER COLUMN ${col} DROP NOT NULL;`
          : `ALTER TABLE ${tbl} ALTER COLUMN ${col} SET NOT NULL;`,
      );
      return lines.join("\n");
    }
    case "mysql":
      return `ALTER TABLE ${tbl} MODIFY COLUMN ${col} ${type} ${nullClause};`;
    case "sqlserver":
      return `ALTER TABLE ${tbl} ALTER COLUMN ${col} ${type} ${nullClause};`;
    case "oracle":
      return `ALTER TABLE ${tbl} MODIFY (${col} ${type} ${nullClause});`;
  }
}

function commentForUnknown(op: DiffOp): string {
  return `-- TODO: manual migration required for ${op.op} at ${op.path}`;
}
