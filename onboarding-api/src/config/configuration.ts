export interface AppConfig {
  port: number;
  nodeEnv: string;
  jwtSecret: string;
  documentStorageDir: string;
  webhookTimeoutMs: number;
  rateLimitPerMinute: number;
}

export const configuration = (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  documentStorageDir: process.env.DOCUMENT_STORAGE_DIR ?? './.storage',
  webhookTimeoutMs: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '5000', 10),
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? '1000', 10),
});
