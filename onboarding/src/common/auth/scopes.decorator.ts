import { SetMetadata } from '@nestjs/common';
import { Scope } from './principal';

export const SCOPES_METADATA = 'onboarding:scopes';
export const PUBLIC_METADATA = 'onboarding:public';

export const RequireScopes = (...scopes: Scope[]) => SetMetadata(SCOPES_METADATA, scopes);

/** Marks a route as reachable without partner credentials (health, docs). */
export const Public = () => SetMetadata(PUBLIC_METADATA, true);
