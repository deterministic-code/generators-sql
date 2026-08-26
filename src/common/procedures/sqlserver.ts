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
  columnName,
}: RenderCtx): string => {
  const paramFields = createParamFields(table);
  const params: Param[] = paramFields.map((f) => ({
    name: columnName(f.name),
    type: paramType(f),
  }));
  const cols = paramFields.map((f) => columnName(f.name));
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
  columnName,
}: RenderCtx): string =>
  fill(findOneTmpl, {
    routineName,
    pkName: columnName(pk.name),
    pkType: paramType(pk),
    cols: allColumnNames(table, columnName).join(", "),
    tableTok,
  }).trimEnd();

const generateFindAll = ({
  routineName,
  table,
  tableTok,
  pk,
  columnName,
}: RenderCtx): string =>
  fill(findAllTmpl, {
    routineName,
    cols: allColumnNames(table, columnName).join(", "),
    tableTok,
    pkName: columnName(pk.name),
  }).trimEnd();

const generateFindBy = (
  { routineName, table, tableTok, columnName }: RenderCtx,
  field: ProcField,
): string =>
  fill(findByTmpl, {
    routineName,
    byField: columnName(field.name),
    fieldType: paramType(field),
    cols: allColumnNames(table, columnName).join(", "),
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
  columnName,
}: RenderCtx): string =>
  fill(deleteTmpl, {
    routineName,
    pkName: columnName(pk.name),
    pkType: paramType(pk),
    tableTok,
  }).trimEnd();

const generateDeleteOcc = (
  { routineName, tableTok, pk, columnName, table }: RenderCtx,
  params: Param[],
): string =>
  fill(deleteOccTmpl, {
    routineName,
    params: renderParams(params),
    tableTok,
    pkName: columnName(pk.name),
    occCol: table.occField
      ? columnName(table.occField.name)
      : columnName("updated"),
    expectedOcc: table.occField
      ? `expected_${columnName(table.occField.name)}`
      : columnName("expected_updated"),
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
