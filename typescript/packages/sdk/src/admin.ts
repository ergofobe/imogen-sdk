import type {
  AdminClient,
  AdminSession,
  AdminShareLink,
  AdminUserUpdate,
  Invite,
  InviteCreate,
  ServerSettingsUpdate,
} from '@imogen/shared'
import {
  AdminClientList,
  AdminSessionList,
  AdminShareLinkList,
  AdminUser,
  AdminUserList,
  InviteCreated,
  InviteList,
  QueueHealth,
  QueueRetryResult,
  ServerSettings,
  StorageReport,
} from '@imogen/shared'
import type { HttpClient } from './http.js'

/**
 * Server administration.
 *
 * Every endpoint here answers 404 rather than 403 to anyone who is not an
 * administrator, so a refusal is indistinguishable from a route that does not exist.
 * Treat a not-found from these methods as "you may not", not as a bug.
 */
export class Admin {
  constructor(private readonly http: HttpClient) {}

  /** Every account on the server, oldest first. Deleted accounts are not included. */
  async users(): Promise<AdminUser[]> {
    const { items } = await this.http.request('GET', '/api/v1/admin/users', {
      decode: AdminUserList,
    })
    return items
  }

  /** Changes a role, or suspends and restores access. */
  updateUser(userId: string, patch: AdminUserUpdate): Promise<AdminUser> {
    return this.http.request('PATCH', `/api/v1/admin/users/${userId}`, {
      body: patch,
      decode: AdminUser,
    })
  }

  /** Removes the account. Its photographs go to the trash, not the incinerator. */
  deleteUser(userId: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/admin/users/${userId}`)
  }

  /** Sets someone's password and ends every session they had. */
  resetPassword(userId: string, password: string): Promise<void> {
    return this.http.request<void>('POST', `/api/v1/admin/users/${userId}/password`, {
      body: { password },
    })
  }

  async invites(): Promise<Invite[]> {
    const { items } = await this.http.request('GET', '/api/v1/admin/invites', {
      decode: InviteList,
    })
    return items
  }

  /** The returned token is the only legible copy. It is stored hashed. */
  createInvite(input: Partial<InviteCreate> = {}): Promise<InviteCreated> {
    return this.http.request('POST', '/api/v1/admin/invites', {
      body: { role: 'user', expiresInDays: 7, ...input },
      decode: InviteCreated,
    })
  }

  revokeInvite(id: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/admin/invites/${id}`)
  }

  /** Queue depth, what is running, and what the pipeline gave up on. */
  queue(): Promise<QueueHealth> {
    return this.http.request('GET', '/api/v1/admin/queue', { decode: QueueHealth })
  }

  /** Puts one failed job back in the queue with its attempts cleared. */
  retryJob(id: string): Promise<void> {
    return this.http.request<void>('POST', `/api/v1/admin/queue/${id}/retry`)
  }

  async retryAllJobs(): Promise<number> {
    const { count } = await this.http.request('POST', '/api/v1/admin/queue/retry', {
      decode: QueueRetryResult,
    })
    return count
  }

  discardJob(id: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/admin/queue/${id}`)
  }

  /** Applications allowed to act on someone's behalf. */
  async clients(): Promise<AdminClient[]> {
    const { items } = await this.http.request('GET', '/api/v1/admin/clients', {
      decode: AdminClientList,
    })
    return items
  }

  /** Removes an application. Its tokens go with it. */
  revokeClient(clientId: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/admin/clients/${clientId}`)
  }

  async sessions(): Promise<AdminSession[]> {
    const { items } = await this.http.request('GET', '/api/v1/admin/sessions', {
      decode: AdminSessionList,
    })
    return items
  }

  /** Ends a session. Refuses the one making the request. */
  revokeSession(id: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/admin/sessions/${id}`)
  }

  /** Where the bytes are, per variant and per account. */
  storage(): Promise<StorageReport> {
    return this.http.request('GET', '/api/v1/admin/storage', { decode: StorageReport })
  }

  settings(): Promise<ServerSettings> {
    return this.http.request('GET', '/api/v1/admin/settings', { decode: ServerSettings })
  }

  /** Takes effect at once. The stored value wins over the environment. */
  updateSettings(patch: ServerSettingsUpdate): Promise<ServerSettings> {
    return this.http.request('PATCH', '/api/v1/admin/settings', {
      body: patch,
      decode: ServerSettings,
    })
  }

  /** Every link that is public right now, across all accounts. */
  async shares(): Promise<AdminShareLink[]> {
    const { items } = await this.http.request('GET', '/api/v1/admin/shares', {
      decode: AdminShareLinkList,
    })
    return items
  }

  /** Closes a link, whoever made it. */
  revokeShare(id: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/admin/shares/${id}`)
  }
}
