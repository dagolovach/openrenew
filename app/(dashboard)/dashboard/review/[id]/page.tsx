// app/(dashboard)/dashboard/review/[id]/page.tsx
import { redirect, notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractExtractions, contracts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai";
import ReviewClient from "@/components/review/review-client";

export const dynamic = "force-dynamic";
export const metadata = { title: 'Review Contract' };

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ manual?: string }>;
};

export default async function ReviewPage({ params, searchParams }: Params) {
  const { id: contractId } = await params;
  const { manual } = await searchParams;
  const isManual = manual === "1";

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const contract = await db.query.contracts.findFirst({
    where: eq(contracts.id, contractId),
    columns: {
      id: true,
      name: true,
      fileName: true,
      category: true,
      status: true,
      extractionStatus: true,
      extractionConfidence: true,
      filePath: true,
      expiryDate: true,
      renewalDate: true,
      effectiveDate: true,
      autoRenew: true,
      noticePeriodDays: true,
      noticePeriodText: true,
      partyA: true,
      partyB: true,
      contractValue: true,
      parentContractId: true,
    },
  });

  if (!contract) notFound();

  // Fetch extractions
  const extractionRows = await db.query.contractExtractions.findMany({
    where: and(eq(contractExtractions.contractId, contractId), ne(contractExtractions.fieldName, "confidence")),
    columns: { fieldName: true, extractedValue: true, confirmedValue: true, confidence: true, wasEdited: true },
  });

  const pdfUrl = contract.filePath ? `/api/contracts/${contractId}/pdf` : null;

  // Party names come from user input stored on the contract row, not AI extractions.
  // Inject synthetic rows so FieldPanel renders them as already-confirmed (blue).
  const partyExtractions = [
    {
      field_name: "party_a",
      extracted_value: contract.partyA ?? null,
      confirmed_value: contract.partyA ?? null,
      confidence: 1.0,
      was_edited: false,
    },
    {
      field_name: "party_b",
      extracted_value: contract.partyB ?? null,
      confirmed_value: contract.partyB ?? null,
      confidence: 1.0,
      was_edited: false,
    },
  ];
  const allExtractions = [
    ...partyExtractions,
    ...extractionRows
      .filter((e) => e.fieldName !== "party_a" && e.fieldName !== "party_b")
      .map((e) => ({
        field_name: e.fieldName,
        extracted_value: e.extractedValue,
        confirmed_value: e.confirmedValue,
        confidence: e.confidence,
        was_edited: e.wasEdited,
      })),
  ];

  const contractForClient = {
    id: contract.id,
    name: contract.name,
    file_name: contract.fileName,
    category: contract.category,
    status: contract.status,
    extraction_status: contract.extractionStatus,
    extraction_confidence: contract.extractionConfidence,
    file_path: contract.filePath,
    expiry_date: contract.expiryDate,
    renewal_date: contract.renewalDate,
    effective_date: contract.effectiveDate,
    auto_renew: contract.autoRenew,
    notice_period_days: contract.noticePeriodDays,
    notice_period_text: contract.noticePeriodText,
    party_a: contract.partyA,
    party_b: contract.partyB,
    contract_value: contract.contractValue,
    parent_contract_id: contract.parentContractId,
  };

  return (
    <ReviewClient
      contract={contractForClient}
      extractions={allExtractions}
      pdfUrl={pdfUrl}
      isManual={isManual}
      parentContractId={contract.parentContractId ?? null}
      aiEnabled={aiEnabled()}
    />
  );
}
