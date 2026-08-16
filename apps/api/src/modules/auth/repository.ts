/**
 * Every database statement the auth module makes.
 *
 * This is the boundary where nullable columns stop being nullable: rows come
 * out as records whose absent fields are `Option`, and nothing above this file
 * sees a `null` again.
 */

import { and, eq, getTableColumns, gt, isNull, sql } from "drizzle-orm";
import type { DomainError, UserRole } from "@prism/shared";
import { Option } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Database } from "../../db/client.ts";
import {
  oauthIdentities,
  passwordResetTokens,
  refreshTokens,
  sessions,
  users,
} from "../../db/schema.ts";

export type UserRecord = Readonly<{
  id: string;
  email: string;
  passwordHash: Option<string>;
  role: UserRole;
  totpSecret: Option<string>;
  totpEnabledAt: Option<Date>;
  /** Every OAuth provider linked to this account, alphabetically. */
  providers: readonly string[];
  createdAt: Date;
}>;

export type SessionRecord = Readonly<{
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Option<Date>;
}>;

/** Why a session ended. Stored so an investigation can tell logout from attack. */
export type RevocationReason = "logout" | "token_reuse" | "password_reset";

/**
 * The providers linked to a user, as a column rather than a second query.
 *
 * Every caller that loads a user goes on to build a `SessionUser` from it, and
 * none of them is in a position to await another round trip — `toSessionUser`
 * is a pure function in the middle of a `ResultAsync` chain. The correlated
 * subquery rides along with the row instead.
 *
 * The reference to the outer row is the table followed by a literal column
 * name, because Drizzle renders a column differently depending on where it is
 * used: bare `"id"` in a single-table select, qualified `"app_user"."id"` in a
 * join. Interpolating the column gives one query a reference that resolves to
 * `oauth_identity.id` — matching nothing, silently — and the other a doubled
 * `"app_user"."app_user"."id"`. The table alone renders the same in both.
 */
const linkedProviders = sql<readonly string[]>`COALESCE(
  (
    SELECT array_agg(DISTINCT link.provider ORDER BY link.provider)
    FROM oauth_identity link
    WHERE link.user_id = ${users}."id"
  ),
  ARRAY[]::text[]
)`;

const USER_COLUMNS = { ...getTableColumns(users), providers: linkedProviders } as const;

type UserRow = typeof users.$inferSelect & Readonly<{ providers: readonly string[] }>;

const toUserRecord = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: Option.fromNullable(row.passwordHash),
  role: row.role,
  totpSecret: Option.fromNullable(row.totpSecret),
  totpEnabledAt: Option.fromNullable(row.totpEnabledAt),
  providers: row.providers,
  createdAt: row.createdAt,
});

const firstOf = <A>(rows: readonly A[]): Option<A> =>
  Option.fromNullable(rows[0]);

/**
 * Postgres unique-violation. Detected rather than pre-checked, because
 * "SELECT then INSERT" has a race between the two statements and a unique
 * index does not.
 */
const UNIQUE_VIOLATION = "23505";

const hasPostgresCode = (value: unknown, code: string): boolean =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  value.code === code;

/**
 * Drizzle wraps driver errors in a `DrizzleQueryError` and puts the original
 * `PostgresError` on `cause`, so the SQLSTATE has to be read one level down.
 * Checking only the outer object silently turns every duplicate email into a
 * generic conflict.
 */
const isUniqueViolation = (reason: unknown): boolean => {
  if (hasPostgresCode(reason, UNIQUE_VIOLATION)) return true;

  return (
    typeof reason === "object" &&
    reason !== null &&
    "cause" in reason &&
    hasPostgresCode(reason.cause, UNIQUE_VIOLATION)
  );
};

/**
 * The outcome of presenting a refresh token. A tagged union rather than an
 * exception, because one of these outcomes — a replay — must still COMMIT the
 * revocation it performed. See `rotateRefreshToken`.
 */
export type RotationOutcome =
  | Readonly<{ _tag: "Rotated"; userId: string; sessionId: string; role: UserRole }>
  | Readonly<{ _tag: "Replayed" }>
  | Readonly<{ _tag: "Unknown" }>
  | Readonly<{ _tag: "SessionEnded" }>;

export type AuthRepository = Readonly<{
  findUserByEmail: (email: string) => Promise<Option<UserRecord>>;
  findUserById: (id: string) => Promise<Option<UserRecord>>;
  findUserByOAuthIdentity: (
    provider: string,
    subject: string,
  ) => Promise<Option<UserRecord>>;

  createUser: (input: {
    email: string;
    passwordHash: Option<string>;
  }) => ResultAsync<UserRecord, DomainError>;

  linkOAuthIdentity: (input: {
    userId: string;
    provider: string;
    subject: string;
  }) => Promise<void>;

  setPasswordHash: (userId: string, passwordHash: string) => Promise<void>;
  setTotpSecret: (userId: string, secret: string) => Promise<void>;
  enableTotp: (userId: string, enabledAt: Date) => Promise<void>;
  disableTotp: (userId: string) => Promise<void>;

  createSession: (input: {
    userId: string;
    expiresAt: Date;
    userAgent: string;
    ipAddress: string;
    refreshTokenDigest: string;
    refreshExpiresAt: Date;
  }) => Promise<SessionRecord>;

  /** The access-token guard's hot path: is this session still live? */
  isSessionLive: (sessionId: string, now: Date) => Promise<boolean>;

  revokeSession: (sessionId: string, reason: RevocationReason) => Promise<void>;
  revokeSessionsForUser: (
    userId: string,
    reason: RevocationReason,
  ) => Promise<void>;

  rotateRefreshToken: (input: {
    presentedDigest: string;
    replacementDigest: string;
    now: Date;
    replacementExpiresAt: Date;
  }) => Promise<RotationOutcome>;

  createPasswordResetToken: (input: {
    userId: string;
    digest: string;
    expiresAt: Date;
  }) => Promise<void>;

  consumePasswordResetToken: (
    digest: string,
    now: Date,
  ) => Promise<Option<string>>;
}>;

export const createAuthRepository = (db: Database): AuthRepository => ({
  findUserByEmail: async (email) =>
    Option.map(toUserRecord)(
      firstOf(await db.select(USER_COLUMNS).from(users).where(eq(users.email, email)).limit(1)),
    ),

  findUserById: async (id) =>
    Option.map(toUserRecord)(
      firstOf(await db.select(USER_COLUMNS).from(users).where(eq(users.id, id)).limit(1)),
    ),

  findUserByOAuthIdentity: async (provider, subject) => {
    // Nested under a key rather than spread: `getTableColumns` emits bare
    // column names, and `"id"` is ambiguous once this joins two tables that
    // both have one.
    const rows = await db
      .select({ user: users, providers: linkedProviders })
      .from(oauthIdentities)
      .innerJoin(users, eq(users.id, oauthIdentities.userId))
      .where(
        and(
          eq(oauthIdentities.provider, provider),
          eq(oauthIdentities.subject, subject),
        ),
      )
      .limit(1);

    return Option.map(
      (row: { user: typeof users.$inferSelect; providers: readonly string[] }) =>
        toUserRecord({ ...row.user, providers: row.providers }),
    )(firstOf(rows));
  },

  createUser: ({ email, passwordHash }) =>
    ResultAsync.fromPromise(
      db
        .insert(users)
        .values({ email, passwordHash: Option.toNullable(passwordHash) })
        .returning(),
      (reason): DomainError =>
        isUniqueViolation(reason)
          ? { _tag: "EmailAlreadyRegistered" }
          : { _tag: "Conflict" },
    ).andThen((rows) => {
      const created = firstOf(rows);
      return Option.isSome(created)
        ? // A user this new has nothing linked yet; the OAuth flow links a
          // provider immediately afterwards.
          okAsync<UserRecord, DomainError>(
            toUserRecord({ ...created.value, providers: [] }),
          )
        : errAsync<UserRecord, DomainError>({ _tag: "Conflict" });
    }),

  linkOAuthIdentity: async ({ userId, provider, subject }) => {
    await db
      .insert(oauthIdentities)
      .values({ userId, provider, subject })
      .onConflictDoNothing();
  },

  setPasswordHash: async (userId, passwordHash) => {
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  },

  setTotpSecret: async (userId, secret) => {
    await db
      .update(users)
      .set({ totpSecret: secret, totpEnabledAt: null })
      .where(eq(users.id, userId));
  },

  enableTotp: async (userId, enabledAt) => {
    await db.update(users).set({ totpEnabledAt: enabledAt }).where(eq(users.id, userId));
  },

  disableTotp: async (userId) => {
    await db
      .update(users)
      .set({ totpSecret: null, totpEnabledAt: null })
      .where(eq(users.id, userId));
  },

  createSession: async (input) => {
    // The session and its first refresh token are one unit: a session with no
    // token is unusable, and a token with no session is unverifiable.
    const created = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(sessions)
        .values({
          userId: input.userId,
          expiresAt: input.expiresAt,
          userAgent: input.userAgent,
          ipAddress: input.ipAddress,
        })
        .returning();

      const session = rows[0];
      if (session === undefined) throw new Error("session insert returned no row");

      await tx.insert(refreshTokens).values({
        sessionId: session.id,
        tokenHash: input.refreshTokenDigest,
        expiresAt: input.refreshExpiresAt,
      });

      return session;
    });

    return {
      id: created.id,
      userId: created.userId,
      expiresAt: created.expiresAt,
      revokedAt: Option.fromNullable(created.revokedAt),
    };
  },

  isSessionLive: async (sessionId, now) => {
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .limit(1);

    return rows.length > 0;
  },

  revokeSession: async (sessionId, reason) => {
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  },

  revokeSessionsForUser: async (userId, reason) => {
    await db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  },

  /**
   * Refresh-token rotation, single-use, with replay detection.
   *
   * `FOR UPDATE` on the token row is what makes this correct under
   * concurrency: a second request presenting the same token blocks until the
   * first commits, then re-reads the row and sees `used_at` already set.
   *
   * Note the isolation level is deliberately the default READ COMMITTED rather
   * than SERIALIZABLE. Under SERIALIZABLE the blocked transaction would abort
   * with a serialization failure instead of observing the updated row — which
   * would turn a detectable replay into a retryable error and lose the
   * revocation. The row lock already gives strict ordering; the weaker
   * isolation level is what lets the second request *see* what the first did.
   *
   * The replay branch returns rather than throws, because its session
   * revocation has to commit. Throwing would roll it back and leave a stolen
   * token's family alive.
   */
  rotateRefreshToken: ({ presentedDigest, replacementDigest, now, replacementExpiresAt }) =>
    db.transaction(async (tx): Promise<RotationOutcome> => {
      const rows = await tx
        .select({
          tokenId: refreshTokens.id,
          usedAt: refreshTokens.usedAt,
          tokenExpiresAt: refreshTokens.expiresAt,
          sessionId: sessions.id,
          sessionRevokedAt: sessions.revokedAt,
          sessionExpiresAt: sessions.expiresAt,
          userId: users.id,
          role: users.role,
        })
        .from(refreshTokens)
        .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(refreshTokens.tokenHash, presentedDigest))
        .for("update", { of: refreshTokens })
        .limit(1);

      const row = rows[0];
      if (row === undefined) return { _tag: "Unknown" };

      if (row.usedAt !== null) {
        // A token presented twice means someone holds a copy. Assume the worst
        // and end the whole family, not just this token.
        await tx
          .update(sessions)
          .set({ revokedAt: now, revokedReason: "token_reuse" })
          .where(and(eq(sessions.id, row.sessionId), isNull(sessions.revokedAt)));

        return { _tag: "Replayed" };
      }

      if (row.sessionRevokedAt !== null) return { _tag: "SessionEnded" };
      if (row.tokenExpiresAt <= now) return { _tag: "SessionEnded" };
      if (row.sessionExpiresAt <= now) return { _tag: "SessionEnded" };

      await tx
        .update(refreshTokens)
        .set({ usedAt: now })
        .where(eq(refreshTokens.id, row.tokenId));

      await tx.insert(refreshTokens).values({
        sessionId: row.sessionId,
        tokenHash: replacementDigest,
        expiresAt: replacementExpiresAt,
      });

      return {
        _tag: "Rotated",
        userId: row.userId,
        sessionId: row.sessionId,
        role: row.role,
      };
    }),

  createPasswordResetToken: async ({ userId, digest, expiresAt }) => {
    await db
      .insert(passwordResetTokens)
      .values({ userId, tokenHash: digest, expiresAt });
  },

  /** Single-use: the same link cannot reset a password twice. */
  consumePasswordResetToken: async (digest, now) => {
    const rows = await db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, digest),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .returning({ userId: passwordResetTokens.userId });

    return Option.map((row: { userId: string }) => row.userId)(firstOf(rows));
  },
});
