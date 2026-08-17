import { SetMetadata } from '@nestjs/common';
import { Scope } from './auth.types';

export const SCOPES_METADATA_KEY = 'required_scopes';

export const RequireScopes = (...scopes: Scope[]) => SetMetadata(SCOPES_METADATA_KEY, scopes);
