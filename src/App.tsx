import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { HashRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";

import { MonthlyPage } from "./features/monthly/MonthlyPage";
import { PlansPage } from "./features/plans/PlansPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SetupPage } from "./features/setup/SetupPage";
import { getDomainContract } from "./shared/api/domain";
import { getSettings, queryKeys, type Settings } from "./shared/api/finance";
import { describeError } from "./shared/formatting/errors";

const navigation = [
  { to: "/monthly", label: "月度计划" },
  { to: "/plans", label: "长期计划" },
  { to: "/settings", label: "设置" },
];

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 15_000 },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppBootstrap />
      </HashRouter>
    </QueryClientProvider>
  );
}

function AppBootstrap() {
  const contractQuery = useQuery({ queryKey: queryKeys.domain, queryFn: () => getDomainContract() });
  const settingsQuery = useQuery({ queryKey: queryKeys.settings, queryFn: () => getSettings() });

  if (contractQuery.isPending || settingsQuery.isPending) {
    return <LaunchState title="正在打开 Aplena" detail="正在检查本地数据库与财务规则…" />;
  }
  if (contractQuery.isError || settingsQuery.isError) {
    return (
      <LaunchState
        tone="error"
        title="本地财务服务暂不可用"
        detail={describeError(contractQuery.error ?? settingsQuery.error)}
      />
    );
  }
  if (!settingsQuery.data) {
    return <SetupPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout settings={settingsQuery.data} />}>
        <Route index element={<Navigate replace to="/monthly" />} />
        <Route path="monthly" element={<MonthlyPage />} />
        <Route path="plans" element={<PlansPage contract={contractQuery.data} />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate replace to="/monthly" />} />
      </Route>
    </Routes>
  );
}

function AppLayout({ settings }: { settings: Settings }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <div>
            <p className="brand-name">Aplena</p>
            <p className="brand-caption">Personal Financial Capacity</p>
          </div>
        </div>
        <nav className="navigation">
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) => (isActive ? "nav-item nav-item-active" : "nav-item")}
              key={item.to}
              to={item.to}
            >
              <span className="nav-dot" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-context">
          <span>目标月份</span>
          <strong>{settings.target_month}</strong>
          <small>{settings.base_currency} · 本地优先</small>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

function LaunchState({
  title,
  detail,
  tone = "loading",
}: {
  title: string;
  detail: string;
  tone?: "loading" | "error";
}) {
  return (
    <main
      className={`launch-screen launch-${tone}`}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <div className="brand-mark" aria-hidden="true">
        A
      </div>
      <p className="eyebrow">Personal Financial Capacity</p>
      <h1>{title}</h1>
      <p>{detail}</p>
    </main>
  );
}
