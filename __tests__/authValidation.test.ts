import {
  getPasswordRequirements,
  getPasswordStrength,
  isStrongPassword,
  normalizeEmail,
  normalizeUsername,
  validateUsername,
} from '../src/lib/auth/validation';

describe('authentication input validation', () => {
  it('normalizes email and usernames consistently', () => {
    expect(normalizeEmail('  Player@Example.COM  ')).toBe('player@example.com');
    expect(normalizeUsername('  Chess_User  ')).toBe('chess_user');
  });

  it('accepts only valid usernames and rejects reserved or offensive names', () => {
    expect(validateUsername('chess_player')).toBeNull();
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('name with spaces')).not.toBeNull();
    expect(validateUsername('admin')).not.toBeNull();
    expect(validateUsername(['sh', 'it'].join(''))).not.toBeNull();
  });

  it('requires all five strong-password conditions', () => {
    expect(getPasswordRequirements('')).toHaveLength(5);
    expect(isStrongPassword('short')).toBe(false);
    expect(isStrongPassword('StrongPass123!')).toBe(true);
    expect(getPasswordStrength('abc')).toEqual({ label: 'Weak', score: 1 });
    expect(getPasswordStrength('Abcdefghijk1')).toEqual({ label: 'Good', score: 4 });
    expect(getPasswordStrength('Abcdefghijk1!')).toEqual({ label: 'Strong', score: 5 });
  });
});
