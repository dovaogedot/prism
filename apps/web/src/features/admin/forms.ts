/**
 * How the admin's forms read what staff type: prices in euros, which the API
 * takes in cents, slugs made from a name, and a picture to upload.
 */

import {
  FieldChecks,
  ImageAlt,
  ProductFields,
  ProductInput,
  ShippingMethodInput,
  type ShippingMethodView,
} from "@prism/shared"
import { z } from "zod"

export const Cents = {
  /** Whole cents from euros written with a dot or a comma and at most two decimals. Exact: no floating point. */
  fromEuros: (text: string): number => {
    const [whole = "0", fraction = ""] = text.replace(",", ".").split(".")
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  },

  /** Cents as staff type them back: "12.50". */
  toEuros: (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
} as const

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
} as const

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
} as const

/** The product form: the API's product, with the price typed in euros and held to the API's limits. */
export type ProductForm = z.input<typeof ProductForm.schema>
export const ProductForm = {
  schema: ProductInput.schema.omit({ priceCents: true }).extend({ price: Euros.schema.pipe(ProductFields.priceCents) }),
} as const

/** The delivery option form's fields: the API's option, with the prices typed in euros. */
export const ShippingFields = {
  schema: z
    .strictObject({
      code: ShippingMethodInput.schema.shape.code,
      name: ShippingMethodInput.schema.shape.name,
      // In euros, then held to the API's limits in cents.
      price: Euros.schema.pipe(ShippingMethodInput.schema.shape.priceCents),
      freeFrom: Euros.optional.pipe(ShippingMethodInput.schema.shape.freeFromCents),
      minDays: z
        .number({ error: "Enter a number of days." })
        .int("Enter whole days.")
        .min(1, "Use 1 to 30 days.")
        .max(30, "Use 1 to 30 days."),
      maxDays: z
        .number({ error: "Enter a number of days." })
        .int("Enter whole days.")
        .min(1, "Use 1 to 30 days.")
        .max(30, "Use 1 to 30 days."),
      isActive: z.boolean(),
      position: z
        .number({ error: "Enter a position." })
        .int("Enter a whole number.")
        .min(0, "Use 0 or more.")
        .max(1000, "Use at most 1000."),
    })
    .refine((form) => form.minDays <= form.maxDays, {
      message: "The latest day cannot come before the earliest.",
      path: ["maxDays"],
      when: FieldChecks.runWhenValid("minDays", "maxDays"),
    }),
} as const

/** The delivery option form as staff fill it in. */
export type ShippingForm = z.input<typeof ShippingFields.schema>
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
} as const

/** The form that adds a picture to a product: the file, the text that describes it, and whether it is pixel art. */
export const PictureUploadForm = {
  schema: z.strictObject({
    // A file input holds the files chosen, which are none until one is.
    file: z
      .custom<FileList>((files) => files instanceof FileList, "Choose a picture to upload.")
      .transform((files, context) => {
        const file = files.item(0)
        if (file !== null) return file

        context.addIssue({ code: "custom", message: "Choose a picture to upload." })
        return z.NEVER
      }),
    alt: ImageAlt.schema,
    isPixelArt: z.boolean(),
  }),
} as const
