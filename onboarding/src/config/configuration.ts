export interface AppConfig {
  port: number;
  nodeEnv: string;
  jwtSecret: string;
  onboardingTokenTtl: number;
  storageDriver: 'local';
  storageLocalDir: string;
  rateLimitPerMinute: number;
  seedPartnerApiKey: string;
}

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  onboardingTokenTtl: Number(process.env.ONBOARDING_TOKEN_TTL ?? 86400),
  storageDriver: 'local',
  storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? './storage',
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 1000),
  seedPartnerApiKey: process.env.SEED_PARTNER_API_KEY ?? 'sk_sandbox_devin_local',
});
