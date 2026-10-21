/**
 * A customer's own account data: the profile and the saved addresses. The
 * email is shown but stays as it is; changing it would need a verification
 * the shop does not have.
 */

import { z } from "zod";
import type { Email } from "./auth.ts";
import { Contact, ShippingAddress } from "./checkout.ts";
import { OptionalText } from "./reviews.ts";

/** The identity of a saved address, as the database assigns it. */
export type AddressId = z.infer<typeof AddressId.schema>;
export const AddressId = {
  schema: z.uuid().brand<"AddressId">(),
} as const;

/** A customer's profile as `GET /account/profile` serves it. Each field is absent until set. */
export type Profile = Readonly<{ email: Email; fullName?: string; phone?: string }>;

/** A validated `PUT /account/profile` body. An empty field clears it. */
export type ProfileInput = z.infer<typeof ProfileInput.schema>;
export const ProfileInput = {
  schema: z.strictObject({
    fullName: OptionalText.of(100, "Use at most 100 characters.").pipe(
      z.string().min(2, "Enter at least 2 characters.").optional(),
    ),
    phone: z
      .string()
      .trim()
      .transform((phone) => (phone.length === 0 ? undefined : phone))
      .pipe(Contact.schema.shape.phone.optional())
      .optional(),
  }),
} as const;

/** A validated saved address, as `POST` and `PUT /account/addresses` take it. */
export type SavedAddressInput = z.infer<typeof SavedAddressInput.schema>;
export const SavedAddressInput = {
  schema: z.strictObject({
    /** What the customer calls it, such as "Home". */
    label: z.string({ error: "Name the address." }).trim().min(1, "Name the address.").max(40, "Use at most 40 characters."),
    fullName: Contact.schema.shape.fullName,
    phone: Contact.schema.shape.phone,
    address: ShippingAddress.schema,
    /** Makes this the address checkout starts with. */
    isDefault: z.boolean().default(false),
  }),
} as const;

/** A saved address as the account serves it. */
export type SavedAddress = Readonly<{
  id: AddressId;
  label: string;
  fullName: string;
  phone: string;
  address: ShippingAddress;
  isDefault: boolean;
}>;

export const SavedAddress = {
  /** The most addresses one account keeps. */
  MAX: 10,
} as const;
