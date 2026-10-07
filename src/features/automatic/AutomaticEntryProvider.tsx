import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { checkAutomaticEntries, type AutomaticEntryCheck } from "../../shared/api/automatic";
import { getStartupStatus, queryKeys } from "../../shared/api/finance";
import { AutomaticEntryContext } from "./AutomaticEntryContext";
import { refreshFinancialQueries } from "./refreshFinancialQueries";

export function AutomaticEntryProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<AutomaticEntryCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const check = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    if (mounted.current) {
      setChecking(true);
      setError(null);
    }
    const operation = (async () => {
      try {
        await Promise.resolve();
        if (!mounted.current) return;
        const next = await checkAutomaticEntries();
        if (!mounted.current) return;
        const startup = await getStartupStatus();
        if (!mounted.current) return;
        queryClient.setQueryData(queryKeys.startup, startup);
        setResult(next);
        // A check may also restore ordinary budgets or special allocations after
        // an exchange-rate failure, even when automatic occurrences are unchanged.
        await refreshFinancialQueries(queryClient);
      } catch (caught) {
        if (mounted.current) setError(caught);
      } finally {
        inFlight.current = null;
        if (mounted.current) setChecking(false);
      }
    })();
    inFlight.current = operation;
    return operation;
  }, [queryClient]);

  useEffect(() => {
    mounted.current = true;
    const whenVisible = () => {
      if (document.visibilityState !== "hidden") void check();
    };
    whenVisible();
    window.addEventListener("focus", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    const timer = window.setInterval(whenVisible, 60_000);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
      window.clearInterval(timer);
    };
  }, [check]);

  const value = useMemo(() => ({ result, checking, error, check }), [result, checking, error, check]);
  return <AutomaticEntryContext.Provider value={value}>{children}</AutomaticEntryContext.Provider>;
}
