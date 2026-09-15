import { z } from 'zod'

/**
 * The vault holds photographs kept out of the ordinary library entirely. It opens only
 * for a signed-in browser session that re-enters the passphrase, so a bearer token can
 * read this and still have no way in.
 */
export const VaultStatus = z.object({
  configured: z.boolean(),
  unlocked: z.boolean(),
  /** Only present while unlocked: a locked vault does not reveal its size. */
  count: z.number().int().nonnegative().optional(),
})
export type VaultStatus = z.infer<typeof VaultStatus>
