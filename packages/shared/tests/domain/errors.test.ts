import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/errors.ts";

describe("the error tables", () => {
  it("covers every tag in both tables", () => {
    expect(Object.keys(DomainError.message).sort()).toEqual(
      Object.keys(DomainError.status).sort(),
    );
  });

  it("maps every tag to a client or server error status", () => {
    for (const [tag, status] of Object.entries(DomainError.status)) {
      expect(status, tag).toBeGreaterThanOrEqual(400);
      expect(status, tag).toBeLessThan(600);
    }
  });

  it("gives every tag a sentence-shaped message", () => {
    for (const [tag, message] of Object.entries(DomainError.message)) {
      expect(message, tag).toMatch(/[.!?]$/);
    }
  });
});

describe("credential safety", () => {
  it("never reveals which half of a credential pair was wrong", () => {
    const message = DomainError.message.InvalidCredentials.toLowerCase();
    expect(message).toContain("or");
    expect(message).not.toMatch(/no account|not registered|unknown user|wrong password/);
  });

  it("uses one status for both halves so timing is the only side channel left", () => {
    expect(DomainError.status.InvalidCredentials).toBe(401);
    expect(DomainError.status.Unauthenticated).toBe(401);
  });
});

describe("DomainError.toResponse", () => {
  it("puts the tag on the wire as a stable machine-readable code", () => {
    expect(DomainError.toResponse({ _tag: "ProductNotFound" })).toEqual({
      error: {
        code: "ProductNotFound",
        message: DomainError.message.ProductNotFound,
        issues: [],
      },
    });
  });

  it("carries field issues through for validation failures", () => {
    const issues = [{ path: "email", message: "Enter a valid email address." }];
    const error: DomainError = { _tag: "ValidationFailed", issues };

    expect(DomainError.toResponse(error).error.issues).toEqual(issues);
    expect(DomainError.httpStatus(error)).toBe(422);
  });
});
