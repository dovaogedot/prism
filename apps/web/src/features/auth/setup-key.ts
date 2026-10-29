import type { OtpauthUri } from "@prism/shared"

/** The setup key an authenticator app asks for when it cannot scan the code. */
export const SetupKey = {
  /** The base32 secret `uri` carries, in groups of four, or `undefined` when it carries none. */
  of: (uri: OtpauthUri): string | undefined => {
    const secret = new URL(uri).searchParams.get("secret")
    if (secret === null || secret.length === 0) return undefined

    return secret.match(/.{1,4}/g)?.join(" ")
  },
} as const
