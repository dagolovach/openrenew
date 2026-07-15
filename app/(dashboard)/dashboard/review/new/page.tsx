// app/(dashboard)/dashboard/review/new/page.tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserFromHeader } from "@/lib/supabase/user-from-header";

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
  const user = await getUserFromHeader();
  if (!user) redirect("/login");
  const supabase = await createClient();

  // Dedup: reuse a stub created in the last 5 minutes
  const { data: existing } = await supabase
    .from("contracts")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "draft")
    .eq("extraction_status", "manual")
    .eq("name", "New Contract")
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();

  if (existing) {
    redirect(`/dashboard/review/${existing.id}?manual=1`);
  }

  // Insert stub contract
  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      user_id: user.id,
      name: "New Contract",
      category: "other",
      status: "draft",
      extraction_status: "manual",
    })
    .select("id")
    .single();

  if (error || !contract) {
    redirect("/dashboard");
  }

  // Insert 8 empty extraction rows (contract_extractions has no user_id column)
  const extractionRows = MANUAL_FIELDS.map((field_name) => ({
    contract_id: contract.id,
    field_name,
    extracted_value: null,
    confirmed_value: null,
    confidence: null,
    was_edited: false,
  }));

  await supabase.from("contract_extractions").insert(extractionRows);

  redirect(`/dashboard/review/${contract.id}?manual=1`);
}
