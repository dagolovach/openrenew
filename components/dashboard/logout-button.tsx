// components/dashboard/logout-button.tsx
"use client";

export default function LogoutButton() {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        fontSize: "13px",
        color: "#4B5563",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "4px 8px",
        borderRadius: "4px",
        transition: "color 150ms ease",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "#9CA3AF")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "#4B5563")}
    >
      Log out
    </button>
  );
}
