import { z } from 'zod'

export const UserRole = z.enum(['admin', 'user'])
export type UserRole = z.infer<typeof UserRole>

export const User = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: UserRole,
  avatarUrl: z.url().nullable(),
  /** Present when the account is linked to an external identity provider. */
  oidcSubject: z.string().nullable(),
  /** False for OIDC-only accounts, which have no local password. */
  hasPassword: z.boolean(),
  createdAt: z.iso.datetime(),
  quotaBytes: z.number().int().positive().nullable(),
  usedBytes: z.number().int().nonnegative(),
})
export type User = z.infer<typeof User>

export const LoginRequest = z.object({
  email: z.email(),
  password: z.string().min(1).max(1024),
})
export type LoginRequest = z.infer<typeof LoginRequest>

export const SignupRequest = z.object({
  email: z.email(),
  password: z.string().min(10, 'Use at least 10 characters').max(1024),
  name: z.string().min(1).max(128),
})
export type SignupRequest = z.infer<typeof SignupRequest>

export const PasswordChangeRequest = z.object({
  currentPassword: z.string().max(1024).optional(),
  newPassword: z.string().min(10).max(1024),
})
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequest>

/** What the login page needs in order to render before anyone has authenticated. */
export const AuthConfig = z.object({
  allowSignup: z.boolean(),
  /** True until the first account exists; the first signup becomes the admin. */
  needsSetup: z.boolean(),
  oidc: z
    .object({
      enabled: z.literal(true),
      label: z.string(),
      startUrl: z.string(),
      /** Where to send someone to edit the details the provider owns, if known. */
      accountUrl: z.url().nullable(),
    })
    .or(z.object({ enabled: z.literal(false) })),
})
export type AuthConfig = z.infer<typeof AuthConfig>

// --- OAuth 2.1 authorization server ---

export const OAuthScope = z.enum([
  'library:read',
  'library:write',
  'albums:read',
  'albums:write',
  'profile',
])
export type OAuthScope = z.infer<typeof OAuthScope>

export const ALL_SCOPES = OAuthScope.options

export const SCOPE_DESCRIPTIONS: Record<OAuthScope, string> = {
  'library:read': 'View your photos and videos',
  'library:write': 'Upload, edit, and delete photos and videos',
  'albums:read': 'View your albums',
  'albums:write': 'Create and modify your albums',
  profile: 'Read your name and email address',
}

/** RFC 7591 dynamic client registration request. */
export const ClientRegistrationRequest = z.object({
  client_name: z.string().min(1).max(256).optional(),
  redirect_uris: z.array(z.url()).min(1).max(16),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_post', 'client_secret_basic'])
    .optional(),
  client_uri: z.url().optional(),
  logo_uri: z.url().optional(),
})
export type ClientRegistrationRequest = z.infer<typeof ClientRegistrationRequest>

export const ClientRegistrationResponse = z.object({
  client_id: z.string(),
  client_secret: z.string().optional(),
  client_id_issued_at: z.number().int(),
  client_secret_expires_at: z.number().int(),
  client_name: z.string().optional(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()),
  response_types: z.array(z.string()),
  token_endpoint_auth_method: z.string(),
  scope: z.string(),
})
export type ClientRegistrationResponse = z.infer<typeof ClientRegistrationResponse>

export const TokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().optional(),
  scope: z.string(),
})
export type TokenResponse = z.infer<typeof TokenResponse>

/**
 * Editing your own profile. Accounts linked to an identity provider cannot change these
 * here — the provider owns them, and imogen re-reads them at every sign-in.
 */
export const ProfileUpdate = z.object({
  name: z.string().min(1).max(128).optional(),
  email: z.email().optional(),
  /** Required to change the email address on an account that has a password. */
  currentPassword: z.string().max(1024).optional(),
})
export type ProfileUpdate = z.infer<typeof ProfileUpdate>
