import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { parseFaults } from './faults.ts';

const port = Number(process.env.PORT ?? 4173);
const faults = parseFaults(process.env.FAULTS);
const testHooks = process.env.TEST_HOOKS === '1';

createApp({ db: openDb(), faults, testHooks }).listen(port, '127.0.0.1', () => {
  const extras = [faults.size ? `faults: ${[...faults].join(', ')}` : '', testHooks ? 'test hooks on' : '']
    .filter(Boolean)
    .join('; ');
  console.log(`order desk on http://127.0.0.1:${port}${extras ? ` (${extras})` : ''}`);
});
