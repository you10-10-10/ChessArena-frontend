import { Client } from 'pg';
import { runMigrations } from '../scripts/migrate';

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({}),
    end: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('database migration runner', () => {
  const mockedClient = Client;
  let originalDatabaseUrl;

  beforeEach(() => {
    jest.clearAllMocks();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://test';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('applies friendship RPCs in the same transaction as the schema', async () => {
    await runMigrations();

    const client = mockedClient.mock.results[0].value;
    const queries = client.query.mock.calls.map(([query]) => query);

    expect(queries[0]).toBe('BEGIN');
    expect(queries[1]).toContain('CREATE TABLE IF NOT EXISTS friendships');
    expect(queries[2]).toContain('CREATE OR REPLACE FUNCTION public.send_friend_request');
    expect(queries[2]).toContain('CREATE OR REPLACE FUNCTION public.respond_friend_request');
    expect(queries[3]).toBe('COMMIT');
  });
});
