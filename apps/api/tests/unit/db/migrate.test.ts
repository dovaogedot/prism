import { describe, expect, it } from "vitest";
import { Option } from "@prism/shared";
import {
  checksumOf,
  planMigrations,
  type AppliedMigration,
  type MigrationFile,
} from "../../../src/db/migrate.ts";

const file = (name: string, statements: string): MigrationFile => ({
  name,
  statements,
  checksum: checksumOf(statements),
});

/** The row a database keeps for a file it applied as the file reads now. */
const recordOf = (applied: MigrationFile): AppliedMigration => ({
  name: applied.name,
  checksum: Option.some(applied.checksum),
});

const FIRST = file("0001_first.sql", "CREATE TABLE first (id int);");
const SECOND = file("0002_second.sql", "CREATE TABLE second (id int);");
const THIRD = file("0003_third.sql", "CREATE TABLE third (id int);");
const FILES = [FIRST, SECOND, THIRD];

describe("checksumOf", () => {
  it("is SHA-256, as lowercase hex", () => {
    expect(checksumOf("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("tells apart files that differ only by a trailing newline", () => {
    expect(checksumOf("SELECT 1;")).not.toBe(checksumOf("SELECT 1;\n"));
  });
});

describe("planMigrations", () => {
  it("applies every file, in order, to a database that records none", () => {
    expect(planMigrations(FILES, [])).toEqual({ _tag: "Apply", pending: FILES, skipped: [] });
  });

  it("applies only the files the database does not record", () => {
    expect(planMigrations(FILES, [recordOf(FIRST), recordOf(SECOND)])).toEqual({
      _tag: "Apply",
      pending: [THIRD],
      skipped: [FIRST.name, SECOND.name],
    });
  });

  it("applies nothing to a database built from exactly these files", () => {
    expect(planMigrations(FILES, FILES.map(recordOf))).toEqual({
      _tag: "Apply",
      pending: [],
      skipped: FILES.map((each) => each.name),
    });
  });

  it("refuses a file edited after it was applied, and applies none of the rest", () => {
    const edited = file(FIRST.name, "CREATE TABLE first (id bigint);");

    expect(planMigrations([edited, SECOND, THIRD], [recordOf(FIRST)])).toEqual({
      _tag: "Refuse",
      mismatches: [{ _tag: "Edited", name: FIRST.name }],
    });
  });

  it("refuses a row that keeps no checksum, even when the file is unchanged", () => {
    expect(planMigrations(FILES, [{ name: FIRST.name, checksum: Option.none }])).toEqual({
      _tag: "Refuse",
      mismatches: [{ _tag: "Unverified", name: FIRST.name }],
    });
  });

  it("leaves alone a recorded migration that has no file, as after a rollback", () => {
    expect(planMigrations([FIRST, SECOND], FILES.map(recordOf))).toEqual({
      _tag: "Apply",
      pending: [],
      skipped: [FIRST.name, SECOND.name],
    });
  });

  it("names every mismatch, in the order the rows give them", () => {
    const edited = file(THIRD.name, "CREATE TABLE third (id bigint);");
    const beyond = file("0004_fourth.sql", "CREATE TABLE fourth (id int);");
    const recorded = [
      recordOf(FIRST),
      { name: SECOND.name, checksum: Option.none },
      recordOf(THIRD),
      recordOf(beyond),
    ];

    expect(planMigrations([FIRST, SECOND, edited], recorded)).toEqual({
      _tag: "Refuse",
      mismatches: [
        { _tag: "Unverified", name: SECOND.name },
        { _tag: "Edited", name: THIRD.name },
      ],
    });
  });
});
