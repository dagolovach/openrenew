import { redirect, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import ContractDetailClient from "@/components/contracts/ContractDetailClient";
import type { Contract } from "@/components/contracts/ContractDetailClient";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

type ChainEntry = {
  id: string;
  name: string | null;
  contract_version: number | null;
  status: string | null;
  expiry_date: string | null;
  contract_value: string | null;
  created_at: string;
  parent_contract_id: string | null;
};

async function getVersionChain(contractId: string): Promise<ChainEntry[]> {
  // Walk up to find the root of the chain
  let rootId = contractId;

  let upwardSteps = 0;
  while (upwardSteps < 10) {
    const row = await db.query.contracts.findFirst({
      where: eq(contracts.id, rootId),
      columns: { id: true, parentContractId: true },
    });

    if (!row?.parentContractId) break;
    rootId = row.parentContractId;
    upwardSteps++;
  }

  // Walk forward from root to build the chain (cap at 10)
  const chain: ChainEntry[] = [];
  let nextId: string | null = rootId;

  while (nextId !== null && chain.length < 10) {
    const currentId: string = nextId;

    const contract = await db.query.contracts.findFirst({
      where: eq(contracts.id, currentId),
      columns: {
        id: true,
        name: true,
        contractVersion: true,
        status: true,
        expiryDate: true,
        contractValue: true,
        createdAt: true,
        parentContractId: true,
      },
    });

    if (!contract) break;
    chain.push({
      id: contract.id,
      name: contract.name,
      contract_version: contract.contractVersion,
      status: contract.status,
      expiry_date: contract.expiryDate,
      contract_value: contract.contractValue,
      created_at: contract.createdAt.toISOString(),
      parent_contract_id: contract.parentContractId,
    });

    const child = await db.query.contracts.findFirst({
      where: eq(contracts.parentContractId, currentId),
      columns: { id: true },
    });

    nextId = child?.id ?? null;
  }

  return chain;
}

export default async function ContractDetailPage({ params }: Params) {
  const { id: contractId } = await params;

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const contract = await db.query.contracts.findFirst({
    where: eq(contracts.id, contractId),
    columns: {
      id: true,
      name: true,
      fileName: true,
      partyA: true,
      partyB: true,
      category: true,
      effectiveDate: true,
      expiryDate: true,
      renewalDate: true,
      autoRenew: true,
      noticePeriodDays: true,
      noticePeriodText: true,
      contractValue: true,
      extractionConfidence: true,
      status: true,
      parentContractId: true,
      contractVersion: true,
      annualValue: true,
    },
  });

  if (!contract) notFound();

  const versionChain = await getVersionChain(contractId);

  const mapped: Contract = {
    id: contract.id,
    name: contract.name,
    file_name: contract.fileName,
    party_a: contract.partyA,
    party_b: contract.partyB,
    category: contract.category,
    effective_date: contract.effectiveDate,
    expiry_date: contract.expiryDate,
    renewal_date: contract.renewalDate,
    auto_renew: contract.autoRenew,
    notice_period_days: contract.noticePeriodDays,
    notice_period_text: contract.noticePeriodText,
    contract_value: contract.contractValue,
    extraction_confidence: contract.extractionConfidence,
    status: contract.status,
    parent_contract_id: contract.parentContractId,
    contract_version: contract.contractVersion,
    annual_value: contract.annualValue,
  };

  return <ContractDetailClient contract={mapped} versionChain={versionChain} />;
}
