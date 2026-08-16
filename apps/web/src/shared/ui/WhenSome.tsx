import type { Option } from "@prism/shared";
import type { ReactNode } from "react";
import { match } from "ts-pattern";

/** Renders an `Option` without the caller writing a branch. */
export const WhenSome = <A,>({
  option,
  children,
}: Readonly<{ option: Option<A>; children: (value: A) => ReactNode }>) =>
  match(option)
    .with({ _tag: "Some" }, ({ value }) => children(value))
    .with({ _tag: "None" }, () => null)
    .exhaustive();
