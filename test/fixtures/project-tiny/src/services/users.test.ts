import { listUsers, reconcile } from './users.js';

export function check(): boolean {
  return reconcile([{ id: 'o', userId: 'u1', total: 1, currency: 'EUR', items: 1 }], listUsers()).length === 1;
}
