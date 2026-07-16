// app/(dashboard)/dashboard/contracts-feed.tsx
import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractExtractions, contracts } from "@/lib/db/schema";
import ContractList, { type SpendStat } from "@/components/dashboard/contract-list";
import { RenewalTimeline } from "@/components/RenewalTimeline";
import { isExpired } from "@/lib/utils";

export default async function ContractsFeed({ spend }: { spend: SpendStat }) {
  // Fetch contracts, then extractions for those contracts, and merge in JS
  // (no left-join relation configured on the Drizzle schema).
  const contractRows = await db.query.contracts.findMany({
    orderBy: desc(contracts.createdAt),
    columns: {
      id: true,
      name: true,
      fileName: true,
      status: true,
      extractionStatus: true,
      extractionConfidence: true,
      expiryDate: true,
      renewalDate: true,
      partyA: true,
      partyB: true,
      contractValue: true,
      noticePeriodDays: true,
      category: true,
      annualValue: true,
      updatedAt: true,
      createdAt: true,
      parentContractId: true,
      renewalDecision: true,
    },
  });

  const contractIds = contractRows.map((c) => c.id);
  const extractionRows = contractIds.length
    ? await db.query.contractExtractions.findMany({
        where: inArray(contractExtractions.contractId, contractIds),
        columns: {
          contractId: true,
          fieldName: true,
          confidence: true,
          confirmedValue: true,
          wasEdited: true,
        },
      })
    : [];

  const extractionsByContract = new Map<string, typeof extractionRows>();
  for (const e of extractionRows) {
    const list = extractionsByContract.get(e.contractId) ?? [];
    list.push(e);
    extractionsByContract.set(e.contractId, list);
  }

  // Compute unresolved amber/red count per contract from the joined data
  const allWithCount = contractRows.map((c) => {
    const extractions = extractionsByContract.get(c.id) ?? [];
    const unresolvedCount = extractions.filter(
      (e) =>
        e.fieldName !== "confidence" &&
        (e.confidence ?? 1) < 0.9 &&
        e.confirmedValue === null &&
        !e.wasEdited
    ).length;
    return {
      id: c.id,
      name: c.name,
      file_name: c.fileName,
      status: c.status,
      extraction_status: c.extractionStatus,
      extraction_confidence: c.extractionConfidence,
      expiry_date: c.expiryDate,
      renewal_date: c.renewalDate,
      party_a: c.partyA,
      party_b: c.partyB,
      contract_value: c.contractValue,
      notice_period_days: c.noticePeriodDays,
      category: c.category,
      annual_value: c.annualValue,
      updated_at: c.updatedAt.toISOString(),
      created_at: c.createdAt.toISOString(),
      parent_contract_id: c.parentContractId,
      unresolved_count: unresolvedCount,
      renewal_decision: c.renewalDecision,
    };
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
    renewal_decision: c.renewal_decision,
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
    renewal_decision: c.renewal_decision,
  }));

  return (
    <>
      {/* Needs review — only when non-empty, or spend header alone when there's nothing to review */}
      {(needsReviewContracts.length > 0 || spend.trackedCount > 0) && (
        <div style={{ marginBottom: 20 }}>
          <ContractList initialContracts={needsReviewContracts} spend={spend} />
        </div>
      )}

      {/* Renewal timeline */}
      <RenewalTimeline contracts={timelineContracts} expiredContracts={expiredTimelineContracts} />
    </>
  );
}
