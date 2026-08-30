import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { HashRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { getDomainContract } from "./shared/api/domain";
import {
  ensureDefaultSettings,
  getStartupStatus,
  queryKeys,
  type Settings,
} from "./shared/api/finance";
import { describeError } from "./shared/formatting/errors";
import { currencyName } from "./shared/formatting/finance";

const DashboardPage = lazy(() =>
  import("./features/dashboard/DashboardPage").then((module) => ({ default: module.DashboardPage })),
);
const HistoryPage = lazy(() =>
  import("./features/history/HistoryPage").then((module) => ({ default: module.HistoryPage })),
);
const GoalsPage = lazy(() =>
  import("./features/goals/GoalsPage").then((module) => ({ default: module.GoalsPage })),
);
const MonthlyPage = lazy(() =>
  import("./features/monthly/MonthlyPage").then((module) => ({ default: module.MonthlyPage })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

const navigation = [
  { to: "/dashboard", label: "总览", icon: "dashboard" },
  { to: "/monthly", label: "月度执行", icon: "calendar" },
  { to: "/history", label: "历史报表", icon: "history" },
  { to: "/goals", label: "目标", icon: "target" },
  { to: "/settings", label: "设置", icon: "settings" },
] as const;

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
        <ApplicationErrorBoundary>
          <AppBootstrap />
        </ApplicationErrorBoundary>
      </HashRouter>
    </QueryClientProvider>
  );
}

export class ApplicationErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <ApplicationFrameState
          tone="error"
          title="界面资源加载失败"
          detail="请完全退出并重新打开 Aplena；如果问题持续，请保留当前数据库文件并停止继续操作。"
        />
      );
    }
    return this.props.children;
  }
}

function AppBootstrap() {
  const contractQuery = useQuery({ queryKey: queryKeys.domain, queryFn: () => getDomainContract() });
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => ensureDefaultSettings(),
  });
  const startupQuery = useQuery({ queryKey: queryKeys.startup, queryFn: () => getStartupStatus() });

  if (contractQuery.isPending || settingsQuery.isPending || startupQuery.isPending) {
    return <ApplicationFrameState title="正在汇总财务数据" detail="正在检查本地数据库与计算规则…" />;
  }
  if (contractQuery.isError || settingsQuery.isError || startupQuery.isError) {
    return (
      <ApplicationFrameState
        tone="error"
        title="本地财务服务暂不可用"
        detail={describeError(contractQuery.error ?? settingsQuery.error ?? startupQuery.error)}
        action={
          <button
            className="button button-primary"
            onClick={() => void Promise.all([contractQuery.refetch(), settingsQuery.refetch(), startupQuery.refetch()])}
            type="button"
          >
            重试启动
          </button>
        }
      />
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout currentMonth={startupQuery.data.current_month} settings={settingsQuery.data} />}>
        <Route index element={<Navigate replace to="/dashboard" />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="monthly" element={<MonthlyPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="history/:month" element={<HistoryPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="plans" element={<Navigate replace to="/goals" />} />
        <Route path="analysis" element={<Navigate replace to={`/history/${startupQuery.data.current_month}`} />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate replace to="/dashboard" />} />
      </Route>
    </Routes>
  );
}

function AppLayout({ currentMonth, settings }: { currentMonth: string; settings: Settings }) {
  return (
    <div className="app-shell">
      <RouteScrollReset />
      <AppSidebar currentMonth={currentMonth} settings={settings} />
      <main className="main-content">
        <Suspense fallback={<section className="state-card">正在打开页面…</section>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

function RouteScrollReset() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return null;
}

function ApplicationFrameState({
  title,
  detail,
  tone = "loading",
  action,
}: {
  title: string;
  detail: string;
  tone?: "loading" | "error";
  action?: ReactNode;
}) {
  return (
    <div className="app-shell app-shell-state">
      <AppSidebar />
      <main className="main-content" aria-live={tone === "error" ? "assertive" : "polite"}>
        <header className="page-header compact-header">
          <div>
            <p className="eyebrow">财务总览</p>
            <h1>{title}</h1>
            <p>{detail}</p>
          </div>
        </header>
        <section className={`workspace-state workspace-state-${tone}`}>
          {tone === "loading" ? (
            <>
              <div className="workspace-skeleton workspace-skeleton-wide" />
              <div className="workspace-skeleton-grid">
                <div className="workspace-skeleton" />
                <div className="workspace-skeleton" />
                <div className="workspace-skeleton" />
              </div>
            </>
          ) : (
            <>
              <strong>{title}</strong>
              <p>{detail}</p>
              {action}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function AppSidebar({ currentMonth, settings }: { currentMonth?: string; settings?: Settings }) {
  return (
    <aside className="sidebar" aria-label="主导航">
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true">A</div>
        <div>
          <p className="brand-name">Aplena</p>
          <p className="brand-caption">Financial Capacity</p>
        </div>
      </div>
      <nav className="navigation">
        {navigation.map((item) =>
          settings ? (
            <NavLink
              className={({ isActive }) => (isActive ? "nav-item nav-item-active" : "nav-item")}
              key={item.to}
              to={item.to}
            >
              <NavigationIcon name={item.icon} />
              {item.label}
            </NavLink>
          ) : (
            <span className="nav-item nav-item-placeholder" key={item.to}>
              <NavigationIcon name={item.icon} />
              {item.label}
            </span>
          ),
        )}
      </nav>
      <div className="sidebar-context">
        <span>当前执行月</span>
        <strong>{currentMonth ?? "正在载入"}</strong>
        <small>{settings ? currencyName(settings.base_currency) : "本地数据"}</small>
      </div>
    </aside>
  );
}

function NavigationIcon({ name }: { name: (typeof navigation)[number]["icon"] }) {
  const paths = {
    dashboard: "M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z",
    calendar: "M5 3v3m14-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z",
    history: "M4 12a8 8 0 1 0 2.34-5.66L4 8m0-5v5h5m3-1v5l3 2",
    target: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5m-5-1 9-8m0 0v5m0-5h-5",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5a7.6 7.6 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15 3.5h-4l-.4 2.6a8 8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 2.6h4l.4-2.6a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7.6 7.6 0 0 0 .1-1Z",
  } as const;
  return (
    <svg aria-hidden="true" className="nav-icon" fill="none" viewBox="0 0 24 24">
      <path d={paths[name]} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}
