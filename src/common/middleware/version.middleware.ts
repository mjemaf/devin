import { Injectable, NestMiddleware, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Supported API versions
 */
const SUPPORTED_VERSIONS = ['2024-01-01', '2024-06-01', '2025-01-01'];

/**
 * Deprecated versions with their sunset dates
 */
const DEPRECATED_VERSIONS: Record<string, string> = {
  '2024-01-01': '2025-01-01',
};

/**
 * Version Middleware
 * 
 * Validates the Acquiring-Version header and adds deprecation warnings
 */
@Injectable()
export class VersionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const versionHeader = req.headers['acquiring-version'] as string;

    // Version header is optional for now - use latest if not provided
    if (!versionHeader) {
      req.apiVersion = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];
      return next();
    }

    // Validate version format (YYYY-MM-DD)
    const versionRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!versionRegex.test(versionHeader)) {
      throw new BadRequestException({
        type: 'https://api.example.com/errors/invalid-version-format',
        title: 'Invalid Version Format',
        status: HttpStatus.BAD_REQUEST,
        code: 'invalid_version_format',
        detail: 'Version header must be in YYYY-MM-DD format',
        instance: req.url,
        request_id: req.id,
        retryable: false,
      });
    }

    // Check if version is supported
    if (!SUPPORTED_VERSIONS.includes(versionHeader)) {
      throw new HttpException({
        type: 'https://api.example.com/errors/unsupported-version',
        title: 'Unsupported API Version',
        status: HttpStatus.BAD_REQUEST,
        code: 'unsupported_version',
        detail: `API version ${versionHeader} is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(', ')}`,
        instance: req.url,
        request_id: req.id,
        retryable: false,
      }, HttpStatus.BAD_REQUEST);
    }

    // Check if version is deprecated
    if (DEPRECATED_VERSIONS[versionHeader]) {
      const sunsetDate = DEPRECATED_VERSIONS[versionHeader];
      const daysUntilSunset = Math.ceil((new Date(sunsetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', sunsetDate);
      res.setHeader('Link', `<https://api.example.com/docs/versioning>; rel="deprecation"; type="text/html"`);

      if (daysUntilSunset <= 30) {
        res.setHeader('Warning', `299 - "API version ${versionHeader} will be sunset on ${sunsetDate}"`);
      }
    }

    req.apiVersion = versionHeader;
    next();
  }
}

/**
 * Extend Express Request type
 */
declare global {
  namespace Express {
    interface Request {
      apiVersion?: string;
    }
  }
}
