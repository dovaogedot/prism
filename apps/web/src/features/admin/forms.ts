/**
 * How the admin's forms read what staff type: prices in euros, which the API
 * takes in cents, and slugs made from a name.
 */

import { ProductInput, ShippingMethodCode, type ShippingMethodInput, type ShippingMethodView, type ValidationIssue } from "@prism/shared";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { z } from "zod";

export const Cents = {
  /** Whole cents from euros written with a dot or a comma and at most two decimals. Exact: no floating point. */
  fromEuros: (text: string): number => {
    const [whole = "0", fraction = ""] = text.replace(",", ".").split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  },

  /** Cents as staff type them back: "12.50". */
  toEuros: (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
} as const;

export const Euros = {
  /** A price as staff type it, such as "12.50" or "12,5", read as whole cents. */
  schema: z
    .string({ error: "Enter a price." })
    .trim()
    .regex(/^\d{1,7}([.,]\d{1,2})?$/, "Enter a price in euros, such as 12.50.")
    .transform(Cents.fromEuros),

  /** The same, for a field staff may leave empty, which is then absent. */
  optional: z
    .string()
    .trim()
    .regex(/^(\d{1,7}([.,]\d{1,2})?)?$/, "Enter an amount in euros, such as 50.00, or leave it empty.")
    .transform((text) => (text.length === 0 ? undefined : Cents.fromEuros(text))),
} as const;

export const Slugs = {
  /** A slug made from a name: lowercase letters and digits, words joined by dashes, at most 120 characters. */
  fromName: (name: string): string =>
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120)
      .replace(/-+$/, ""),
} as const;

/** The product form: the API's product, with the price typed in euros. */
export type ProductForm = z.input<typeof ProductForm.schema>;
export const ProductForm = {
  schema: ProductInput.schema.omit({ priceCents: true }).extend({ price: Euros.schema }),
} as const;

export const ServerIssues = {
  /**
   * Puts each issue the server found under the field it names, and hands
   * back the ones no field shows. `renamed` maps the API's names to the
   * form's, such as `priceCents` to `price`.
   */
  place: <Values extends FieldValues>(
    issues: readonly ValidationIssue[],
    fields: readonly string[],
    setError: UseFormSetError<Values>,
    renamed: Readonly<Record<string, string>> = {},
  ): readonly ValidationIssue[] => {
    const unplaced: ValidationIssue[] = [];

    for (const issue of issues) {
      const path = renamed[issue.path] ?? issue.path;
      const isField = fields.includes(path) || fields.some((field) => path.startsWith(`${field}.`));

      if (isField) {
        setError(path as Path<Values>, { message: issue.message });
      } else {
        unplaced.push(issue);
      }
    }

    return unplaced;
  },
} as const;

/** The delivery option form's fields: the API's option, with the prices typed in euros. */
export const ShippingFields = {
  schema: z
    .strictObject({
      code: ShippingMethodCode.schema,
      name: z.string().trim().min(1, "Enter a name.").max(60, "Use at most 60 characters."),
      price: Euros.schema,
      freeFrom: Euros.optional,
      minDays: z.number({ error: "Enter a number of days." }).int("Enter whole days.").min(1, "Use 1 to 30 days.").max(30, "Use 1 to 30 days."),
      maxDays: z.number({ error: "Enter a number of days." }).int("Enter whole days.").min(1, "Use 1 to 30 days.").max(30, "Use 1 to 30 days."),
      isActive: z.boolean(),
      position: z.number({ error: "Enter a position." }).int("Enter a whole number.").min(0, "Use 0 or more.").max(1000, "Use at most 1000."),
    })
    .refine((form) => form.minDays <= form.maxDays, { message: "The latest day cannot come before the earliest.", path: ["maxDays"] }),
} as const;

/** The delivery option form as staff fill it in. */
export type ShippingForm = z.input<typeof ShippingFields.schema>;
export const ShippingForm = {
  /** The form an option starts from: empty for a new one. */
  of: (option: ShippingMethodView | undefined, nextPosition: number): ShippingForm =>
    option === undefined
      ? { code: "", name: "", price: "", freeFrom: "", minDays: 2, maxDays: 5, isActive: true, position: nextPosition }
      : {
          code: option.code,
          name: option.name,
          price: Cents.toEuros(option.priceCents),
          freeFrom: option.freeFromCents === undefined ? "" : Cents.toEuros(option.freeFromCents),
          minDays: option.minDays,
          maxDays: option.maxDays,
          isActive: option.isActive,
          position: option.position,
        },

  /** The option the API takes from the form's checked values. */
  toInput: (form: z.output<typeof ShippingFields.schema>): ShippingMethodInput => ({
    code: form.code,
    name: form.name,
    priceCents: form.price,
    ...(form.freeFrom === undefined ? {} : { freeFromCents: form.freeFrom }),
    minDays: form.minDays,
    maxDays: form.maxDays,
    isActive: form.isActive,
    position: form.position,
  }),
} as const;
