export interface AppConfig {
  nodeEnv: string;
  port: number;
  adminApiKey: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  dataEncryptionKey: string;
  documentStorageDir: string;
  maxDocumentBytes: number;
  verificationProviderMode: string;
  webhookMaxAttempts: number;
  webhookTimeoutMs: number;
}

export const configuration = (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  adminApiKey: process.env.ADMIN_API_KEY ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'local_dev_jwt_secret',
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 3600),
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY ?? '0'.repeat(64),
  documentStorageDir: process.env.DOCUMENT_STORAGE_DIR ?? './storage/documents',
  maxDocumentBytes: Number(process.env.MAX_DOCUMENT_BYTES ?? 10 * 1024 * 1024),
  verificationProviderMode: process.env.VERIFICATION_PROVIDER_MODE ?? 'mock',
  webhookMaxAttempts: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 5),
  webhookTimeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS ?? 5000),
});
