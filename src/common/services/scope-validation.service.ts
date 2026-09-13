import { Injectable, ForbiddenException } from '@nestjs/common';

/**
 * Scope Validation Service
 * 
 * Manages 42 granular scopes with broken-out sensitive operations
 * Implements scope validation, narrowing, and inheritance rules
 */
@Injectable()
export class ScopeValidationService {
  // Define all 42 granular scopes
  private readonly SCOPES = {
    // Onboarding scopes
    'onboarding:read': 'Read onboarding data',
    'onboarding:write': 'Create and modify onboarding data',
    'onboarding:migrate': 'Bypass prefill validation for portfolio migration',
    
    // Merchant scopes
    'merchants:read': 'Read merchant information',
    'merchants:write': 'Create and modify merchant data',
    'merchants:activate': 'Activate merchant accounts',
    'merchants:suspend': 'Suspend merchant accounts',
    'merchants:close': 'Close merchant accounts',
    
    // Verification scopes
    'verification:read': 'Read verification results',
    'verification:write': 'Trigger verifications',
    'verification:raw': 'Access raw provider payloads (licensed data)',
    'verification:adjudicate': 'Override screening outcomes',
    
    // Risk scopes
    'risk:read': 'Read risk assessments',
    'risk:write': 'Create risk assessments',
    'risk:override': 'Change limits and tiers',
    'risk:trace': 'Access rule traces and policy logic',
    
    // Underwriting scopes
    'underwriting:read': 'Read underwriting decisions',
    'underwriting:write': 'Create underwriting decisions',
    'underwriting:override': 'Reverse automated decisions',
    'underwriting:trace': 'Access rule traces',
    
    // Banking scopes
    'banking:read': 'Read bank account information',
    'banking:write': 'Create and modify bank accounts',
    'banking:verify': 'Trigger bank account verification',
    
    // PII scopes
    'pii:read': 'Read unmasked personal identifiers',
    'pii:write': 'Modify personal information',
    
    // Organizations scopes
    'organizations:read': 'Read organization data',
    'organizations:write': 'Create and modify organizations',
    'organizations:program': 'Configure program settings',
    
    // Webhooks scopes
    'webhooks:read': 'Read webhook configurations',
    'webhooks:write': 'Create and modify webhooks',
    'webhooks:redeliver': 'Trigger webhook redelivery',
    
    // Audit scopes
    'audit:read': 'Read audit logs',
    'audit:export': 'Export audit trail data',
    
    // Configuration scopes
    'config:read': 'Read configuration',
    'config:write': 'Modify configuration',
    
    // Documents scopes
    'documents:read': 'Read document metadata',
    'documents:write': 'Upload and modify documents',
    
    // Products scopes
    'products:read': 'Read product information',
    'products:write': 'Configure product enablements',
    
    // Pricing scopes
    'pricing:read': 'Read pricing information',
    'pricing:write': 'Configure pricing',
    
    // Payouts scopes
    'payouts:read': 'Read payout information',
    'payouts:write': 'Configure payouts',
    
    // Cases scopes
    'cases:read': 'Read case information',
    'cases:write': 'Create and modify cases',
    'cases:resolve': 'Resolve cases',
    
    // Reports scopes
    'reports:read': 'Read reports',
    'reports:export': 'Export report data',
    
    // Admin scopes
    'admin:read': 'Read administrative data',
    'admin:write': 'Modify administrative settings',
    
    // Partner scopes
    'partner:read': 'Read partner information',
    'partner:write': 'Modify partner settings',
  };

  // Scope hierarchy for inheritance
  private readonly SCOPE_HIERARCHY = {
    'onboarding:write': ['onboarding:read'],
    'merchants:write': ['merchants:read'],
    'verification:write': ['verification:read'],
    'risk:write': ['risk:read'],
    'underwriting:write': ['underwriting:read'],
    'banking:write': ['banking:read'],
    'pii:write': ['pii:read'],
    'organizations:write': ['organizations:read'],
    'webhooks:write': ['webhooks:read'],
    'config:write': ['config:read'],
    'documents:write': ['documents:read'],
    'products:write': ['products:read'],
    'pricing:write': ['pricing:read'],
    'payouts:write': ['payouts:read'],
    'cases:write': ['cases:read'],
    'reports:export': ['reports:read'],
    'admin:write': ['admin:read'],
    'partner:write': ['partner:read'],
  };

  // Sensitive scopes that require special handling
  private readonly SENSITIVE_SCOPES = [
    'pii:read',
    'verification:raw',
    'verification:adjudicate',
    'underwriting:override',
    'risk:override',
    'underwriting:trace',
    'risk:trace',
    'organizations:program',
    'onboarding:migrate',
    'audit:export',
  ];

  /**
   * Validate if a credential has the required scope
   */
  hasScope(tokenScopes: string[], requiredScope: string): boolean {
    // Direct scope match
    if (tokenScopes.includes(requiredScope)) {
      return true;
    }

    // Check inherited scopes
    const inheritedScopes = this.getImplicitScopes(tokenScopes);
    return inheritedScopes.includes(requiredScope);
  }

  /**
   * Validate multiple required scopes (all must be present)
   */
  hasAllScopes(tokenScopes: string[], requiredScopes: string[]): boolean {
    return requiredScopes.every(scope => this.hasScope(tokenScopes, scope));
  }

  /**
   * Validate multiple required scopes (at least one must be present)
   */
  hasAnyScope(tokenScopes: string[], requiredScopes: string[]): boolean {
    return requiredScopes.some(scope => this.hasScope(tokenScopes, scope));
  }

  /**
   * Get all implicit scopes through inheritance
   */
  getImplicitScopes(tokenScopes: string[]): string[] {
    const implicitScopes = [...tokenScopes];

    for (const scope of tokenScopes) {
      const inherited = this.SCOPE_HIERARCHY[scope] || [];
      implicitScopes.push(...inherited);
    }

    return [...new Set(implicitScopes)]; // Remove duplicates
  }

  /**
   * Check if a scope is sensitive
   */
  isSensitiveScope(scope: string): boolean {
    return this.SENSITIVE_SCOPES.includes(scope);
  }

  /**
   * Validate scope narrowing (prevent scope widening)
   */
  canNarrowScopes(originalScopes: string[], newScopes: string[]): boolean {
    const originalImplicit = this.getImplicitScopes(originalScopes);
    const newImplicit = this.getImplicitScopes(newScopes);

    // Check if new scopes are a subset of original scopes
    return newImplicit.every(scope => originalImplicit.includes(scope));
  }

  /**
   * Enforce segregation of duties
   */
  validateSegregationOfDuties(tokenScopes: string[], action: string): void {
    // Two-eyes principle for sensitive operations
    const requiresTwoEyes = [
      'verification:adjudicate',
      'underwriting:override',
    ];

    if (requiresTwoEyes.includes(action)) {
      // This would check if there's a second approver
      // For now, we'll implement basic validation
      if (!this.hasScope(tokenScopes, action)) {
        throw new ForbiddenException('Insufficient scope for this action');
      }
    }

    // Cannot approve delegated decisions outside envelope
    if (action === 'underwriting:override' && this.hasScope(tokenScopes, 'organizations:program')) {
      throw new ForbiddenException('Cannot override decisions for delegated organizations');
    }
  }

  /**
   * Get all available scopes
   */
  getAllScopes(): Record<string, string> {
    return { ...this.SCOPES };
  }

  /**
   * Validate scope format
   */
  isValidScope(scope: string): boolean {
    return scope in this.SCOPES;
  }

  /**
   * Validate multiple scopes
   */
  validateScopes(scopes: string[]): void {
    for (const scope of scopes) {
      if (!this.isValidScope(scope)) {
        throw new ForbiddenException(`Invalid scope: ${scope}`);
      }
    }
  }
}