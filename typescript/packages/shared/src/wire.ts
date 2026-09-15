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
 * `booleanOnTheWire`. `1` and `0` are taken as well because they are the other spelling a
 * hand-written client reaches for; a native checkbox's own `on` is not, since a form posting
 * one would have to be told what `value` to send in any case. An unrecognised spelling is
 * refused rather than guessed at — a rejected request is a bug report, a silently favourited
 * photograph is not.
 *
 * An already-boolean value passes through untouched: these schemas also type this package's
 * own callers, and re-read upload metadata stored as JSON, where the field never became a
 * string in the first place.
 *
 * No type is exported alongside this. Every branch that carries no opinion parses to
 * `undefined`, so the inferred type is `boolean | undefined` — a name a caller would
 * reasonably read as a plain boolean and be wrong about. Fields spell their own optionality
 * with `.optional()`, and `z.infer` on the object they belong to says what they hold.
 */
export const WireBoolean = z.union([
  z.boolean(),
  /*
   * The two ways a field arrives carrying no opinion: present but empty, which is how
   * `?covers=` comes from a link built with no query at all, and an explicit JSON null,
   * which is how a stored metadata blob spells "never set". Both parse to `undefined`, the
   * same as never having been sent — not to `false`, which now means something of its own
   * (only the photographs that are *not* favourites) and would be a filter nobody asked
   * for. The key itself survives on the parsed object holding `undefined`; a reader that
   * asks `value !== undefined`, as this SDK's own query builder does, sees no filter, while
   * one that walks `Object.entries` sees the key. Refusing them instead is worse: it turns
   * a link with an empty parameter into a 400, and `AssetUploadMetadata.safeParse` of an
   * older stored row into a total loss of that row's metadata.
   */
  z.literal('').transform(() => undefined),
  z.null().transform(() => undefined),
  z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1'),
])
