import type { Order } from '../data/orders.js';

export interface User {
  id: string;
  name: string;
  active: boolean;
}

export interface Line {
  id: string;
  name: string;
  tier: string;
}

export function listUsers(): User[] {
  return [
    { id: 'u1', name: 'Ada', active: true },
    { id: 'u2', name: 'Lin', active: false },
  ];
}

export function reconcile(orders: Order[], users: User[]): Line[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const out: Line[] = [];
  for (const order of orders) {
    const user = byId.get(order.userId);
    if (user) out.push({ id: order.id, name: user.name, tier: order.total > 100 ? 'gold' : 'bronze' });
  }
  return out;
}
