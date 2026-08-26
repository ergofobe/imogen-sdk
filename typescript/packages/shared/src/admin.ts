import { z } from 'zod'
import { UserRole } from './auth.ts'

/**
 * An account as an administrator sees it.
 *
 * Deliberately not the same shape as `User`: this carries what is needed to decide
 * what to do about someone — how much of the disk they are using, whether they can
 * still sign in, how they authenticate — and carries no secret of any kind. Password
 * and vault hashes never leave the database, so they are absent here rather than
 * present and stripped somewhere downstream.
 */
export const AdminUser = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: UserRole,
  /** How this account signs in. An SSO account has no password to reset. */
  signsInWith: z.enum(['password', 'sso', 'both']),
  photoCount: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
  /** Null when the account draws on whatever the server has. */
  quotaBytes: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type AdminUser = z.infer<typeof AdminUser>

export const AdminUserList = z.object({ items: z.array(AdminUser) })
export type AdminUserList = z.infer<typeof AdminUserList>
