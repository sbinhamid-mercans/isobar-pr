import type { Line } from '../services/users.js';

export function formatLine(line: Line): string {
  return `${line.id}: ${line.name} (${line.tier})`;
}
