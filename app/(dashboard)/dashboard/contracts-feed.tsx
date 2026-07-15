// app/(dashboard)/dashboard/contracts-feed.tsx
import { createClient } from "@/lib/supabase/server";
import ContractList from "@/components/dashboard/contract-list";
import { RenewalTimeline } from "@/components/RenewalTimeline";
import { isExpired } from "@/lib/utils";

export default async function ContractsFeed({ userId }: { userId: string }) {
  const supabase = await createClient();

  // Left join (no !inner) so processing contracts with no extractions are included
  const { data: contracts, error: contractsError } = await supabase
    .from("contracts")
    .select(`
      id, name, file_name, status, extraction_status, extraction_confidence,
      expiry_date, renewal_date, party_a, party_b, contract_value, notice_period_days,
      category, annual_value, updated_at, created_at, parent_contract_id,
      contract_extractions(confidence, confirmed_value, was_edited, field_name)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (contractsError)
    console.error("[contracts-feed] query failed:", contractsError.message);

  type ExtractionRow = {
    field_name: string;
    confidence: number | null;
    confirmed_value: string | null;
    was_edited: boolean | null;
  };
  type QueryRow = {
    id: string;
    name: string;
    file_name: string | null;
    status: string;
    extraction_status: string;
    extraction_confidence: number | null;
    expiry_date: string | null;
    renewal_date: string | null;
    party_a: string | null;
    party_b: string | null;
    contract_value: string | null;
    notice_period_days: number | null;
    category: string | null;
    annual_value: number | null;
    updated_at: string;
    created_at: string;
    parent_contract_id: string | null;
    contract_extractions: ExtractionRow[];
  };

  const rows = (contracts ?? []) as unknown as QueryRow[];

  // Compute unresolved amber/red count per contract from the joined data
  const allWithCount = rows.map((c) => {
    const { contract_extractions, ...rest } = c;
    const unresolvedCount = contract_extractions.filter(
      (e) =>
        e.field_name !== "confidence" &&
        (e.confidence ?? 1) < 0.9 &&
        e.confirmed_value === null &&
        !e.was_edited
    ).length;
    return { ...rest, unresolved_count: unresolvedCount };
  });

  // Active (non-expired) contracts → timeline
  const activeContracts = allWithCount.filter(
    (c) => c.status === "active" && !isExpired(c)
  );

  // Expired contracts → collapsed section below timeline
  const expiredContracts = allWithCount
    .filter((c) => c.status === "expired" || (c.status === "active" && isExpired(c)))
    .sort((a, b) => {
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date > b.expiry_date ? -1 : 1; // most recently expired first
    });

  // In-progress uploads → needs-review section (hidden when empty)
  const needsReviewContracts = allWithCount.filter((c) =>
    ["draft", "processing", "analyzing", "party_review"].includes(c.status)
  );

  // Timeline shape
  const timelineContracts = activeContracts.map((c) => ({
    id: c.id,
    name: c.name,
    party_a: c.party_a,
    party_b: c.party_b,
    expiry_date: c.expiry_date,
    notice_period_days: c.notice_period_days,
    annual_value: c.annual_value,
    contract_value: c.contract_value,
  }));

  const expiredTimelineContracts = expiredContracts.map((c) => ({
    id: c.id,
    name: c.name,
    party_a: c.party_a,
    party_b: c.party_b,
    expiry_date: c.expiry_date,
    notice_period_days: c.notice_period_days,
    annual_value: c.annual_value,
    contract_value: c.contract_value,
  }));

  return (
    <>
      {/* Needs review — only when non-empty */}
      {needsReviewContracts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <ContractList initialContracts={needsReviewContracts} />
        </div>
      )}

      {/* Renewal timeline */}
      <RenewalTimeline contracts={timelineContracts} expiredContracts={expiredTimelineContracts} />
    </>
  );
}

