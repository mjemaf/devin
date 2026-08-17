import { SetMetadata } from '@nestjs/common';

export const PUBLIC_METADATA_KEY = 'is_public_route';

export const Public = () => SetMetadata(PUBLIC_METADATA_KEY, true);
