import type { AdminUser } from '@imogen/shared'
import type { HttpClient } from './http.ts'

/**
 * Server administration.
 *
 * Every endpoint here answers 404 rather than 403 to anyone who is not an
 * administrator, so a rejection is indistinguishable from a route that does not
 * exist. Treat a `NotFoundError` from these methods as "you may not", not as a bug.
 */
export class Admin {
  constructor(private readonly http: HttpClient) {}

  /** Every account on the server, oldest first. */
  async users(): Promise<AdminUser[]> {
    const { items } = await this.http.request<{ items: AdminUser[] }>('GET', '/api/v1/admin/users')
    return items
  }
}
