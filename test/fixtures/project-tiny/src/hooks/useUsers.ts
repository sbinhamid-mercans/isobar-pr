import { listUsers, type User } from '../services/users.js';

export function useUsers(): User[] {
  return listUsers();
}
