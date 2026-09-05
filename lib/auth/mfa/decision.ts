import type { MfaDecision, MfaRole, TotpRequirement } from './types';

export function roleRequiresTotp(requirement: TotpRequirement, role: MfaRole): boolean {
  if (requirement === 'all-users') return true;
  if (requirement === 'super-admin-only') return role === 'super-admin';
  return role === 'admin' || role === 'super-admin' || role === 'organization-leader';
}

export function decideMfa(input: {
  requirement: TotpRequirement;
  role: MfaRole;
  hasActiveTotp: boolean;
  rememberedDeviceValid: boolean;
  rememberTotpDevice: boolean;
}): MfaDecision {
  if (!roleRequiresTotp(input.requirement, input.role)) return 'not-required';
  if (!input.hasActiveTotp) return 'enrollment-required';
  if (input.rememberTotpDevice && input.rememberedDeviceValid) {
    return 'remembered-device-satisfied';
  }
  return 'challenge-required';
}

export function sensitiveActionRequiresFreshStepUp(input: {
  configuredFactor: 'none' | 'policy-factor' | 'totp';
  hasFreshPolicyFactor: boolean;
  hasFreshTotp: boolean;
}): boolean {
  if (input.configuredFactor === 'none') return false;
  if (input.configuredFactor === 'totp') return !input.hasFreshTotp;
  return !input.hasFreshPolicyFactor;
}
