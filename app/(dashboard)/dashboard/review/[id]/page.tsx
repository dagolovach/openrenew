// app/(dashboard)/dashboard/review/[id]/page.tsx
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import { getUserFromHeader } from "@/lib/supabase/user-from-header";
import ReviewClient from "@/components/review/review-client";

export const dynamic = "force-dynamic";
export const metadata = { title: 'Review Contract — OpenRenew' };

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ manual?: string }>;
};

export default async function ReviewPage({ params, searchParams }: Params) {
  const { id: contractId } = await params;
  const { manual } = await searchParams;
  const isManual = manual === "1";

  const user = await getUserFromHeader();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const { data: contract, error } = await supabase
    .from("contracts")
    .select("id, name, file_name, category, status, extraction_status, extraction_confidence, file_path, expiry_date, renewal_date, effective_date, auto_renew, notice_period_days, notice_period_text, party_a, party_b, contract_value, parent_contract_id")
    .eq("id", contractId)
    .single();

  if (error || !contract) notFound();

  // Fetch extractions and generate signed URL in parallel
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [extractionsRes, signedRes] = await Promise.all([
    supabase
      .from("contract_extractions")
      .select("field_name, extracted_value, confirmed_value, confidence, was_edited")
      .eq("contract_id", contractId)
      .neq("field_name", "confidence"),
    contract.file_path
      ? adminClient.storage.from("contracts").createSignedUrl(contract.file_path, 600)
      : Promise.resolve(null),
  ]);

  const extractions = extractionsRes.data;
  const pdfUrl = signedRes && "data" in signedRes ? (signedRes.data?.signedUrl ?? null) : null;

  // Party names come from user input stored on the contract row, not AI extractions.
  // Inject synthetic rows so FieldPanel renders them as already-confirmed (blue).
  const partyExtractions = [
    {
      field_name: "party_a",
      extracted_value: contract.party_a ?? null,
      confirmed_value: contract.party_a ?? null,
      confidence: 1.0,
      was_edited: false,
    },
    {
      field_name: "party_b",
      extracted_value: contract.party_b ?? null,
      confirmed_value: contract.party_b ?? null,
      confidence: 1.0,
      was_edited: false,
    },
  ];
  const allExtractions = [
    ...partyExtractions,
    ...(extractions ?? []).filter(
      (e) => e.field_name !== "party_a" && e.field_name !== "party_b"
    ),
  ];

  return <ReviewClient contract={contract} extractions={allExtractions} pdfUrl={pdfUrl} isManual={isManual} parentContractId={contract.parent_contract_id ?? null} />;
}
