import type { OtpauthUri } from "@prism/shared"

/** The setup key an authenticator app asks for when it cannot scan the code. */
export const SetupKey = {
  /** The base32 secret `uri` carries, cut into groups of four for reading, or `undefined` when it carries none. */
  splitIntoGroups: (uri: OtpauthUri): readonly string[] | undefined => {
    const secret = new URL(uri).searchParams.get("secret")
    if (secret === null || secret.length === 0) return undefined

    return secret.match(/.{1,4}/g) ?? undefined
  },
} as const
