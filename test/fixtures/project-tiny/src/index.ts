import { listUsers, reconcile } from './services/users.js';
import { formatLine } from './utils/format.js';
import { orders } from './data/orders.js';

export function main(): string[] {
  return reconcile(orders, listUsers()).map(formatLine);
}
