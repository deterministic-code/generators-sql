import { fill } from "@deterministic-code/generators-common/fill";
import { mapColumnType } from "../sql-dialect.ts";
import { createParamFields } from "./helpers.ts";
import {
  renderInParams,
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
} from "../../resources/procedures-sqlserver.ts";

const dialectName = "sqlserver";
const paramType = (field: ProcField): string =>
  mapColumnType(dialectName, field);

const allColumnNames = (table: ProcTable, columnName: (f: string) => string) =>
  table.fields.map((f) => columnName(f.name));

const renderParams = (params: Param[]): string =>
  renderInParams(params, "@");

const generateCreate = ({
  routineName,
  table,
  tableTok,
  casing,
}: RenderCtx): string => {
  const paramFields = createParamFields(table);
  const params: Param[] = paramFields.map((f) => ({
    name: casing.columnName(f.name),
    type: paramType(f),
  }));
  const cols = paramFields.map((f) => casing.columnName(f.name));
  return fill(createTmpl, {
    routineName,
    params: renderParams(params),
    tableTok,
    cols: cols.join(", "),
    placeholders: cols.map((c) => `@${c}`).join(", "),
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
    cols: allColumnNames(table, casing.columnName).join(", "),
    tableTok,
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
    cols: allColumnNames(table, casing.columnName).join(", "),
    tableTok,
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
    cols: allColumnNames(table, casing.columnName).join(", "),
    tableTok,
  }).trimEnd();

const updateDialect: UpdateProcDialect = {
  colRef: (c) => c,
  setLhs: (c) => c,
  argRef: (c) => `@${c}`,
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
