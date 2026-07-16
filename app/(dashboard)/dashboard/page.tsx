// app/(dashboard)/dashboard/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { and, eq, gte, isNotNull, isNull, notInArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { alerts as alertsTable, contracts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import UploadZone from "@/components/dashboard/upload-zone";
import DashboardNav from "@/components/dashboard/dashboard-nav";
import DashboardMetrics from "@/components/dashboard/DashboardMetrics";
import ContractsFeed from "./contracts-feed";
import ContractsFeedSkeleton from "@/components/dashboard/contracts-feed-skeleton";
import "./dashboard.css";

export const metadata = { title: "Dashboard — OpenRenew" };

export const dynamic = "force-dynamic";

async function getDashboardMetrics() {
  const todayStr = new Date().toISOString().split("T")[0];

  const activeContracts = await db.query.contracts.findMany({
    where: and(
      eq(contracts.status, "active"),
      or(isNull(contracts.expiryDate), gte(contracts.expiryDate, todayStr))
    ),
    columns: { annualValue: true },
  });

  const contractsManaged = activeContracts.length;
  const parsedValues = activeContracts
    .map((c) => c.annualValue)
    .filter((v): v is number => v != null && v > 0);
  const totalSpend = parsedValues.reduce((a, b) => a + b, 0);
  const trackedCount = parsedValues.length;

  const sentAlerts = await db.query.alerts.findMany({
    where: isNotNull(alertsTable.sentAt),
    columns: { id: true },
  });

  return {
    contractsManaged,
    alertsSent: sentAlerts.length,
    totalSpend,
    trackedCount,
  };
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const openContracts = await db.query.contracts.findMany({
    where: notInArray(contracts.status, ["expired", "renewed"]),
    columns: { id: true },
  });
  const contractCount = openContracts.length;

  const metrics = await getDashboardMetrics();

  return (
    <div style={{ fontFamily: "var(--font-inter), system-ui, sans-serif", color: "#F9FAFB" }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <DashboardNav userEmail={user.email ?? ""} />

      {/* ── Main content ───────────────────────────────────── */}
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>

        {/* ── Dashboard metrics ────────────────────────────── */}
        <DashboardMetrics metrics={metrics} />

        {/* ── Upload zone ────────────────────────────────── */}
        <div style={{ marginBottom: "24px" }}>
          <UploadZone contractCount={contractCount} />
        </div>

        {/* ── Contract list (streams in after shell renders) ── */}
        <Suspense fallback={<ContractsFeedSkeleton />}>
          <ContractsFeed />
        </Suspense>
      </main>
    </div>
  );
}
