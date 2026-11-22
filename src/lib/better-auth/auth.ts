import 'server-only';

import { dash } from '@better-auth/infra';
import { betterAuth } from 'better-auth';
import { PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { sendBetterAuthEmail } from './email';

function createBetterAuthInstance(
  baseURL: string,
  secret: string,
  databaseUrl: string,
  databaseCaCert: string,
) {
  const connectionUrl = new URL(databaseUrl);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].forEach((parameter) => {
    connectionUrl.searchParams.delete(parameter);
  });

  const pool = new Pool({
    connectionString: connectionUrl.toString(),
    max: 1,
    ssl: { ca: databaseCaCert, rejectUnauthorized: true },
  });

  return betterAuth({
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    plugins: [dash({ apiKey: process.env.BETTER_AUTH_API_KEY })],
    database: {
      dialect: new PostgresDialect({ pool }),
      type: 'postgres',
      schemaName: 'better_auth',
    },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await sendBetterAuthEmail(
          user.email,
          'Reset your Chess Arena password',
          'Use this link to reset your password:',
          url,
        );
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendBetterAuthEmail(
          user.email,
          'Verify your Chess Arena email',
          'Use this link to verify your email:',
          url,
        );
      },
    },
  });
}

type BetterAuthInstance = ReturnType<typeof createBetterAuthInstance>;
let authInstance: BetterAuthInstance | undefined;

export function getBetterAuth(): BetterAuthInstance {
  if (authInstance) return authInstance;

  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  const databaseUrl = process.env.BETTER_AUTH_DATABASE_URL;
  const databaseCaCert = process.env.BETTER_AUTH_DATABASE_CA_CERT;

  if (!secret || !baseURL || !databaseUrl || !databaseCaCert) {
    const missingVariables = [
      !secret && 'BETTER_AUTH_SECRET',
      !baseURL && 'BETTER_AUTH_URL',
      !databaseUrl && 'BETTER_AUTH_DATABASE_URL',
      !databaseCaCert && 'BETTER_AUTH_DATABASE_CA_CERT',
    ].filter((name): name is string => Boolean(name));
    throw new Error(
      `Better Auth is enabled but is missing environment variables: ${missingVariables.join(', ')}`,
    );
  }

  authInstance = createBetterAuthInstance(
    baseURL,
    secret,
    databaseUrl,
    databaseCaCert,
  );
  return authInstance;
}
