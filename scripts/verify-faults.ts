// Runs the suite once per fault. Exits 1 if any fault leaves it green.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAULTS, type Fault } from '../server/faults.ts';

type Spec = { title: string; file: string; ok: boolean };
type Suite = { title: string; specs?: Spec[]; suites?: Suite[] };

const OUT_DIR = '.fault-runs';
mkdirSync(OUT_DIR, { recursive: true });

function failedSpecs(suite: Suite, path: string[] = []): string[] {
  const here = suite.title && !suite.title.endsWith('.ts') ? [...path, suite.title] : path;
  const own = (suite.specs ?? []).filter((spec) => !spec.ok).map((spec) => `${spec.file} > ${[...here, spec.title].join(' > ')}`);
  return [...own, ...(suite.suites ?? []).flatMap((child) => failedSpecs(child, here))];
}

function runWith(fault: Fault, port: number): string[] {
  const output = join(OUT_DIR, `${fault}.json`);
  const result = spawnSync('npx', ['playwright', 'test', '--reporter=json'], {
    env: { ...process.env, FAULTS: fault, PORT: String(port), PLAYWRIGHT_JSON_OUTPUT_NAME: output },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const report = JSON.parse(readFileSync(output, 'utf8')) as { suites: Suite[] };
  const failed = report.suites.flatMap((suite) => failedSpecs(suite));
  if (result.status === 0 && failed.length > 0) throw new Error(`${fault}: exit code 0 but ${failed.length} failures`);
  return failed;
}

let missed = 0;
let port = 4300;
for (const [fault, description] of Object.entries(FAULTS) as [Fault, string][]) {
  const failed = runWith(fault, port++);
  if (failed.length === 0) {
    missed++;
    console.log(`MISSED  ${fault}: ${description}`);
    continue;
  }
  console.log(`CAUGHT  ${fault}: ${description}`);
  for (const title of failed.slice(0, 2)) console.log(`        ${title}`);
  if (failed.length > 2) console.log(`        and ${failed.length - 2} more`);
}

console.log(missed === 0 ? '\nEvery fault was caught.' : `\n${missed} fault(s) went unnoticed.`);
process.exit(missed === 0 ? 0 : 1);
