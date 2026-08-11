export type Actor = { id: number; roles: readonly string[] };

export class AuthorizationError extends Error {
  constructor() {
    super('You are not authorized to perform this action.');
    this.name = 'AuthorizationError';
  }
}

export function requireOwnerOrAdmin(actor: Actor, ownerUserId: number): void {
  if (actor.id !== ownerUserId && !isAdministrator(actor)) throw new AuthorizationError();
}

export function requireAdministrator(actor: Actor): void {
  if (!isAdministrator(actor)) throw new AuthorizationError();
}

export function requireSuperAdmin(actor: Actor): void {
  if (!actor.roles.includes('super_admin')) throw new AuthorizationError();
}

export function isAdministrator(actor: Actor): boolean {
  return actor.roles.includes('administrator') || actor.roles.includes('super_admin');
}
