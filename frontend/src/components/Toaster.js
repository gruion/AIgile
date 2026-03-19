"use client";

import { useState, useEffect, useCallback } from "react";

// Simple global event bus for toasts
const listeners = new Set();
let toastId = 0;

export function toast(message, type = "info", duration = 4000) {
  const id = ++toastId;
  const t = { id, message, type, duration };
  listeners.forEach((fn) => fn(t));
  return id;
}

toast.success = (msg, duration) => toast(msg, "success", duration);
toast.error = (msg, duration) => toast(msg, "error", duration ?? 6000);
toast.warning = (msg, duration) => toast(msg, "warning", duration);
toast.info = (msg, duration) => toast(msg, "info", duration);

const TYPE_STYLES = {
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  warning: "bg-amber-500 text-white",
  info: "bg-gray-800 text-white",
};

const TYPE_ICONS = {
  success: "\u2713",
  error: "\u2717",
  warning: "\u26A0",
  info: "\u2139",
};

export default function Toaster() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((t) => {
    setToasts((prev) => [...prev.slice(-4), t]); // keep max 5
    if (t.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, t.duration);
    }
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => listeners.delete(addToast);
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`${TYPE_STYLES[t.type] || TYPE_STYLES.info} px-4 py-3 rounded-lg shadow-lg text-sm flex items-center gap-2 animate-slide-in`}
        >
          <span className="text-base leading-none">{TYPE_ICONS[t.type] || ""}</span>
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="text-white/60 hover:text-white ml-2 text-xs"
          >
            &#10005;
          </button>
        </div>
      ))}
    </div>
  );
}
