import type {
  AuthConfig,
  LoginRequest,
  PasswordChangeRequest,
  ProfileUpdate,
  SignupRequest,
  User,
} from '@imogen/shared'
import type { HttpClient } from './http.ts'

export class Auth {
  constructor(private readonly http: HttpClient) {}

  /** What the sign-in screen needs before anyone has authenticated. */
  config(): Promise<AuthConfig> {
    return this.http.request<AuthConfig>('GET', '/api/v1/auth/config')
  }

  login(request: LoginRequest): Promise<User> {
    return this.http.request<User>('POST', '/api/v1/auth/login', { body: request })
  }

  signup(request: SignupRequest): Promise<User> {
    return this.http.request<User>('POST', '/api/v1/auth/signup', { body: request })
  }

  logout(): Promise<void> {
    return this.http.request<void>('POST', '/api/v1/auth/logout')
  }

  logoutEverywhere(): Promise<void> {
    return this.http.request<void>('POST', '/api/v1/auth/logout-everywhere')
  }

  me(): Promise<User> {
    return this.http.request<User>('GET', '/api/v1/auth/me')
  }

  /** Edits your own name or email. Not available to provider-managed accounts. */
  updateProfile(patch: ProfileUpdate): Promise<User> {
    return this.http.request<User>('PATCH', '/api/v1/auth/me', { body: patch })
  }

  changePassword(request: PasswordChangeRequest): Promise<void> {
    return this.http.request<void>('POST', '/api/v1/auth/password', { body: request })
  }

  /** Where to send a browser to begin single sign-on. */
  oidcStartUrl(returnTo = '/'): string {
    return this.http.url('/api/v1/auth/oidc/start', { returnTo })
  }
}
