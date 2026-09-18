#!/usr/bin/env node
/**
 * guard-data-only.mjs — run this in the automated pipeline right before committing.
 *
 * The pipeline commits data that came from third-party APIs, and the agent that
 * runs it has push access. If a fetcher (or anything reading that data) is ever
 * talked into touching source files, this aborts the commit: an automated run is
 * only ever allowed to change `public/data/*.json`.
 *
 * Usage:  node scripts/guard-data-only.mjs   # exit 0 = safe to commit
 */
import { execFileSync } from 'node:child_process';

const ALLOWED = /^public\/data\/[A-Za-z0-9._-]+\.json$/;

const changed = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean)
  // porcelain v1: 2 status chars + space + path (renames use "old -> new")
  .map((line) => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));

const offenders = changed.filter((f) => !ALLOWED.test(f));

if (offenders.length) {
  console.error('❌ pipeline tried to change files outside public/data/:');
  for (const f of offenders) console.error(`   ${f}`);
  console.error('   Refusing to commit. Review these by hand.');
  process.exit(1);
}

console.log(`✅ guard OK — ${changed.length} data file(s) changed, nothing else.`);
