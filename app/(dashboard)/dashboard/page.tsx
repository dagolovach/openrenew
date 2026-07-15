// app/(dashboard)/dashboard/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUserFromHeader } from "@/lib/supabase/user-from-header";
import { createClient } from "@/lib/supabase/server";
import UploadZone from "@/components/dashboard/upload-zone";
import DashboardNav from "@/components/dashboard/dashboard-nav";
import DashboardMetrics from "@/components/dashboard/DashboardMetrics";
import ContractsFeed from "./contracts-feed";
import ContractsFeedSkeleton from "@/components/dashboard/contracts-feed-skeleton";
import "./dashboard.css";

export const metadata = { title: "Dashboard — OpenRenew" };

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getUserFromHeader();
  if (!user) redirect("/login");

  const supabase = await createClient();
  // eslint-disable-next-line react-hooks/purity
  const renderKey = Date.now();
  const { count: contractCount } = await supabase
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .not("status", "in", '("expired","renewed")');

  return (
    <div style={{ fontFamily: "var(--font-inter), system-ui, sans-serif", color: "#F9FAFB" }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <DashboardNav userEmail={user.email ?? ""} />

      {/* ── Main content ───────────────────────────────────── */}
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 24px" }}>

        {/* ── Dashboard metrics ────────────────────────────── */}
        <DashboardMetrics userId={user.id} refreshKey={renderKey} />

        {/* ── Upload zone ────────────────────────────────── */}
        <div style={{ marginBottom: "24px" }}>
          <UploadZone contractCount={contractCount ?? 0} />
        </div>

        {/* ── Contract list (streams in after shell renders) ── */}
        <Suspense fallback={<ContractsFeedSkeleton />}>
          <ContractsFeed userId={user.id} />
        </Suspense>
      </main>
    </div>
  );
}
