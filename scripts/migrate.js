const fs = require('node:fs');
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');

const migrationSets = {
  default: [
    '../sql/schema.sql',
    '../sql/fix_friendships.sql',
  ],
  compatibility: [
    '../sql/fix_matchmaking_and_seed_puzzles.sql',
  ],
  friendPlay: [
    '../sql/fix_matchmaking_and_seed_puzzles.sql',
    '../sql/game_invitations.sql',
  ],
};

async function runMigrations(migrationSet = 'default') {
  loadEnvConfig(process.cwd());

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !connectionString.startsWith('postgres')) {
    throw new Error(
      'Set DATABASE_URL in .env.local to the Supabase Postgres connection string (Project Settings > Database > Connection string).'
    );
  }

  const migrationFiles = migrationSets[migrationSet];
  if (!migrationFiles) {
    throw new Error(`Unknown migration set: ${migrationSet}`);
  }
  const migrations = migrationFiles.map(filePath =>
    fs.readFileSync(path.join(__dirname, filePath), 'utf8')
  );
  const client = new Client({ connectionString });

  await client.connect();
  try {
    await client.query('BEGIN');
    for (const migration of migrations) {
      await client.query(migration);
    }
    await client.query('COMMIT');
    console.log(`ChessArena ${migrationSet} database migrations applied successfully.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations(process.argv[2] || 'default').catch(error => {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { runMigrations };
