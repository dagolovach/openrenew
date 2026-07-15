// components/dashboard/contracts-feed-skeleton.tsx

function SkeletonBlock({ width, height, style }: { width: string | number; height: string | number; style?: React.CSSProperties }) {
  return (
    <div
      className="skel-pulse"
      style={{
        width,
        height,
        borderRadius: "4px",
        background: "#1F2937",
        ...style,
      }}
    />
  );
}

function SkeletonContractCard() {
  return (
    <div
      style={{
        background: "#111827",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "8px",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SkeletonBlock width="45%" height={16} />
        <SkeletonBlock width={64} height={22} style={{ borderRadius: "12px" }} />
      </div>
      {/* Meta row */}
      <div style={{ display: "flex", gap: "24px" }}>
        <SkeletonBlock width={90} height={12} />
        <SkeletonBlock width={70} height={12} />
        <SkeletonBlock width={80} height={12} />
      </div>
    </div>
  );
}

export default function ContractsFeedSkeleton() {
  return (
    <>
      <style>{`
        @keyframes skel-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .skel-pulse {
          animation: skel-pulse 1.6s ease-in-out infinite;
        }
      `}</style>

      {/* Metrics row skeleton */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "12px",
          marginBottom: "28px",
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              background: "#111827",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "6px",
              padding: "10px 16px",
              display: "flex",
              alignItems: "baseline",
              gap: "10px",
            }}
          >
            <SkeletonBlock width={24} height={20} />
            <SkeletonBlock width="60%" height={11} />
          </div>
        ))}
      </div>

      {/* Contract card skeletons */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {[0, 1, 2].map((i) => (
          <SkeletonContractCard key={i} />
        ))}
      </div>
    </>
  );
}
