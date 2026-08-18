import { mapColumnType } from "../sql-dialect.ts";
import { fill } from "../fill.ts";
import {
  hasSystemUuidColumn,
  writableNonAuditFields,
  aliasedColumns,
  pluralizeEntity,
} from "./helpers.ts";
import {
  renderInParams,
  makeGenerateUpdate,
  type ProcField,
  type Param,
  type RenderCtx,
  type UpdateProcDialect,
  type Dialect,
} from "./driver.ts";
import {
  createTmpl,
  findOneTmpl,
  findAllTmpl,
  findByTmpl,
  updateTmpl,
  deleteTmpl,
  deleteOccTmpl,
} from "../../resources/procedures-postgres.ts";

export const dialectName = "postgres";
export const auditType = "TIMESTAMPTZ";

export const paramType = (field: ProcField): string => {
  if (field.type === "biginteger") return "BIGINT";
  return mapColumnType(dialectName, field);
};

export const generateCreate = ({
  entityName,
  table,
  idType,
  tableTok,
  pk,
}: RenderCtx): string => {
  const writable = writableNonAuditFields(table, idType);
  const pkType = paramType(pk);
  const uuidParam: Param[] = hasSystemUuidColumn(idType)
    ? [{ name: "uuid", type: "UUID" }]
    : [];
  const params: Param[] = [
    ...uuidParam,
    ...writable.map((f) => ({ name: f.name, type: paramType(f) })),
    { name: "created", type: "TIMESTAMPTZ" },
    { name: "updated", type: "TIMESTAMPTZ" },
  ];
  const cols = [
    ...(hasSystemUuidColumn(idType) ? ["uuid"] : []),
    ...writable.map((f) => f.name),
    "created",
    "updated",
  ];
  return fill(createTmpl, {
    entityName,
    params: renderInParams(params),
    pkType,
    tableTok,
    cols: cols.join(", "),
    pkName: pk.name,
  }).trimEnd();
};

export const generateFindOne = ({
  entityName,
  table,
  idType,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(findOneTmpl, {
    entityName,
    pkName: pk.name,
    pkType: paramType(pk),
    tableTok,
    aliasedCols: aliasedColumns(table, idType),
  }).trimEnd();

export const generateFindAll = ({
  entityName,
  table,
  idType,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(findAllTmpl, {
    plural: pluralizeEntity(entityName),
    tableTok,
    aliasedCols: aliasedColumns(table, idType),
    pkName: pk.name,
  }).trimEnd();

export const generateFindBy = (
  { entityName, table, idType, tableTok }: RenderCtx,
  field: ProcField,
): string =>
  fill(findByTmpl, {
    entityName,
    byField: field.name,
    fieldType: paramType(field),
    tableTok,
    aliasedCols: aliasedColumns(table, idType),
  }).trimEnd();

const updateDialect: UpdateProcDialect = {
  colRef: (c) => `t.${c}`,
  setLhs: (c) => c,
  argRef: (c, name) => `${name}.${c}`,
  wrap: (ctx, { name, params }, updateLines) =>
    fill(updateTmpl, {
      name,
      params: renderInParams(params),
      tableTok: ctx.tableTok,
      updateBody: updateLines.join("\n"),
    }).trimEnd(),
};

export const generateUpdate = makeGenerateUpdate(updateDialect);

export const generateDelete = ({
  entityName,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(deleteTmpl, {
    entityName,
    pkName: pk.name,
    pkType: paramType(pk),
    tableTok,
  }).trimEnd();

export const generateDeleteOcc = (
  { entityName, tableTok, pk }: RenderCtx,
  params: Param[],
): string =>
  fill(deleteOccTmpl, {
    entityName,
    params: renderInParams(params),
    tableTok,
    pkName: pk.name,
  }).trimEnd();

export const dialect: Dialect = {
  dialectName,
  auditType,
  paramType,
  generateCreate,
  generateFindOne,
  generateFindAll,
  generateFindBy,
  generateUpdate,
  generateDelete,
  generateDeleteOcc,
};
