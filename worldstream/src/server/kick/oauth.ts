// OAuth 2.1 with PKCE against id.kick.com. Tokens live in state/kick-tokens.json.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface KickTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  /** Epoch ms. */
  expires_at: number;
}

export interface KickAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenFile: string;
  idBase?: string;
}

export const KICK_SCOPES = ['user:read', 'chat:write', 'events:subscribe'];

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export class KickAuth {
  private tokens: KickTokens | null = null;
  private readonly idBase: string;

  constructor(private readonly cfg: KickAuthConfig) {
    this.idBase = cfg.idBase ?? 'https://id.kick.com';
    if (existsSync(cfg.tokenFile)) {
      try {
        this.tokens = JSON.parse(readFileSync(cfg.tokenFile, 'utf8')) as KickTokens;
      } catch {
        this.tokens = null;
      }
    }
  }

  get configured(): boolean {
    return Boolean(this.cfg.clientId && this.cfg.clientSecret);
  }

  get connected(): boolean {
    return this.tokens !== null;
  }

  get expiresAt(): number | null {
    return this.tokens?.expires_at ?? null;
  }

  loginUrl(state: string, challenge: string, scopes = KICK_SCOPES): string {
    const u = new URL('/oauth/authorize', this.idBase);
    u.searchParams.set('client_id', this.cfg.clientId);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', this.cfg.redirectUri);
    u.searchParams.set('scope', scopes.join(' '));
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  async exchange(code: string, verifier: string): Promise<KickTokens> {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri, code_verifier: verifier });
  }

  async refresh(): Promise<KickTokens> {
    if (!this.tokens) throw new Error('not connected');
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token });
  }

  /** A valid access token, refreshed when within a minute of expiry; null when not connected. */
  async accessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (Date.now() > this.tokens.expires_at - 60_000) await this.refresh();
    return this.tokens?.access_token ?? null;
  }

  forget(): void {
    this.tokens = null;
    if (existsSync(this.cfg.tokenFile)) writeFileSync(this.cfg.tokenFile, '{}');
  }

  private async tokenRequest(fields: Record<string, string>): Promise<KickTokens> {
    const body = new URLSearchParams({ ...fields, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret });
    const res = await fetch(`${this.idBase}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
    this.tokens = {
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? this.tokens?.refresh_token ?? '',
      scope: json.scope ?? this.tokens?.scope ?? '',
      expires_at: Date.now() + json.expires_in * 1000,
    };
    writeFileSync(this.cfg.tokenFile, JSON.stringify(this.tokens, null, 2));
    return this.tokens;
  }
}
