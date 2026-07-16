// app/(dashboard)/dashboard/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, inArray, lte, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { alerts as alertsTable, contractAnalysis, contracts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/db/settings";
import { isSmtpConfigured } from "@/lib/email-smtp";
import { aiEnabled } from "@/lib/ai";
import { buildTriageQueue, nextUp, type TriageContract } from "@/lib/triage";
import UploadZone from "@/components/dashboard/upload-zone";
import DashboardNav from "@/components/dashboard/dashboard-nav";
import TriageQueue from "@/components/dashboard/triage-queue";
import ContractsFeed from "./contracts-feed";
import ContractsFeedSkeleton from "@/components/dashboard/contracts-feed-skeleton";
import "./dashboard.css";

export const metadata = { title: "Dashboard" };

export const dynamic = "force-dynamic";

async function getDeliveryBannerData() {
  const todayStr = new Date().toISOString().split("T")[0];

  const overdueRows = await db
    .select({ contractId: alertsTable.contractId, contractName: contracts.name })
    .from(alertsTable)
    .innerJoin(contracts, eq(alertsTable.contractId, contracts.id))
    .where(and(lte(alertsTable.scheduledFor, todayStr), eq(alertsTable.status, "pending")));

  const overdueCount = overdueRows.length;
  const uniqueContracts = Array.from(
    new Map(overdueRows.map((r) => [r.contractId, r.contractName])).entries()
  ).slice(0, 5);

  const slackConfigured = !!(await getSetting<string>("slack_webhook_url"));
  const channelConfigured = slackConfigured || isSmtpConfigured();

  return { overdueCount, uniqueContracts, channelConfigured };
}

async function getTriageData() {
  const rows = await db.query.contracts.findMany({
    where: eq(contracts.status, "active"),
    columns: {
      id: true, name: true, partyA: true, partyB: true, status: true,
      annualValue: true, expiryDate: true, renewalDate: true,
      noticePeriodDays: true, snoozedUntil: true, renewalDecision: true,
    },
  });
  const mapped: TriageContract[] = rows.map((r) => ({
    id: r.id, name: r.name, party_a: r.partyA, party_b: r.partyB,
    status: r.status, annual_value: r.annualValue,
    expiry_date: r.expiryDate, renewal_date: r.renewalDate,
    notice_period_days: r.noticePeriodDays,
    snoozed_until: r.snoozedUntil, renewal_decision: r.renewalDecision,
  }));
  const items = buildTriageQueue(mapped);
  const next = nextUp(mapped);
  const ids = items.map((i) => i.contract_id);
  const findings = ids.length
    ? await db.query.contractAnalysis.findMany({
        where: inArray(contractAnalysis.contractId, ids),
        columns: { contractId: true },
      })
    : [];
  const aiFindingsByContract = Object.fromEntries(findings.map((f) => [f.contractId, true]));
  return { items, next, aiFindingsByContract, triageContracts: mapped };
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const openContracts = await db.query.contracts.findMany({
    where: notInArray(contracts.status, ["expired", "renewed"]),
    columns: { id: true },
  });
  const contractCount = openContracts.length;

  const { overdueCount, uniqueContracts, channelConfigured } = await getDeliveryBannerData();
  const showDeliveryBanner = overdueCount > 0 && !channelConfigured;

  const { items, next, aiFindingsByContract } = await getTriageData();

  return (
    <div style={{ fontFamily: "var(--font-inter), system-ui, sans-serif", color: "#F9FAFB" }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <DashboardNav userEmail={user.email ?? ""} />

      {/* ── Main content ───────────────────────────────────── */}
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>

        {/* ── No delivery channel configured banner ─────────── */}
        {showDeliveryBanner && (
          <div
            style={{
              background: "#78350f",
              border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: "8px",
              padding: "14px 16px",
              marginBottom: "24px",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
            }}
          >
            <p style={{ margin: 0, fontSize: "13px", color: "#fbbf24", fontWeight: 600, lineHeight: 1.5 }}>
              {overdueCount} renewal alert{overdueCount === 1 ? "" : "s"} {overdueCount === 1 ? "is" : "are"} due
              but no delivery channel is configured — add a Slack webhook in{" "}
              <Link href="/dashboard/settings" style={{ color: "#fbbf24", textDecoration: "underline" }}>
                Settings
              </Link>
              .
            </p>
            {uniqueContracts.length > 0 && (
              <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "12px" }}>
                {uniqueContracts.map(([id, name]) => (
                  <Link
                    key={id}
                    href={`/dashboard/contracts/${id}`}
                    style={{ fontSize: "12px", color: "#fcd34d", textDecoration: "none" }}
                  >
                    {name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Triage queue — what needs action now ──────────── */}
        <TriageQueue
          items={items}
          next={next}
          aiFindingsByContract={aiFindingsByContract}
          aiEnabled={aiEnabled()}
        />

        {/* ── Upload zone ────────────────────────────────── */}
        <div style={{ marginBottom: "24px" }}>
          <UploadZone contractCount={contractCount} aiEnabled={aiEnabled()} />
        </div>

        {/* ── Contract list (streams in after shell renders) ── */}
        <Suspense fallback={<ContractsFeedSkeleton />}>
          <ContractsFeed />
        </Suspense>
      </main>
    </div>
  );
}
