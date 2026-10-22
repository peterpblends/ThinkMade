import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { promptVersion } from '../schema/index';

/** Active admin prompt overrides by stage. Stages without one use the built-in prompt. */
export async function getActivePrompts(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ stage: promptVersion.stage, text: promptVersion.systemPrompt }).from(promptVersion).where(eq(promptVersion.active, true));
  return new Map(rows.map((r) => [r.stage, r.text]));
}
