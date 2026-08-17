export type ActorType = 'api_key' | 'user' | 'system';
export type PartnerRole = 'admin' | 'operator' | 'viewer';

export const SCOPES = [
  'merchants:read',
  'merchants:write',
  'verification:write',
  'risk:read',
  'risk:write',
  'underwriting:read',
  'underwriting:write',
  'webhooks:read',
  'webhooks:write',
  'analytics:read',
  'partners:admin',
] as const;

export type Scope = (typeof SCOPES)[number];

export interface Principal {
  partnerId: string;
  actorId: string;
  actorType: ActorType;
  role: PartnerRole;
  scopes: Scope[];
  livemode: boolean;
  /** Set for session tokens minted for a single merchant (embedded / white-label flows). */
  merchantReference?: string;
}

export const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
