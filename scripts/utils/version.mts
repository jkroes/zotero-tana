import os from 'node:os';
import path from 'node:path';

import fs from 'fs-extra';

import pkg from '../../package.json' with { type: 'json' };

import { genDir, relativeToRoot } from './paths.mts';

const versionJsonPath = path.join(genDir, 'version.json');

export async function getVersion(): Promise<string> {
  const versionJsonExists = await fs.pathExists(versionJsonPath);

  if (versionJsonExists) {
    const version = await fs.readJson(versionJsonPath);
    if (typeof version === 'string') {
      console.log(`Found ${relativeToRoot(versionJsonPath)} with ${version}`);
      return version;
    }
  }

  const version = computeVersion();
  console.log(`Writing ${relativeToRoot(versionJsonPath)} with ${version}`);
  await fs.outputJson(versionJsonPath, version);
  return version;
}

function computeVersion(): string {
  const { GITHUB_ACTIONS, GITHUB_JOB, GITHUB_RUN_NUMBER } = process.env;

  // Local builds carry a user/host suffix so they're never confused with a release.
  if (!GITHUB_ACTIONS) {
    return `${pkg.version}-${os.userInfo().username}.${os.hostname()}`;
  }

  // CI builds (build.yml) are dev artifacts; tag-triggered releases use the bare version.
  if (GITHUB_JOB === 'build') return `${pkg.version}-${GITHUB_RUN_NUMBER}`;

  return pkg.version;
}
