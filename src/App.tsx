import { useEffect, useState } from "react";

import { getDomainContract, type DomainContract } from "./shared/api/domain";
import { describeError } from "./shared/formatting/errors";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; contract: DomainContract }
  | { status: "error"; message: string };

const navigation = ["概览", "月度计划", "长期计划", "分析", "设置"];

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    getDomainContract()
      .then((contract) => {
        if (active) {
          setLoadState({ status: "ready", contract });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadState({ status: "error", message: describeError(error) });
        }
      });

    return () => {
      active = false;
    };
  }, []);

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
          {navigation.map((item, index) => (
            <button
              className={index === 0 ? "nav-item nav-item-active" : "nav-item"}
              disabled={index !== 0}
              key={item}
              type="button"
            >
              <span className="nav-dot" aria-hidden="true" />
              {item}
              {index !== 0 && <span className="soon">后续阶段</span>}
            </button>
          ))}
        </nav>

        <p className="sidebar-note">本地优先 · 数据留在设备中</p>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">领域基础 · 第二阶段</p>
            <h1>计划你的财务承载力</h1>
          </div>
          <div className={`connection-chip connection-${loadState.status}`} role="status">
            <span aria-hidden="true" />
            {loadState.status === "loading" && "正在连接领域内核"}
            {loadState.status === "ready" && "领域内核已连接"}
            {loadState.status === "error" && "领域内核连接失败"}
          </div>
        </header>

        <section className="hero-card" aria-labelledby="foundation-heading">
          <div className="hero-copy">
            <p className="section-label">Aplena 不是逐笔记账工具</p>
            <h2 id="foundation-heading">先建立可靠的计算基础，再承载真实计划。</h2>
            <p>
              当前版本已经接通 Rust 领域层。金额精度、月份边界、支付确认与按月均摊都由同一套规则计算。
            </p>
          </div>
          <div className="month-tile" aria-label="示意月份">
            <span>目标月份</span>
            <strong>尚未设置</strong>
            <small>数据存储将在下一阶段接入</small>
          </div>
        </section>

        {loadState.status === "loading" && (
          <section className="state-card" aria-live="polite">
            <div className="loading-line" />
            <div className="loading-line loading-line-short" />
          </section>
        )}

        {loadState.status === "error" && (
          <section className="state-card error-card" aria-live="assertive">
            <p className="section-label">连接状态</p>
            <h2>本地领域服务暂不可用</h2>
            <p>{loadState.message}</p>
          </section>
        )}

        {loadState.status === "ready" && (
          <section className="foundation-grid" aria-label="领域规则概览">
            <article className="foundation-card foundation-card-wide">
              <div className="card-heading">
                <div>
                  <p className="section-label">计划分类</p>
                  <h2>五类财务计划</h2>
                </div>
                <span className="metric-number">{loadState.contract.categories.length}</span>
              </div>
              <div className="tag-list">
                {loadState.contract.categories.map((category) => (
                  <span className="tag" key={category.code}>
                    {category.label}
                  </span>
                ))}
              </div>
            </article>

            <article className="foundation-card">
              <p className="section-label">确认模式</p>
              <h2>录入时自由选择</h2>
              <ul className="mode-list">
                {loadState.contract.recognition_modes.map((mode) => (
                  <li key={mode.code}>
                    <span aria-hidden="true" />
                    {mode.label}
                  </li>
                ))}
              </ul>
            </article>

            <article className="foundation-card precision-card">
              <p className="section-label">计算精度</p>
              <h2>确定性十进制</h2>
              <dl>
                <div>
                  <dt>金额</dt>
                  <dd>{loadState.contract.amount_decimal_places} 位小数</dd>
                </div>
                <div>
                  <dt>汇率</dt>
                  <dd>{loadState.contract.exchange_rate_decimal_places} 位小数</dd>
                </div>
              </dl>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}
