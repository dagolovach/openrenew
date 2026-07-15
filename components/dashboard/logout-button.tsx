// components/dashboard/logout-button.tsx
"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
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
