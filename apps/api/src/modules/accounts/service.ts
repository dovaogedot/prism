/**
 * A customer's own account: the profile, and the addresses checkout can
 * start from.
 */

import {
  SavedAddress,
  type AddressId,
  type DomainError,
  type Profile,
  type ProfileInput,
  type SavedAddressInput,
  type UserId,
} from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Clock } from "../../platform/clock.ts";
import type { AuthRepository } from "../auth/repository.ts";
import type { AccountRepository } from "./repository.ts";

/** What the accounts service works through. */
export type AccountDependencies = Readonly<{ repository: AccountRepository; users: AuthRepository; clock: Clock }>;

/** Everything the account pages do. */
export type AccountService = Readonly<{
  profile: (userId: UserId) => ResultAsync<Profile, DomainError>;
  updateProfile: (userId: UserId, input: ProfileInput) => ResultAsync<Profile, DomainError>;
  addresses: (userId: UserId) => Promise<readonly SavedAddress[]>;
  addAddress: (userId: UserId, input: SavedAddressInput) => ResultAsync<SavedAddress, DomainError>;
  updateAddress: (userId: UserId, id: AddressId, input: SavedAddressInput) => ResultAsync<SavedAddress, DomainError>;
  removeAddress: (userId: UserId, id: AddressId) => ResultAsync<void, DomainError>;
  /** The address checkout starts with; `undefined` when none is the default. */
  defaultAddressOf: (userId: UserId) => Promise<SavedAddress | undefined>;
}>;

export const AccountService = {
  create: (deps: AccountDependencies): AccountService => {
    const { repository, clock } = deps;

    const profile = (userId: UserId): ResultAsync<Profile, DomainError> =>
      ResultAsync.fromSafePromise(Promise.all([deps.users.findUserById(userId), repository.profileOf(userId)])).andThen(
        ([user, record]) =>
          user === undefined || record === undefined
            ? errAsync<Profile, DomainError>({ _tag: "Unauthenticated" })
            : okAsync<Profile, DomainError>({ email: user.email, ...record }),
      );

    const addressWith = (userId: UserId, id: AddressId): ResultAsync<SavedAddress, DomainError> =>
      ResultAsync.fromSafePromise(repository.addresses(userId)).andThen((all) => {
        const found = all.find((address) => address.id === id);
        return found === undefined ? errAsync<SavedAddress, DomainError>({ _tag: "AddressNotFound" }) : okAsync<SavedAddress, DomainError>(found);
      });

    return {
      profile,

      updateProfile: (userId, input) =>
        ResultAsync.fromSafePromise(
          repository.setProfile(userId, {
            ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
            ...(input.phone === undefined ? {} : { phone: input.phone }),
          }),
        ).andThen(() => profile(userId)),

      addresses: (userId) => repository.addresses(userId),

      addAddress: (userId, input) =>
        ResultAsync.fromSafePromise(repository.addAddress(userId, input, SavedAddress.MAX, clock.now())).andThen((outcome) =>
          outcome._tag === "LimitReached"
            ? errAsync<SavedAddress, DomainError>({ _tag: "AddressLimitReached" })
            : addressWith(userId, outcome.id),
        ),

      updateAddress: (userId, id, input) =>
        ResultAsync.fromSafePromise(repository.updateAddress(userId, id, input, clock.now())).andThen((updated) =>
          updated ? addressWith(userId, id) : errAsync<SavedAddress, DomainError>({ _tag: "AddressNotFound" }),
        ),

      removeAddress: (userId, id) =>
        ResultAsync.fromSafePromise(repository.removeAddress(userId, id)).andThen((removed) =>
          removed ? okAsync<void, DomainError>(undefined) : errAsync<void, DomainError>({ _tag: "AddressNotFound" }),
        ),

      defaultAddressOf: async (userId) => (await repository.addresses(userId)).find((address) => address.isDefault),
    };
  },
} as const;
