import { z } from 'zod'

/**
 * The vault holds photographs kept out of the ordinary library entirely. It opens only
 * for a signed-in browser session that re-enters the passphrase, so a bearer token can
 * read this and still have no way in.
 */
export const VaultStatus = z.object({
  configured: z.boolean(),
  unlocked: z.boolean(),
  /**
   * Only present while unlocked: a locked vault does not reveal its size.
   *
   * Absent *or* null, because the other four ports accept both — Rust's is a
   * `#[serde(default)] Option<u64>`, Swift's an `Int?` — and a schema stricter than they
   * are would make TypeScript the one port a server could break by being explicit.
   */
  count: z.number().int().nonnegative().nullish(),
})
export type VaultStatus = z.infer<typeof VaultStatus>
