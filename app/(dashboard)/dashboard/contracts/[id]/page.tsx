// app/(dashboard)/dashboard/contracts/[id]/page.tsx
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getUserFromHeader } from "@/lib/supabase/user-from-header";
import ContractDetailClient from "@/components/contracts/ContractDetailClient";
import type { Contract } from "@/components/contracts/ContractDetailClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

async function getVersionChain(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contractId: string,
  userId: string
) {
  // Walk up to find the root of the chain
  let rootId = contractId;

  let upwardSteps = 0;
  while (upwardSteps < 10) {
    const { data } = await supabase
      .from("contracts")
      .select("id, parent_contract_id")
      .eq("id", rootId)
      .eq("user_id", userId)
      .single();

    if (!data?.parent_contract_id) break;
    rootId = data.parent_contract_id;
    upwardSteps++;
  }

  // Walk forward from root to build the chain (cap at 10)
  const chain: Array<{
    id: string;
    name: string | null;
    contract_version: number | null;
    status: string | null;
    expiry_date: string | null;
    contract_value: string | null;
    created_at: string;
    parent_contract_id: string | null;
  }> = [];
  let nextId: string | null = rootId;

  while (nextId !== null && chain.length < 10) {
    const currentId: string = nextId;

    const { data: contract } = await supabase
      .from("contracts")
      .select("id, name, contract_version, status, expiry_date, contract_value, created_at, parent_contract_id")
      .eq("id", currentId)
      .eq("user_id", userId)
      .single();

    if (!contract) break;
    chain.push(contract);

    const { data: childData } = await supabase
      .from("contracts")
      .select("id")
      .eq("parent_contract_id", currentId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    nextId = (childData as { id: string } | null)?.id ?? null;
  }

  return chain;
}

export default async function ContractDetailPage({ params }: Params) {
  const { id: contractId } = await params;

  const user = await getUserFromHeader();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const { data: contract, error } = await supabase
    .from("contracts")
    .select(
      "id, name, file_name, party_a, party_b, category, effective_date, expiry_date, renewal_date, auto_renew, notice_period_days, notice_period_text, contract_value, extraction_confidence, status, parent_contract_id, contract_version, annual_value"
    )
    .eq("id", contractId)
    .eq("user_id", user.id)
    .single();

  if (error || !contract) notFound();

  const versionChain = await getVersionChain(supabase, contractId, user.id);

  return <ContractDetailClient contract={contract as unknown as Contract} versionChain={versionChain} />;
}
