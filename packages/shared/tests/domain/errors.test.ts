import { describe, expect, it } from "vitest";
import {
  httpStatusByTag,
  httpStatusOf,
  messageByTag,
  messageOf,
  toErrorResponse,
  type DomainError,
} from "../../src/domain/errors.ts";

const allTags = Object.keys(httpStatusByTag);

describe("the error tables", () => {
  it("covers every tag in both tables", () => {
    expect(Object.keys(messageByTag).sort()).toEqual(allTags.sort());
  });

  it("maps every tag to a client or server error status", () => {
    for (const [tag, status] of Object.entries(httpStatusByTag)) {
      expect(status, tag).toBeGreaterThanOrEqual(400);
      expect(status, tag).toBeLessThan(600);
    }
  });

  it("gives every tag a non-empty, sentence-shaped message", () => {
    for (const [tag, message] of Object.entries(messageByTag)) {
      expect(message.length, tag).toBeGreaterThan(0);
      expect(message, tag).toMatch(/[.!?]$/);
    }
  });
});

describe("credential safety", () => {
  it("never reveals which half of a credential pair was wrong", () => {
    const message = messageByTag["InvalidCredentials"].toLowerCase();
    expect(message).toContain("or");
    expect(message).not.toMatch(/no account|not registered|unknown user|wrong password/);
  });

  it("uses one status for both halves so timing is the only side channel left", () => {
    expect(httpStatusByTag["InvalidCredentials"]).toBe(401);
    expect(httpStatusByTag["Unauthenticated"]).toBe(401);
  });
});

describe("httpStatusOf", () => {
  it("reads the status from the tag", () => {
    expect(httpStatusOf({ _tag: "ProductNotFound" })).toBe(404);
    expect(httpStatusOf({ _tag: "EmailAlreadyRegistered" })).toBe(409);
    expect(httpStatusOf({ _tag: "RateLimited" })).toBe(429);
    expect(httpStatusOf({ _tag: "ValidationFailed", issues: [] })).toBe(422);
  });
});

describe("messageOf", () => {
  it("reads the message from the tag", () => {
    expect(messageOf({ _tag: "ImageTooLarge" })).toBe(messageByTag["ImageTooLarge"]);
  });
});

describe("toErrorResponse", () => {
  it("puts the tag on the wire as a stable machine-readable code", () => {
    expect(toErrorResponse({ _tag: "ProductNotFound" })).toEqual({
      error: {
        code: "ProductNotFound",
        message: messageByTag["ProductNotFound"],
        issues: [],
      },
    });
  });

  it("carries field issues through for validation failures", () => {
    const issues = [{ path: "email", message: "Enter a valid email address." }];
    const error: DomainError = { _tag: "ValidationFailed", issues };

    expect(toErrorResponse(error).error.issues).toEqual(issues);
  });

  it("always emits an issues array, so clients need no absence check", () => {
    expect(toErrorResponse({ _tag: "Forbidden" }).error.issues).toEqual([]);
  });
});
