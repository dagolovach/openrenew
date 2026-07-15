// app/(dashboard)/dashboard/contracts/[id]/loading.tsx

function Skel({ width, height, style }: { width: string | number; height: string | number; style?: React.CSSProperties }) {
  return (
    <div
      className="skel-pulse"
      style={{ width, height, borderRadius: 4, background: "#1F2937", ...style }}
    />
  );
}

export default function ContractDetailLoading() {
  return (
    <>
      <style>{`
        @keyframes skel-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .skel-pulse { animation: skel-pulse 1.6s ease-in-out infinite; }
      `}</style>

      <div style={{ fontFamily: "var(--font-inter), system-ui, sans-serif", color: "#F9FAFB", minHeight: "100vh", background: "#0A0F1E" }}>

        {/* Nav bar skeleton */}
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Skel width={80} height={14} />
          <Skel width={120} height={14} />
        </div>

        <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>

          {/* Back link skeleton */}
          <Skel width={110} height={12} style={{ marginBottom: 24 }} />

          {/* Hero band skeleton */}
          <div style={{
            background: "#111827",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: "28px 32px",
            marginBottom: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
              <Skel width="55%" height={22} />
              <Skel width="35%" height={13} />
              <Skel width="25%" height={13} />
            </div>
            {/* Countdown block */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
              <Skel width={64} height={36} style={{ borderRadius: 6 }} />
              <Skel width={80} height={11} />
            </div>
          </div>

          {/* Details grid skeleton */}
          <div style={{
            background: "#111827",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: "24px 32px",
            marginBottom: 24,
          }}>
            <Skel width={120} height={13} style={{ marginBottom: 20 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 32px" }}>
              {[180, 140, 160, 120, 150, 110].map((w, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Skel width={80} height={10} />
                  <Skel width={w} height={14} />
                </div>
              ))}
            </div>
          </div>

          {/* Intelligence panel skeleton */}
          <div style={{
            background: "#111827",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: "24px 32px",
          }}>
            <Skel width={160} height={13} style={{ marginBottom: 20 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Skel width="100%" height={13} />
              <Skel width="85%" height={13} />
              <Skel width="70%" height={13} />
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
