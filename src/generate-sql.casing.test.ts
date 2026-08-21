import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryReader } from "@deterministic-code/generators-common/deterministic-reader";
import { DATASOURCE_TYPES_YAML } from "@deterministic-code/generators-common/specification";
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
    });
    assert.match(sql, /CREATE TABLE "notification_types"/);
    assert.match(sql, /"channel_name"/);
    assert.doesNotMatch(sql, /CREATE TABLE "NotificationTypes"/);
  });
});
