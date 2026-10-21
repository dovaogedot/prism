import { describe, expect, it } from "vitest";
import { Config, Environment } from "../../src/config.ts";
import { testEnvironment } from "../support/harness.ts";

/** The test environment as a process would carry it: text where the harness hands the config values. */
const base = { ...testEnvironment("postgres://prism@localhost/prism", "/tmp/media"), PORT: "8080", SMTP_SECURE: "false" };
const admin = {
  ADMIN_EMAIL: "Admin@Prism.test",
  ADMIN_PASSWORD: "a long admin passphrase",
  ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
};

/** The messages a parse of `overrides` over the base environment fails with. */
const problemsOf = (overrides: Readonly<Record<string, unknown>>): readonly string[] => {
  const parsed = Environment.schema.safeParse({ ...base, ...overrides });
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe("the first admin's variables", () => {
  it("make a first admin when all three are set", () => {
    const config = Config.fromEnvironment(Environment.schema.parse({ ...base, ...admin }));

    expect(config.firstAdmin).toEqual({
      email: "admin@prism.test",
      password: "a long admin passphrase",
      totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
    });
  });

  it("make none when all three are unset or empty", () => {
    expect(Config.fromEnvironment(Environment.schema.parse(base)).firstAdmin).toBeUndefined();
    expect(
      Config.fromEnvironment(Environment.schema.parse({ ...base, ADMIN_EMAIL: "", ADMIN_PASSWORD: "", ADMIN_TOTP_SECRET: "" }))
        .firstAdmin,
    ).toBeUndefined();
  });

  it("stop the start when only some are set", () => {
    expect(problemsOf({ ADMIN_EMAIL: admin.ADMIN_EMAIL })).toEqual([
      "Set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_TOTP_SECRET together, or none of them.",
    ]);
    expect(problemsOf({ ADMIN_EMAIL: admin.ADMIN_EMAIL, ADMIN_PASSWORD: admin.ADMIN_PASSWORD })).toHaveLength(1);
  });

  it("stop the start with a password registration would refuse", () => {
    expect(problemsOf({ ...admin, ADMIN_PASSWORD: "short" })).toEqual(["Use at least 12 characters."]);
    expect(problemsOf({ ...admin, ADMIN_PASSWORD: "password123" })).toContain("That password is too easy to guess.");
    expect(problemsOf({ ...admin, ADMIN_PASSWORD: "administrator" })).toEqual(["That password is too easy to guess."]);
  });

  it("stop the start with a key that is short or not base32", () => {
    expect(problemsOf({ ...admin, ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP" })).toEqual([
      "ADMIN_TOTP_SECRET must be at least 32 base32 characters (160 bits).",
    ]);
    expect(problemsOf({ ...admin, ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PX1" })).toEqual([
      "ADMIN_TOTP_SECRET must be base32: letters A to Z and digits 2 to 7.",
    ]);
  });

  it("forgive the spaces, lowercase and padding an authenticator app forgives", () => {
    const config = Config.fromEnvironment(
      Environment.schema.parse({ ...base, ...admin, ADMIN_TOTP_SECRET: "jbsw y3dp ehpk 3pxp jbsw y3dp ehpk 3pxp====" }),
    );

    expect(config.firstAdmin?.totpSecret).toBe("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
  });
});
