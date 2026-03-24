"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { fetchConfigStatus } from "../lib/api";

const AppConfigContext = createContext({
  defaultJql: "",
  jiraBaseUrl: "",
  needsSetup: true,
  ready: false,
  refresh: async () => {},
});

export function AppConfigProvider({ children }) {
  const [config, setConfig] = useState({
    defaultJql: "",
    jiraBaseUrl: "",
    needsSetup: true,
    ready: false,
  });

  const refresh = useCallback(async () => {
    try {
      const s = await fetchConfigStatus();
      setConfig({
        defaultJql: s.defaultJql || "",
        jiraBaseUrl: s.browserUrl || "",
        needsSetup: !!s.needsSetup,
        ready: true,
      });
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AppConfigContext.Provider value={{ ...config, refresh }}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  return useContext(AppConfigContext);
}
