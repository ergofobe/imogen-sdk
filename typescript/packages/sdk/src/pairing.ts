import type {
  PairingClaim,
  PairingClaimRequest,
  PairingStatus,
  PairingTicket,
} from '@imogen/shared'
import type { HttpClient } from './http.js'

/**
 * Handing a device an account without making anybody type a hostname.
 *
 * The two halves of this run in different places and are meant to. A browser that is
 * already signed in calls [create] and renders the ticket as a QR code; a phone that
 * knows nothing at all reads the code out of it and calls [claim]. Between them the
 * device learns where the server is and gets an authorization code for it, in one
 * gesture.
 *
 * What [claim] returns is an ordinary OAuth code bound to a PKCE challenge the device
 * generated, so a photographed QR is not on its own enough to reach a library.
 */
export class Pairing {
  constructor(private readonly http: HttpClient) {}

  /**
   * Makes a ticket. Needs a browser session — a bearer token is refused, because a
   * paired device that could mint tickets would be a device that could pair others.
   *
   * The `code` is legible only in this response.
   */
  create(): Promise<PairingTicket> {
    return this.http.request<PairingTicket>('POST', '/api/v1/pairing')
  }

  /** Whether a device has taken the ticket yet, and what it called itself. */
  status(ticketId: string): Promise<PairingStatus> {
    return this.http.request<PairingStatus>('GET', `/api/v1/pairing/${ticketId}`)
  }

  /**
   * Spends a ticket. Called by the device, with a client it has just registered through
   * RFC 7591 and a PKCE challenge it generated; exchange the code that comes back at the
   * token endpoint with the matching verifier.
   */
  claim(request: PairingClaimRequest): Promise<PairingClaim> {
    return this.http.request<PairingClaim>('POST', '/api/v1/pairing/claim', { body: request })
  }
}
