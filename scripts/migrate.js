const fs = require('node:fs');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');

async function runMigrations() {
  loadEnvConfig(process.cwd());

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !connectionString.startsWith('postgres')) {
    throw new Error(
      'Set DATABASE_URL to the Supabase Postgres connection string (Project Settings > Database > Connection string).'
    );
  }

  const migrationPaths = [
    path.join(__dirname, '../sql/schema.sql'),
    path.join(__dirname, '../sql/fix_friendships.sql'),
  ];
  const migrations = migrationPaths.map(filePath => fs.readFileSync(filePath, 'utf8'));
  const client = new Client({ connectionString });

  await client.connect();
  try {
    await client.query('BEGIN');
    for (const migration of migrations) {
      await client.query(migration);
    }
    await client.query('COMMIT');
    console.log('ChessArena database schema and friendship RPCs applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations().catch(error => {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { runMigrations };
