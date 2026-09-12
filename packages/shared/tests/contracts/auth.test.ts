import { describe, expect, it } from "vitest";
import {
  Email,
  LoginInput,
  Password,
  RegisterInput,
  ResetPasswordInput,
  TotpCode,
  TwoFactorLoginInput,
} from "../../src/contracts/auth.ts";

const validPassword = "correct horse battery staple";

describe("Email.schema", () => {
  it("accepts ordinary addresses", () => {
    expect(Email.schema.parse("shopper@example.com")).toBe("shopper@example.com");
  });

  it("normalizes case and whitespace so one person is one account", () => {
    expect(Email.schema.parse("  Shopper@Example.COM  ")).toBe("shopper@example.com");
  });

  it("accepts sub-addressing and plus tags", () => {
    expect(Email.schema.parse("shopper+tag@example.co.uk")).toBe(
      "shopper+tag@example.co.uk",
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
      expect(Email.schema.safeParse(input).success, input).toBe(false);
    }
  });

  it("rejects addresses beyond the RFC length limit", () => {
    const tooLong = `${"a".repeat(250)}@example.com`;
    expect(Email.schema.safeParse(tooLong).success).toBe(false);
  });

  it("does not treat an injection payload as an address", () => {
    const payloads = [
      "'; DROP TABLE users; --@example.com",
      "<script>alert(1)</script>@example.com",
      "shopper@example.com\r\nBcc: victim@example.com",
    ];

    for (const payload of payloads) {
      expect(Email.schema.safeParse(payload).success, payload).toBe(false);
    }
  });
});

describe("Password.schema", () => {
  it("accepts a long passphrase", () => {
    expect(Password.schema.parse(validPassword)).toBe(validPassword);
  });

  it("enforces the minimum length at the boundary", () => {
    expect(Password.schema.safeParse("a".repeat(Password.MIN_LENGTH - 1)).success).toBe(
      false,
    );
    expect(Password.schema.safeParse("a".repeat(Password.MIN_LENGTH)).success).toBe(true);
  });

  it("enforces the maximum length, so hashing cost stays bounded", () => {
    expect(Password.schema.safeParse("a".repeat(Password.MAX_LENGTH)).success).toBe(true);
    expect(Password.schema.safeParse("a".repeat(Password.MAX_LENGTH + 1)).success).toBe(
      false,
    );
  });

  it("rejects known-common passwords regardless of case", () => {
    expect(Password.schema.safeParse("password123").success).toBe(false);
    expect(Password.schema.safeParse("PASSWORD123").success).toBe(false);
    expect(Password.schema.safeParse("iloveshopping").success).toBe(false);
  });

  it("imposes no composition rules, per NIST SP 800-63B", () => {
    expect(Password.schema.safeParse("all lowercase words here").success).toBe(true);
  });

  it("preserves the password byte-for-byte — no trimming", () => {
    const padded = ` ${validPassword} `;
    expect(Password.schema.parse(padded)).toBe(padded);
  });
});

describe("TotpCode.schema", () => {
  it("accepts exactly six digits", () => {
    expect(TotpCode.schema.parse("012345")).toBe("012345");
  });

  it("trims whitespace people paste in from their phone", () => {
    expect(TotpCode.schema.parse(" 123456 ")).toBe("123456");
  });

  it("rejects anything that is not six digits", () => {
    for (const input of ["12345", "1234567", "12345a", "", "abcdef", "12 3456"]) {
      expect(TotpCode.schema.safeParse(input).success, input).toBe(false);
    }
  });
});

describe("RegisterInput.schema", () => {
  const valid = {
    email: "shopper@example.com",
    password: validPassword,
    captchaToken: "captcha-response",
  };

  it("accepts a complete registration", () => {
    expect(RegisterInput.schema.parse(valid)).toEqual(valid);
  });

  it("requires a CAPTCHA response", () => {
    expect(RegisterInput.schema.safeParse({ ...valid, captchaToken: "" }).success).toBe(false);
  });

  it("strips unknown keys, so `role` cannot be mass-assigned", () => {
    const parsed = RegisterInput.schema.parse({ ...valid, role: "admin", id: "1" });
    expect(parsed).toEqual(valid);
    expect(Object.keys(parsed)).toEqual(["email", "password", "captchaToken"]);
  });

  it("reports every invalid field at once rather than one at a time", () => {
    const result = RegisterInput.schema.safeParse({
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

describe("LoginInput.schema", () => {
  it("does not apply password strength rules to sign-in", () => {
    // An account created before a rule change must still be able to sign in.
    expect(
      LoginInput.schema.safeParse({ email: "shopper@example.com", password: "old" }).success,
    ).toBe(true);
  });

  it("still requires a non-empty password", () => {
    expect(
      LoginInput.schema.safeParse({ email: "shopper@example.com", password: "" }).success,
    ).toBe(false);
  });
});

describe("TwoFactorLoginInput.schema", () => {
  it("requires both the challenge and the code", () => {
    expect(
      TwoFactorLoginInput.schema.safeParse({ challengeToken: "t", code: "123456" }).success,
    ).toBe(true);
    expect(TwoFactorLoginInput.schema.safeParse({ challengeToken: "", code: "123456" }).success).toBe(
      false,
    );
    expect(TwoFactorLoginInput.schema.safeParse({ challengeToken: "t", code: "12" }).success).toBe(
      false,
    );
  });
});

describe("ResetPasswordInput.schema", () => {
  it("applies full strength rules to the new password", () => {
    expect(ResetPasswordInput.schema.safeParse({ token: "t", password: "short" }).success).toBe(
      false,
    );
    expect(
      ResetPasswordInput.schema.safeParse({ token: "t", password: validPassword }).success,
    ).toBe(true);
  });

  it("requires the token", () => {
    expect(
      ResetPasswordInput.schema.safeParse({ token: "", password: validPassword }).success,
    ).toBe(false);
  });
});
