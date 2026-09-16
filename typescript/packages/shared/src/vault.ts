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
   * Absent, not null. The other four ports tolerate an explicit null as a side effect of
   * their optionals, but the server omits the key and the contract's locked fixture omits
   * it too, so `nullish` here would widen this type — the SDK's public `VaultStatus` —
   * for a value nothing can send.
   */
  count: z.number().int().nonnegative().optional(),
})
export type VaultStatus = z.infer<typeof VaultStatus>
