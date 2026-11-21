import 'server-only';

import { betterAuth } from 'better-auth';
import { PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { sendBetterAuthEmail } from './email';

function createBetterAuthInstance(
  baseURL: string,
  secret: string,
  databaseUrl: string,
) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
  });

  return betterAuth({
    baseURL,
    secret,
    trustedOrigins: [baseURL],
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

  if (!secret || !baseURL || !databaseUrl) {
    const missingVariables = [
      !secret && 'BETTER_AUTH_SECRET',
      !baseURL && 'BETTER_AUTH_URL',
      !databaseUrl && 'BETTER_AUTH_DATABASE_URL',
    ].filter((name): name is string => Boolean(name));
    throw new Error(
      `Better Auth is enabled but is missing environment variables: ${missingVariables.join(', ')}`,
    );
  }

  authInstance = createBetterAuthInstance(baseURL, secret, databaseUrl);
  return authInstance;
}
