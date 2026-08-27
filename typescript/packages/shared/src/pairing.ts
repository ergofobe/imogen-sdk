import { z } from 'zod'

/**
 * Pairing a device.
 *
 * A native application that wants to reach an imogen server has a chicken-and-egg
 * problem the web interface does not: before it can show a sign-in screen it has to be
 * told which server to sign in to, and a self-hosted library is at whatever hostname its
 * owner chose. Typing that on a phone keyboard is the worst part of installing one of
 * these apps.
 *
 * So the browser, which is already signed in and already knows the address, hands both
 * facts over at once. It asks for a ticket, renders it as a QR code, and the device
 * reads the server URL and a one-time secret out of it in a single gesture.
 *
 * The secret is not a token. It buys exactly one thing: the right to have an
 * authorization code minted for a client the device registered a moment earlier, bound
 * to a PKCE challenge only that device holds the verifier for. A photographed QR code is
 * therefore not enough on its own, and what comes out the far end is an ordinary OAuth
 * grant that an administrator can see and revoke like any other.
 */

export const PAIRING_TTL_SECONDS = 300

/** The scheme a device registers so `imogen://pair?…` opens the app. */
export const PAIRING_URI_SCHEME = 'imogen'

export const PairingTicket = z.object({
  id: z.uuid(),
  /**
   * The one-time secret. Legible exactly once, here; the server keeps only a hash, so a
   * ticket cannot be recovered from a database that leaks.
   */
  code: z.string(),
  /** Where the device should talk to. Absolute, because the device has no context. */
  serverUrl: z.url(),
  /** Server and secret in one string, which is what actually goes into the QR code. */
  uri: z.string(),
  expiresAt: z.iso.datetime(),
})
export type PairingTicket = z.infer<typeof PairingTicket>

/** What the page showing the QR code polls for, so it can say "paired" and move on. */
export const PairingStatus = z.object({
  id: z.uuid(),
  expiresAt: z.iso.datetime(),
  claimedAt: z.iso.datetime().nullable(),
  /** What the device called itself. Null until something claims the ticket. */
  deviceName: z.string().nullable(),
})
export type PairingStatus = z.infer<typeof PairingStatus>

export const PairingClaimRequest = z.object({
  code: z.string().min(1).max(512),
  /** The client the device registered for itself through RFC 7591. */
  clientId: z.string().min(1).max(256),
  redirectUri: z.string().min(1).max(2048),
  codeChallenge: z.string().min(43).max(128),
  codeChallengeMethod: z.literal('S256'),
  /** Space-separated, as everywhere else in OAuth. Narrowed to what the server allows. */
  scope: z.string().max(512).optional(),
  /** Shown to the person who made the ticket, and in the connected-apps list. */
  deviceName: z.string().min(1).max(128).optional(),
})
export type PairingClaimRequest = z.infer<typeof PairingClaimRequest>

/**
 * An ordinary authorization code. The device exchanges it at the token endpoint with the
 * verifier it generated, so this response on its own grants nothing.
 */
export const PairingClaim = z.object({
  code: z.string(),
  redirectUri: z.string(),
  scope: z.string(),
})
export type PairingClaim = z.infer<typeof PairingClaim>
