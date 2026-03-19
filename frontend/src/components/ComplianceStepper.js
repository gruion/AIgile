"use client";

import { useState } from "react";

const STATUS_STYLES = {
  pass: { card: "border-green-300 bg-green-50", badge: "bg-green-100 text-green-700", bar: "bg-green-500" },
  warning: { card: "border-amber-300 bg-amber-50", badge: "bg-amber-100 text-amber-700", bar: "bg-amber-500" },
  fail: { card: "border-red-300 bg-red-50", badge: "bg-red-100 text-red-700", bar: "bg-red-500" },
  critical: { card: "border-red-400 bg-red-100", badge: "bg-red-200 text-red-800", bar: "bg-red-600" },
};

export default function ComplianceStepper({ checks, onReload, loading }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [reloadingStep, setReloadingStep] = useState(false);

  // Only show non-pass checks
  const failingChecks = checks.filter((c) => c.status !== "pass");

  if (failingChecks.length === 0) {
    return (
      <div className="bg-green-50 border-2 border-green-200 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3">&#10003;</div>
        <h3 className="text-lg font-bold text-green-800 mb-1">All Checks Pass!</h3>
        <p className="text-sm text-green-600">Your project is fully compliant. No remediation needed.</p>
      </div>
    );
  }

  const step = Math.min(currentStep, failingChecks.length - 1);
  const check = failingChecks[step];
  const styles = STATUS_STYLES[check.status] || STATUS_STYLES.fail;
  const scorePct = check.maxScore > 0 ? Math.round((check.score / check.maxScore) * 100) : 0;

  const handleReload = async () => {
    setReloadingStep(true);
    await onReload();
    setReloadingStep(false);
  };

  return (
    <div className="space-y-4">
      {/* Progress indicator */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-gray-500">
          Step {step + 1} of {failingChecks.length}
        </span>
        <div className="flex-1 flex gap-1">
          {failingChecks.map((c, i) => {
            const s = STATUS_STYLES[c.status] || STATUS_STYLES.fail;
            return (
              <button
                key={c.id}
                onClick={() => setCurrentStep(i)}
                className={`h-2 rounded-full transition-all ${
                  i === step ? `${s.bar} flex-[2]` : i < step ? "bg-gray-300 flex-1" : "bg-gray-200 flex-1"
                }`}
                title={c.name}
              />
            );
          })}
        </div>
        <span className="text-xs text-gray-400">
          {failingChecks.length} issue{failingChecks.length !== 1 ? "s" : ""} to fix
        </span>
      </div>

      {/* Step dots navigation */}
      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        {failingChecks.map((c, i) => {
          const s = STATUS_STYLES[c.status] || STATUS_STYLES.fail;
          return (
            <button
              key={c.id}
              onClick={() => setCurrentStep(i)}
              className={`text-[10px] px-2 py-1 rounded-md border transition-all ${
                i === step
                  ? `${s.badge} border-current font-bold ring-2 ring-offset-1 ring-current`
                  : "border-gray-200 text-gray-400 hover:bg-gray-50"
              }`}
              title={c.name}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {/* Current check card */}
      <div className={`rounded-xl border-2 overflow-hidden transition-all ${styles.card}`}>
        {/* Header */}
        <div className="px-6 py-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded ${styles.badge}`}>
                {check.status}
              </span>
              <h3 className="text-base font-bold text-gray-900">{check.name}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-700">{check.score}/{check.maxScore}</span>
              <span className="text-xs text-gray-400">({scorePct}%)</span>
            </div>
          </div>

          {/* Score bar */}
          <div className="w-full bg-white/60 rounded-full h-3 overflow-hidden mb-4">
            <div className={`${styles.bar} h-3 rounded-full transition-all duration-500`} style={{ width: `${scorePct}%` }} />
          </div>

          {/* Description */}
          <p className="text-sm text-gray-700 leading-relaxed">{check.description}</p>

          {/* Detail */}
          {check.detail && (
            <div className="mt-3 text-xs text-gray-500 bg-white/60 rounded-lg px-4 py-3 font-mono">
              {check.detail}
            </div>
          )}

          {/* Action links */}
          {check.action && check.action.keys?.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{check.action.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {check.action.keys.map((key) => (
                  <a
                    key={key}
                    href={`${check.action.serverUrl}/browse/${key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-blue-600 bg-white rounded px-2.5 py-1.5 hover:bg-blue-50 hover:underline border border-blue-200 transition-colors"
                  >
                    {key}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Navigation footer */}
        <div className="px-6 py-4 bg-white/40 border-t border-white/50 flex items-center justify-between">
          <button
            onClick={() => setCurrentStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${
              step === 0
                ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            &larr; Previous
          </button>

          <button
            onClick={handleReload}
            disabled={reloadingStep || loading}
            className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            {reloadingStep || loading ? (
              <>
                <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-blue-500 rounded-full" />
                Checking...
              </>
            ) : (
              <>&#8635; Reload &amp; Verify</>
            )}
          </button>

          <button
            onClick={() => setCurrentStep(Math.min(failingChecks.length - 1, step + 1))}
            disabled={step === failingChecks.length - 1}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${
              step === failingChecks.length - 1
                ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            Next &rarr;
          </button>
        </div>
      </div>

      {/* Summary sidebar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h4 className="text-xs font-semibold text-gray-600 mb-2">Remediation Checklist</h4>
        <div className="space-y-1">
          {failingChecks.map((c, i) => {
            const s = STATUS_STYLES[c.status] || STATUS_STYLES.fail;
            const pct = c.maxScore > 0 ? Math.round((c.score / c.maxScore) * 100) : 0;
            return (
              <button
                key={c.id}
                onClick={() => setCurrentStep(i)}
                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  i === step ? "bg-gray-100 font-medium" : "hover:bg-gray-50"
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${s.bar}`} />
                <span className="flex-1 truncate text-gray-700">{c.name}</span>
                <span className="text-gray-400 font-mono">{pct}%</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
