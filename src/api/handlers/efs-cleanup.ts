// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

const EFS_MOUNT_PATH = process.env.EFS_MOUNT_PATH || '/workspace';
const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export interface CleanupResult {
  deleted: string[];
  retained: number;
  errors: string[];
}

export async function handler(): Promise<CleanupResult> {
  const now = Date.now();
  const deleted: string[] = [];
  const errors: string[] = [];
  let retained = 0;

  let entries: string[];
  try {
    entries = readdirSync(EFS_MOUNT_PATH);
  } catch (error) {
    console.error(`Failed to read EFS mount at ${EFS_MOUNT_PATH}:`, error);
    return { deleted: [], retained: 0, errors: [`Failed to read ${EFS_MOUNT_PATH}`] };
  }

  for (const entry of entries) {
    const fullPath = join(EFS_MOUNT_PATH, entry);

    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;

      const age = now - stat.mtimeMs;
      if (age > MAX_AGE_MS) {
        rmSync(fullPath, { recursive: true, force: true });
        deleted.push(entry);
        console.log(`Deleted ${entry} (age: ${Math.round(age / 86400000)} days)`);
      } else {
        retained++;
      }
    } catch (error) {
      const msg = `Failed to process ${entry}: ${error}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(`Cleanup complete: deleted ${deleted.length}, retained ${retained}, errors ${errors.length}`);
  return { deleted, retained, errors };
}
