import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryReader } from "@deterministic-code/generators-common/deterministic-reader";
import { DATASOURCE_TYPES_YAML } from "@deterministic-code/generators-common/specification";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generate } from "./generate-sql.ts";

const FIXTURE_YAML = `types:
  - user:
      fields:
        - email:
            type: string
  - notification_type:
      fields:
        - channel_name:
            type: string
        - user_id:
            type: integer
            references: user.id
`;

const fixtureReader = () =>
  memoryReader({ [DATASOURCE_TYPES_YAML]: FIXTURE_YAML });

const entryBody = (entry: GenerateEntry): string => {
  if ("contents" in entry) return String(entry.contents);
  return entry.content;
};

const generateWith = (settings: Record<string, string>) =>
  generate({
    reader: fixtureReader(),
    settings: { "backend.datasources": "postgres", ...settings },
  });

const byFilename = async (settings: Record<string, string>) => {
  const map = new Map<string, string>();
  for (const entry of await generateWith(settings)) {
    map.set(entry.filename, entryBody(entry));
  }
  return map;
};

const upSql = async (settings: Record<string, string> = {}) => {
  const files = await byFilename(settings);
  const body = files.get("postgres/migrations/0001_initial_up.sql");
  assert.ok(body, "expected 0001_initial_up.sql");
  return body;
};

const procSql = async (settings: Record<string, string> = {}) => {
  const files = await byFilename({
    "datasource.use_stored_procedures": "true",
    ...settings,
  });
  const body = files.get("postgres/migrations/0002_stored_procedures_up.sql");
  assert.ok(body, "expected stored procedures up migration");
  return body;
};

describe("generate-sql casing", () => {
  it("Auto + pluralize uses snake plural tables and snake columns", async () => {
    const sql = await upSql({});
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.match(sql, /CREATE TABLE "users"/);
    assert.match(sql, /"channel_name"/);
    assert.match(sql, /"notification_types_user_id_foreign_key"/);
    assert.match(sql, /REFERENCES "users"\("id"\)/);
  });

  it("pluralize_datatable_names=false keeps singular tables", async () => {
    const sql = await upSql({
      "datasource.pluralize_datatable_names": "false",
    });
    assert.match(sql, /CREATE TABLE "notification_type"/);
    assert.match(sql, /CREATE TABLE "user"/);
    assert.match(sql, /"notification_type_user_id_foreign_key"/);
    assert.match(sql, /REFERENCES "user"\("id"\)/);
    assert.doesNotMatch(sql, /CREATE TABLE "notification_types"/);
  });

  it("Pascal types cases tables, constraints, and routines", async () => {
    const settings = { "datasource.casing.types": "Pascal" };
    const sql = await upSql(settings);
    assert.match(sql, /CREATE TABLE "NotificationTypes"/);
    assert.match(sql, /CREATE TABLE "Users"/);
    assert.match(sql, /"channel_name"/);
    assert.match(sql, /"NotificationTypesUserIdForeignKey"/);
    assert.match(sql, /REFERENCES "Users"\("id"\)/);
    const procs = await procSql(settings);
    assert.match(procs, /CREATE OR REPLACE FUNCTION CreateNotificationType\(/);
    assert.match(procs, /CREATE OR REPLACE FUNCTION FindNotificationTypes\(/);
    assert.match(procs, /INSERT INTO "NotificationTypes"/);
  });

  it("Camel fields cases columns only", async () => {
    const sql = await upSql({ "datasource.casing.fields": "Camel" });
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.match(sql, /"channelName"/);
    assert.match(sql, /"userId"/);
    assert.match(sql, /REFERENCES "users"\("id"\)/);
  });

  it("Pascal types and Camel fields apply independently", async () => {
    const settings = {
      "datasource.casing.types": "Pascal",
      "datasource.casing.fields": "Camel",
    };
    const sql = await upSql(settings);
    assert.match(sql, /CREATE TABLE "NotificationTypes"/);
    assert.match(sql, /"channelName"/);
    assert.match(sql, /"NotificationTypesUserIdForeignKey"/);
    assert.match(sql, /REFERENCES "Users"\("id"\)/);
    const procs = await procSql(settings);
    assert.match(procs, /CREATE OR REPLACE FUNCTION CreateNotificationType\(/);
    assert.match(procs, /channelName/);
  });

  it("languages.sql.casing does not change emit", async () => {
    const sql = await upSql({
      "languages.sql.casing.types": "Pascal",
      "languages.sql.casing.fields": "Camel",
    });
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.match(sql, /"channel_name"/);
    assert.doesNotMatch(sql, /CREATE TABLE "NotificationTypes"/);
  });
});
