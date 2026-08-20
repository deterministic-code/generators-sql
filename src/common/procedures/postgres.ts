import { mapColumnType } from "../sql-dialect.ts";
import { fill } from "@deterministic-code/generators-common/fill";
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

const dialectName = "postgres";
const native = (type: string): string =>
  mapColumnType(dialectName, { type });
const auditType = native("datetime");
const paramType = (field: ProcField): string =>
  mapColumnType(dialectName, field);

const generateCreate = ({
  entityName,
  table,
  idType,
  tableTok,
  pk,
}: RenderCtx): string => {
  const writable = writableNonAuditFields(table, idType);
  const pkType = paramType(pk);
  const uuidParam: Param[] = hasSystemUuidColumn(idType)
    ? [{ name: "uuid", type: native("uuid") }]
    : [];
  const params: Param[] = [
    ...uuidParam,
    ...writable.map((f) => ({ name: f.name, type: paramType(f) })),
    { name: "created", type: auditType },
    { name: "updated", type: auditType },
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

const generateFindOne = ({
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

const generateFindAll = ({
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

const generateFindBy = (
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
  wrap: (ctx, { name, params }, updateBody) =>
    fill(updateTmpl, {
      name,
      params: renderInParams(params),
      tableTok: ctx.tableTok,
      updateBody,
    }).trimEnd(),
};

const generateUpdate = makeGenerateUpdate(updateDialect);

const generateDelete = ({
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

const generateDeleteOcc = (
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
