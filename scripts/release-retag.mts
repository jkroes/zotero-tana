import { execSync } from 'node:child_process';

import pkg from '../package.json' with { type: 'json' };

// Amend the current commit (folding in anything staged) and move the version
// tag + the rolling `release` tag onto it, then force-push all three. Keeps the
// repo at a single release commit. Stage your changes first; this does NOT run
// tests — CI verifies on push.

const versionTag = `v${pkg.version}`;
const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

function run(command: string): void {
  console.log(`$ ${command}`);
  execSync(command, { stdio: 'inherit' });
}

run('git commit --amend --no-edit');
run(`git tag -f ${versionTag}`);
run('git tag -f release');
run(`git push --force origin ${branch} ${versionTag} release`);

console.log(
  `\nDone. ${branch}, ${versionTag}, and release all point at the amended commit.`,
);
