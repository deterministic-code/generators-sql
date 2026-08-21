import { fill } from "@deterministic-code/generators-common/fill";
import { mapColumnType } from "../sql-dialect.ts";
import { createParamFields, aliasedColumns } from "./helpers.ts";
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
} from "../../resources/procedures-mysql.ts";

const dialectName = "mysql";
const paramType = (field: ProcField): string =>
  mapColumnType(dialectName, field);

const renderParams = (params: Param[]): string =>
  renderInParams(params, "IN ");

const generateCreate = ({
  routineName,
  table,
  tableTok,
  pk,
  casing,
}: RenderCtx): string => {
  const paramFields = createParamFields(table);
  const generatedId = pk.type === "uuid";
  const insertFields = generatedId ? table.fields : paramFields;
  const cols = insertFields.map((f) => casing.columnName(f.name));
  const vals = generatedId
    ? insertFields.map((f) =>
        f.name === pk.name ? "new_id" : casing.columnName(f.name),
      )
    : cols;
  return fill(createTmpl, {
    routineName,
    params: renderParams(
      paramFields.map((f) => ({
        name: casing.columnName(f.name),
        type: paramType(f),
      })),
    ),
    generatedId,
    lastInsertId: pk.type === "biginteger" || pk.type === "integer",
    tableTok,
    cols: cols.join(", "),
    vals: vals.join(", "),
    pkName: casing.columnName(pk.name),
    uuidCol: casing.columnName("uuid"),
  }).trimEnd();
};

const generateFindOne = ({
  routineName,
  table,
  tableTok,
  pk,
  casing,
}: RenderCtx): string =>
  fill(findOneTmpl, {
    routineName,
    pkName: casing.columnName(pk.name),
    pkType: paramType(pk),
    tableTok,
    aliasedCols: aliasedColumns(table, "t", casing.columnName),
  }).trimEnd();

const generateFindAll = ({
  routineName,
  table,
  tableTok,
  pk,
  casing,
}: RenderCtx): string =>
  fill(findAllTmpl, {
    routineName,
    tableTok,
    aliasedCols: aliasedColumns(table, "t", casing.columnName),
    pkName: casing.columnName(pk.name),
  }).trimEnd();

const generateFindBy = (
  { routineName, table, tableTok, casing }: RenderCtx,
  field: ProcField,
): string =>
  fill(findByTmpl, {
    routineName,
    byField: casing.columnName(field.name),
    fieldType: paramType(field),
    tableTok,
    aliasedCols: aliasedColumns(table, "t", casing.columnName),
  }).trimEnd();

const updateDialect: UpdateProcDialect = {
  colRef: (c) => `t.${c}`,
  setLhs: (c) => `t.${c}`,
  argRef: (c) => c,
  wrap: (ctx, { name, params }, updateBody) =>
    fill(updateTmpl, {
      name,
      params: renderParams(params),
      tableTok: ctx.tableTok,
      updateBody,
    }).trimEnd(),
};

const generateUpdate = makeGenerateUpdate(updateDialect);

const generateDelete = ({
  routineName,
  tableTok,
  pk,
  casing,
}: RenderCtx): string =>
  fill(deleteTmpl, {
    routineName,
    pkName: casing.columnName(pk.name),
    pkType: paramType(pk),
    tableTok,
  }).trimEnd();

const generateDeleteOcc = (
  { routineName, tableTok, pk, casing }: RenderCtx,
  params: Param[],
): string =>
  fill(deleteOccTmpl, {
    routineName,
    params: renderParams(params),
    tableTok,
    pkName: casing.columnName(pk.name),
    updatedCol: casing.columnName("updated"),
    expectedUpdated: casing.columnName("expected_updated"),
  }).trimEnd();

export const dialect: Dialect = {
  dialectName,
  paramType,
  generateCreate,
  generateFindOne,
  generateFindAll,
  generateFindBy,
  generateUpdate,
  generateDelete,
  generateDeleteOcc,
};
