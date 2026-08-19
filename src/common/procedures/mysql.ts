import { fill } from "@deterministic-code/generators-common/fill";
import {
  hasSystemUuidColumn,
  writableNonAuditFields,
  aliasedColumns,
  pluralizeEntity,
} from "./helpers.ts";
import {
  renderInParams,
  charParamType,
  makeGenerateUpdate,
  type ProcField,
  type ProcTable,
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
} from "../../resources/procedures-mysql.ts";

export const dialectName = "mysql";
export const auditType = "VARCHAR(64)";

export const paramType = (field: ProcField): string =>
  charParamType(field, "VARCHAR", dialectName);

const renderParams = (params: Param[]): string =>
  renderInParams(params, "IN ");

const mysqlValueExpr = (name: string): string => {
  if (
    name === "created" ||
    name === "updated" ||
    name === "new_updated" ||
    name === "expected_updated"
  ) {
    return `CAST(REPLACE(REPLACE(${name}, 'T', ' '), 'Z', '') AS DATETIME(6))`;
  }
  return name;
};

const createProcParams = (
  table: ProcTable,
  idType: string | undefined,
): Param[] => {
  const writable = writableNonAuditFields(table, idType);
  return [
    ...(hasSystemUuidColumn(idType)
      ? [{ name: "uuid", type: "VARCHAR(36)" }]
      : []),
    ...writable.map((f) => ({ name: f.name, type: paramType(f) })),
    { name: "created", type: "VARCHAR(64)" },
    { name: "updated", type: "VARCHAR(64)" },
  ];
};

export const generateCreate = ({
  entityName,
  table,
  idType,
  tableTok,
  pk,
}: RenderCtx): string => {
  const generatedId = !hasSystemUuidColumn(idType);
  const writable = writableNonAuditFields(table, idType);
  const cols = generatedId
    ? [pk.name, ...writable.map((f) => f.name), "created", "updated"]
    : ["uuid", ...writable.map((f) => f.name), "created", "updated"];
  const vals = generatedId
    ? [
        "new_id",
        ...writable.map((f) => f.name),
        mysqlValueExpr("created"),
        mysqlValueExpr("updated"),
      ]
    : cols.map((c) => mysqlValueExpr(c));
  const selectAfterWrite =
    pk.type === "biginteger" || pk.type === "integer"
      ? `SELECT LAST_INSERT_ID() AS ${pk.name};`
      : `SELECT t.${pk.name} AS ${pk.name} FROM ${tableTok} t WHERE t.uuid = uuid;`;
  return fill(createTmpl, {
    entityName,
    params: renderParams(createProcParams(table, idType)),
    generatedId,
    tableTok,
    cols: cols.join(", "),
    vals: vals.join(", "),
    pkName: pk.name,
    selectAfterWrite,
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
  setLhs: (c) => `t.${c}`,
  argRef: (c) => mysqlValueExpr(c),
  wrap: (ctx, { name, params }, updateLines) =>
    fill(updateTmpl, {
      name,
      params: renderParams(params),
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
    params: renderParams(params),
    tableTok,
    pkName: pk.name,
    expectedUpdated: mysqlValueExpr("expected_updated"),
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
