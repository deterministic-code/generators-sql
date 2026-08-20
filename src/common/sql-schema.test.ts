import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { datasourceSettings } from "./sql-schema.ts";

describe("datasourceSettings use_stored_procedures", () => {
  it("is off by default", () => {
    assert.equal(datasourceSettings({}).useStoredProcedures, false);
  });

  it("turns on for the string true", () => {
    assert.equal(
      datasourceSettings({ "datasource.use_stored_procedures": "true" })
        .useStoredProcedures,
      true,
    );
  });

  it("stays off for the string false", () => {
    assert.equal(
      datasourceSettings({ "datasource.use_stored_procedures": "false" })
        .useStoredProcedures,
      false,
    );
  });

  it("turns on when a YAML boolean true leaks through flattening", () => {
    assert.equal(
      datasourceSettings({
        "datasource.use_stored_procedures": true as unknown as string,
      }).useStoredProcedures,
      true,
    );
  });

  it("ignores the unprefixed settings key", () => {
    assert.equal(
      datasourceSettings({ use_stored_procedures: "true" }).useStoredProcedures,
      false,
    );
  });
});
