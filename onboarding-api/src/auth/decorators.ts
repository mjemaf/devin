import { SetMetadata } from '@nestjs/common';
import { Scope } from './auth-context';

export const PUBLIC_ROUTE = 'auth:public';
export const REQUIRED_SCOPES = 'auth:scopes';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export const RequireScopes = (...scopes: Scope[]) => SetMetadata(REQUIRED_SCOPES, scopes);
