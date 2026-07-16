// app/(dashboard)/dashboard/review/new/page.tsx
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractExtractions, contracts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const MANUAL_FIELDS = [
  "party_a",
  "party_b",
  "effective_date",
  "expiry_date",
  "renewal_date",
  "auto_renew",
  "notice_period_days",
  "notice_period_text",
  "contract_value",
] as const;

export default async function ReviewNewPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Dedup: reuse a stub created in the last 5 minutes
  const existing = await db.query.contracts.findFirst({
    where: and(
      eq(contracts.status, "draft"),
      eq(contracts.extractionStatus, "manual"),
      eq(contracts.name, "New Contract"),
      gt(contracts.createdAt, new Date(Date.now() - 5 * 60 * 1000))
    ),
    columns: { id: true },
  });

  if (existing) {
    redirect(`/dashboard/review/${existing.id}?manual=1`);
  }

  // Insert stub contract
  let contractId: string;
  try {
    const [created] = await db
      .insert(contracts)
      .values({
        createdBy: user.id,
        name: "New Contract",
        category: "other",
        status: "draft",
        extractionStatus: "manual",
      })
      .returning({ id: contracts.id });
    contractId = created.id;
  } catch (error) {
    console.error("[review/new] Failed to create stub contract:", error);
    redirect("/dashboard");
  }

  // Insert 8 empty extraction rows (contract_extractions has no user scoping)
  const extractionRows = MANUAL_FIELDS.map((fieldName) => ({
    contractId,
    fieldName,
    extractedValue: null,
    confirmedValue: null,
    confidence: null,
    wasEdited: false,
  }));

  await db.insert(contractExtractions).values(extractionRows);

  redirect(`/dashboard/review/${contractId}?manual=1`);
}
