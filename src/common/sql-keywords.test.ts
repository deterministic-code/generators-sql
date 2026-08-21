import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyKeywordCasing, SQL_KEYWORDS } from "./sql-keywords.ts";

const lower = (word: string): string => word.toLowerCase();
const upper = (word: string): string => word.toUpperCase();

describe("applyKeywordCasing", () => {
  it("returns empty SQL unchanged", () => {
    assert.equal(applyKeywordCasing("", lower), "");
  });

  it("lowercases every registered keyword", () => {
    for (const word of SQL_KEYWORDS) {
      assert.equal(applyKeywordCasing(word, lower), word.toLowerCase(), word);
      assert.equal(
        applyKeywordCasing(word.toLowerCase(), lower),
        word.toLowerCase(),
        word,
      );
    }
  });

  it("uppercases every registered keyword", () => {
    for (const word of SQL_KEYWORDS) {
      assert.equal(
        applyKeywordCasing(word.toLowerCase(), upper),
        word.toUpperCase(),
        word,
      );
    }
  });

  it("leaves non-keywords alone", () => {
    assert.equal(
      applyKeywordCasing("set_updated_at plpgsql users CREATED NOTNULL", lower),
      "set_updated_at plpgsql users CREATED NOTNULL",
    );
  });

  it("skips single-quoted strings including escaped quotes", () => {
    assert.equal(
      applyKeywordCasing("VALUES ('CREATE', 'NOT NULL', 'it''s CREATE')", lower),
      "values ('CREATE', 'NOT NULL', 'it''s CREATE')",
    );
  });

  it("skips double-quoted identifiers including escaped quotes", () => {
    assert.equal(
      applyKeywordCasing('CREATE TABLE "CREATE" ("TABLE")', lower),
      'create table "CREATE" ("TABLE")',
    );
    assert.equal(
      applyKeywordCasing('SELECT "a""CREATE""b" FROM t', lower),
      'select "a""CREATE""b" from t',
    );
  });

  it("skips backtick identifiers", () => {
    assert.equal(
      applyKeywordCasing("CREATE TABLE `CREATE` (`TABLE`)", lower),
      "create table `CREATE` (`TABLE`)",
    );
    assert.equal(
      applyKeywordCasing("SELECT `a``CREATE``b` FROM t", lower),
      "select `a``CREATE``b` from t",
    );
  });

  it("skips bracket identifiers", () => {
    assert.equal(
      applyKeywordCasing("CREATE TABLE [CREATE] ([TABLE])", lower),
      "create table [CREATE] ([TABLE])",
    );
  });

  it("skips line comments", () => {
    assert.equal(
      applyKeywordCasing("-- CREATE TABLE stays\nDROP TABLE t;", lower),
      "-- CREATE TABLE stays\ndrop table t;",
    );
  });

  it("skips block comments", () => {
    assert.equal(
      applyKeywordCasing("SELECT /* CREATE TABLE */ 1 FROM t", lower),
      "select /* CREATE TABLE */ 1 from t",
    );
    assert.equal(
      applyKeywordCasing("SELECT /*\nCREATE\nTABLE\n*/ 1", lower),
      "select /*\nCREATE\nTABLE\n*/ 1",
    );
  });

  it("cases keywords next to punctuation and numbers", () => {
    assert.equal(
      applyKeywordCasing("VARCHAR(256) INT UNSIGNED DECIMAL(10, 2)", lower),
      "varchar(256) int unsigned decimal(10, 2)",
    );
    assert.equal(
      applyKeywordCasing("SELECT @@ROWCOUNT AS affected;", lower),
      "select @@rowcount as affected;",
    );
    assert.equal(
      applyKeywordCasing("INT AUTO_INCREMENT", lower),
      "int auto_increment",
    );
  });

  it("does not case a keyword that is only a prefix of an identifier", () => {
    assert.equal(
      applyKeywordCasing("CREATED NOTES ONZONE", lower),
      "CREATED NOTES ONZONE",
    );
  });
});
