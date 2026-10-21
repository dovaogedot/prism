/**
 * The account pages of the admin: finding accounts, and the changes only an
 * admin makes to them. Nobody changes their own roles, status or 2FA here,
 * and the shop never loses its last admin.
 */

import type {
  AdminUserDetail,
  AdminUserQuery,
  AdminUserSummary,
  DomainError,
  OrderSummary,
  Page,
  StaffRole,
  UserId,
} from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Clock } from "../../platform/clock.ts";
import type { Mailer } from "../../platform/mailer.ts";
import type { StaffActor } from "../staff/audit.ts";
import type { AccountAdminRepository, AccountOutcome } from "./admin-repository.ts";
import { RolesChangedEmail } from "./emails.ts";

/** The ports the account admin works through. */
export type AccountAdminDependencies = Readonly<{
  repository: AccountAdminRepository;
  /** The account's most recent orders, newest first. */
  recentOrders: (userId: UserId) => Promise<readonly OrderSummary[]>;
  mailer: Mailer;
  clock: Clock;
  webOrigin: string;
}>;

/** Everything the account pages of the admin do. Each change answers the account as it now stands. */
export type AccountAdminService = Readonly<{
  list: (query: AdminUserQuery) => Promise<Page<AdminUserSummary>>;
  detail: (userId: UserId) => ResultAsync<AdminUserDetail, DomainError>;
  setRoles: (actor: StaffActor, userId: UserId, roles: readonly StaffRole[]) => ResultAsync<AdminUserDetail, DomainError>;
  disable: (actor: StaffActor, userId: UserId) => ResultAsync<AdminUserDetail, DomainError>;
  enable: (actor: StaffActor, userId: UserId) => ResultAsync<AdminUserDetail, DomainError>;
  resetTwoFactor: (actor: StaffActor, userId: UserId) => ResultAsync<AdminUserDetail, DomainError>;
  signOut: (actor: StaffActor, userId: UserId) => ResultAsync<AdminUserDetail, DomainError>;
}>;

export const AccountAdminService = {
  /** A refusal for each outcome that is not a change. */
  failureOf: (outcome: AccountOutcome): DomainError | undefined => {
    if (outcome._tag === "NotFound") return { _tag: "UserNotFound" };
    if (outcome._tag === "LastAdmin") return { _tag: "LastAdmin" };
    return undefined;
  },

  create: (deps: AccountAdminDependencies): AccountAdminService => {
    const { repository, clock } = deps;

    const detail = (userId: UserId): ResultAsync<AdminUserDetail, DomainError> =>
      ResultAsync.fromSafePromise(
        Promise.all([repository.detail(userId, clock.now()), deps.recentOrders(userId)]),
      ).andThen(([account, orders]) =>
        account === undefined
          ? errAsync<AdminUserDetail, DomainError>({ _tag: "UserNotFound" })
          : okAsync<AdminUserDetail, DomainError>({ ...account, orders }),
      );

    /** Runs `change` on another account, then answers that account as it now stands. */
    const change = (
      actor: StaffActor,
      userId: UserId,
      run: () => Promise<AccountOutcome>,
    ): ResultAsync<AdminUserDetail, DomainError> => {
      if (actor.id === userId) return errAsync({ _tag: "SelfChangeNotAllowed" });

      return ResultAsync.fromSafePromise(run()).andThen((outcome) => {
        const failure = AccountAdminService.failureOf(outcome);
        return failure === undefined ? detail(userId) : errAsync<AdminUserDetail, DomainError>(failure);
      });
    };

    return {
      list: (query) => repository.list(query),

      detail,

      setRoles: (actor, userId, roles) => {
        if (actor.id === userId) return errAsync({ _tag: "SelfChangeNotAllowed" });

        return ResultAsync.fromSafePromise(repository.setRoles({ userId, roles, actor })).andThen((outcome) => {
          if (outcome._tag === "NotFound") return errAsync<AdminUserDetail, DomainError>({ _tag: "UserNotFound" });
          if (outcome._tag === "LastAdmin") return errAsync<AdminUserDetail, DomainError>({ _tag: "LastAdmin" });
          if (outcome._tag === "Unchanged") return detail(userId);

          return ResultAsync.fromSafePromise(
            deps.mailer.send(RolesChangedEmail.compose({ to: outcome.email, roles, adminUrl: `${deps.webOrigin}/admin` })),
          ).andThen(() => detail(userId));
        });
      },

      disable: (actor, userId) =>
        change(actor, userId, () => repository.setDisabled({ userId, isDisabled: true, actor, now: clock.now() })),

      enable: (actor, userId) =>
        change(actor, userId, () => repository.setDisabled({ userId, isDisabled: false, actor, now: clock.now() })),

      resetTwoFactor: (actor, userId) =>
        change(actor, userId, () => repository.resetTwoFactor({ userId, actor, now: clock.now() })),

      // Signing an account out, one's own included, takes nothing away.
      signOut: (actor, userId) =>
        ResultAsync.fromSafePromise(repository.signOut({ userId, actor, now: clock.now() })).andThen((outcome) => {
          const failure = AccountAdminService.failureOf(outcome);
          return failure === undefined ? detail(userId) : errAsync<AdminUserDetail, DomainError>(failure);
        }),
    };
  },
} as const;
