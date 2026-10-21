/**
 * The signed-in customer's own account data: the profile and the saved
 * addresses, and which saved address checkout starts with.
 */

import type { AddressId, Profile, ProfileInput, SavedAddress, SavedAddressInput } from "@prism/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../../shared/api/client.ts";
import { useSession } from "../auth/session.ts";

export const SavedAddresses = {
  /** The address checkout starts with: the default one; `undefined` when there is none. */
  initial: (addresses: readonly SavedAddress[]): SavedAddress | undefined => addresses.find((address) => address.isDefault),

  /** An address on one line, such as "Narva mnt 7, 10117 Tallinn". */
  oneLine: (address: SavedAddress["address"]): string =>
    [address.line1, address.line2, `${address.postalCode} ${address.city}`].filter((part) => part !== undefined && part.length > 0).join(", "),
} as const;

export const AccountKeys = {
  profile: (userId: string | undefined) => ["account", userId ?? "guest", "profile"] as const,
  addresses: (userId: string | undefined) => ["account", userId ?? "guest", "addresses"] as const,
} as const;

/** The signed-in customer's profile; nothing is fetched for a guest. */
export const useProfile = () => {
  const session = useSession();

  return useQuery({
    queryKey: AccountKeys.profile(session?.id),
    queryFn: ({ signal }) => Api.get<Profile>("/account/profile", signal),
    enabled: session !== undefined,
  });
};

/** The signed-in customer's saved addresses, the default first; nothing is fetched for a guest. */
export const useSavedAddresses = () => {
  const session = useSession();

  return useQuery({
    queryKey: AccountKeys.addresses(session?.id),
    queryFn: async ({ signal }) => (await Api.get<{ items: readonly SavedAddress[] }>("/account/addresses", signal)).items,
    enabled: session !== undefined,
  });
};

/** Changing the profile and the saved addresses; each answer replaces what the page holds. */
export const useAccountChanges = () => {
  const client = useQueryClient();

  const userId = useSession()?.id;

  const refreshAddresses = (): Promise<void> => client.invalidateQueries({ queryKey: AccountKeys.addresses(userId) });

  const saveProfile = useMutation({
    mutationFn: (profile: ProfileInput) => Api.put<Profile>("/account/profile", profile),
    onSuccess: (profile) => client.setQueryData(AccountKeys.profile(userId), profile),
  });

  const addAddress = useMutation({
    mutationFn: (address: SavedAddressInput) => Api.post<SavedAddress>("/account/addresses", address),
    onSuccess: refreshAddresses,
  });

  const updateAddress = useMutation({
    mutationFn: (change: Readonly<{ id: AddressId; address: SavedAddressInput }>) => Api.put<SavedAddress>(`/account/addresses/${change.id}`, change.address),
    onSuccess: refreshAddresses,
  });

  const removeAddress = useMutation({
    mutationFn: (id: AddressId) => Api.requestEmpty(`/account/addresses/${id}`, { method: "DELETE" }),
    onSuccess: refreshAddresses,
  });

  return { saveProfile, addAddress, updateAddress, removeAddress };
};
