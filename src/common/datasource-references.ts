import { referenceFieldShape } from "./datasource-settings.ts";

type FieldDef = {
  type?: string;
  size?: number;
  references?: string;
  primary_key?: boolean;
  [key: string]: unknown;
};
type FieldEntry = Record<string, FieldDef>;
type EntityDef = { fields?: FieldEntry[]; [key: string]: unknown };
type TypeEntry = Record<string, EntityDef>;

export type DatasourceTypes = { types?: TypeEntry[] };

type ReferenceParentType = {
  type: string | undefined;
  size: number | undefined;
};

const named = <T,>(entry: Record<string, T>): [string, T] =>
  Object.entries(entry)[0];

const findEntityDef = (
  types: TypeEntry[],
  entityName: string,
): EntityDef | undefined => {
  for (const entry of types) {
    const [name, def] = named(entry);
    if (name === entityName) return def;
  }
  return undefined;
};

const explicitPk = (parentDef: EntityDef): [string, FieldDef] | undefined => {
  const entry = (parentDef.fields ?? []).find(
    (f) => Object.values(f)[0]?.primary_key === true,
  );
  return entry ? named(entry) : undefined;
};

/** `{ type, size }` a `references: <entity>.<col>` FK inherits from the parent PK. */
export const resolveReferenceParentType = (
  references: unknown,
  types: unknown,
  idType: string,
): ReferenceParentType | null => {
  const parts = String(references).split(".");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") return null;
  if (!Array.isArray(types)) return null;
  const parentDef = findEntityDef(types, parts[0]);
  if (!parentDef) return null;
  const pk = explicitPk(parentDef);
  if (pk) return parts[1] === pk[0] ? { type: pk[1].type, size: pk[1].size } : null;
  return parts[1] === "id" ? referenceFieldShape(idType) : null;
};

/** Stamp parent-PK `type`/`size` onto type-less `references` fields. Mutates + returns. */
export const materializeReferenceTypes = (
  datasourceTypes: DatasourceTypes,
  idType: string,
): DatasourceTypes => {
  for (const entry of datasourceTypes.types ?? []) {
    const def = Object.values(entry)[0];
    for (const fieldEntry of def.fields ?? []) {
      const [fieldName, fdef] = named(fieldEntry);
      if (!fdef.references || fdef.type !== undefined) continue;
      const parent = resolveReferenceParentType(
        fdef.references,
        datasourceTypes.types,
        idType,
      );
      if (!parent) {
        throw new Error(
          `invariant: type-less reference "${fieldName}" -> "${fdef.references}" has no resolvable parent primary key`,
        );
      }
      fieldEntry[fieldName] =
        parent.size !== undefined
          ? { type: parent.type, size: parent.size, ...fdef }
          : { type: parent.type, ...fdef };
    }
  }
  return datasourceTypes;
};
