import { z } from 'zod'

/**
 * A boolean as a query string or a multipart body can carry it, which is to say as text.
 *
 * `z.coerce.boolean()` reads such a field by JavaScript truthiness, where every string but
 * the empty one is true. So `"false"` — which is exactly what all five ports write — came
 * back as `true`, `favorite=false` favourited the photograph, and no value of the field
 * could say otherwise: an import that set it on every line favourited the whole library
 * (imogen-sdk#36).
 *
 * The spelling is the contract instead, and `conformance/endpoints.json` holds it under
 * `booleanOnTheWire`. `1` and `0` are taken because that is what an HTML form sends for a
 * checkbox. An unrecognised spelling is refused rather than guessed at — a rejected request
 * is a bug report, a silently favourited photograph is not.
 *
 * An already-boolean value passes through untouched: these schemas also type this package's
 * own callers, and re-read upload metadata stored as JSON, where the field never became a
 * string in the first place.
 */
export const WireBoolean = z.union([
  z.boolean(),
  /*
   * Present but carrying no value, which is how `?covers=` arrives from a link built with
   * no query at all. That is an absence of opinion rather than a `false` — and now that
   * `false` means something (only the photographs that are not favourites), reading it as
   * one would be a filter the caller never asked for.
   */
  z.literal('').transform(() => undefined),
  z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1'),
])
export type WireBoolean = z.infer<typeof WireBoolean>
