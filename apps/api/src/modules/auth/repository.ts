/**
 * Every database statement the auth module makes. This is the boundary where
 * nullable columns become absent fields: nothing above this file sees `null`.
 */

import { and, eq, getTableColumns, gt, isNull, sql } from "drizzle-orm";
import type { DomainError, Email, OAuthProvider, SessionUser, UserId } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Database } from "../../db/client.ts";
import type { SessionId } from "../../db/ids.ts";
import {
  oauthIdentities,
  passwordResetTokens,
  refreshTokens,
  sessions,
  users,
  type RevocationReason,
} from "../../db/schema.ts";
import type { PasswordHash } from "../../platform/hasher.ts";
import type { ProviderSubject } from "../../platform/oauth.ts";
import type { Digest } from "../../platform/tokens.ts";
import type { TotpSecret } from "../../platform/totp.ts";

/** An account as the rest of the module sees it. */
export type UserRecord = Readonly<{
  id: UserId;
  email: Email;
  /** Left out for an account that only ever signed in through a provider. */
  passwordHash?: PasswordHash;
  /** Present once setup begins; confirmed only when `totpEnabledAt` is set. */
  totpSecret?: TotpSecret;
  totpEnabledAt?: Date;
  /** Every provider linked to this account, alphabetically. */
  providers: readonly OAuthProvider[];
  createdAt: Date;
}>;

/** The row as the driver returns it, with the linked providers alongside. */
type UserRow = typeof users.$inferSelect & Readonly<{ providers: readonly OAuthProvider[] }>;

export const UserRecord = {
  fromRow: (row: UserRow): UserRecord => ({
    id: row.id,
    email: row.email,
    ...(row.passwordHash === null ? {} : { passwordHash: row.passwordHash }),
    ...(row.totpSecret === null ? {} : { totpSecret: row.totpSecret }),
    ...(row.totpEnabledAt === null ? {} : { totpEnabledAt: row.totpEnabledAt }),
    providers: row.providers,
    createdAt: row.createdAt,
  }),

  /** An account as the wire reports it. Neither secret leaves in it. */
  toSessionUser: (user: UserRecord): SessionUser => ({
    id: user.id,
    email: user.email,
    twoFactorEnabled: user.totpEnabledAt !== undefined,
    hasPassword: user.passwordHash !== undefined,
    providers: user.providers,
  }),

  /**
   * The record as it stands once `provider` has just been linked, in the
   * same alphabetical order the SQL produces.
   */
  withProvider: (user: UserRecord, provider: OAuthProvider): UserRecord => ({
    ...user,
    providers: [...new Set([...user.providers, provider])].sort(),
  }),
} as const;

/** One sign-in, which is both the revocation unit and the refresh family. */
export type SessionRecord = Readonly<{ id: SessionId; userId: UserId; expiresAt: Date }>;

/**
 * The outcome of presenting a refresh token. A union rather than an
 * exception, because a replay must still COMMIT the revocation it performed.
 */
export type RotationOutcome =
  | Readonly<{ _tag: "Rotated"; userId: UserId; sessionId: SessionId }>
  | Readonly<{ _tag: "Replayed" }>
  | Readonly<{ _tag: "Unknown" }>
  | Readonly<{ _tag: "SessionEnded" }>;

/** The outcome of presenting a password-reset token with a replacement password. */
export type PasswordResetOutcome = Readonly<{ _tag: "Reset" }> | Readonly<{ _tag: "TokenInvalid" }>;

/** Every read and write the auth module makes against the database. */
export type AuthRepository = Readonly<{
  findUserByEmail: (email: Email) => Promise<UserRecord | undefined>;
  findUserById: (id: UserId) => Promise<UserRecord | undefined>;
  findUserByOAuthIdentity: (provider: OAuthProvider, subject: ProviderSubject) => Promise<UserRecord | undefined>;
  createUser: (input: { email: Email; passwordHash?: PasswordHash }) => ResultAsync<UserRecord, DomainError>;
  linkOAuthIdentity: (input: { userId: UserId; provider: OAuthProvider; subject: ProviderSubject }) => Promise<void>;
  setPasswordHash: (userId: UserId, passwordHash: PasswordHash) => Promise<void>;
  setTotpSecret: (userId: UserId, secret: TotpSecret) => Promise<void>;
  enableTotp: (userId: UserId, enabledAt: Date) => Promise<void>;
  disableTotp: (userId: UserId) => Promise<void>;
  createSession: (input: {
    userId: UserId;
    expiresAt: Date;
    userAgent: string;
    ipAddress: string;
    refreshTokenDigest: Digest;
    refreshExpiresAt: Date;
  }) => Promise<SessionRecord>;
  /** The guard's hot path: is this session still live? */
  isSessionLive: (sessionId: SessionId, now: Date) => Promise<boolean>;
  revokeSession: (sessionId: SessionId, reason: RevocationReason) => Promise<void>;
  rotateRefreshToken: (input: {
    presentedDigest: Digest;
    replacementDigest: Digest;
    now: Date;
    replacementExpiresAt: Date;
  }) => Promise<RotationOutcome>;
  createPasswordResetToken: (input: { userId: UserId; digest: Digest; expiresAt: Date }) => Promise<void>;
  /**
   * Spends a live, unused reset token, stores `passwordHash` on its user and
   * signs every session of that user out, as one transaction: all three
   * happen or none does. A token that is unknown, spent or expired changes
   * nothing.
   */
  resetPassword: (input: { digest: Digest; passwordHash: PasswordHash; now: Date }) => Promise<PasswordResetOutcome>;
}>;

export const AuthRepository = {
  /**
   * The providers linked to a user, as a column rather than a second query.
   * The outer row is referenced as the table plus a literal column name,
   * because drizzle renders a column bare in a single-table select and
   * qualified in a join; the table alone renders the same in both.
   */
  linkedProviders: sql<readonly OAuthProvider[]>`COALESCE(
    (SELECT array_agg(DISTINCT link.provider ORDER BY link.provider)
     FROM oauth_identity link WHERE link.user_id = ${users}."id"),
    ARRAY[]::text[]
  )`,

  /** Postgres unique-violation, read one level down from drizzle's wrapper. */
  isUniqueViolation: (reason: unknown): boolean => {
    const codeOf = (value: unknown): unknown =>
      typeof value === "object" && value !== null && "code" in value ? value.code : undefined;

    return (
      codeOf(reason) === "23505" ||
      (typeof reason === "object" && reason !== null && "cause" in reason && codeOf(reason.cause) === "23505")
    );
  },

  create: (db: Database): AuthRepository => {
    const columns = { ...getTableColumns(users), providers: AuthRepository.linkedProviders };

    const firstUser = (rows: readonly UserRow[]): UserRecord | undefined => {
      const row = rows[0];
      return row === undefined ? undefined : UserRecord.fromRow(row);
    };

    return {
      findUserByEmail: async (email) =>
        firstUser(await db.select(columns).from(users).where(eq(users.email, email)).limit(1)),

      findUserById: async (id) =>
        firstUser(await db.select(columns).from(users).where(eq(users.id, id)).limit(1)),

      findUserByOAuthIdentity: async (provider, subject) => {
        // Nested under a key: bare column names are ambiguous once two tables
        // with an `id` are joined.
        const rows = await db
          .select({ user: users, providers: AuthRepository.linkedProviders })
          .from(oauthIdentities)
          .innerJoin(users, eq(users.id, oauthIdentities.userId))
          .where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.subject, subject)))
          .limit(1);

        return firstUser(rows.map((row) => ({ ...row.user, providers: row.providers })));
      },

      // Detected rather than pre-checked: SELECT-then-INSERT races, a unique index does not.
      createUser: ({ email, passwordHash }) =>
        ResultAsync.fromPromise(
          db
            .insert(users)
            .values({ email, passwordHash: passwordHash ?? null })
            .returning(),
          (reason): DomainError =>
            AuthRepository.isUniqueViolation(reason)
              ? { _tag: "EmailAlreadyRegistered" }
              : { _tag: "Conflict" },
        ).andThen((rows) => {
          const created = firstUser(rows.map((row) => ({ ...row, providers: [] })));
          return created === undefined
            ? errAsync<UserRecord, DomainError>({ _tag: "Conflict" })
            : okAsync<UserRecord, DomainError>(created);
        }),

      linkOAuthIdentity: async ({ userId, provider, subject }) => {
        await db.insert(oauthIdentities).values({ userId, provider, subject }).onConflictDoNothing();
      },

      setPasswordHash: async (userId, passwordHash) => {
        await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
      },

      setTotpSecret: async (userId, secret) => {
        await db.update(users).set({ totpSecret: secret, totpEnabledAt: null }).where(eq(users.id, userId));
      },

      enableTotp: async (userId, enabledAt) => {
        await db.update(users).set({ totpEnabledAt: enabledAt }).where(eq(users.id, userId));
      },

      disableTotp: async (userId) => {
        await db.update(users).set({ totpSecret: null, totpEnabledAt: null }).where(eq(users.id, userId));
      },

      // The session and its first refresh token are one unit.
      createSession: (input) =>
        db.transaction(async (tx) => {
          const [session] = await tx
            .insert(sessions)
            .values({
              userId: input.userId,
              expiresAt: input.expiresAt,
              userAgent: input.userAgent,
              ipAddress: input.ipAddress,
            })
            .returning({ id: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt });

          if (session === undefined) throw new Error("session insert returned no row");

          await tx.insert(refreshTokens).values({
            sessionId: session.id,
            tokenHash: input.refreshTokenDigest,
            expiresAt: input.refreshExpiresAt,
          });

          return session;
        }),

      isSessionLive: async (sessionId, now) => {
        const rows = await db
          .select({ id: sessions.id })
          .from(sessions)
          .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
          .limit(1);

        return rows.length > 0;
      },

      revokeSession: async (sessionId, reason) => {
        await db
          .update(sessions)
          .set({ revokedAt: new Date(), revokedReason: reason })
          .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
      },

      /**
       * Single-use rotation with replay detection. `FOR UPDATE` on the token
       * row makes a concurrent second presentation wait, then re-read the row
       * with `used_at` set. READ COMMITTED on purpose: under SERIALIZABLE the
       * waiter would abort instead of seeing the update. The replay branch
       * returns rather than throws, so its revocation commits.
       */
      rotateRefreshToken: ({ presentedDigest, replacementDigest, now, replacementExpiresAt }) =>
        db.transaction(async (tx): Promise<RotationOutcome> => {
          const [row] = await tx
            .select({
              tokenId: refreshTokens.id,
              usedAt: refreshTokens.usedAt,
              tokenExpiresAt: refreshTokens.expiresAt,
              sessionId: sessions.id,
              sessionRevokedAt: sessions.revokedAt,
              sessionExpiresAt: sessions.expiresAt,
              userId: sessions.userId,
            })
            .from(refreshTokens)
            .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
            .where(eq(refreshTokens.tokenHash, presentedDigest))
            .for("update", { of: refreshTokens })
            .limit(1);

          if (row === undefined) return { _tag: "Unknown" };

          if (row.usedAt !== null) {
            // Someone holds a copy. End the whole family, not just this token.
            await tx
              .update(sessions)
              .set({ revokedAt: now, revokedReason: "token_reuse" })
              .where(and(eq(sessions.id, row.sessionId), isNull(sessions.revokedAt)));

            return { _tag: "Replayed" };
          }

          if (row.sessionRevokedAt !== null || row.tokenExpiresAt <= now || row.sessionExpiresAt <= now) {
            return { _tag: "SessionEnded" };
          }

          await tx.update(refreshTokens).set({ usedAt: now }).where(eq(refreshTokens.id, row.tokenId));
          await tx.insert(refreshTokens).values({
            sessionId: row.sessionId,
            tokenHash: replacementDigest,
            expiresAt: replacementExpiresAt,
          });

          return { _tag: "Rotated", userId: row.userId, sessionId: row.sessionId };
        }),

      createPasswordResetToken: async ({ userId, digest, expiresAt }) => {
        await db.insert(passwordResetTokens).values({ userId, tokenHash: digest, expiresAt });
      },

      resetPassword: ({ digest, passwordHash, now }) =>
        db.transaction(async (tx): Promise<PasswordResetOutcome> => {
          // The check and the spending are one statement, so the token works
          // once however many requests carry it.
          const [spent] = await tx
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

          if (spent === undefined) return { _tag: "TokenInvalid" };

          await tx.update(users).set({ passwordHash }).where(eq(users.id, spent.userId));

          // Whoever knew the old password no longer has a way in.
          await tx
            .update(sessions)
            .set({ revokedAt: now, revokedReason: "password_reset" })
            .where(and(eq(sessions.userId, spent.userId), isNull(sessions.revokedAt)));

          return { _tag: "Reset" };
        }),
    };
  },
} as const;
