/**
 * Staff accounts end to end: the 2FA every staff route demands, the step-up
 * that renews it, the rules around roles and disabled accounts, the audit
 * log, and the first admin that comes from the environment.
 */

import { Email } from "@prism/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app.ts";
import { Config, Environment } from "../../src/config.ts";
import { Topology } from "../../src/messaging/topology.ts";
import { AccountAdminRepository } from "../../src/modules/auth/admin-repository.ts";
import { FirstAdmin } from "../../src/modules/auth/first-admin.ts";
import { AuditLog } from "../../src/modules/staff/audit.ts";
import { MockAuthorizationCode } from "../../src/platform/oauth.ts";
import { MessageQueue } from "../../src/platform/queue.ts";
import { TotpSecret } from "../../src/platform/totp.ts";
import {
  cookieValue,
  fastHasher,
  jsonOf,
  registerUser,
  startHarness,
  testEnvironment,
  userIdOf,
  VALID_PASSWORD,
  type Harness,
} from "../support/harness.ts";
import { Staff } from "../support/staff.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
});

const auditActions = async (): Promise<readonly string[]> =>
  (await harness.database.sql<{ action: string }[]>`SELECT action FROM audit_event ORDER BY id`).map((row) => row.action);

describe("the staff guard", () => {
  it("asks a staff account without 2FA to set it up", async () => {
    const moderator = await Staff.account(harness, "moderator@example.com", ["moderator"], { hasTwoFactor: false });

    const response = await Staff.call(harness, moderator, "GET", "/admin/summary");

    expect(response.statusCode).toBe(403);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "TwoFactorSetupRequired" });
  });

  it("asks a session that has not passed a check for a code, and lets it in after the step-up", async () => {
    const { accessToken } = await registerUser(harness, "late-check@example.com");
    const userId = await userIdOf(harness, "late-check@example.com");
    if (userId === undefined) throw new Error("no account");
    await Staff.setRoles(harness, userId, ["moderator"]);

    // A second session, opened before 2FA was on, never passed a check.
    const other = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "late-check@example.com", password: VALID_PASSWORD },
    });
    const unchecked = { userId, email: "late-check@example.com", accessToken: String((jsonOf(other)["grant"] as { accessToken: string }).accessToken), refreshToken: "" };
    const secret = await Staff.enableTwoFactor(harness, { ...unchecked, accessToken });

    const refused = await Staff.call(harness, unchecked, "GET", "/admin/summary");
    expect(refused.statusCode).toBe(403);
    expect(jsonOf(refused)["error"]).toMatchObject({ code: "TwoFactorVerificationRequired" });

    Staff.nextCode(harness);
    const stepUp = await Staff.call(harness, unchecked, "POST", "/auth/2fa/verify", { code: harness.totpCodeFor(secret) });
    expect(stepUp.statusCode).toBe(200);
    expect(jsonOf(stepUp)).toMatchObject({ roles: ["moderator"], isSecondFactorVerified: true });

    expect((await Staff.call(harness, unchecked, "GET", "/admin/summary")).statusCode).toBe(200);
  });

  it("asks for a code again once the check is 8 hours old", async () => {
    const moderator = await Staff.account(harness, "moderator@example.com", ["moderator"]);
    expect((await Staff.call(harness, moderator, "GET", "/admin/summary")).statusCode).toBe(200);

    harness.clock.advanceSeconds(8 * 60 * 60);
    // The access token has expired by now too; the refresh keeps the same session.
    const refreshed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: moderator.refreshToken },
    });
    const renewed = { ...moderator, accessToken: String(jsonOf(refreshed)["accessToken"]) };
    expect(jsonOf(refreshed)["user"]).toMatchObject({ isSecondFactorVerified: false });

    const response = await Staff.call(harness, renewed, "GET", "/admin/summary");
    expect(jsonOf(response)["error"]).toMatchObject({ code: "TwoFactorVerificationRequired" });
  });

  it("counts a provider sign-in that passed the 2FA challenge as checked", async () => {
    const begin = await harness.app.inject({ method: "GET", url: "/api/v1/auth/oauth/github" });
    const state = cookieValue(begin, "prism_oauth_state");
    const callbackOf = (code: string) =>
      harness.app.inject({
        method: "GET",
        url: `/api/v1/auth/oauth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        cookies: { prism_oauth_state: state },
      });
    const code = MockAuthorizationCode.issue("github", Email.schema.parse("oauth-staff@example.com"), harness.config.tokens.secret);

    // The first sign-in creates the account; give it a role and 2FA.
    const first = await callbackOf(code);
    const refreshed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: cookieValue(first, "prism_refresh") },
    });
    const userId = await userIdOf(harness, "oauth-staff@example.com");
    if (userId === undefined) throw new Error("no account");
    await Staff.setRoles(harness, userId, ["support"]);
    const secret = await Staff.enableTwoFactor(harness, {
      userId,
      email: "oauth-staff@example.com",
      accessToken: String(jsonOf(refreshed)["accessToken"]),
      refreshToken: "",
    });

    // The next provider sign-in is challenged, and answering it checks the session.
    const begin2 = await harness.app.inject({ method: "GET", url: "/api/v1/auth/oauth/github" });
    const state2 = cookieValue(begin2, "prism_oauth_state");
    const second = await harness.app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state2)}`,
      cookies: { prism_oauth_state: state2 },
    });
    expect(second.headers["location"]).toContain("/login/2fa");

    Staff.nextCode(harness);
    const answered = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login/2fa",
      cookies: { prism_2fa_challenge: cookieValue(second, "prism_2fa_challenge") },
      payload: { code: harness.totpCodeFor(secret) },
    });
    const grant = jsonOf(answered)["grant"] as { accessToken: string; user: { isSecondFactorVerified: boolean } };

    expect(grant.user.isSecondFactorVerified).toBe(true);
    const summary = await Staff.call(harness, { userId, email: "", accessToken: grant.accessToken, refreshToken: "" }, "GET", "/admin/summary");
    expect(summary.statusCode).toBe(200);
  });
});

describe("TOTP codes", () => {
  it("work once: the same code is refused the second time", async () => {
    const account = await Staff.account(harness, "once@example.com", []);
    if (account.secret === undefined) throw new Error("no secret");

    Staff.nextCode(harness);
    const code = harness.totpCodeFor(account.secret);

    expect((await Staff.call(harness, account, "POST", "/auth/2fa/verify", { code })).statusCode).toBe(200);

    const replayed = await Staff.call(harness, account, "POST", "/auth/2fa/verify", { code });
    expect(replayed.statusCode).toBe(401);
    expect(jsonOf(replayed)["error"]).toMatchObject({ code: "TwoFactorCodeInvalid" });
  });

  it("cannot be turned off by an account with a staff role", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"]);
    if (admin.secret === undefined) throw new Error("no secret");

    Staff.nextCode(harness);
    const response = await Staff.call(harness, admin, "POST", "/auth/2fa/disable", { code: harness.totpCodeFor(admin.secret) });

    expect(response.statusCode).toBe(409);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "TwoFactorRequiredForStaff" });
  });

  it("can still be turned off by a customer", async () => {
    const customer = await Staff.account(harness, "customer@example.com", []);
    if (customer.secret === undefined) throw new Error("no secret");

    Staff.nextCode(harness);
    const response = await Staff.call(harness, customer, "POST", "/auth/2fa/disable", { code: harness.totpCodeFor(customer.secret) });

    expect(response.statusCode).toBe(200);
    expect(jsonOf(response)).toMatchObject({ twoFactorEnabled: false });
  });
});

describe("account changes by an admin", () => {
  it("disables an account: it can neither sign in nor refresh, and its sessions end", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"]);
    const target = await Staff.account(harness, "target@example.com", [], { hasTwoFactor: false });

    const disabled = await Staff.call(harness, admin, "POST", `/admin/users/${target.userId}/disable`);
    expect(disabled.statusCode).toBe(200);
    expect(jsonOf(disabled)).toMatchObject({ disabledAt: expect.any(String), liveSessions: 0 });

    const login = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "target@example.com", password: VALID_PASSWORD },
    });
    expect(jsonOf(login)["error"]).toMatchObject({ code: "AccountDisabled" });

    const refresh = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: target.refreshToken },
    });
    expect(jsonOf(refresh)["error"]).toMatchObject({ code: "AccountDisabled" });

    expect((await Staff.call(harness, target, "GET", "/auth/me")).statusCode).toBe(401);
    expect(await harness.database.sql`SELECT DISTINCT revoked_reason FROM session WHERE user_id = ${target.userId}`).toEqual([
      { revoked_reason: "account_disabled" },
    ]);

    const enabled = await Staff.call(harness, admin, "POST", `/admin/users/${target.userId}/enable`);
    expect(jsonOf(enabled)).not.toHaveProperty("disabledAt");
  });

  it("refuses to change one's own roles or status, or reset one's own 2FA", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"]);
    await Staff.account(harness, "other-admin@example.com", ["admin"]);

    for (const [method, url, payload] of [
      ["PUT", `/admin/users/${admin.userId}/roles`, { roles: [] }],
      ["POST", `/admin/users/${admin.userId}/disable`, undefined],
      ["POST", `/admin/users/${admin.userId}/reset-two-factor`, undefined],
    ] as const) {
      const response = await Staff.call(harness, admin, method, url, payload);
      expect(jsonOf(response)["error"], url).toMatchObject({ code: "SelfChangeNotAllowed" });
    }
  });

  it("never leaves the shop without an admin when two admins demote each other at once", async () => {
    const first = await Staff.account(harness, "first-admin@example.com", ["admin"]);
    const second = await Staff.account(harness, "second-admin@example.com", ["admin"]);

    const results = await Promise.all([
      Staff.call(harness, first, "PUT", `/admin/users/${second.userId}/roles`, { roles: [] }),
      Staff.call(harness, second, "PUT", `/admin/users/${first.userId}/roles`, { roles: [] }),
    ]);

    expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(await harness.database.sql`SELECT count(*)::int AS n FROM app_user WHERE 'admin' = ANY(roles)`).toEqual([{ n: 1 }]);
  });

  it("refuses to demote or disable the last admin, and records nothing", async () => {
    // An admin's guard can pass a moment before another admin demotes it; the
    // repository is what has to hold the line then.
    const admin = await Staff.account(harness, "last-admin@example.com", ["admin"]);
    const former = await Staff.account(harness, "former-admin@example.com", []);
    const repository = AccountAdminRepository.create(harness.database.db, harness.cipher, AuditLog.create(harness.database.db, harness.cipher));
    const actor = { id: former.userId, roles: ["admin"] as const, ip: "203.0.113.1" };
    const before = await auditActions();

    expect(await repository.setRoles({ userId: admin.userId, roles: ["support"], actor })).toEqual({ _tag: "LastAdmin" });
    expect(await repository.setDisabled({ userId: admin.userId, isDisabled: true, actor, now: harness.clock.now() })).toEqual({
      _tag: "LastAdmin",
    });
    expect(await auditActions()).toEqual(before);
  });

  it("writes an audit row exactly when a change commits", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"]);
    const target = await Staff.account(harness, "target@example.com", [], { hasTwoFactor: false });
    const before = await auditActions();

    // Refused: no row.
    await Staff.call(harness, admin, "PUT", `/admin/users/${admin.userId}/roles`, { roles: [] });
    // Unchanged: no row.
    await Staff.call(harness, admin, "PUT", `/admin/users/${target.userId}/roles`, { roles: [] });
    expect(await auditActions()).toEqual(before);

    await Staff.call(harness, admin, "PUT", `/admin/users/${target.userId}/roles`, { roles: ["moderator"] });
    const [row] = await harness.database.sql`
      SELECT actor_id, actor_roles, action, target_type, target_id, changes, ip FROM audit_event ORDER BY id DESC LIMIT 1`;

    expect(row).toMatchObject({
      actor_id: admin.userId,
      actor_roles: ["admin"],
      action: "user.roles",
      target_type: "user",
      target_id: target.userId,
      changes: { roles: [[], ["moderator"]] },
    });
    expect(Buffer.from(row?.["ip"] as Uint8Array).toString("latin1")).not.toContain("127.0.0.1");
    expect(harness.mailer.sent.at(-1)).toMatchObject({ to: "target@example.com", subject: "Your Prism staff roles changed" });
  });

  it("records each staff step-up, and lists the log for admins only", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"]);
    const support = await Staff.account(harness, "support@example.com", ["support"]);

    const log = await Staff.call(harness, admin, "GET", "/admin/audit?action=staff.");
    const items = (jsonOf(log)["items"] as { action: string; actor: { email: string } }[]).map((item) => [item.action, item.actor.email]);

    expect(items).toEqual([
      ["staff.verify", "support@example.com"],
      ["staff.verify", "admin@example.com"],
    ]);
    expect((await Staff.call(harness, support, "GET", "/admin/audit")).statusCode).toBe(403);
  });

  it("resets an account's 2FA, which signs it out", async () => {
    const admin = await Staff.account(harness, "admin@example.com", ["admin"]);
    const target = await Staff.account(harness, "lost-phone@example.com", ["moderator"]);

    const reset = await Staff.call(harness, admin, "POST", `/admin/users/${target.userId}/reset-two-factor`);

    expect(jsonOf(reset)).toMatchObject({ twoFactorEnabled: false, liveSessions: 0 });
    expect((await Staff.call(harness, target, "GET", "/auth/me")).statusCode).toBe(401);
  });
});

describe("the first admin", () => {
  const settings = {
    email: Email.schema.parse("first-admin@example.com"),
    password: "a long admin passphrase",
    totpSecret: TotpSecret.base32.parse("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"),
  };
  const ensure = () =>
    FirstAdmin.ensure({
      repository: AccountAdminRepository.create(harness.database.db, harness.cipher, AuditLog.create(harness.database.db, harness.cipher)),
      hasher: fastHasher,
      clock: harness.clock,
      settings,
    });

  it("is created when no admin exists, with 2FA on under the key", async () => {
    expect(await ensure()).toMatchObject({ _tag: "Created" });

    const login = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: settings.email, password: settings.password },
    });
    expect(jsonOf(login)).toMatchObject({ status: "two_factor_required" });

    const second = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login/2fa",
      payload: { challengeToken: jsonOf(login)["challengeToken"], code: harness.totpCodeFor(settings.totpSecret) },
    });
    expect(jsonOf(second)).toMatchObject({ grant: { user: { roles: ["admin"], isSecondFactorVerified: true } } });
    expect(await auditActions()).toContain("user.create");
  });

  it("promotes an existing account with that email instead of creating one", async () => {
    await registerUser(harness, settings.email);

    expect(await ensure()).toMatchObject({ _tag: "Promoted" });
    expect(await harness.database.sql`SELECT roles, totp_enabled_at FROM app_user`).toEqual([
      { roles: ["admin"], totp_enabled_at: null },
    ]);
  });

  it("changes nothing once an admin exists", async () => {
    await Staff.account(harness, "someone-else@example.com", ["admin"]);

    expect(await ensure()).toEqual({ _tag: "Present" });
    expect(await userIdOf(harness, settings.email)).toBeUndefined();
  });

  it("is made when the application starts with the variables set", async () => {
    const environment = {
      ...testEnvironment(harness.config.database.url, harness.mediaDirectory),
      PORT: "8080",
      SMTP_SECURE: "false",
      ADMIN_EMAIL: "booted-admin@example.com",
      ADMIN_PASSWORD: "a long admin passphrase",
      ADMIN_TOTP_SECRET: "jbsw y3dp ehpk 3pxp jbsw y3dp ehpk 3pxp",
    };
    const built = await App.build({
      config: Config.fromEnvironment(Environment.schema.parse(environment)),
      database: harness.database,
      overrides: { clock: harness.clock, mailer: harness.mailer, hasher: fastHasher, queue: MessageQueue.memory(Topology.declarations()) },
    });
    await built.app.close();

    expect(await userIdOf(harness, "booted-admin@example.com")).toBeDefined();
  });
});
