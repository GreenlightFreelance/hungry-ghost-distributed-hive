// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Scheduled Lambda: cleans up EFS directories for runs older than MAX_AGE_DAYS.
 * Triggered by CloudWatch Events cron rule (daily).
 *
 * Scans /workspace/checkpoints/ and /workspace/runs/ for directories
 * whose modification time exceeds the retention window.
 */
export async function handler(): Promise<{ deleted: string[] }> {
  const efsMountPath = process.env.EFS_MOUNT_PATH || '/workspace';
  const maxAgeDays = parseInt(process.env.EFS_MAX_AGE_DAYS || '30', 10);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const deleted: string[] = [];

  const dirsToClean = [join(efsMountPath, 'checkpoints'), join(efsMountPath, 'runs')];

  for (const dir of dirsToClean) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      // Directory doesn't exist yet, skip
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry);
      try {
        const stat = statSync(entryPath);
        if (stat.isDirectory() && stat.mtimeMs < cutoff) {
          rmSync(entryPath, { recursive: true, force: true });
          deleted.push(entryPath);
          console.log(
            `Deleted stale directory: ${entryPath} (modified: ${new Date(stat.mtimeMs).toISOString()})`
          );
        }
      } catch (err) {
        console.error(`Failed to process ${entryPath}:`, err);
      }
    }
  }

  console.log(`EFS cleanup complete. Deleted ${deleted.length} directories.`);
  return { deleted };
}
