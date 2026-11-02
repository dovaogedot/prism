import * as Flags from "country-flag-icons/react/3x2"

/** The country whose flag to draw, as its ISO code such as "EE". */
export type CountryFlagProps = Readonly<{ country: string; className?: string }>

const flags: Readonly<Record<string, (typeof Flags)[keyof typeof Flags] | undefined>> = Flags

/** A country's flag, drawn as an SVG since Windows shows flag emoji as two letters; nothing for a code the set lacks. */
export const CountryFlag = ({ country, className }: CountryFlagProps) => {
  const Flag = flags[country]
  return Flag === undefined ? null : <Flag className={className} aria-hidden="true" />
}
