import { Check, Circle } from 'lucide-react';
import { getPasswordRequirements, getPasswordStrength } from '@/lib/auth/validation';

export function PasswordRequirements({ password }: { password: string }) {
  const requirements = getPasswordRequirements(password);
  const strength = getPasswordStrength(password);
  const strengthColor = {
    Weak: 'bg-red-500',
    Fair: 'bg-amber-400',
    Good: 'bg-lime-400',
    Strong: 'bg-accent',
  }[strength.label];

  return (
    <div className="mt-3" aria-live="polite">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-text-secondary">Password strength</span>
        <span className="font-semibold text-text-primary">{password ? strength.label : '—'}</span>
      </div>
      <div className="mb-3 grid grid-cols-5 gap-1" aria-hidden="true">
        {requirements.map((requirement, index) => (
          <span
            key={requirement.label}
            className={`h-1 rounded-full transition-colors ${index < strength.score ? strengthColor : 'bg-text-secondary/15'}`}
          />
        ))}
      </div>
      <ul className="grid gap-x-3 gap-y-1.5 text-xs text-text-secondary sm:grid-cols-2">
        {requirements.map((requirement) => (
          <li key={requirement.label} className={`flex items-center gap-1.5 ${requirement.valid ? 'text-accent' : ''}`}>
            {requirement.valid
              ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              : <Circle aria-hidden="true" className="h-3 w-3 shrink-0" />}
            {requirement.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
