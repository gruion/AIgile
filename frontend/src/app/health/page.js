"use client";

import { useState, useEffect, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3011";

const STATUS_STYLES = {
  healthy: { bg: "bg-green-50", border: "border-green-200", text: "text-green-800", dot: "bg-green-500", badge: "bg-green-100 text-green-800" },
  degraded: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-800" },
  unhealthy: { bg: "bg-red-50", border: "border-red-200", text: "text-red-800", dot: "bg-red-500", badge: "bg-red-100 text-red-800" },
  not_configured: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-500", dot: "bg-gray-400", badge: "bg-gray-100 text-gray-600" },
};

const OVERALL_STYLES = {
  healthy: { bg: "bg-green-500", text: "All Systems Operational" },
  degraded: { bg: "bg-amber-500", text: "Partial Service Degradation" },
  unhealthy: { bg: "bg-red-500", text: "System Issues Detected" },
};

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function HealthPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/health`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastChecked(new Date());
    } catch (err) {
      setError("Cannot reach API: " + err.message);
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const overall = data ? OVERALL_STYLES[data.status] || OVERALL_STYLES.unhealthy : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header bar */}
      <div className={`${overall?.bg || "bg-gray-500"} text-white`}>
        <div className="max-w-3xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-[10px] font-bold">AI</div>
              <h1 className="text-lg font-bold">AIgile {data?.edition || "Open Source"} Status</h1>
            </div>
            <div className="flex items-center gap-3">
              {lastChecked && (
                <span className="text-xs text-white/70">
                  Last checked: {lastChecked.toLocaleTimeString()}
                </span>
              )}
              <button onClick={load} className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded transition-colors">
                Refresh
              </button>
            </div>
          </div>
          <p className="text-xl font-semibold mt-3">
            {loading ? "Checking..." : error ? "API Unreachable" : overall?.text}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {/* API error */}
        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <p className="text-red-800 font-medium">{error}</p>
            <p className="text-red-600 text-sm mt-1">The API server may be down or unreachable.</p>
          </div>
        )}

        {/* Loading */}
        {loading && !error && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-blue-200 border-t-blue-600 rounded-full" />
          </div>
        )}

        {/* Checks */}
        {data && (
          <>
            {/* Summary bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <span className="text-xs text-gray-600">{data.summary.healthy} healthy</span>
                </div>
                {data.summary.degraded > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="text-xs text-gray-600">{data.summary.degraded} degraded</span>
                  </div>
                )}
                {data.summary.unhealthy > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    <span className="text-xs text-gray-600">{data.summary.unhealthy} unhealthy</span>
                  </div>
                )}
                {data.summary.notConfigured > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                    <span className="text-xs text-gray-600">{data.summary.notConfigured} not configured</span>
                  </div>
                )}
              </div>
              <div className="text-xs text-gray-400">
                Uptime: {formatUptime(data.uptime)} | {data.totalLatencyMs}ms
              </div>
            </div>

            {/* Individual checks */}
            {data.checks.map((check, i) => {
              const s = STATUS_STYLES[check.status] || STATUS_STYLES.not_configured;
              return (
                <div key={i} className={`rounded-xl border-2 p-4 ${s.bg} ${s.border}`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full shrink-0 ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{check.name}</span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${s.badge}`}>
                          {check.status.replace("_", " ")}
                        </span>
                        {check.latencyMs > 0 && (
                          <span className="text-[10px] text-gray-400">{check.latencyMs}ms</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5">{check.message}</p>
                    </div>
                  </div>
                  {check.details && (
                    <div className="mt-2 ml-6 text-[10px] text-gray-400 font-mono">
                      {Object.entries(check.details).map(([k, v]) => (
                        <span key={k} className="mr-3">{k}: {String(v)}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* JSON endpoint link */}
            <div className="text-center pt-4">
              <a
                href={`${API_URL}/health`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                JSON endpoint: {API_URL}/health
              </a>
              <p className="text-[10px] text-gray-300 mt-1">Auto-refreshes every 30 seconds</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
