import type { ko } from "./ko";

/** Literal string types widened to `string`, so other languages can fill the same shape. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : { readonly [K in keyof T]: Widen<T[K]> };

/** The shape every dictionary has: the keys of the Korean dictionary. */
export type Strings = Widen<typeof ko>;
