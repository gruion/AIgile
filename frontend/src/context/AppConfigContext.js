"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { fetchConfigStatus } from "../lib/api";

const AppConfigContext = createContext({
  defaultJql: "",
  jiraBaseUrl: "",
  needsSetup: true,
  ready: false,
});

export function AppConfigProvider({ children }) {
  const [config, setConfig] = useState({
    defaultJql: "",
    jiraBaseUrl: "",
    needsSetup: true,
    ready: false,
  });

  useEffect(() => {
    fetchConfigStatus()
      .then((s) => {
        setConfig({
          defaultJql: s.defaultJql || "",
          jiraBaseUrl: s.browserUrl || "",
          needsSetup: !!s.needsSetup,
          ready: true,
        });
      })
      .catch(() => {
        setConfig((prev) => ({ ...prev, ready: true }));
      });
  }, []);

  return (
    <AppConfigContext.Provider value={config}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig() {
  return useContext(AppConfigContext);
}
