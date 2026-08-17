export type Role = 'admin' | 'operator' | 'viewer';

export type Scope =
  | 'merchants:read'
  | 'merchants:write'
  | 'verification:write'
  | 'risk:read'
  | 'risk:write'
  | 'underwriting:write'
  | 'webhooks:write';

export const ALL_SCOPES: Scope[] = [
  'merchants:read',
  'merchants:write',
  'verification:write',
  'risk:read',
  'risk:write',
  'underwriting:write',
  'webhooks:write',
];

export const SCOPES_BY_ROLE: Record<Role, Scope[]> = {
  admin: ALL_SCOPES,
  operator: ALL_SCOPES.filter((scope) => scope !== 'webhooks:write'),
  viewer: ['merchants:read', 'risk:read'],
};

export interface AuthContext {
  partnerId: string;
  partnerPublicId: string;
  apiKeyId: string;
  role: Role;
  scopes: Scope[];
  /** Present when the caller authenticated with a merchant-scoped onboarding token. */
  merchantPublicId?: string;
}
