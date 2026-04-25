process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test/test';
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-secret-at-least-32-characters-long';
process.env.STORAGE_PROVIDER = process.env.STORAGE_PROVIDER ?? 'local';
process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER ?? 'console';
process.env.OCR_PROVIDER = process.env.OCR_PROVIDER ?? 'mock';
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER ?? 'mock';
process.env.DEMO_MODE = process.env.DEMO_MODE ?? 'true';
