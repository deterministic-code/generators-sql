import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCasing, defaultCasing } from "./default-casing.ts";

type Format = "Camel" | "Pascal" | "Snake" | "Kebab";
type Pluralize = "on" | "off";

const FORMATS: readonly Format[] = ["Camel", "Pascal", "Snake", "Kebab"];
const PLURALIZE: readonly Pluralize[] = ["on", "off"];

const ENTITY = "notification_type";
const FIELD = "channel_name";
const ROUTINE = `create_${ENTITY}`;

const settingsFor = (
  leaf: "types" | "fields" | "file_names" | "directories",
  format: Format,
  pluralize: Pluralize = "on",
): Record<string, string> => ({
  [`datasource.casing.${leaf}`]: format,
  ...(pluralize === "off"
    ? { "datasource.pluralize_datatable_names": "false" }
    : {}),
});

const TYPES = {
  convertTypes: {
    Camel: "notificationType",
    Pascal: "NotificationType",
    Snake: "notification_type",
    Kebab: "notification-type",
  },
  routineName: {
    Camel: "createNotificationType",
    Pascal: "CreateNotificationType",
    Snake: "create_notification_type",
    Kebab: "create-notification-type",
  },
  tableName: {
    on: {
      Camel: "notificationTypes",
      Pascal: "NotificationTypes",
      Snake: "notification_types",
      Kebab: "notification-types",
    },
    off: {
      Camel: "notificationType",
      Pascal: "NotificationType",
      Snake: "notification_type",
      Kebab: "notification-type",
    },
  },
  userTable: {
    on: {
      Camel: "users",
      Pascal: "Users",
      Snake: "users",
      Kebab: "users",
    },
    off: {
      Camel: "user",
      Pascal: "User",
      Snake: "user",
      Kebab: "user",
    },
  },
  constraintName: {
    on: {
      Camel: "notificationTypesChannelNameForeignKey",
      Pascal: "NotificationTypesChannelNameForeignKey",
      Snake: "notification_types_channel_name_foreign_key",
      Kebab: "notification-types-channel-name-foreign-key",
    },
    off: {
      Camel: "notificationTypeChannelNameForeignKey",
      Pascal: "NotificationTypeChannelNameForeignKey",
      Snake: "notification_type_channel_name_foreign_key",
      Kebab: "notification-type-channel-name-foreign-key",
    },
  },
  triggerName: {
    on: {
      Camel: "trgNotificationTypesUpdatedAt",
      Pascal: "TrgNotificationTypesUpdatedAt",
      Snake: "trg_notification_types_updated_at",
      Kebab: "trg-notification-types-updated-at",
    },
    off: {
      Camel: "trgNotificationTypeUpdatedAt",
      Pascal: "TrgNotificationTypeUpdatedAt",
      Snake: "trg_notification_type_updated_at",
      Kebab: "trg-notification-type-updated-at",
    },
  },
} as const;

const FIELDS = {
  channel_name: {
    Camel: "channelName",
    Pascal: "ChannelName",
    Snake: "channel_name",
    Kebab: "channel-name",
  },
  role_id: {
    Camel: "roleId",
    Pascal: "RoleId",
    Snake: "role_id",
    Kebab: "role-id",
  },
} as const;

const FILES = {
  Camel: "notificationType",
  Pascal: "NotificationType",
  Snake: "notification_type",
  Kebab: "notification-type",
} as const;

describe("createCasing Auto defaults", () => {
  it("matches Default Casings for SQL", () => {
    const casing = createCasing({});
    assert.equal(casing.convertFileName(ENTITY), "notification_type");
    assert.equal(casing.convertTypes(ENTITY), "notification_type");
    assert.equal(casing.convertFields(ENTITY), "notification_type");
    assert.equal(casing.convertDirectories(ENTITY), "notification_type");
    assert.equal(casing.filePath(ENTITY), "notification_type.sql");
    assert.equal(casing.fileBase(ENTITY), "notification_type");
    assert.equal(casing.directory(ENTITY), "notification_type");
    assert.equal(casing.tableName(ENTITY), "notification_types");
    assert.equal(casing.columnName(FIELD), "channel_name");
    assert.equal(
      casing.constraintName(ENTITY, FIELD, "foreign_key"),
      "notification_types_channel_name_foreign_key",
    );
    assert.equal(casing.triggerName(ENTITY), "trg_notification_types_updated_at");
    assert.equal(casing.routineName(ROUTINE), "create_notification_type");
    assert.equal(casing.pluralTableName(ENTITY), "notification_types");
    assert.equal(casing.keyword("create"), "CREATE");
    assert.equal(casing.keyword("TABLE"), "TABLE");
    assert.equal(
      casing.applyKeywords('CREATE TABLE "users"'),
      'CREATE TABLE "users"',
    );
  });

  it("defaultCasing is createCasing", () => {
    const settings = { "datasource.casing.types": "Pascal" };
    const viaDefault = defaultCasing(settings);
    const viaCreate = createCasing(settings);
    assert.equal(viaDefault.convertTypes(ENTITY), viaCreate.convertTypes(ENTITY));
    assert.equal(viaDefault.convertFields(FIELD), viaCreate.convertFields(FIELD));
    assert.equal(
      viaDefault.convertFileName(ENTITY),
      viaCreate.convertFileName(ENTITY),
    );
    assert.equal(
      viaDefault.convertDirectories(ENTITY),
      viaCreate.convertDirectories(ENTITY),
    );
  });
});

describe("createCasing conversion matrix", () => {
  for (const format of FORMATS) {
    for (const pluralize of PLURALIZE) {
      it(`types × ${format} × pluralize ${pluralize}`, () => {
        const casing = createCasing(settingsFor("types", format, pluralize));
        assert.equal(casing.convertTypes(ENTITY), TYPES.convertTypes[format]);
        assert.equal(casing.tableName(ENTITY), TYPES.tableName[pluralize][format]);
        assert.equal(casing.tableName("user"), TYPES.userTable[pluralize][format]);
        assert.equal(casing.pluralTableName(ENTITY), TYPES.tableName.on[format]);
        assert.equal(casing.pluralTableName("user"), TYPES.userTable.on[format]);
        assert.equal(
          casing.constraintName(ENTITY, FIELD, "foreign_key"),
          TYPES.constraintName[pluralize][format],
        );
        assert.equal(
          casing.triggerName(ENTITY),
          TYPES.triggerName[pluralize][format],
        );
        assert.equal(casing.routineName(ROUTINE), TYPES.routineName[format]);
        assert.equal(casing.columnName(FIELD), "channel_name");
        assert.equal(casing.fileBase(ENTITY), "notification_type");
        assert.equal(casing.directory(ENTITY), "notification_type");
      });
    }
  }

  for (const format of FORMATS) {
    it(`fields × ${format}`, () => {
      const casing = createCasing(settingsFor("fields", format));
      assert.equal(casing.columnName("channel_name"), FIELDS.channel_name[format]);
      assert.equal(casing.convertFields("channel_name"), FIELDS.channel_name[format]);
      assert.equal(casing.columnName("role_id"), FIELDS.role_id[format]);
      assert.equal(casing.convertFields("role_id"), FIELDS.role_id[format]);
      assert.equal(casing.tableName(ENTITY), "notification_types");
      assert.equal(casing.convertTypes(ENTITY), "notification_type");
    });
  }

  for (const format of FORMATS) {
    it(`file_names × ${format}`, () => {
      const casing = createCasing(settingsFor("file_names", format));
      assert.equal(casing.convertFileName(ENTITY), FILES[format]);
      assert.equal(casing.fileBase(ENTITY), FILES[format]);
      assert.equal(casing.filePath(ENTITY), `${FILES[format]}.sql`);
      assert.equal(casing.tableName(ENTITY), "notification_types");
      assert.equal(casing.directory(ENTITY), "notification_type");
    });
  }

  for (const format of FORMATS) {
    it(`directories × ${format}`, () => {
      const casing = createCasing(settingsFor("directories", format));
      assert.equal(casing.convertDirectories(ENTITY), FILES[format]);
      assert.equal(casing.directory(ENTITY), FILES[format]);
      assert.equal(casing.fileBase(ENTITY), "notification_type");
      assert.equal(casing.tableName(ENTITY), "notification_types");
    });
  }
});

describe("createCasing overrides", () => {
  it("treats Auto and empty as omitted", () => {
    const omitted = createCasing({});
    const explicit = createCasing({
      "datasource.casing.file_names": "Auto",
      "datasource.casing.types": "auto",
      "datasource.casing.fields": "AUTO",
      "datasource.casing.directories": "",
    });
    assert.equal(omitted.tableName(ENTITY), explicit.tableName(ENTITY));
    assert.equal(omitted.columnName(FIELD), explicit.columnName(FIELD));
    assert.equal(omitted.fileBase(ENTITY), explicit.fileBase(ENTITY));
    assert.equal(omitted.directory(ENTITY), explicit.directory(ENTITY));
  });

  it("ignores languages.sql.casing keys", () => {
    const casing = createCasing({
      "languages.sql.casing.types": "Pascal",
      "languages.sql.casing.fields": "Camel",
      "languages.sql.casing.keywords": "lower",
      "languages.sql.casing.objects": "upper",
    });
    assert.equal(casing.tableName(ENTITY), "notification_types");
    assert.equal(casing.columnName(FIELD), "channel_name");
    assert.equal(casing.keyword("create"), "CREATE");
  });

  it("keywords upper and Auto match the default", () => {
    const omitted = createCasing({});
    const upper = createCasing({ "datasource.casing.keywords": "upper" });
    const auto = createCasing({ "datasource.casing.keywords": "Auto" });
    assert.equal(omitted.keyword("create"), "CREATE");
    assert.equal(upper.keyword("table"), "TABLE");
    assert.equal(auto.keyword("not"), "NOT");
    assert.equal(
      upper.applyKeywords('CREATE TABLE "users"'),
      'CREATE TABLE "users"',
    );
  });

  it("keywords lower cases SQL keywords and types only", () => {
    const casing = createCasing({ "datasource.casing.keywords": "LOWER" });
    assert.equal(casing.keyword("CREATE"), "create");
    assert.equal(casing.keyword("Table"), "table");
    assert.equal(
      casing.applyKeywords(
        'CREATE TABLE "users" (\n  "email" VARCHAR(256) NOT NULL\n);',
      ),
      'create table "users" (\n  "email" varchar(256) not null\n);',
    );
    assert.equal(
      casing.applyKeywords("INSERT INTO t VALUES ('CREATE', 'NOT NULL');"),
      "insert into t values ('CREATE', 'NOT NULL');",
    );
    assert.equal(
      casing.applyKeywords('-- CREATE TABLE stays in comments\nDROP TABLE t;'),
      '-- CREATE TABLE stays in comments\ndrop table t;',
    );
  });

  for (const leaf of ["file_names", "types", "fields", "directories"] as const) {
    it(`throws on an unknown case format for ${leaf}`, () => {
      assert.throws(
        () => createCasing({ [`datasource.casing.${leaf}`]: "screaming" }),
        new RegExp(`datasource\\.casing\\.${leaf} must be one of`),
      );
    });
  }

  it("throws on an unknown keywords format", () => {
    assert.throws(
      () => createCasing({ "datasource.casing.keywords": "screaming" }),
      /datasource\.casing\.keywords must be one of \[upper, lower\]/,
    );
  });

  it("throws on an unknown objects format", () => {
    assert.throws(
      () => createCasing({ "datasource.casing.objects": "screaming" }),
      /datasource\.casing\.objects must be one of \[upper, lower\]/,
    );
  });
});

describe("createCasing objects", () => {
  const KEYWORD_ALIASES = [
    undefined,
    "",
    "Auto",
    "auto",
    "AUTO",
    "upper",
    "UPPER",
    "Upper",
  ] as const;

  for (const raw of KEYWORD_ALIASES) {
    it(`keywords ${JSON.stringify(raw)} is upper`, () => {
      const settings =
        raw === undefined ? {} : { "datasource.casing.keywords": raw };
      const casing = createCasing(settings);
      assert.equal(casing.keyword("create"), "CREATE");
      assert.equal(
        casing.applyKeywords('CREATE TABLE "users"'),
        'CREATE TABLE "users"',
      );
    });
  }

  it("keywords lower aliases all lowercase SQL", () => {
    for (const raw of ["lower", "LOWER", "Lower"] as const) {
      const casing = createCasing({ "datasource.casing.keywords": raw });
      assert.equal(casing.keyword("CREATE"), "create");
      assert.equal(
        casing.applyKeywords("CREATE TABLE t"),
        "create table t",
      );
    }
  });

  const OBJECT_PRESERVE = [undefined, "", "Auto", "auto", "AUTO"] as const;
  for (const raw of OBJECT_PRESERVE) {
    it(`objects ${JSON.stringify(raw)} preserves type casing`, () => {
      const settings =
        raw === undefined ? {} : { "datasource.casing.objects": raw };
      assert.equal(
        createCasing(settings).tableName("contacts_member"),
        "contacts_members",
      );
      assert.equal(
        createCasing({
          "datasource.casing.types": "Pascal",
          ...settings,
        }).tableName(ENTITY),
        "NotificationTypes",
      );
    });
  }

  it("lower keeps snake object names", () => {
    const casing = createCasing({ "datasource.casing.objects": "lower" });
    assert.equal(casing.tableName("contacts_member"), "contacts_members");
    assert.equal(casing.tableName(ENTITY), "notification_types");
    assert.equal(casing.pluralTableName(ENTITY), "notification_types");
    assert.equal(
      casing.constraintName(ENTITY, FIELD, "foreign_key"),
      "notification_types_channel_name_foreign_key",
    );
    assert.equal(casing.triggerName(ENTITY), "trg_notification_types_updated_at");
    assert.equal(casing.columnName(FIELD), "channel_name");
    assert.equal(casing.routineName(ROUTINE), "create_notification_type");
  });

  it("upper emits screaming-snake object names", () => {
    const casing = createCasing({ "datasource.casing.objects": "UPPER" });
    assert.equal(casing.tableName("contacts_member"), "CONTACTS_MEMBERS");
    assert.equal(casing.tableName(ENTITY), "NOTIFICATION_TYPES");
    assert.equal(casing.pluralTableName(ENTITY), "NOTIFICATION_TYPES");
    assert.equal(
      casing.constraintName(ENTITY, FIELD, "foreign_key"),
      "NOTIFICATION_TYPES_CHANNEL_NAME_FOREIGN_KEY",
    );
    assert.equal(
      casing.triggerName(ENTITY),
      "TRG_NOTIFICATION_TYPES_UPDATED_AT",
    );
    assert.equal(casing.routineName(ROUTINE), "CREATE_NOTIFICATION_TYPE");
    assert.equal(casing.columnName(FIELD), "channel_name");
    assert.equal(casing.convertTypes(ENTITY), "notification_type");
    assert.equal(casing.fileBase(ENTITY), "notification_type");
    assert.equal(casing.directory(ENTITY), "notification_type");
  });

  for (const format of FORMATS) {
    for (const objects of ["upper", "lower"] as const) {
      it(`objects ${objects} × types ${format}`, () => {
        const casing = createCasing({
          "datasource.casing.types": format,
          "datasource.casing.objects": objects,
        });
        const letter = (text: string) =>
          objects === "upper" ? text.toUpperCase() : text.toLowerCase();
        assert.equal(casing.convertTypes(ENTITY), TYPES.convertTypes[format]);
        assert.equal(
          casing.tableName(ENTITY),
          letter(TYPES.tableName.on[format]),
        );
        assert.equal(
          casing.tableName("user"),
          letter(TYPES.userTable.on[format]),
        );
        assert.equal(
          casing.pluralTableName(ENTITY),
          letter(TYPES.tableName.on[format]),
        );
        assert.equal(
          casing.constraintName(ENTITY, FIELD, "foreign_key"),
          letter(TYPES.constraintName.on[format]),
        );
        assert.equal(
          casing.triggerName(ENTITY),
          letter(TYPES.triggerName.on[format]),
        );
        assert.equal(casing.routineName(ROUTINE), letter(TYPES.routineName[format]));
        assert.equal(casing.columnName(FIELD), "channel_name");
      });
    }
  }

  it("upper with pluralize off screams the singular stem", () => {
    const casing = createCasing({
      "datasource.casing.objects": "upper",
      "datasource.pluralize_datatable_names": "false",
    });
    assert.equal(casing.tableName(ENTITY), "NOTIFICATION_TYPE");
    assert.equal(casing.tableName("user"), "USER");
    assert.equal(casing.pluralTableName(ENTITY), "NOTIFICATION_TYPES");
    assert.equal(
      casing.constraintName(ENTITY, FIELD, "foreign_key"),
      "NOTIFICATION_TYPE_CHANNEL_NAME_FOREIGN_KEY",
    );
  });

  it("does not change fields when objects is set", () => {
    const casing = createCasing({
      "datasource.casing.objects": "upper",
      "datasource.casing.fields": "Camel",
    });
    assert.equal(casing.columnName(FIELD), "channelName");
    assert.equal(casing.tableName(ENTITY), "NOTIFICATION_TYPES");
  });
});

describe("createCasing tableName pluralize", () => {
  it("pluralizes when the flag is true or empty", () => {
    assert.equal(
      createCasing({ "datasource.pluralize_datatable_names": "true" }).tableName(
        "user",
      ),
      "users",
    );
    assert.equal(
      createCasing({ "datasource.pluralize_datatable_names": "" }).tableName(
        "user",
      ),
      "users",
    );
  });

  it("handles irregular and already-plural names", () => {
    const casing = createCasing({});
    assert.equal(casing.tableName("person"), "people");
    assert.equal(casing.tableName("category"), "categories");
    assert.equal(casing.tableName("users"), "users");
    assert.equal(casing.tableName(""), "");
  });
});
