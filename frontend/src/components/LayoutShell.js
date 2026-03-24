"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import SetupGuard from "./SetupGuard";

export default function LayoutShell({ children }) {
  const pathname = usePathname();
  const isSetup = pathname === "/setup";

  return (
    <>
      {!isSetup && <Sidebar />}
      <div className="min-h-screen" id="main-content">
        {!isSetup && <SetupGuard />}
        {children}
      </div>
    </>
  );
}
