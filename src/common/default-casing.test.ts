import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCasing } from "./default-casing.ts";

const NAME = "notification_type";
const FIELD = "channel_name";

describe("createCasing Auto defaults", () => {
  it("matches Default Casings for SQL", () => {
    const casing = createCasing({});
    assert.equal(casing.convertFileName(NAME), "notification_type");
    assert.equal(casing.convertTypes(NAME), "notification_type");
    assert.equal(casing.convertFields(NAME), "notification_type");
    assert.equal(casing.convertDirectories(NAME), "notification_type");
    assert.equal(casing.filePath(NAME), "notification_type.sql");
    assert.equal(casing.fileBase(NAME), "notification_type");
    assert.equal(casing.directory(NAME), "notification_type");
    assert.equal(casing.tableName(NAME), "notification_types");
    assert.equal(casing.columnName(FIELD), "channel_name");
    assert.equal(
      casing.constraintName(NAME, FIELD, "foreign_key"),
      "notification_types_channel_name_foreign_key",
    );
    assert.equal(casing.triggerName(NAME), "trg_notification_types_updated_at");
    assert.equal(
      casing.routineName(`create_${NAME}`),
      "create_notification_type",
    );
    assert.equal(casing.pluralTableName(NAME), "notification_types");
  });
});

describe("createCasing overrides", () => {
  it("pascals types without changing fields", () => {
    const casing = createCasing({ "datasource.casing.types": "Pascal" });
    assert.equal(casing.convertTypes(NAME), "NotificationType");
    assert.equal(casing.tableName(NAME), "NotificationTypes");
    assert.equal(casing.convertFields(FIELD), "channel_name");
    assert.equal(casing.columnName(FIELD), "channel_name");
    assert.equal(casing.convertFileName(NAME), "notification_type");
    assert.equal(casing.convertDirectories(NAME), "notification_type");
    assert.equal(
      casing.constraintName(NAME, FIELD, "foreign_key"),
      "NotificationTypesChannelNameForeignKey",
    );
    assert.equal(casing.triggerName(NAME), "TrgNotificationTypesUpdatedAt");
    assert.equal(
      casing.routineName(`create_${NAME}`),
      "CreateNotificationType",
    );
  });

  it("camels fields without changing types", () => {
    const casing = createCasing({ "datasource.casing.fields": "Camel" });
    assert.equal(casing.columnName("role_id"), "roleId");
    assert.equal(casing.convertFields("role_id"), "roleId");
    assert.equal(casing.tableName(NAME), "notification_types");
    assert.equal(casing.convertTypes(NAME), "notification_type");
  });

  it("pascals fields", () => {
    const casing = createCasing({ "datasource.casing.fields": "Pascal" });
    assert.equal(casing.columnName("role_id"), "RoleId");
  });

  it("kebabs fields", () => {
    const casing = createCasing({ "datasource.casing.fields": "Kebab" });
    assert.equal(casing.columnName("role_id"), "role-id");
  });

  it("kebabs file names and directories independently", () => {
    const casing = createCasing({
      "datasource.casing.file_names": "Kebab",
      "datasource.casing.directories": "Kebab",
    });
    assert.equal(casing.fileBase(NAME), "notification-type");
    assert.equal(casing.filePath(NAME), "notification-type.sql");
    assert.equal(casing.directory(NAME), "notification-type");
    assert.equal(casing.tableName(NAME), "notification_types");
  });

  it("snakes directories independently of files", () => {
    const casing = createCasing({
      "datasource.casing.file_names": "Pascal",
      "datasource.casing.directories": "Snake",
    });
    assert.equal(casing.fileBase(NAME), "NotificationType");
    assert.equal(casing.directory(NAME), "notification_type");
  });

  it("treats Auto and empty as omitted", () => {
    const omitted = createCasing({});
    const explicit = createCasing({
      "datasource.casing.file_names": "Auto",
      "datasource.casing.types": "auto",
      "datasource.casing.fields": "AUTO",
      "datasource.casing.directories": "",
    });
    assert.equal(omitted.tableName(NAME), explicit.tableName(NAME));
    assert.equal(omitted.columnName(FIELD), explicit.columnName(FIELD));
    assert.equal(omitted.fileBase(NAME), explicit.fileBase(NAME));
    assert.equal(omitted.directory(NAME), explicit.directory(NAME));
  });

  it("ignores languages.sql.casing keys", () => {
    const casing = createCasing({
      "languages.sql.casing.types": "Pascal",
      "languages.sql.casing.fields": "Camel",
    });
    assert.equal(casing.tableName(NAME), "notification_types");
    assert.equal(casing.columnName(FIELD), "channel_name");
  });

  it("throws on an unknown case format with the datasource path", () => {
    assert.throws(
      () => createCasing({ "datasource.casing.types": "screaming" }),
      /datasource\.casing\.types must be one of/,
    );
  });
});

describe("createCasing tableName pluralize", () => {
  it("pluralizes by default", () => {
    const casing = createCasing({});
    assert.equal(casing.tableName("user"), "users");
    assert.equal(casing.tableName("backend_type"), "backend_types");
  });

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

  it("does not pluralize when the flag is false", () => {
    const casing = createCasing({
      "datasource.pluralize_datatable_names": "false",
    });
    assert.equal(casing.tableName("user"), "user");
    assert.equal(casing.tableName(NAME), "notification_type");
    assert.equal(
      casing.constraintName(NAME, FIELD, "foreign_key"),
      "notification_type_channel_name_foreign_key",
    );
    assert.equal(casing.triggerName(NAME), "trg_notification_type_updated_at");
  });

  it("handles irregular and already-plural names", () => {
    const casing = createCasing({});
    assert.equal(casing.tableName("person"), "people");
    assert.equal(casing.tableName("category"), "categories");
    assert.equal(casing.tableName("users"), "users");
    assert.equal(casing.tableName(""), "");
  });

  it("pluralizes then applies types casing", () => {
    const pascalOn = createCasing({ "datasource.casing.types": "Pascal" });
    assert.equal(pascalOn.tableName(NAME), "NotificationTypes");
    const pascalOff = createCasing({
      "datasource.casing.types": "Pascal",
      "datasource.pluralize_datatable_names": "false",
    });
    assert.equal(pascalOff.tableName(NAME), "NotificationType");
    const kebabOn = createCasing({ "datasource.casing.types": "Kebab" });
    assert.equal(kebabOn.tableName(NAME), "notification-types");
  });

  it("pluralTableName always pluralizes", () => {
    const off = createCasing({
      "datasource.pluralize_datatable_names": "false",
    });
    assert.equal(off.pluralTableName("user"), "users");
    assert.equal(off.pluralTableName(NAME), "notification_types");
    const pascalOff = createCasing({
      "datasource.casing.types": "Pascal",
      "datasource.pluralize_datatable_names": "false",
    });
    assert.equal(pascalOff.pluralTableName(NAME), "NotificationTypes");
  });
});
