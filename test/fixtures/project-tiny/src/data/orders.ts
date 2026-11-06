export interface Order {
  id: string;
  userId: string;
  total: number;
  currency: string;
  items: number;
}

export const orders: Order[] = [
  { id: 'o1', userId: 'u1', total: 120, currency: 'EUR', items: 4 },
  { id: 'o2', userId: 'u2', total: 15, currency: 'USD', items: 1 },
];
