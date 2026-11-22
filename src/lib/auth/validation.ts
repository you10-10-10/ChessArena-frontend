export const usernamePattern = /^[a-z0-9_]{3,20}$/;

const blockedUsernameTerms = [
  'admin',
  'administrator',
  'moderator',
  'support',
  'chessarena',
  'fuck',
  'shit',
  'bitch',
  'asshole',
];

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  const normalized = normalizeUsername(username);
  if (!usernamePattern.test(normalized)) {
    return 'Enter a username containing 3-20 letters, numbers, or underscores.';
  }

  if (blockedUsernameTerms.some((term) => normalized.includes(term))) {
    return 'Please choose a different username.';
  }

  return null;
}

export function getPasswordRequirements(password: string) {
  return [
    { label: 'At least 12 characters', valid: password.length >= 12 },
    { label: 'One uppercase letter', valid: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', valid: /[a-z]/.test(password) },
    { label: 'One number', valid: /\d/.test(password) },
    { label: 'One special character', valid: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function isStrongPassword(password: string) {
  return getPasswordRequirements(password).every((requirement) => requirement.valid);
}

export function getPasswordStrength(password: string) {
  const score = getPasswordRequirements(password).filter((requirement) => requirement.valid).length;
  if (score <= 2) return { label: 'Weak', score };
  if (score === 3) return { label: 'Fair', score };
  if (score === 4) return { label: 'Good', score };
  return { label: 'Strong', score };
}

export function getPublicSignUpError(error: Error) {
  const message = error.message.toLowerCase();

  if (/rate.?limit|too many requests/.test(message)) {
    return 'Signup is temporarily unavailable. Please wait a moment and try again.';
  }

  if (/username.*(taken|already|available)|duplicate key|unique constraint|profiles_username/.test(message)) {
    return 'That username is no longer available. Please choose another.';
  }

  if (/username/.test(message)) {
    return 'Enter a valid username.';
  }

  if (/already registered|already exists|email.*taken/.test(message)) {
    return 'If this email can be registered, you will receive instructions. Try signing in or resetting your password if you already have an account.';
  }

  return 'Unable to create your account. Check your details and try again.';
}

export function getPublicSignInError() {
  return 'Email or password is incorrect. Please try again.';
}
