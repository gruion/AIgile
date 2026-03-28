"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import SetupGuard from "./SetupGuard";

const NO_SIDEBAR_PATHS = ["/setup", "/health"];

export default function LayoutShell({ children }) {
  const pathname = usePathname();
  const hideSidebar = NO_SIDEBAR_PATHS.some(p => pathname.startsWith(p));

  return (
    <>
      {!hideSidebar && <Sidebar />}
      <div className="min-h-screen" id={hideSidebar ? undefined : "main-content"}>
        {!hideSidebar && <SetupGuard />}
        {children}
      </div>
    </>
  );
}
