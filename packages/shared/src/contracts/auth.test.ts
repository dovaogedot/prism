import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  emailSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
  resetPasswordSchema,
  totpCodeSchema,
  twoFactorLoginSchema,
} from "./auth.ts";

const validPassword = "correct horse battery staple";

describe("emailSchema", () => {
  it("accepts ordinary addresses", () => {
    expect(emailSchema.parse("shopper@example.com")).toBe("shopper@example.com");
  });

  it("normalises case and whitespace so one person is one account", () => {
    expect(emailSchema.parse("  Shopper@Example.COM  ")).toBe("shopper@example.com");
  });

  it("accepts sub-addressing and plus tags", () => {
    expect(emailSchema.parse("shopper+colours@example.co.uk")).toBe(
      "shopper+colours@example.co.uk",
    );
  });

  it("rejects malformed addresses", () => {
    const rejected = [
      "",
      "   ",
      "not-an-email",
      "@example.com",
      "shopper@",
      "shopper example.com",
      "shopper@@example.com",
    ];

    for (const input of rejected) {
      expect(emailSchema.safeParse(input).success, input).toBe(false);
    }
  });

  it("rejects addresses beyond the RFC length limit", () => {
    const tooLong = `${"a".repeat(250)}@example.com`;
    expect(emailSchema.safeParse(tooLong).success).toBe(false);
  });

  it("does not treat an injection payload as an address", () => {
    const payloads = [
      "'; DROP TABLE users; --@example.com",
      "<script>alert(1)</script>@example.com",
      "shopper@example.com\r\nBcc: victim@example.com",
    ];

    for (const payload of payloads) {
      expect(emailSchema.safeParse(payload).success, payload).toBe(false);
    }
  });
});

describe("passwordSchema", () => {
  it("accepts a long passphrase", () => {
    expect(passwordSchema.parse(validPassword)).toBe(validPassword);
  });

  it("enforces the minimum length at the boundary", () => {
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(
      false,
    );
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
  });

  it("enforces the maximum length, so hashing cost stays bounded", () => {
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MAX_LENGTH)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(
      false,
    );
  });

  it("rejects known-common passwords regardless of case", () => {
    expect(passwordSchema.safeParse("password123").success).toBe(false);
    expect(passwordSchema.safeParse("PASSWORD123").success).toBe(false);
    expect(passwordSchema.safeParse("iloveshopping").success).toBe(false);
  });

  it("imposes no composition rules, per NIST SP 800-63B", () => {
    expect(passwordSchema.safeParse("all lowercase words here").success).toBe(true);
  });

  it("preserves the password byte-for-byte — no trimming", () => {
    const padded = ` ${validPassword} `;
    expect(passwordSchema.parse(padded)).toBe(padded);
  });
});

describe("totpCodeSchema", () => {
  it("accepts exactly six digits", () => {
    expect(totpCodeSchema.parse("012345")).toBe("012345");
  });

  it("trims whitespace people paste in from their phone", () => {
    expect(totpCodeSchema.parse(" 123456 ")).toBe("123456");
  });

  it("rejects anything that is not six digits", () => {
    for (const input of ["12345", "1234567", "12345a", "", "abcdef", "12 3456"]) {
      expect(totpCodeSchema.safeParse(input).success, input).toBe(false);
    }
  });
});

describe("registerSchema", () => {
  const valid = {
    email: "shopper@example.com",
    password: validPassword,
    captchaToken: "captcha-response",
  };

  it("accepts a complete registration", () => {
    expect(registerSchema.parse(valid)).toEqual(valid);
  });

  it("requires a CAPTCHA response", () => {
    expect(registerSchema.safeParse({ ...valid, captchaToken: "" }).success).toBe(false);
  });

  it("strips unknown keys, so `role` cannot be mass-assigned", () => {
    const parsed = registerSchema.parse({ ...valid, role: "admin", id: "1" });
    expect(parsed).toEqual(valid);
    expect(Object.keys(parsed)).toEqual(["email", "password", "captchaToken"]);
  });

  it("reports every invalid field at once rather than one at a time", () => {
    const result = registerSchema.safeParse({
      email: "nope",
      password: "short",
      captchaToken: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(new Set(paths)).toEqual(new Set(["email", "password", "captchaToken"]));
    }
  });
});

describe("loginSchema", () => {
  it("does not apply password strength rules to sign-in", () => {
    // An account created before a rule change must still be able to sign in.
    expect(
      loginSchema.safeParse({ email: "shopper@example.com", password: "old" }).success,
    ).toBe(true);
  });

  it("still requires a non-empty password", () => {
    expect(
      loginSchema.safeParse({ email: "shopper@example.com", password: "" }).success,
    ).toBe(false);
  });
});

describe("twoFactorLoginSchema", () => {
  it("requires both the challenge and the code", () => {
    expect(
      twoFactorLoginSchema.safeParse({ challengeToken: "t", code: "123456" }).success,
    ).toBe(true);
    expect(twoFactorLoginSchema.safeParse({ challengeToken: "", code: "123456" }).success).toBe(
      false,
    );
    expect(twoFactorLoginSchema.safeParse({ challengeToken: "t", code: "12" }).success).toBe(
      false,
    );
  });
});

describe("resetPasswordSchema", () => {
  it("applies full strength rules to the new password", () => {
    expect(resetPasswordSchema.safeParse({ token: "t", password: "short" }).success).toBe(
      false,
    );
    expect(
      resetPasswordSchema.safeParse({ token: "t", password: validPassword }).success,
    ).toBe(true);
  });

  it("requires the token", () => {
    expect(
      resetPasswordSchema.safeParse({ token: "", password: validPassword }).success,
    ).toBe(false);
  });
});
