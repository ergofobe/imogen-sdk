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
  /** Suspended: the rows are all still here, but nobody can sign in as them. */
  disabled: z.boolean(),
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

/** Only what an administrator is allowed to change about somebody else's account. */
export const AdminUserUpdate = z.object({
  role: UserRole.optional(),
  disabled: z.boolean().optional(),
})
export type AdminUserUpdate = z.infer<typeof AdminUserUpdate>

/** A newly set password, handed back to the administrator to pass on. */
export const AdminPasswordReset = z.object({
  password: z.string().min(10).max(1024),
})
export type AdminPasswordReset = z.infer<typeof AdminPasswordReset>

/**
 * An outstanding invitation.
 *
 * The token is absent on purpose: it is shown once, when the invitation is made, and
 * is stored only as a hash. An administrator who loses the link revokes it and makes
 * another rather than looking the old one up.
 */
export const Invite = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  role: UserRole,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  /** Expired, accepted, or still good. */
  state: z.enum(['pending', 'accepted', 'expired']),
})
export type Invite = z.infer<typeof Invite>

export const InviteCreate = z.object({
  /** When set, only this address may use the link. */
  email: z.email().nullable().optional(),
  role: UserRole.default('user'),
  expiresInDays: z.number().int().min(1).max(90).default(7),
})
export type InviteCreate = z.infer<typeof InviteCreate>

/** The one and only time the token is legible. */
export const InviteCreated = Invite.extend({ token: z.string() })
export type InviteCreated = z.infer<typeof InviteCreated>

/** One piece of background work, as an administrator needs to see it. */
export const AdminJob = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().nullable(),
  runAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
})
export type AdminJob = z.infer<typeof AdminJob>

/**
 * The state of the work queue.
 *
 * `stuck` counts photographs the pipeline never finished with. They are the reason
 * this section exists: without it a failed transcode leaves a photo saying
 * "processing" for ever and nothing anywhere says why.
 */
export const QueueHealth = z.object({
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Assets left in a pending or processing state, whatever the queue says. */
  stuck: z.number().int().nonnegative(),
  /** The oldest thing still waiting, so a jammed queue is obvious. */
  oldestQueuedAt: z.iso.datetime().nullable(),
  failures: z.array(AdminJob),
})
export type QueueHealth = z.infer<typeof QueueHealth>

/**
 * An application allowed to act on someone's behalf.
 *
 * `dynamicallyRegistered` is the one that matters: with RFC 7591 open, anything that
 * asks gets a client, so this separates what an administrator set up deliberately
 * from what simply turned up.
 */
export const AdminClient = z.object({
  id: z.string(),
  name: z.string(),
  redirectUris: z.array(z.string()),
  scopes: z.array(z.string()),
  dynamicallyRegistered: z.boolean(),
  /** Public clients hold no secret and rely on PKCE. Native apps and MCP are these. */
  isPublic: z.boolean(),
  createdAt: z.iso.datetime(),
  /** How many live tokens it holds, across everyone. */
  activeTokens: z.number().int().nonnegative(),
})
export type AdminClient = z.infer<typeof AdminClient>

/** A signed-in browser. */
export const AdminSession = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userEmail: z.string(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** True for the session making this request, so it is not revoked by accident. */
  current: z.boolean(),
})
export type AdminSession = z.infer<typeof AdminSession>
