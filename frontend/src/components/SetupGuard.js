"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchConfigStatus } from "../lib/api";

export default function SetupGuard() {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetchConfigStatus()
      .then((s) => { setStatus(s); setApiDown(false); })
      .catch(() => setApiDown(true));
  }, [pathname]);

  // Redirect to setup when needed
  useEffect(() => {
    if (status?.needsSetup && pathname !== "/setup" && pathname !== "/settings") {
      router.replace("/setup");
    }
  }, [status, pathname, router]);

  // Don't show banners on setup or settings pages
  if (pathname === "/settings" || pathname === "/setup") return null;
  if (dismissed) return null;

  // API unreachable
  if (apiDown) {
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">API not reachable</p>
            <p className="text-xs text-red-600">Make sure the backend is running. Check your NEXT_PUBLIC_API_URL environment variable.</p>
          </div>
          <button onClick={() => setDismissed(true)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1">
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}
