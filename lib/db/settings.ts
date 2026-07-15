// lib/db/settings.ts
import { eq } from "drizzle-orm";
import { db } from "./index";
import { appSettings } from "./schema";

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
