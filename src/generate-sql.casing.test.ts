import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryReader } from "@deterministic-code/generators-common/deterministic-reader";
import {
  DATASOURCE_SEEDS_YAML,
  DATASOURCE_TYPES_YAML,
} from "@deterministic-code/generators-common/specification";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generate } from "./generate-sql.ts";

type Format = "Camel" | "Pascal" | "Snake" | "Kebab";
type Pluralize = "on" | "off";

const FORMATS: readonly Format[] = ["Camel", "Pascal", "Snake", "Kebab"];
const PLURALIZE: readonly Pluralize[] = ["on", "off"];

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

const SEEDS_YAML = `seeds:
  - user:
      - id1:
          email: CREATE
`;

const fixtureReader = (withSeeds = false) =>
  memoryReader({
    [DATASOURCE_TYPES_YAML]: FIXTURE_YAML,
    ...(withSeeds ? { [DATASOURCE_SEEDS_YAML]: SEEDS_YAML } : {}),
  });

const entryBody = (entry: GenerateEntry): string => {
  if ("contents" in entry) return String(entry.contents);
  return entry.content;
};

const generateWith = (
  settings: Record<string, string>,
  withSeeds = false,
) =>
  generate({
    reader: fixtureReader(withSeeds),
    settings: { "backend.datasources": "postgres", ...settings },
  });

const byFilename = async (
  settings: Record<string, string>,
  withSeeds = false,
) => {
  const map = new Map<string, string>();
  for (const entry of await generateWith(settings, withSeeds)) {
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

const fileSql = async (
  filename: string,
  settings: Record<string, string> = {},
  withSeeds = false,
) => {
  const files = await byFilename(settings, withSeeds);
  const body = files.get(filename);
  assert.ok(body, `expected ${filename}`);
  return body;
};

const downSql = async (settings: Record<string, string> = {}) =>
  fileSql("postgres/migrations/0001_initial_down.sql", settings);

const procSql = async (settings: Record<string, string> = {}) =>
  fileSql("postgres/migrations/0002_stored_procedures_up.sql", {
    "datasource.use_stored_procedures": "true",
    ...settings,
  });

const procDownSql = async (settings: Record<string, string> = {}) =>
  fileSql("postgres/migrations/0002_stored_procedures_down.sql", {
    "datasource.use_stored_procedures": "true",
    ...settings,
  });

const TYPES = {
  on: {
    Camel: {
      notificationTable: "notificationTypes",
      userTable: "users",
      constraint: "notificationTypesUserIdForeignKey",
    },
    Pascal: {
      notificationTable: "NotificationTypes",
      userTable: "Users",
      constraint: "NotificationTypesUserIdForeignKey",
    },
    Snake: {
      notificationTable: "notification_types",
      userTable: "users",
      constraint: "notification_types_user_id_foreign_key",
    },
    Kebab: {
      notificationTable: "notification-types",
      userTable: "users",
      constraint: "notification-types-user-id-foreign-key",
    },
  },
  off: {
    Camel: {
      notificationTable: "notificationType",
      userTable: "user",
      constraint: "notificationTypeUserIdForeignKey",
    },
    Pascal: {
      notificationTable: "NotificationType",
      userTable: "User",
      constraint: "NotificationTypeUserIdForeignKey",
    },
    Snake: {
      notificationTable: "notification_type",
      userTable: "user",
      constraint: "notification_type_user_id_foreign_key",
    },
    Kebab: {
      notificationTable: "notification-type",
      userTable: "user",
      constraint: "notification-type-user-id-foreign-key",
    },
  },
} as const;

const ROUTINES = {
  Camel: {
    createFn: "createNotificationType",
    findAllFn: "findNotificationTypes",
  },
  Pascal: {
    createFn: "CreateNotificationType",
    findAllFn: "FindNotificationTypes",
  },
  Snake: {
    createFn: "create_notification_type",
    findAllFn: "find_notification_types",
  },
  Kebab: {
    createFn: "create-notification-type",
    findAllFn: "find-notification-types",
  },
} as const;

const FIELDS = {
  Camel: {
    channel: "channelName",
    userId: "userId",
    id: "id",
  },
  Pascal: {
    channel: "ChannelName",
    userId: "UserId",
    id: "Id",
  },
  Snake: {
    channel: "channel_name",
    userId: "user_id",
    id: "id",
  },
  Kebab: {
    channel: "channel-name",
    userId: "user-id",
    id: "id",
  },
} as const;

describe("generate-sql casing", () => {
  it("Auto + pluralize uses snake plural tables and snake columns", async () => {
    const sql = await upSql({});
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.match(sql, /CREATE TABLE "users"/);
    assert.match(sql, /"channel_name"/);
    assert.match(sql, /"notification_types_user_id_foreign_key"/);
    assert.match(sql, /REFERENCES "users"\("id"\)/);
  });

  for (const format of FORMATS) {
    for (const pluralize of PLURALIZE) {
      it(`types × ${format} × pluralize ${pluralize}`, async () => {
        const settings = {
          "datasource.casing.types": format,
          ...(pluralize === "off"
            ? { "datasource.pluralize_datatable_names": "false" }
            : {}),
        };
        const expected = TYPES[pluralize][format];
        const routines = ROUTINES[format];
        const sql = await upSql(settings);
        assert.match(
          sql,
          new RegExp(`CREATE TABLE "${expected.notificationTable}"`),
        );
        assert.match(sql, new RegExp(`CREATE TABLE "${expected.userTable}"`));
        assert.match(sql, /"channel_name"/);
        assert.match(sql, new RegExp(`"${expected.constraint}"`));
        assert.match(
          sql,
          new RegExp(`REFERENCES "${expected.userTable}"\\("id"\\)`),
        );
        if (pluralize === "off") {
          assert.doesNotMatch(sql, /CREATE TABLE "notification_types"/);
        }
        const procs = await procSql(settings);
        assert.match(
          procs,
          new RegExp(`CREATE OR REPLACE FUNCTION ${routines.createFn}\\(`),
        );
        assert.match(
          procs,
          new RegExp(`CREATE OR REPLACE FUNCTION ${routines.findAllFn}\\(`),
        );
        assert.match(
          procs,
          new RegExp(`INSERT INTO "${expected.notificationTable}"`),
        );
      });
    }
  }

  for (const format of FORMATS) {
    it(`fields × ${format} cases columns only`, async () => {
      const expected = FIELDS[format];
      const sql = await upSql({ "datasource.casing.fields": format });
      assert.match(sql, /CREATE TABLE "notification_types"/);
      assert.match(sql, new RegExp(`"${expected.channel}"`));
      assert.match(sql, new RegExp(`"${expected.userId}"`));
      assert.match(
        sql,
        new RegExp(`REFERENCES "users"\\("${expected.id}"\\)`),
      );
    });
  }

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
      "languages.sql.casing.keywords": "lower",
    });
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.match(sql, /"channel_name"/);
    assert.doesNotMatch(sql, /CREATE TABLE "NotificationTypes"/);
    assert.doesNotMatch(sql, /create table/);
  });

  it("keywords upper matches the default emit", async () => {
    const sql = await upSql({ "datasource.casing.keywords": "upper" });
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.match(sql, /NOT NULL/);
    assert.match(sql, /REFERENCES "users"/);
    const procs = await procSql({ "datasource.casing.keywords": "upper" });
    assert.match(procs, /CREATE OR REPLACE FUNCTION create_notification_type\(/);
    assert.match(procs, /INSERT INTO "notification_types"/);
  });

  it("keywords lower lowercases SQL keywords and types", async () => {
    const sql = await upSql({ "datasource.casing.keywords": "lower" });
    assert.match(sql, /create table "notification_types"/);
    assert.match(sql, /create table "users"/);
    assert.match(sql, /not null/);
    assert.match(sql, /references "users"\("id"\)/);
    assert.match(sql, /"email" text not null/);
    assert.match(sql, /integer not null/);
    assert.match(sql, /timestamptz not null default/);
    assert.doesNotMatch(sql, /CREATE TABLE/);
    assert.doesNotMatch(sql, /NOT NULL/);
    const procs = await procSql({ "datasource.casing.keywords": "lower" });
    assert.match(procs, /create or replace function create_notification_type\(/);
    assert.match(procs, /insert into "notification_types"/);
    assert.match(procs, /returns /);
    assert.doesNotMatch(procs, /CREATE OR REPLACE/);
  });

  it("objects upper screams table, constraint, and routine names", async () => {
    const sql = await upSql({ "datasource.casing.objects": "upper" });
    assert.match(sql, /CREATE TABLE "NOTIFICATION_TYPES"/);
    assert.match(sql, /CREATE TABLE "USERS"/);
    assert.match(sql, /"channel_name"/);
    assert.match(sql, /"NOTIFICATION_TYPES_USER_ID_FOREIGN_KEY"/);
    assert.match(sql, /REFERENCES "USERS"\("id"\)/);
    assert.doesNotMatch(sql, /CREATE TABLE "notification_types"/);
    const procs = await procSql({ "datasource.casing.objects": "upper" });
    assert.match(procs, /CREATE OR REPLACE FUNCTION CREATE_NOTIFICATION_TYPE\(/);
    assert.match(procs, /INSERT INTO "NOTIFICATION_TYPES"/);
  });

  it("objects lower matches the default snake emit", async () => {
    const sql = await upSql({ "datasource.casing.objects": "lower" });
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.match(sql, /CREATE TABLE "users"/);
    assert.match(sql, /"channel_name"/);
  });

  it("objects and keywords compose independently", async () => {
    const sql = await upSql({
      "datasource.casing.objects": "upper",
      "datasource.casing.keywords": "lower",
    });
    assert.match(sql, /create table "NOTIFICATION_TYPES"/);
    assert.match(sql, /references "USERS"\("id"\)/);
    assert.match(sql, /not null/);
  });

  it("keywords Auto and empty match the default emit", async () => {
    for (const raw of ["Auto", ""] as const) {
      const sql = await upSql({ "datasource.casing.keywords": raw });
      assert.match(sql, /CREATE TABLE "notification_types"/);
      assert.doesNotMatch(sql, /create table/);
    }
  });

  it("objects Auto and empty preserve snake names", async () => {
    for (const raw of ["Auto", ""] as const) {
      const sql = await upSql({ "datasource.casing.objects": raw });
      assert.match(sql, /CREATE TABLE "notification_types"/);
      assert.doesNotMatch(sql, /CREATE TABLE "NOTIFICATION_TYPES"/);
    }
  });

  it("languages.sql.casing.objects does not change emit", async () => {
    const sql = await upSql({ "languages.sql.casing.objects": "upper" });
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.doesNotMatch(sql, /CREATE TABLE "NOTIFICATION_TYPES"/);
  });

  it("throws when keywords or objects is unknown", async () => {
    await assert.rejects(
      () => upSql({ "datasource.casing.keywords": "screaming" }),
      /datasource\.casing\.keywords must be one of \[upper, lower\]/,
    );
    await assert.rejects(
      () => upSql({ "datasource.casing.objects": "screaming" }),
      /datasource\.casing\.objects must be one of \[upper, lower\]/,
    );
  });

  it("keywords lower and objects upper apply to down and procedure drops", async () => {
    const settings = {
      "datasource.casing.keywords": "lower",
      "datasource.casing.objects": "upper",
    };
    const down = await downSql(settings);
    assert.match(down, /drop table if exists "NOTIFICATION_TYPES"/);
    assert.match(down, /drop table if exists "USERS"/);
    assert.doesNotMatch(down, /DROP TABLE/);
    const procs = await procSql(settings);
    assert.match(procs, /create or replace function CREATE_NOTIFICATION_TYPE\(/);
    assert.match(procs, /insert into "NOTIFICATION_TYPES"/);
    const procDown = await procDownSql(settings);
    assert.match(procDown, /drop function if exists CREATE_NOTIFICATION_TYPE;/);
    assert.doesNotMatch(procDown, /DROP FUNCTION/);
  });

  it("objects upper applies after Pascal types in emit", async () => {
    const sql = await upSql({
      "datasource.casing.types": "Pascal",
      "datasource.casing.objects": "upper",
    });
    assert.match(sql, /CREATE TABLE "NOTIFICATIONTYPES"/);
    assert.match(sql, /CREATE TABLE "USERS"/);
    assert.match(sql, /"NOTIFICATIONTYPESUSERIDFOREIGNKEY"/);
  });

  it("leaves seed string literals when keywords are lower", async () => {
    const sql = await fileSql(
      "postgres/migrations/0001_initial_up.sql",
      { "datasource.casing.keywords": "lower" },
      true,
    );
    assert.match(sql, /insert into "users"/);
    assert.match(sql, /'CREATE'/);
    assert.doesNotMatch(sql, /'create'/);
  });

  const DIALECT_QUOTES = {
    postgres: ['"', '"'],
    sqlite: ['"', '"'],
    mysql: ["`", "`"],
    sqlserver: ["[", "]"],
    oracle: ['"', '"'],
  } as const;

  for (const [dialect, [left, right]] of Object.entries(DIALECT_QUOTES)) {
    it(`keywords lower keeps ${dialect} quoted object names`, async () => {
      const files = await byFilename({
        "backend.datasources": dialect,
        "datasource.casing.keywords": "lower",
        "datasource.casing.objects": "upper",
      });
      const body = files.get(`${dialect}/migrations/0001_initial_up.sql`);
      assert.ok(body, `expected ${dialect} up migration`);
      const quoted = `${left}NOTIFICATION_TYPES${right}`;
      assert.equal(body.includes(`create table ${quoted}`), true);
      assert.match(body, /not null/);
    });
  }
});
