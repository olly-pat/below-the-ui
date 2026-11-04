// Bugs the server can bring back on request. Enabled with FAULTS=name,name.
export const FAULTS = {
  ghost_success: 'the API answers 201 and the UI shows a confirmation, but the order is never stored',
  double_submit: 'the idempotency key is ignored, so a retried request creates a second order',
  order_leak: 'any signed-in customer can open any order by its id',
  lost_event: 'the order is stored but its outbox event is not, so it never leaves pending',
  total_drift: 'the cart rounds the discount per line, the server per order, and the totals disagree',
} as const;

export type Fault = keyof typeof FAULTS;

// Faults that live in public/app.js.
export const CLIENT_FAULTS: readonly Fault[] = ['total_drift'];

export function parseFaults(raw: string | undefined): Set<Fault> {
  const names = (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) {
    if (!(name in FAULTS)) {
      throw new Error(`Unknown fault "${name}". Known faults: ${Object.keys(FAULTS).join(', ')}`);
    }
  }
  return new Set(names as Fault[]);
}
