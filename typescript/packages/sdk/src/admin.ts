import type {
  AdminUser,
  AdminUserUpdate,
  Invite,
  InviteCreate,
  InviteCreated,
} from '@imogen/shared'
import type { HttpClient } from './http.ts'

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
    const { items } = await this.http.request<{ items: AdminUser[] }>('GET', '/api/v1/admin/users')
    return items
  }

  /** Changes a role, or suspends and restores access. */
  updateUser(userId: string, patch: AdminUserUpdate): Promise<AdminUser> {
    return this.http.request<AdminUser>('PATCH', `/api/v1/admin/users/${userId}`, { body: patch })
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
    const { items } = await this.http.request<{ items: Invite[] }>('GET', '/api/v1/admin/invites')
    return items
  }

  /** The returned token is the only legible copy. It is stored hashed. */
  createInvite(input: Partial<InviteCreate> = {}): Promise<InviteCreated> {
    return this.http.request<InviteCreated>('POST', '/api/v1/admin/invites', {
      body: { role: 'user', expiresInDays: 7, ...input },
    })
  }

  revokeInvite(id: string): Promise<void> {
    return this.http.request<void>('DELETE', `/api/v1/admin/invites/${id}`)
  }
}
