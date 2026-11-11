/**
 * surfcore-core —— 浏览器半边：DSH 设置里的「SurfCore · 核心」栏目。
 *
 * 自包含经典脚本：由 window.__ModuleLoader__.load({ id, factory }) 包装，
 * factory 内只有作用域，不能 import 相对文件；公共 UI 控件已内联在下面。
 * 数据流：本组件 ⇄ /dsh-surfcore-core/api/*（同源 fetch）⇄ 本插件宿主半边。
 */
window.__ModuleLoader__.load({
  id: "surfcore-core",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      createElement: h,
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState,
    } = React;

    const API = "/dsh-surfcore-core/api";
    const CSS_TAG = "surfcore-core/console.css";

    // ── 通用：进度条 ──
  function ProgressBar({ pct = 0, phase = "", err = "", indeterminate = false, style = {} }) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    return h("div", { style: { marginTop: "8px", ...style } },
      h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.82, marginBottom: "4px" } },
        h("span", null, phase || "安装中"),
        h("span", null, indeterminate ? "…" : `${v}%`)),
      h("div", { className: "qbw-progress" + (indeterminate ? " indet" : "") }, h("i", { style: { width: `${Math.max(2, v)}%` } })),
      err ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, err) : null);
  }

    // ── 通用：原生目录/文件选择（宿主弹框） ──
  async function browseNative(mode = "dir", title = "") {
    const q = `mode=${mode === "file" ? "file" : "dir"}&title=${encodeURIComponent(title)}`;
    const res = await fetch(`${API}/browse?${q}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(180000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return data;
  }

    // ── 通用：样式（每个包一份，注入 <head>） ──
    const CSS = `
.qbw-app{max-width:1020px;margin:0 auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:rgba(127,127,127,.04);box-shadow:0 10px 30px rgba(0,0,0,.12);overflow:hidden}
.qbw-head{padding:18px 20px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(255,122,162,.08))}
.qbw-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0 0 4px}
.qbw-title{margin:0;font-size:19px;font-weight:600;line-height:28px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-sub{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.qbw-dots{display:inline-flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.qbw-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.10);padding:2px 8px;border-radius:999px}
.qbw-dot i{width:7px;height:7px;border-radius:50%;background:#8a8f98;display:inline-block}
.qbw-dot.ok i{background:#2fbf71}.qbw-dot.warn i{background:#ffb020}.qbw-dot.bad i{background:#ff5c5c}
.qbw-tabs{display:flex;gap:2px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto;background:rgba(127,127,127,.025)}
.qbw-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:8px 10px 9px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;border-radius:6px 6px 0 0}
.qbw-tab:hover{background:rgba(127,127,127,.08);color:var(--dsw-alias-label-primary)}
.qbw-tab.on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.qbw-body{padding:16px 20px 8px;max-height:min(68vh,760px);overflow:auto}
.qbw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
.qbw-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 13px;background:rgba(127,127,127,.03)}
.qbw-card h4{margin:0 0 6px;font-size:13px;font-weight:600}
.qbw-card p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px}
.qbw-kv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px}
.qbw-kv:last-child{border-bottom:none}
.qbw-kv span:first-child{color:var(--dsw-alias-label-tertiary)}
.qbw-kv span:last-child{text-align:right;word-break:break-all}
.qbw-group{margin:16px 0 8px;font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-group small{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:11px}
.qbw-rows{display:flex;flex-direction:column}
.qbw-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 20px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.qbw-row:last-child{border-bottom:none}
.qbw-row>div:first-child{flex:1;min-width:190px}
.qbw-label{font-size:12.5px;line-height:19px}
.qbw-hint{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:11px;line-height:17px}
.qbw-input,.qbw-select,.qbw-textarea{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;min-height:28px;padding:3px 8px;min-width:180px;outline:none;font-family:inherit}
.qbw-input:focus-visible,.qbw-select:focus-visible,.qbw-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.qbw-input.wide,.qbw-textarea.wide{min-width:320px}
.qbw-textarea{width:100%;min-height:90px;resize:vertical;line-height:18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.qbw-textarea.card{min-height:360px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qbw-btn{background:#2f6fed;color:#fff;border:none;border-radius:6px;font-size:12.5px;min-height:29px;padding:0 12px;cursor:pointer;white-space:nowrap}
.qbw-progress{height:6px;background:rgba(255,255,255,.14);border-radius:99px;overflow:hidden}
.qbw-progress>i{display:block;height:100%;background:#2f6fed;border-radius:99px;transition:width .35s ease}
.qbw-progress.indet>i{width:35%!important;animation:qbw-indet 1.1s ease-in-out infinite}
@keyframes qbw-indet{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}
.qbw-btn:disabled{opacity:.5;cursor:default}
.qbw-btn:hover:not(:disabled){background:#2a63d4}
.qbw-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.qbw-btn3{background:transparent;border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.qbw-btn.danger{background:#e5484d}
.qbw-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.qbw-foot{position:sticky;bottom:0;background:rgba(127,127,127,.06);border-top:1px solid var(--dsw-alias-border-l2);padding:10px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.qbw-foot .spacer{flex:1}
.qbw-dirty{color:#ffb020;font-size:12px}
.qbw-ok{color:#2fbf71;font-size:12px}
.qbw-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.qbw-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:280px;overflow:auto;margin-top:10px}
.qbw-badge{display:inline-block;font-size:10.5px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}
.qbw-badge.ok{background:rgba(47,191,113,.16);color:#2fbf71}
.qbw-badge.warn{background:rgba(255,176,32,.16);color:#b97800}
.qbw-badge.bad{background:rgba(229,72,77,.14);color:#e5484d}
.qbw-list{display:flex;flex-direction:column;gap:6px}
.qbw-item{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 10px;display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.qbw-item>div:first-child{flex:1;min-width:220px}
.qbw-table{width:100%;border-collapse:collapse;font-size:12px}
.qbw-table th,.qbw-table td{text-align:left;padding:6px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2);vertical-align:top}
.qbw-table th{color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11px}
.qbw-pill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 9px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.qbw-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.qbw-chip{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:11.5px;line-height:18px;background:transparent;color:var(--dsw-alias-label-secondary)}
.qbw-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.qbw-chip.on{border-color:var(--dsw-alias-brand-primary);background:rgba(31,111,235,.14);color:var(--dsw-alias-label-primary)}
.qbw-warnbox{border:1px solid rgba(255,176,32,.35);background:rgba(255,176,32,.08);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-infobox{border:1px solid rgba(31,111,235,.28);background:rgba(31,111,235,.06);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-dangerbox{border:1px solid rgba(229,72,77,.30);background:rgba(229,72,77,.06);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-admin{border:1px solid rgba(31,111,235,.45);border-radius:12px;padding:12px 14px;margin:0 0 12px;background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(255,122,162,.07))}
.qbw-admin-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
.qbw-admin-title{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:10px}
.qbw-admin-field{display:flex;flex-direction:column;gap:4px;font-size:12px}
.qbw-admin-field small{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.qbw-admin-field .qbw-input{min-width:0;width:100%}
.qbw-admin-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:.5px dashed var(--dsw-alias-border-l2)}
.qbw-admin-check{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer}
.qbw-alias{border:1px solid rgba(255,122,162,.45);background:rgba(255,122,162,.07);border-radius:10px;padding:10px 12px;margin:0 0 10px}
.qbw-alias .qbw-input{width:100%;min-width:0;margin-top:6px}
.qbw-alias-title{font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-switch{width:16px;height:16px;accent-color:#2f6fed;margin-top:2px}
.qbw-search{display:flex;gap:8px;align-items:center;margin:4px 0 10px;flex-wrap:wrap}
.qbw-search .qbw-input{flex:1;min-width:220px}
.qbw-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:760px){.qbw-cols{grid-template-columns:1fr}.qbw-body{padding:12px}.qbw-foot{padding:8px 12px}.qbw-app{border-radius:0;border-left:none;border-right:none}}
.qbw-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:rgba(127,127,127,.10);border-radius:4px;padding:1px 5px}
.qbw-scroll{max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;background:rgba(127,127,127,.03)}
.qbw-scroll pre{margin:0;white-space:pre-wrap;font-size:11.5px;line-height:17px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qbw-meter{height:9px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;margin:8px 0 6px}
.qbw-meter>i{display:block;height:100%;border-radius:inherit;background:#2fbf71;transition:width .3s ease}
.qbw-meter.warn>i{background:#ffb020}
.qbw-meter.bad>i{background:#e5484d}
.qbw-meter-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:12px}
.qbw-meter-head b{font-size:15px}
.qbw-rec{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;margin:6px 0;display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.qbw-rec>div:first-child{flex:1;min-width:260px}
.qbw-rec-title{font-size:12.5px;font-weight:600;line-height:18px}
.qbw-rec-text{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:17px;margin-top:2px;word-break:break-word}
.qbw-rec-actions{display:flex;gap:6px;flex-wrap:wrap}
.qbw-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 7px;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-right:5px}
.qbw-chip.on{background:rgba(47,191,113,.14);border-color:rgba(47,191,113,.4);color:#2fbf71}
.qbw-chip.warn{background:rgba(255,176,32,.14);border-color:rgba(255,176,32,.4);color:#b97800}
.qbw-chip.bad{background:rgba(229,72,77,.12);border-color:rgba(229,72,77,.4);color:#e5484d}
.qbw-modal-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:18px}
.qbw-modal{width:100%;max-width:470px;background:#1c1f24;color:#f2f5f7;border:1px solid #3a3f46;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.5);padding:18px 18px 14px}
.qbw-modal h3{margin:0 0 8px;font-size:16px;line-height:24px;display:flex;align-items:center;gap:8px}
.qbw-modal p{margin:0 0 10px;font-size:12.5px;line-height:19px;color:#c3c9d1}
.qbw-modal .qbw-hint{color:#9aa3ad}
.qbw-modal .qbw-chip{background:rgba(255,255,255,.12);color:#f2f5f7}
.qbw-modal .qbw-actions{margin-top:14px}
/* 弹窗内所有文字强制浅色：浅色主题下主题变量是深字，会和深色卡片糊在一起 */
.qbw-modal h3,.qbw-modal p,.qbw-modal label,.qbw-modal div,.qbw-modal span,.qbw-modal strong,.qbw-modal li{color:#f2f5f7}
.qbw-modal .qbw-hint{color:#9aa3ad}
.qbw-modal input.qbw-input{background:rgba(255,255,255,.08);color:#f2f5f7;border:1px solid #3a3f46}
.qbw-modal input[type=checkbox]{accent-color:#2f6fed}
/* ── Token 额度页 ─────────────────────────────────────────────── */
.qbw-budget-summary{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;border:1px solid rgba(31,111,235,.28);background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(255,122,162,.06));border-radius:12px;padding:12px 14px;margin:0 0 12px}
.qbw-budget-summary .qbw-kicker{margin-bottom:2px}
.qbw-budget-big{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:2px 0 3px}
.qbw-budget-big b{font-size:23px;line-height:30px;font-weight:700}
.qbw-budget-big span{font-size:13px;color:var(--dsw-alias-label-secondary)}
.qbw-budget-status{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:420px}
.qbw-budget-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.qbw-budget-card{padding:11px 12px}
.qbw-budget-card.total{grid-column:1/-1;order:-1;border-color:rgba(31,111,235,.35);background:linear-gradient(135deg,rgba(31,111,235,.05),rgba(127,127,127,.02))}
.qbw-budget-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:7px}
.qbw-budget-head h4{margin:0 0 3px}
.qbw-budget-head p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;max-width:440px}
.qbw-budget-today{display:flex;flex-direction:column;align-items:flex-end;gap:1px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.qbw-budget-today b{font-size:17px;line-height:22px;color:var(--dsw-alias-label-primary)}
.qbw-budget-lines{display:flex;flex-direction:column;gap:7px}
.qbw-budget-line{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.qbw-budget-field{display:flex;flex-direction:column;gap:3px;font-size:11.5px;min-width:170px;flex:1}
.qbw-budget-field>span{color:var(--dsw-alias-label-tertiary);font-size:11px}
.qbw-budget-field .qbw-input{min-width:150px;width:100%}
.qbw-budget-field small{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.qbw-budget-meters{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:7px}
.qbw-budget-meter-empty{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);padding:5px 0}
.qbw-budget-meter .qbw-meter-head{font-size:11px}
.qbw-budget-meter .qbw-meter-head b{font-size:12px}
.qbw-budget-extra{margin-top:9px;padding-top:8px;border-top:.5px dashed var(--dsw-alias-border-l2)}
.qbw-budget-quick{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.qbw-budget-note{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.qbw-budget-note .qbw-hint{max-width:760px;line-height:18px}
.qbw-budget-note .qbw-btn{flex:0 0 auto}
@media(max-width:860px){.qbw-budget-grid{grid-template-columns:1fr}.qbw-budget-meters{grid-template-columns:1fr}}
`;

    // ── 通用：深拷贝 ──
    const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

    // ── 通用：按路径读 ──
    const getPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
    // 路径既接受 ["night","windows"]，也接受 "night.windows"。
    // 2026-10-24 踩坑：WindowsEditor 传的是字符串，旧 setPath 按字符下标遍历，
    // 生成了 n.i.g.h.t... 这样的垃圾嵌套键——界面看起来"改了但没保存"，
    // 表现就是添加/删除窗口、改时间全部弹回原值。这里统一归一化，避免同类事故。

    // ── 通用：路径归一化（数组或 "a.b.c" 都接受） ──
    const pathKeys = (path) => (Array.isArray(path) ? path : String(path ?? "").split(".")).filter((key) => key !== "");

    // ── 通用：按路径写 ──
    const setPath = (obj, path, value) => {
      const keys = pathKeys(path);
      if (!keys.length) return;
      let cur = obj;
      for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i];
        if (cur[key] == null || typeof cur[key] !== "object" || Array.isArray(cur[key])) cur[key] = {};
        cur = cur[key];
      }
      cur[keys[keys.length - 1]] = value;
    };

    // ── 通用：字段路径简写 ──
    const p = (str) => str.split(".");

    // ── 通用：配置键 → 人读标签 ──
    const labelize = (str) =>
      String(str)
        .replace(/\./g, " · ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ");

    // ── 通用：同源 API 客户端（失败抛 Error 带 code/hint/missing） ──
    async function api(path, options = {}) {
      const res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.headers ?? {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        const error = new Error(data?.error || `HTTP ${res.status}`);
        error.status = res.status;
        error.code = data?.code || '';
        error.hint = data?.hint || '';
        error.missing = Array.isArray(data?.missing) ? data.missing : [];
        error.data = data;
        throw error;
      }
      return data;
    }

    // ── 通用：样式注入 ──
    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === "undefined") return;
        if (!document.getElementById(CSS_TAG)) {
          const el = document.createElement("style");
          el.id = CSS_TAG;
          el.textContent = CSS;
          document.head.appendChild(el);
        }
      }, []);
    }

    // ── 通用：时间格式化 ──
    function fmtTime(iso) {
      if (!iso) return "—";
      try { return new Date(iso).toLocaleString("zh-CN", { hour12: false }); } catch { return iso; }
    }

    // ── 通用：字节格式化 ──
    function fmtBytes(n) {
      const v = Number(n) || 0;
      if (v > 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
      if (v > 1024) return `${(v / 1024).toFixed(1)} KB`;
      return `${v} B`;
    }

    // ── 通用控件：Row ──
    function Row({ label, hint, children, badge }) {
      return h("div", { className: "qbw-row" },
        h("div", null,
          h("div", { className: "qbw-label" }, label, badge ? h("span", { className: "qbw-badge" }, badge) : null),
          hint ? h("div", { className: "qbw-hint" }, hint) : null),
        children);
    }

    // 逗号分隔的列表输入框（2026-10-23 修）：
    // 以前每次按键都把 text 按逗号切开再 join 回去，逗号还没输进去就被吞掉 ✗。
    // 现在本地保存原始文本，输入过程中允许逗号；解析后的数组同步给父组件，失焦时再规范化。

    // ── 通用控件：字符串列表输入 ──
    function ListInput({ value, onChange, readOnly, placeholder, className }) {
      const list = Array.isArray(value) ? value.map(String) : [];
      const joined = list.join("，");
      const [text, setText] = useState(joined);
      const focused = useRef(false);
      const last = useRef(joined);
      useEffect(() => {
        if (!focused.current && joined !== last.current) {
          last.current = joined;
          setText(joined);
        }
      }, [joined]);
      const parse = (raw) => [...new Set(String(raw ?? "").split(/[,，]/).map((s) => s.trim()).filter(Boolean))];
      const commit = (nextText) => {
        const next = parse(nextText);
        last.current = next.join("，");
        onChange(next);
      };
      return h("input", {
        className,
        value: text,
        readOnly,
        placeholder,
        autoComplete: "off",
        onFocus: () => { focused.current = true; },
        onChange: (e) => { setText(e.target.value); commit(e.target.value); },
        onBlur: () => {
          focused.current = false;
          const next = parse(text);
          last.current = next.join("，");
          setText(next.join("，"));
          onChange(next);
        },
      });
    }

    // ── 通用控件：Field ──
    function Field({ f, value, onChange, readOnly }) {
      const common = { className: "qbw-input" + (f.wide ? " wide" : "") };
      let control;
      if (f.kind === "switch") {
        control = h("input", { className: "qbw-switch", type: "checkbox", checked: !!value, disabled: readOnly, onChange: (e) => onChange(e.target.checked) });
      } else if (f.kind === "number") {
        control = h("input", { ...common, type: "number", step: f.step ?? "any", min: f.min, max: f.max, value: value ?? "", readOnly, onChange: (e) => onChange(e.target.value === "" ? undefined : Number(e.target.value)) });
      } else if (f.kind === "select") {
        control = h("select", { className: "qbw-select", value: value ?? "", disabled: readOnly, onChange: (e) => onChange(e.target.value) },
          (f.options ?? []).map((opt) => {
            const [v, l] = Array.isArray(opt) ? opt : [opt, opt];
            return h("option", { key: v, value: v }, l);
          }));
      } else if (f.kind === "list") {
        control = h(ListInput, {
          className: common.className,
          value,
          readOnly,
          placeholder: f.placeholder ?? "逗号分隔",
          onChange,
        });
      } else if (f.kind === "times") {
        control = h(ListInput, {
          className: common.className,
          value,
          readOnly,
          placeholder: "07:00，11:00",
          onChange,
        });
      } else if (f.kind === "textarea") {
        control = h("textarea", { className: "qbw-textarea" + (f.wide ? " wide" : ""), value: value ?? "", readOnly, style: f.rows ? { minHeight: `${f.rows * 18}px` } : undefined, onChange: (e) => onChange(e.target.value) });
      } else if (f.kind === "json") {
        control = h(JsonCell, { value, onChange, readOnly, placeholder: f.placeholder });
      } else if (f.kind === "password") {
        control = h("input", { ...common, type: "password", value: value ?? "", readOnly, placeholder: f.placeholder ?? "已设置（保持 ******** 不变）", onChange: (e) => onChange(e.target.value) });
      } else {
        control = h("input", { ...common, value: value ?? "", readOnly, placeholder: f.placeholder, onChange: (e) => onChange(e.target.value) });
        if (f.browse && !readOnly) {
          control = h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
            control,
            h("button", {
              type: "button",
              className: "qbw-btn2",
              onClick: async () => {
                const r = await browseNative(f.browse, f.label || "选择路径").catch((e) => ({ ok: false, error: e.message }));
                if (r.ok && r.path) onChange(String(r.path));
                else if (!r.cancelled) (window.__surfcoreToast || console.warn)(r.error || "打不开选择框，请手动填写");
              },
            }, "浏览…"));
        }
      }
      return h(Row, { label: f.label, hint: f.hint, badge: f.badge }, control);
    }

    // 高级设置里的参数组：QQ / B站 共用同一套渲染，避免两份 map 慢慢漂移。

    // ── 通用控件：字段分组 ──
    function FieldGroups({ groups, cfg, set, readOnly, groupExtra }) {
      return h("div", null, groups.map((g) => h(Section, {
        key: g.group,
        title: g.group,
        note: g.note,
        collapsible: false,
      },
        typeof groupExtra === "function" ? groupExtra(g) : null,
        g.fields.map((f) => h(Field, {
          key: f.path.join("."),
          f,
          value: getPath(cfg, f.path),
          readOnly: typeof readOnly === "function" ? readOnly(f) : f.readOnly,
          onChange: (v) => set(f.path, v),
        })))));
    }

    // ── 通用控件：JSON 单元格 ──
    function JsonCell({ value, onChange, readOnly, placeholder }) {
      const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
      const [err, setErr] = useState("");
      useEffect(() => { setText(JSON.stringify(value ?? null, null, 2)); setErr(""); }, [JSON.stringify(value ?? null)]);
      return h("div", { style: { minWidth: "260px", flex: 1 } },
        h("textarea", {
          className: "qbw-textarea", style: { minHeight: "90px" },
          value: text, readOnly, placeholder,
          onChange: (e) => {
            const next = e.target.value;
            setText(next);
            try { onChange(JSON.parse(next)); setErr(""); } catch (error) { setErr("JSON 语法错误：" + error.message); }
          },
        }),
        err ? h("div", { className: "qbw-err" }, err) : null);
    }

    // ── 通用控件：折叠分组 ──
    function Section({ title, note, children, defaultOpen = false, collapsible = true }) {
      const [open, setOpen] = useState(defaultOpen || !collapsible);
      return h("div", null,
        h("div", {
          className: "qbw-group",
          style: { cursor: collapsible ? "pointer" : "default" },
          onClick: collapsible ? () => setOpen((v) => !v) : undefined,
        },
          collapsible ? h("span", { style: { width: "14px", display: "inline-block" } }, open ? "▾" : "▸") : null,
          title,
          note ? h("small", null, note) : null),
        open || !collapsible ? h("div", { className: "qbw-rows" }, children) : null);
    }

    // 每个标签页只留最关键的几张卡；其余统一收进这个抽屉。
    // 抽屉里的分组用 <Section collapsible={false}>，避免“折叠套折叠”点两次。

    // ── 通用控件：高级设置折叠 ──
    function AdvancedSettings({ children, note = "不常用的参数都在这里；展开后同样可改，改完统一点底部保存" }) {
      return h(Section, { title: "高级设置", note, defaultOpen: false }, children);
    }

    // ── 通用控件：状态点 ──
    function StatusDot({ ok, warn, children }) {
      return h("span", { className: "qbw-dot " + (ok ? "ok" : warn ? "warn" : "bad") }, h("i"), children);
    }

    // ── 通用控件：按钮 ──
    function Btn({ children, onClick, disabled, kind = "", title, type = "button" }) {
      return h("button", { type, title, className: `qbw-btn ${kind}`.trim(), onClick, disabled }, children);
    }

    // ── 管理员卡片（QQ / B站 两个标签页共用同一份身份）──────────────────────
    // 为什么放在最上面：用户要求管理员的 QQ 号与 B站 UID 默认是同一个人，
    // 这是比「鱼群保护 / 作息」更基础的身份设置。两个标签页改的是同一个
    // unified.admin，保存时由宿主投影到 qq.ownerQQ 与 bili.owner.mid。
    // 主人特权操作审计：只读桥接写好的 state/owner-audit.jsonl。

    // ── 通用：字段描述器 ──
    const F = (path, label, hint, kind = "text", extra = {}) => ({ path: p(path), label, hint, kind, ...extra });
    // 原生选择框：浏览器拿不到绝对路径，只能让宿主进程弹 Windows 对话框。

    // ── 通用：「浏览…」按钮 ──
    const Browse = ({ mode = "dir", onPick, title, label = "浏览…" }) => h(Btn, {
      kind: "qbw-btn2",
      onClick: async () => {
        try {
          const r = await browseNative(mode, title || (mode === "file" ? "选择文件" : "选择目录"));
          if (r.ok && r.path) onPick(String(r.path));
          else if (!r.cancelled) (window.__surfcoreToast || console.warn)(r.error || "打不开选择框，请手动填路径");
        } catch (e) { (window.__surfcoreToast || console.warn)(e.message); }
      },
    }, label);

    // ── 通用：序号符号表 ──
    const NUMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];

    // ── 通用：数组窗口编辑器 ──
    function WindowsEditor({ value, onChange }) {
      const list = Array.isArray(value) ? value : [];
      const upd = (i, patch) => onChange(list.map((w, j) => (j === i ? { ...w, ...patch } : w)));
      const del = (i) => onChange(list.filter((_, j) => j !== i));
      const add = () => onChange([...list, { start: "20:00", end: "22:00", wakes: 1 }]);
      return h("div", null,
        list.length === 0 ? h("div", { className: "qbw-warnbox" }, "没有窗口 = 永远不醒；至少加一个。") : null,
        h("div", { className: "qbw-list" }, list.map((w, i) => h("div", { className: "qbw-item", key: i },
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            h("span", { className: "qbw-hint", style: { minWidth: "18px" } }, NUMS[i] ?? String(i + 1)),
            h("input", { className: "qbw-input", style: { width: "90px", minWidth: "90px" }, value: w.start ?? "", onChange: (e) => upd(i, { start: e.target.value }) }),
            h("span", { className: "qbw-hint" }, "–"),
            h("input", { className: "qbw-input", style: { width: "90px", minWidth: "90px" }, value: w.end ?? "", onChange: (e) => upd(i, { end: e.target.value }) }),
            h("span", { className: "qbw-hint" }, "醒来"),
            h("input", { className: "qbw-input", style: { width: "64px", minWidth: "64px" }, type: "number", min: 1, max: 12, value: w.wakes ?? 1, onChange: (e) => upd(i, { wakes: Number(e.target.value) || 1 }) }),
            h("span", { className: "qbw-hint" }, "次")),
          h(Btn, { kind: "qbw-btn2", disabled: list.length <= 1, onClick: () => del(i), title: list.length <= 1 ? "至少保留一个窗口；要换时间直接改" : "删掉这个窗口" }, "×")))),
        h("div", { style: { marginTop: "8px" } },
          h(Btn, { kind: "qbw-btn2", onClick: add }, "+ 添加窗口"),
          h("span", { className: "qbw-hint", style: { marginLeft: "8px" } }, "至少保留一个窗口；最后一个的 × 会置灰，想换时段直接改时间")));
    }

    // ── 通用：任意配置扁平化 ──
    function flatten(value, prefix = []) {
      const out = [];
      if (value == null || typeof value !== "object") {
        out.push({ path: prefix, value });
        return out;
      }
      if (Array.isArray(value)) {
        out.push({ path: prefix, value });
        return out;
      }
      for (const [key, item] of Object.entries(value)) {
        out.push(...flatten(item, [...prefix, key]));
      }
      return out;
    }

    // ── 通用：类型推断 ──
    function inferKind(value) {
      if (typeof value === "boolean") return "switch";
      if (typeof value === "number") return "number";
      if (Array.isArray(value)) return value.every((v) => typeof v === "string") ? "list" : "json";
      if (value && typeof value === "object") return "json";
      if (typeof value === "string" && value.length > 160) return "textarea";
      return "text";
    }

    // ── 通用：配置 → 字段列表 ──
    function flattenFields(cfg) {
      return flatten(cfg).filter((item) => item.path.length > 0).map((item) => ({
        path: item.path,
        label: labelize(item.path.join(".")),
        kind: inferKind(item.value),
        value: item.value,
      }));
    }

    // ── 通用：错误报告弹窗 ──
    function ErrorModal({ title, message, hint, tried, actions = [], disabled, onClose }) {
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h("div", { className: "qbw-modal" },
          h("h3", null, "⚠️ " + (title || "操作失败")),
          message ? h("p", null, message) : null,
          hint ? h("p", { className: "qbw-hint" }, hint) : null,
          (tried || []).length
            ? h("details", { style: { marginTop: "4px" } },
              h("summary", { style: { cursor: "pointer", fontSize: "12px", opacity: 0.8 } }, `试过 ${tried.length} 个位置（点开看）`),
              h("ul", { style: { margin: "6px 0 0", paddingLeft: "18px", fontSize: "11.5px", lineHeight: "17px", wordBreak: "break-all" } },
                tried.map((p, i) => h("li", { key: i }, p))))
            : null,
          h("div", { className: "qbw-actions" },
            ...(actions || []).map((a) => h(Btn, {
              key: a.label, ...(a.kind ? { kind: a.kind } : {}), disabled: disabled || a.disabled, onClick: a.onClick,
            }, a.label)),
            h(Btn, { kind: "qbw-btn2", onClick: onClose }, "关闭"))));
    }

    // ── 管理员身份（唯一编辑入口）──────────────────────────────────────────
    // 为什么放在最上面：用户要求管理员的 QQ 号与 B站 UID 默认是同一个人，
    // 这是比「鱼群保护 / 作息」更基础的身份设置。这里改的是统一配置的 unified.admin，
    // 保存时由宿主投影到 qq.ownerQQ（+ qq.admin）与 bili.owner.mid/name（两个文件各自加锁）。
    // 其它拆分包只读展示，不再提供编辑入口（见 PACKAGE-SPEC §2）。
    function AdminCard({ admin, onChange, qqPrivate = [], qqAllowAll = false }) {
      const value = admin && typeof admin === "object" ? admin : {};
      const set = (key, next) => onChange({ ...value, [key]: next });
      const configured = Boolean(value.qq || value.biliMid || value.biliName);
      const aligned = Boolean(value.qq && value.biliMid);
      const privateList = (Array.isArray(qqPrivate) ? qqPrivate : []).map(String);
      const blockedPrivate = Boolean(value.qq) && !qqAllowAll && !privateList.includes(String(value.qq));
      const badge = aligned ? "ok" : configured ? "warn" : "bad";
      const badgeText = aligned ? "同一个人 ✓" : configured ? "只填了一边" : "未设置";
      const digits = (next) => String(next ?? "").replace(/[^\d]/g, "");
      return h("div", { className: "qbw-admin" },
        h("div", { className: "qbw-admin-head" },
          h("div", null,
            h("div", { className: "qbw-admin-title" },
              "管理员（QQ ⇄ B站 · 同一个人）",
              h("span", { className: "qbw-badge " + badge }, badgeText),
              h("span", { className: "qbw-pill" }, "对 TA 温柔 · 不回嘴")),
            h("div", { className: "qbw-hint" },
              "默认就是同一个人：这里填一次，QQ 的 ownerQQ 和 B站 的 owner.mid 会同时写成这两个号（QQ 侧保存后需重启桥接，B站 下一轮生效）。"))),
        h("div", { className: "qbw-admin-grid" },
          h("label", { className: "qbw-admin-field" },
            h("span", null, "管理员 QQ"),
            h("input", {
              className: "qbw-input", inputMode: "numeric", placeholder: "例如 3287064288",
              value: value.qq ?? "",
              onChange: (e) => set("qq", digits(e.target.value)),
            }),
            h("small", null, "审批、管理命令、封闭模式都用这个 QQ")),
          h("label", { className: "qbw-admin-field" },
            h("span", null, "管理员 B站 UID（mid）"),
            h("input", {
              className: "qbw-input", inputMode: "numeric", placeholder: "例如 37634003",
              value: value.biliMid ?? "",
              onChange: (e) => set("biliMid", digits(e.target.value)),
            }),
            h("small", null, "B站 评论区 / 私信 / 直播间认主用这个 mid")),
          h("label", { className: "qbw-admin-field" },
            h("span", null, "怎么称呼 TA"),
            h("input", {
              className: "qbw-input", placeholder: "留空就用 B站 昵称",
              value: value.displayName ?? "",
              onChange: (e) => set("displayName", e.target.value),
            }),
            h("small", null, "人格卡和提示词里都用这个称呼")),
          h("label", { className: "qbw-admin-field" },
            h("span", null, "B站 昵称"),
            h("input", {
              className: "qbw-input", placeholder: "例如 你的B站昵称",
              value: value.biliName ?? "",
              onChange: (e) => set("biliName", e.target.value),
            }),
            h("small", null, "B站 提示词里用来认人"))),
        h("div", { className: "qbw-admin-foot" },
          h("label", { className: "qbw-admin-check" },
            h("input", {
              type: "checkbox", className: "qbw-switch",
              checked: value.gentle !== false,
              onChange: (e) => set("gentle", e.target.checked),
            }),
            h("span", null, "对管理员更温柔、绝不回嘴")),
          h("span", { className: "qbw-hint" }, "QQ 消息和 B站 回复都适用；关掉 = 只按人格卡。")),
        blockedPrivate
          ? h("div", { className: "qbw-warnbox" }, "⚠️ 管理员 QQ 不在私聊白名单 allow.private 里：私聊会被拦截（白名单为空时也没人放行）。到「SurfCore · QQ」栏目的白名单把 TA 加进去。")
          : null,
        configured && !aligned
          ? h("div", { className: "qbw-warnbox" }, "⚠️ 只填了一边：QQ 和 B站 要分别是同一个人的两个号，两边才都认得出。")
          : null,
        h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          "管理操作记录（主人特权审计）由「SurfCore · 记忆」栏目只读展示。"));
    }

    // ── 平台启动开关（2026-10-24 用户要求）──────────────────────────────────
    // 不是所有用户都想同时开 QQ 和 B站。唯一真相是统一配置的 platforms.start.{qq,bili}：
    // 本包负责写这个键；「真的启动/停止」由 surfcore-qq / surfcore-bili 读它执行。
    function PlatformStartCard({ platform, title, hint, starts, busy, onToggle }) {
      const enabled = starts?.[platform] !== false;
      return h("div", { className: "qbw-card" },
        h("h4", null, `${title} 启动`),
        h(Row, { label: "是否启动", hint }, h("input", {
          type: "checkbox",
          checked: enabled,
          disabled: !!busy,
          onChange: (e) => onToggle(platform, e.target.checked),
        })),
        h("div", { className: "qbw-hint" }, enabled
          ? `当前：开。DSH 启动时 ${title} 会随对应拆分包自动拉起，并纳入它的「一键启动」。`
          : `当前：关。${title} 不会被自动启动；正在运行的那一边由对应拆分包停掉。`));
    }

    // ── 身份标签页 ──────────────────────────────────────────────────────────
    function IdentityTab({ config, busy, setBusy, toast, reload }) {
      const savedAdmin = config?.unified?.admin ?? {};
      const [draft, setDraft] = useState(savedAdmin);
      useEffect(() => { setDraft(savedAdmin); }, [JSON.stringify(savedAdmin)]);
      const dirty = JSON.stringify(draft) !== JSON.stringify(savedAdmin);
      const qq = config?.qq ?? {};
      const qqPrivate = Array.isArray(qq?.allow?.private) ? qq.allow.private : [];
      const qqAllowAll = qq?.allowAllWhenEmpty === true;
      const starts = config?.unified?.platforms?.start ?? {};

      const saveAdmin = async () => {
        setBusy("admin");
        try {
          const r = await api("/admin", { method: "POST", body: { admin: draft } });
          const warnings = Array.isArray(r.warnings) ? r.warnings : [];
          toast(warnings.length ? `✓ 已保存；⚠️ ${warnings.join(" ")}` : "✓ 管理员身份已保存，并投影到 QQ / B站 配置");
          await reload();
        } catch (e) {
          toast(`✗ 保存失败：${e.message}`);
        } finally { setBusy(""); }
      };
      const togglePlatform = async (id, enabled) => {
        setBusy("platform-" + id);
        try {
          await api("/platforms", { method: "POST", body: { action: "start", id, enabled } });
          toast(enabled ? "✓ 已打开启动开关（由对应拆分包执行启动）" : "✓ 已关闭启动开关");
          await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "管理员身份是本插件的唯一编辑入口：保存后同时写入 QQ config.json 的 ownerQQ（+ 称呼）与 bili.config.json 的 owner（两个文件各自加配置锁）。其它栏目的管理员卡片只读。"),
        h(AdminCard, { admin: draft, onChange: setDraft, qqPrivate, qqAllowAll }),
        h("div", { className: "qbw-actions" },
          h(Btn, { onClick: saveAdmin, disabled: !!busy || !dirty }, busy === "admin" ? "保存中…" : (dirty ? "保存管理员身份" : "已保存")),
          h(Btn, { kind: "qbw-btn2", onClick: () => setDraft(savedAdmin), disabled: !!busy || !dirty }, "撤销改动")),
        h("div", { className: "qbw-group" }, "平台启动开关 ", h("small", null, "唯一真相：统一配置 platforms.start；启停动作由 qq / bili 包执行")),
        h("div", { className: "qbw-grid" },
          h(PlatformStartCard, { platform: "qq", title: "QQ", hint: "关掉 = DSH 启动时不自动拉起 QQ 桥接（桥接本身仍可由 QQ 栏目手动启动）", starts, busy, onToggle: togglePlatform }),
          h(PlatformStartCard, { platform: "bili", title: "B站", hint: "关掉 = DSH 启动时不自动起 B站 生物钟（仍然可以手动启动）", starts, busy, onToggle: togglePlatform })));
    }

    // ── 组件更新弹窗（旧 client.js:1218-1329 搬，接口指向本包 /updates）──────
    function UpdatesModal({ status, onClose, onDone, toast }) {
      const pending = Array.isArray(status?.pending) ? status.pending : [];
      // 远端只拿到提交号时显示「提交 abc1234」而不是 "vabc1234"（否则用户以为是乱码）
      const fmtV = (v) => {
        const t = String(v ?? "").trim();
        if (!t) return "?";
        return /^[0-9a-f]{7,40}$/i.test(t) ? `提交 ${t.slice(0, 7)}` : `v${t}`;
      };
      const [selected, setSelected] = useState(() => new Set(pending.map((item) => item.id)));
      const [never, setNever] = useState(false);
      const [working, setWorking] = useState(false);
      const toggle = (id) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      const applySelected = async () => {
        const ids = [...selected];
        if (!ids.length) return;
        setWorking(true);
        try {
          const r = await api("/updates", { method: "POST", body: { action: "apply", ids } });
          const failed = (r.results ?? []).filter((x) => !x.ok);
          const staged = (r.results ?? []).filter((x) => x.ok && x.staged);
          if (r.ok && staged.length) {
            // 延后应用：文件已下载到 staging，宿主退出后才覆盖（避免覆盖正在使用的模块导致崩溃）
            toast(`⏳ 已下载 ${staged.length} 个组件，退出并重新打开 DSH 后应用（尚未更新）`);
          } else if (r.ok) toast(`✓ 已更新 ${r.updated} 个组件${r.restartRequired ? "，请重启对应服务" : ""}`);
          else {
            const f = failed[0] ?? {};
            toast(`✗ 更新失败${f.code ? `（${f.code}）` : ""}：${f.reason ?? f.error ?? "原因不明"}${f.hint ? `；建议：${f.hint}` : ""}`);
          }
          onDone?.(r);
        } catch (e) { toast(`✗ 更新失败：${e.message}`); }
        finally { setWorking(false); }
      };
      const dismissThis = async () => {
        setWorking(true);
        try {
          await api("/updates", { method: "POST", body: { action: "dismiss" } });
          toast("✓ 本次更新不再提示（远端有新提交时会再提醒）");
        } catch (e) { toast(`✗ ${e.message}`); }
        finally { setWorking(false); onClose?.(); }
      };
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget && !working) onClose?.(); } },
        h("div", { className: "qbw-modal", style: { maxWidth: "600px", maxHeight: "82vh", display: "flex", flexDirection: "column" } },
          h("h3", { style: { flexShrink: 0 } }, pending.length > 1 ? `发现 ${pending.length} 个可用更新` : "发现可用更新"),
          h("div", { style: { flex: "1 1 auto", minHeight: 0, overflow: "auto", paddingRight: "2px" } },
            h("p", null, (() => {
              const withVer = pending.filter((x) => x.latestVersion);
              if (!withVer.length) return "git 安装做快进（--ff-only）；zip 安装会下载新包覆盖代码。两种都不会动 config.json 与记忆卡。";
              const parts = withVer.map((x) => `${x.name} v${x.installedVersion || "?"} → ${fmtV(x.latestVersion)}`);
              return `${parts.join("　")}；更新不会动 config.json 与记忆卡。`;
            })()),
            pending.length ? pending.map((item) => h("div", { key: item.id, style: { border: "1px solid rgba(127,127,127,.24)", borderRadius: "10px", padding: "10px 12px", margin: "0 0 8px" } },
              h("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontWeight: 600 } },
                h("input", { type: "checkbox", checked: selected.has(item.id), onChange: () => toggle(item.id), disabled: working }),
                item.name,
                h("span", { className: "qbw-chip", style: { marginLeft: "auto" } },
                  item.channel === "version"
                    ? `v${item.installedVersion} → ${fmtV(item.latestVersion)}`
                    : item.channel === "release"
                      ? `${item.installedVersion ? `v${item.installedVersion}` : "未安装"} → ${fmtV(item.latestVersion)}`
                      : (item.latestVersion
                        ? `v${item.installedVersion || "?"} → ${fmtV(item.latestVersion)}（${item.behind} 个提交）`
                        : `${item.behind} 个提交（到 ${String(item.remote || "").slice(0, 7)}）`))),
              h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
                `${item.dir} · ${item.branch ?? ""}${item.dirty ? ` · ⚠️ 本地有 ${item.dirty} 处改动` : ""}${item.ahead ? ` · ⚠️ 本地领先 ${item.ahead}` : ""} · ${item.channel === "release" ? "版本清单" : item.channel === "version" ? "提交追踪" : "git 仓库"}`),
              item.blocked ? h("div", { className: "qbw-hint", style: { color: "#c0392b" } }, `不能自动更新：${item.blocked}`) : null,
              item.blocked ? h("div", { className: "qbw-hint" }, "处理办法：本仓库有未提交改动时，先 commit/stash 再更新；或者直接用新版本的 zip 覆盖安装。") : null,
              (item.changelog ?? []).length ? h("ul", { style: { margin: "6px 0 0 18px", padding: 0, fontSize: "11.5px", lineHeight: "18px", opacity: 0.82 } },
                item.changelog.slice(0, 8).map((line, index) => h("li", { key: index }, line))) : null,
              (item.changelog ?? []).length > 8 ? h("div", { className: "qbw-hint" }, `…另有 ${item.changelog.length - 8} 条`) : null)) : h("p", null, "当前没有可用更新。"),
            h("label", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" } },
              h("input", { type: "checkbox", checked: never, onChange: (e) => setNever(e.target.checked), disabled: working }),
              h("span", { className: "qbw-hint" }, "不再提示本次更新（只对这次的远端版本生效；有更新提交时会重新提醒）")),
            (() => {
              const la = status?.lastApply;
              if (!la || la.status !== "failed") return null;
              return h("div", {
                className: "qbw-err",
                style: { marginTop: "6px", padding: "8px 10px", borderRadius: "8px", background: "rgba(192,57,43,.12)" },
              },
                h("div", { style: { fontWeight: 600 } }, `更新被阻止（${la.code || "failed"}）`),
                (la.mismatchCount || la.missingCount)
                  ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } },
                    `清单不符 ${la.mismatchCount ?? 0} 个 / 缺失 ${la.missingCount ?? 0} 个`)
                  : null,
                h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, la.reason || "原因不明"),
                la.hint ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, `建议：${la.hint}`) : null);
            })(),
            working ? h(ProgressBar, { phase: "正在下载/应用更新…", indeterminate: true }) : null),
          h("div", { className: "qbw-actions", style: { flexShrink: 0, paddingTop: "10px" } },
            h(Btn, { kind: "qbw-btn2", onClick: () => (never ? dismissThis() : onClose?.()), disabled: working },
              never ? "不再提示本次" : "稍后"),
            h(Btn, {
              onClick: applySelected,
              disabled: working || !selected.size || status?.lastApply?.deterministic === true,
            },
              status?.lastApply?.deterministic === true
                ? "此版本无法自动更新（请手动下载）"
                : (working ? "更新中…" : `立即更新（${selected.size}）`)))));
    }

    // ── 概览（核心）────────────────────────────────────────────────────────
    // 改造自旧 OverviewTab：保留 QQ/B站 只读状态、扩展/更新/备份/版本卡；
    // 「一键启动 / 启动 QQ / 启动 B站」删除（由 qq / bili 包各自提供）。
    function OverviewTab({ overview, config, reload, busy, setBusy, toast, goTab }) {
      const qq = overview?.qq ?? {};
      const bili = overview?.bili ?? {};
      const updatesData = overview?.updates ?? {};
      const platformStart = overview?.platformStart ?? {};
      const [updateOpen, setUpdateOpen] = useState(false);
      const [tokenDraft, setTokenDraft] = useState("");
      const [autoPrompted, setAutoPrompted] = useState(false);
      useEffect(() => {
        if (!autoPrompted && updatesData?.showPrompt) {
          setAutoPrompted(true);
          setUpdateOpen(true);
        }
      }, [updatesData?.showPrompt, autoPrompted]);

      const checkUpdates = async ({ openOnHit = true } = {}) => {
        setBusy("updates");
        try {
          const r = await api("/updates", { method: "POST", body: { action: "check" } });
          const n = r.pendingCount ?? 0;
          toast(n ? `发现 ${n} 个组件有更新` : "已是最新");
          if (n && openOnHit) setUpdateOpen(true);
          await reload();
          return r;
        } catch (e) {
          toast(`✗ 检查更新失败：${e.message}`);
          return null;
        } finally { setBusy(""); }
      };
      const saveGithubToken = async (clear = false) => {
        setBusy("token");
        try {
          const r = await api("/updates", { method: "POST", body: clear ? { action: "clear-token" } : { action: "set-token", token: tokenDraft.trim() } });
          if (!r.ok) throw new Error(r.error ?? "保存失败");
          toast(clear ? "✓ 已清除令牌（回到匿名 60 次/小时）" : "✓ 令牌已保存（检查更新改用账号额度 5000 次/小时）");
          setTokenDraft("");
          await reload();
        } catch (e) {
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally { setBusy(""); }
      };
      const backupNow = async () => {
        setBusy("backup");
        try {
          const r = await api("/diagnostics/fix", { method: "POST", body: { action: "backup" } });
          toast(`✓ 已备份 ${r.created?.length ?? 0} 个文件`);
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      const updatesBadge = (() => {
        const rows = updatesData.results ?? [];
        const bad = rows.filter((x) => !x.available);
        if (updatesData.pendingCount > 0) return h(StatusDot, { ok: false, warn: true }, `${updatesData.pendingCount} 个可更新`);
        if (bad.length) return h(StatusDot, { ok: false, warn: true }, `部分查不到（${bad[0].name}：${bad[0].reason || "网络/限流"}）`);
        return h(StatusDot, { ok: true }, "已是最新");
      })();

      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "这是拆分后的「核心」插件：只负责配置读写、管理员身份、扩展宿主、平台注册表、组件更新、备份、日志与原生浏览。",
          "QQ 与 B站 的启动 / 业务参数 / 运行态分别到「SurfCore · QQ」「SurfCore · B站」栏目。"),
        h("div", { className: "qbw-grid" },
          h("div", { className: "qbw-card" },
            h("h4", null, "核心 ", h(StatusDot, { ok: true }, "运行中")),
            h("div", { className: "qbw-kv" }, h("span", null, "版本"), h("span", null, `v${overview?.version ?? "—"}`)),
            h("div", { className: "qbw-kv" }, h("span", null, "隐私策略"), h("span", null, `v${overview?.privacyPolicyVersion ?? "?"}`)),
            h("div", { className: "qbw-kv" }, h("span", null, "统一配置"), h("span", null, overview?.files?.unified?.exists ? "已创建" : "默认值（未落盘）")),
            h("div", { className: "qbw-kv" }, h("span", null, "备份"), h("span", null, `${overview?.backups?.count ?? 0} 份`)),
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", onClick: reload, disabled: !!busy }, "刷新状态"),
              h(Btn, { kind: "qbw-btn3", onClick: backupNow, disabled: !!busy }, "立即备份配置"))),
          h("div", { className: "qbw-card" },
            h("h4", null, "QQ ", h(StatusDot, { ok: qq.running === true, warn: qq.running === null }, qq.running === true ? "桥接在跑" : qq.running === null ? "状态未知" : "桥接未运行")),
            h("div", { className: "qbw-kv" }, h("span", null, "模式"), h("span", null, overview?.mode?.effective ?? overview?.mode?.local ?? "—")),
            h("div", { className: "qbw-kv" }, h("span", null, "PID"), h("span", null, qq.pid ?? "—")),
            h("div", { className: "qbw-kv" }, h("span", null, "启动开关"), h("span", null, platformStart.qq !== false ? "开" : "关")),
            h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, "只读展示。启停 / 白名单 / SnowLuma 到「SurfCore · QQ」栏目。")),
          h("div", { className: "qbw-card" },
            h("h4", null, "B站 ", h(StatusDot, { ok: Boolean(bili.available), warn: !bili.available }, bili.available ? "配置已就绪" : "还没配置")),
            h("div", { className: "qbw-kv" }, h("span", null, "配置"), h("span", null, bili.configMtime ? fmtTime(bili.configMtime) : "—")),
            h("div", { className: "qbw-kv" }, h("span", null, "Cookie"), h("span", null, bili.hasCookie ? "已写入" : "未写入")),
            h("div", { className: "qbw-kv" }, h("span", null, "启动开关"), h("span", null, platformStart.bili !== false ? "开" : "关")),
            h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, "只读展示。生物钟 / 养鱼参数到「SurfCore · B站」栏目。")),
          h("div", { className: "qbw-card" },
            h("h4", null, "平台与扩展 ", h(StatusDot, { ok: (overview?.extensions ?? []).every((x) => !x.active) }, `${(overview?.extensions ?? []).filter((x) => x.enabled).length}/${(overview?.extensions ?? []).length} 个扩展启用`)),
            h("div", { className: "qbw-kv" }, h("span", null, "平台"), h("span", null, (overview?.platforms ?? []).map((x) => `${x.name}${x.status === "planned" ? "(预留)" : ""}`).join(" · "))),
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", onClick: () => goTab?.("extensions"), disabled: !!busy }, "管理扩展"),
              h(Btn, { kind: "qbw-btn3", onClick: () => goTab?.("identity"), disabled: !!busy }, "管理员身份 / 启动开关"))),
          h("div", { className: "qbw-card" },
            h("h4", null, "更新 ", updatesBadge),
            h("div", { className: "qbw-kv" }, h("span", null, "上次检查"), h("span", null, updatesData.lastCheckAt ? fmtTime(new Date(updatesData.lastCheckAt).toISOString()) : "还没查过")),
            (() => {
              const la = updatesData.lastApply;
              if (!la) return null;
              const color = la.status === "failed" ? "#c0392b" : (la.status === "applied_unverified" ? "#b9770e" : undefined);
              const text = la.status === "failed"
                ? `失败：${la.reason || "原因不明"}${la.hint ? `（${la.hint}）` : ""}`
                : la.status === "pending_restart"
                  ? "已排队，等待退出 DSH 后应用（尚未更新）"
                  : la.status === "applied_unverified"
                    ? `${la.reason || "已应用，尚未验证"}${la.hint ? `（${la.hint}）` : ""}`
                    : `${la.reason || "结果未知"}${la.hint ? `（${la.hint}）` : ""}`;
              return h("div", { className: "qbw-kv" }, h("span", null, "上次更新"), h("span", { style: { color } }, text));
            })(),
            h("div", { className: "qbw-grid", style: { marginTop: "6px" } },
              h("div", { className: "qbw-hint" },
                updatesData.githubTokenConfigured
                  ? "GitHub 令牌：已配置（检查更新走账号额度 5000 次/小时）"
                  : "GitHub 令牌：未配置（匿名 60 次/小时，共享 IP 时可能遇到「查不到：限流」）"),
              h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" } },
                h("input", {
                  type: "password",
                  value: tokenDraft,
                  placeholder: updatesData.githubTokenConfigured ? "已配置；要更换请粘贴新令牌" : "粘贴只读 token（可留空）",
                  onChange: (e) => setTokenDraft(e.target.value),
                  style: { width: "260px" },
                }),
                h(Btn, { kind: "qbw-btn2", disabled: !!busy || !tokenDraft.trim(), onClick: () => saveGithubToken(false) },
                  busy === "token" ? "保存中…" : "保存令牌"),
                updatesData.githubTokenConfigured
                  ? h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: () => saveGithubToken(true) }, "清除")
                  : null)),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: () => checkUpdates(), disabled: !!busy }, busy === "updates" ? "检查中…" : "检查更新"),
              (updatesData.pending ?? []).length
                ? h(Btn, {
                  kind: "qbw-btn2",
                  onClick: async () => {
                    setBusy("apply-update");
                    try {
                      const ids = (updatesData.pending ?? []).map((x) => x.id);
                      const r = await api("/updates", { method: "POST", body: { action: "apply", ids } });
                      const staged = (r.results ?? []).filter((x) => x.ok && x.staged);
                      const failedRows = (r.results ?? []).filter((x) => !x.ok);
                      if (r.ok && staged.length) toast(`⏳ 已下载 ${staged.length} 个组件，退出并重新打开 DSH 后应用（尚未更新）`);
                      else if (r.ok) toast(`✓ 已更新 ${r.updated} 个组件${r.restartRequired ? "，请重启对应服务" : ""}`);
                      else {
                        const f = failedRows[0] ?? {};
                        toast(`✗ 更新失败${f.code ? `（${f.code}）` : ""}：${f.reason ?? f.error ?? "原因不明"}${f.hint ? `；建议：${f.hint}` : ""}`);
                      }
                      await reload();
                    } catch (e) { toast(`✗ 更新失败：${e.message}`); } finally { setBusy(""); }
                  },
                }, busy === "apply-update" ? "更新中…" : `立即更新（${(updatesData.pending ?? []).length}）`)
                : null,
              h(Btn, { kind: "qbw-btn2", onClick: () => setUpdateOpen(true), disabled: !(updatesData.results ?? []).length }, "查看详情"))),
          h("div", { className: "qbw-card" },
            h("h4", null, "环境路径"),
            Object.entries(overview?.paths ?? {}).slice(0, 7).map(([key, value]) => h("div", { className: "qbw-kv", key },
              h("span", null, key), h("span", { style: { wordBreak: "break-all" } }, String(value))))),
          h(AdvancedSettings, { note: "SnowLuma 安装 / 扩展与平台：装好后很少改；检测与启动已归「SurfCore · QQ」" },
            h("div", { className: "qbw-card" },
              h("h4", null, "SnowLuma（只读检测）"),
              h("div", { className: "qbw-kv" }, h("span", null, "检测"), h("span", null, overview?.snowluma?.detected ? "找到安装目录" : "没检测到")),
              h("div", { className: "qbw-kv" }, h("span", null, "状态诊断"), h("span", null, overview?.snowluma?.diagnosis?.state ?? "unknown")),
              overview?.snowluma?.diagnosis?.hint ? h("div", { className: "qbw-hint" }, overview.snowluma.diagnosis.hint) : null,
              h("div", { className: "qbw-hint" }, "安装目录 / token / 一键启动在「SurfCore · QQ」栏目维护。")),
            h("div", { className: "qbw-card" },
              h("h4", null, "扩展与平台"),
              h("div", { className: "qbw-kv" }, h("span", null, "已启用扩展"), h("span", null, `${(overview?.extensions ?? []).filter((x) => x.enabled).length} / ${(overview?.extensions ?? []).length}`)),
              h("div", { className: "qbw-kv" }, h("span", null, "平台"), h("span", null, (overview?.platforms ?? []).map((x) => x.id).join(" · "))),
              h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, "贴吧已预留接口：接适配器即可，不改主流程。")))),
        h("div", { className: "qbw-actions" },
          h(Btn, { kind: "qbw-btn2", onClick: reload, disabled: !!busy }, "刷新状态")),
        updateOpen ? h(UpdatesModal, {
          status: updatesData,
          toast,
          onClose: () => setUpdateOpen(false),
          onDone: async () => { setUpdateOpen(false); await reload(); },
        }) : null);
    }

    // ── 扩展与平台（旧 client.js:4202-4263 搬）──────────────────────────────
    function ExtensionsTab({ busy, setBusy, toast, reload }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [configs, setConfigs] = useState({});
      const load = useCallback(async () => {
        try {
          const r = await api("/extensions");
          setData(r);
          const next = {};
          for (const ext of r.extensions ?? []) next[ext.id] = JSON.stringify(ext.config ?? {}, null, 2);
          setConfigs(next);
          setErr("");
        } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const toggle = async (id, enabled) => {
        setBusy("ext-" + id);
        try {
          await api("/extensions", { method: "POST", body: { action: "toggle", id, enabled } });
          toast(enabled ? "✓ 已启用" : "✓ 已停用");
          await load();
          await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const saveConfig = async (id) => {
        setBusy("extcfg-" + id);
        try {
          const parsed = JSON.parse(configs[id] || "{}");
          await api("/extensions", { method: "POST", body: { action: "config", id, config: parsed } });
          toast("✓ 扩展配置已保存");
          await load();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const reloadExt = async (id) => {
        setBusy("extreload-" + id);
        try {
          await api("/extensions", { method: "POST", body: { action: "reload", id } });
          toast("✓ 已重载");
          await load();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const platforms = data?.platforms ?? [];
      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "后续功能从这里接：杀戮尖塔启动器、B站自主直播、贴吧，都不需要改主流程。",
          "扩展默认关闭；开启等于允许它在本机执行代码，请只打开你信得过的。"),
        h(AdvancedSettings, { note: "平台接入 / 扩展目录：内置平台和文档入口，平时不用改" },
          h("div", { className: "qbw-group" }, "平台接入 ", h("small", null, "QQ/B站内置，贴吧预留")),
          h("div", { className: "qbw-grid" }, platforms.map((p) => h("div", { className: "qbw-card", key: p.id },
            h("h4", null, p.name, h("span", { className: "qbw-badge " + (p.status === "active" ? "ok" : "warn") }, p.status === "active" ? "已接入" : "预留")),
            h("p", null, `${p.capabilities?.join(" · ") || "—"}`),
            h("div", { className: "qbw-hint" }, `${p.id} · ${p.builtin ? "内置" : "扩展"}`)))),
          h("div", { className: "qbw-hint" },
            "文档：", h("code", { className: "qbw-code" }, "plugins/surfcore/extensions/README.md"), " · ",
            h("code", { className: "qbw-code" }, "docs/EXTENSIONS.md"))),
        h("div", { className: "qbw-group" }, "功能扩展 ", h("small", null, data?.dir ?? "")),
        (data?.extensions ?? []).length === 0 ? h("div", { className: "qbw-hint" }, "（没有扩展包）") : (data.extensions ?? []).map((ext) => h("div", { className: "qbw-card", key: ext.id, style: { marginBottom: "8px" } },
          h("h4", null, ext.name, h("span", { className: "qbw-badge " + (ext.enabled ? "ok" : "") }, ext.enabled ? (ext.active ? "运行中" : "已启用") : "关闭")),
          h("p", null, ext.description || "（无描述）"),
          h("div", { className: "qbw-hint" }, `${ext.id} · v${ext.version} · ${ext.author || "local"} · 能力：${(ext.capabilities ?? []).join("、") || "—"}`),
          ext.routes?.length ? h("div", { className: "qbw-hint" }, `路由：${ext.routes.join(" · ")}`) : null,
          h("div", { className: "qbw-actions" },
            h(Btn, { kind: ext.enabled ? "qbw-btn2" : "", onClick: () => toggle(ext.id, !ext.enabled), disabled: !!busy }, ext.enabled ? "停用" : "启用"),
            h(Btn, { kind: "qbw-btn2", onClick: () => reloadExt(ext.id), disabled: !!busy || !ext.enabled }, "重载")),
          h(Section, { title: "配置 JSON（高级）", note: "保存后立即写扩展配置；不确定的字段先备份" },
            h("textarea", { className: "qbw-textarea", value: configs[ext.id] ?? "{}", onChange: (e) => setConfigs((s) => ({ ...s, [ext.id]: e.target.value })), placeholder: "扩展配置 JSON" }),
            h("div", { className: "qbw-actions" }, h(Btn, { kind: "qbw-btn2", onClick: () => saveConfig(ext.id), disabled: !!busy }, "保存配置"))))),
        err ? h("div", { className: "qbw-err" }, err) : null);
    }

    // ── 全部参数（旧 client.js:4266-4304 搬，改成所有权语义）─────────────────
    // 三份配置的完整扁平树。统一配置可编辑（只有本包负责的键会被保存）；
    // QQ / B站 配置由对应拆分包负责，这里只读展示（避免两个插件写同一份文件）。
    function AdvancedTab({ config, busy, setUnifiedPath }) {
      const [query, setQuery] = useState("");
      const [scope, setScope] = useState("unified");
      const current = scope === "qq" ? config?.qq : scope === "bili" ? config?.bili : config?.unified;
      const readOnly = scope !== "unified";
      const fields = useMemo(() => flattenFields(current ?? {}), [current]);
      const filtered = query.trim()
        ? fields.filter((f) => `${f.label} ${f.path.join(".")}`.toLowerCase().includes(query.trim().toLowerCase()))
        : fields;
      const groups = useMemo(() => {
        const out = new Map();
        for (const f of filtered) {
          const key = f.path.length > 2 ? `${f.path[0]} · ${f.path[1]}` : f.path[0];
          if (!out.has(key)) out.set(key, []);
          out.get(key).push(f);
        }
        return [...out.entries()];
      }, [filtered]);
      return h("div", null,
        h("div", { className: "qbw-dangerbox" },
          "这里是「真正全部」的参数树：上面标签页没列出的键也能在这里改。",
          readOnly
            ? "QQ / B站 配置本包只读展示：要改请到「SurfCore · QQ」「SurfCore · B站」栏目。"
            : "统一配置里只有本包负责的键（admin / extensions / platforms / updates / ui / qqbotRoot）会被保存；bridge / persona / memory / alignment / memoryCard 由对应拆分包负责，保存时原样保留。"),
        h("div", { className: "qbw-search" },
          h("select", { className: "qbw-select", value: scope, onChange: (e) => setScope(e.target.value) },
            h("option", { value: "unified" }, "统一配置 unified config"),
            h("option", { value: "qq" }, "QQ config.json（只读）"),
            h("option", { value: "bili" }, "B站 bili.config.json（只读）")),
          h("input", { className: "qbw-input", placeholder: "搜索参数名 / 路径", value: query, onChange: (e) => setQuery(e.target.value) }),
          h("span", { className: "qbw-hint" }, `${filtered.length} 项${readOnly ? " · 只读" : ""}`)),
        groups.length === 0 ? h("div", { className: "qbw-hint" }, "没有匹配项") : groups.map(([group, list]) => h(Section, { key: group, title: group, note: `${list.length} 项`, defaultOpen: Boolean(query.trim()) || groups.length < 8 },
          list.map((f) => h(Field, {
            key: f.path.join("."),
            f: { ...f, hint: f.path.join(".") },
            value: getPath(current, f.path),
            readOnly,
            onChange: readOnly ? undefined : (v) => setUnifiedPath(f.path, v),
          })))),
        h("div", { className: "qbw-actions" },
          h(Btn, { kind: "qbw-btn2", onClick: () => { setQuery(""); }, disabled: !!busy }, "清空搜索"),
          readOnly ? h(Btn, { kind: "qbw-btn3", onClick: () => setScope("unified"), disabled: !!busy }, "去改统一配置") : null));
    }

    // ── 诊断（旧 client.js:4307-4516 搬；一键安装流程删除，归 qq 包）─────────
    function DiagnosticsTab({ busy, setBusy, toast, reload }) {
      const [diag, setDiag] = useState(null);
      const [logs, setLogs] = useState(null);
      const [backups, setBackups] = useState([]);
      const [err, setErr] = useState("");

      const load = useCallback(async () => {
        try {
          const r = await api("/diagnostics");
          setDiag(r);
          setErr("");
        } catch (e) { setErr(e.message); }
        try {
          const b = await api("/backups");
          setBackups(b.backups ?? []);
        } catch {}
      }, []);
      useEffect(() => { load(); }, [load]);

      const loadLogs = async () => {
        setBusy("logs");
        try {
          const r = await api("/logs?lines=160");
          setLogs(r);
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const doctorFix = async () => {
        setBusy("doctor");
        try {
          const r = await api("/diagnostics/fix", { method: "POST", body: { action: "doctor-fix" } });
          const changed = r.changed ?? [];
          const warnings = r.warnings ?? [];
          toast(changed.length
            ? `✓ 已补齐：${changed.join("、")}${r.restartRequired ? "（重启 DSH 生效）" : ""}${warnings.length ? `；⚠️ ${warnings.join(" ")}` : ""}`
            : (warnings.length ? `没有需要补的；⚠️ ${warnings.join(" ")}` : "✓ 没有需要补的"));
          await load();
        } catch (e) {
          toast(`✗ ${e.message}`);
        } finally { setBusy(""); }
      };
      const backupAll = async () => {
        setBusy("backup");
        try {
          const r = await api("/diagnostics/fix", { method: "POST", body: { action: "backup" } });
          toast(`✓ 已备份 ${r.created?.length ?? 0} 个文件`);
          await load();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const restore = async (name) => {
        if (!confirm(`确定用备份 ${name} 覆盖当前文件？会先自动备份当前文件。`)) return;
        setBusy("restore");
        try {
          const r = await api("/diagnostics/fix", { method: "POST", body: { action: "restore", name } });
          toast(`✓ 已恢复 ${r.target}`);
          await load();
          await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      const checkRows = (diag?.checks ?? []).map((c) => h("div", { className: "qbw-kv", key: c.name },
        h("span", null, `${c.level === "warn" ? "⚠️" : c.ok ? "✓" : "✗"} ${c.name}`),
        h("span", null, `${c.detail ?? ""}${c.fix ? ` · 怎么补：${c.fix}` : ""}`)));
      const pathRows = Object.entries(diag?.paths ?? {}).map(([k, v]) => h("div", { className: "qbw-kv", key: k },
        h("span", null, k),
        h("span", null, String(v))));
      const backupRows = backups.slice(0, 20).map((b) => h("div", { className: "qbw-item", key: b.name },
        h("div", null,
          h("div", { className: "qbw-label" }, b.name),
          h("div", { className: "qbw-hint" }, `${fmtBytes(b.bytes)} · ${fmtTime(new Date(b.mtime).toISOString())}${b.target === "restorable" ? "" : " · 只能手动恢复"}`)),
        b.target === "restorable"
          ? h(Btn, { kind: "qbw-btn2", onClick: () => restore(b.name), disabled: !!busy }, "恢复")
          : null));

      const cards = diag ? h("div", { className: "qbw-grid", style: { marginTop: "8px" } },
        h("div", { className: "qbw-card" },
          h("h4", null, "体检 ", h("span", { className: "qbw-badge " + (diag.ok ? "ok" : "bad") }, diag.ok ? "通过" : "有项不可用")),
          checkRows),
        h("div", { className: "qbw-card" },
          h("h4", null, "路径"),
          pathRows)) : null;

      const backupSection = h(Section, { title: `备份（${backups.length}）`, note: "写文件前自动生成；旧 store.js 命名的备份也能识别", collapsible: false }, backupRows);

      const logBlock = logs ? h("div", null,
        h("div", { className: "qbw-group" }, "插件日志"),
        h("div", { className: "qbw-out" }, logs.plugin || "（空）"),
        h("div", { className: "qbw-group" }, "桥接日志（只读）"),
        h("div", { className: "qbw-out" }, logs.bridge || "（空）")) : null;

      return h("div", null,
        h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: 0, paddingTop: 0 } },
          h(Btn, { kind: "qbw-btn2", onClick: doctorFix, disabled: !!busy }, busy === "doctor" ? "配置中…" : "只补缺失项"),
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "重新体检"),
          h(Btn, { kind: "qbw-btn2", onClick: backupAll, disabled: !!busy }, "备份全部配置"),
          h(Btn, { kind: "qbw-btn3", onClick: () => window.open(`${API}/diagnostics`, "_blank", "noopener"), disabled: !!busy }, "查看原始 JSON")),
        cards,
        h(AdvancedSettings, { note: "备份恢复 / 插件与桥接日志：排障时再展开" },
          h("div", { className: "qbw-actions" }, h(Btn, { kind: "qbw-btn2", onClick: loadLogs, disabled: !!busy }, busy === "logs" ? "读取中…" : "读取日志")),
          backupSection,
          logBlock),
        err ? h("div", { className: "qbw-err" }, err) : null);
    }

    // ── 栏目外壳 ────────────────────────────────────────────────────────────
    // 内页：概览 / 身份 / 扩展 / 全部参数 / 诊断（见 PLAN §3）。
    const TABS = [
      ["overview", "概览"],
      ["identity", "身份"],
      ["extensions", "扩展"],
      ["advanced", "全部参数"],
      ["diag", "诊断"],
    ];
    const NAMES = { nav: "SurfCore · 核心" };

    function surfcoreCoreSection() {
      useStyleOnce();
      const [tab, setTab] = useState("overview");
      const [overview, setOverview] = useState(null);
      const [config, setConfig] = useState(null);
      // 加载时的配置版本戳：保存时回传，防止把别人刚改的配置整份覆盖（2026-10-29 事故）。
      const [savedSnapshot, setSavedSnapshot] = useState("");
      const [busy, setBusy] = useState("");
      // 浮层文案（字符串）。真正的通知函数叫 notify —— 两者别同名，否则会被误当函数传（2026-10-30）。
      const [toastText, setToastText] = useState("");
      const [err, setErr] = useState("");

      const notify = (message) => {
        setToastText(String(message ?? ""));
        setTimeout(() => setToastText(""), 4000);
      };
      // 让深层组件（如泛用 Field 的「浏览…」）也能弹提示，而不是静默失败。
      useEffect(() => { window.__surfcoreToast = notify; return () => { delete window.__surfcoreToast; }; }, []);

      const loadOverview = useCallback(async () => {
        try { setOverview(await api("/overview")); } catch (e) { setErr(`读取概览失败：${e.message}`); }
      }, []);
      const loadConfig = useCallback(async () => {
        setErr("");
        try {
          const r = await api("/config");
          const next = {
            qq: r.qq ?? {},
            bili: r.bili ?? {},
            unified: r.unified ?? {},
            stamps: r.stamps ?? null,
            backups: r.backups ?? [],
            paths: r.paths ?? {},
            ownership: r.ownership ?? {},
            hasUserFile: r.hasUserFile ?? {},
          };
          setConfig(next);
          setSavedSnapshot(JSON.stringify({ qq: next.qq, bili: next.bili, unified: next.unified }));
        } catch (e) { setErr(`读取配置失败：${e.message}`); }
      }, []);
      useEffect(() => { void loadOverview(); void loadConfig(); }, [loadOverview, loadConfig]);
      const reload = useCallback(async () => { await loadOverview(); await loadConfig(); }, [loadOverview, loadConfig]);

      const setUnifiedPath = (pathKeys, value) => setConfig((current) => {
        const next = clone(current?.unified ?? {});
        setPath(next, pathKeys, value);
        return { ...current, unified: next };
      });
      const dirty = Boolean(config && savedSnapshot && JSON.stringify({ qq: config.qq, bili: config.bili, unified: config.unified }) !== savedSnapshot);

      const save = async () => {
        setBusy("save"); setErr("");
        try {
          let r;
          try {
            // 只提交统一配置；QQ/B站 配置由对应拆分包负责，本包不整份回写。
            r = await api("/config", { method: "POST", body: { unified: config?.unified ?? {}, baseStamp: config?.stamps } });
          } catch (e) {
            // 409：配置在加载后被别处改过。不要盲目覆盖 —— 提示重新读取。
            if (/CONFIG_STALE|已被别处修改/.test(String(e.message))) {
              setErr(`保存被拒绝：${e.message}。请点「重新读取」后再改。`);
              notify(`⚠️ ${e.message}`);
              return;
            }
            throw e;
          }
          const warnings = Array.isArray(r.warnings) ? r.warnings : [];
          notify(`✓ 已保存${warnings.length ? "（有提示）" : ""}`);
          if (warnings.length) setErr(warnings.join(" "));
          await reload();
        } catch (e) { setErr(`保存失败：${e.message}`); } finally { setBusy(""); }
      };
      const reset = () => {
        if (!savedSnapshot) return;
        const saved = JSON.parse(savedSnapshot);
        setConfig((current) => ({ ...current, qq: saved.qq, bili: saved.bili, unified: saved.unified }));
        notify("已撤销未保存的改动");
      };

      if (!config || !overview) {
        return h("div", { className: "qbw-app" },
          h("div", { className: "qbw-head" },
            h("p", { className: "qbw-kicker" }, "DeepSeek Harness · SurfCore 拆分包"),
            h("h3", { className: "qbw-title" }, NAMES.nav),
            h("p", { className: "qbw-sub" }, "正在读取配置…")),
          h("div", { className: "qbw-body" }, err ? h("div", { className: "qbw-err" }, err) : h("div", { className: "qbw-hint" }, "读取中…")),
          h("div", { className: "qbw-foot" }, h(Btn, { onClick: reload, disabled: !!busy }, "重试")));
      }

      const updatesData = overview.updates ?? {};
      const active = (id) => tab === id;
      const renderTab = () => {
        if (tab === "overview") return h(OverviewTab, { overview, config, reload, busy, setBusy, toast: notify, goTab: setTab });
        if (tab === "identity") return h(IdentityTab, { config, busy, setBusy, toast: notify, reload });
        if (tab === "extensions") return h(ExtensionsTab, { busy, setBusy, toast: notify, reload });
        if (tab === "advanced") return h(AdvancedTab, { config, busy, setUnifiedPath });
        if (tab === "diag") return h(DiagnosticsTab, { busy, setBusy, toast: notify, reload });
        return null;
      };

      return h("div", { className: "qbw-app" },
        h("div", { className: "qbw-head" },
          h("p", { className: "qbw-kicker" }, "DeepSeek Harness · SurfCore 拆分包"),
          h("h3", { className: "qbw-title" }, NAMES.nav,
            h("span", { className: "qbw-badge" }, `v${overview.version ?? "—"}`),
            h("span", { className: "qbw-dots" },
              h(StatusDot, { ok: !updatesData.pendingCount, warn: Boolean(updatesData.pendingCount) }, updatesData.pendingCount ? `${updatesData.pendingCount} 个可更新` : "组件最新"),
              h(StatusDot, { ok: (overview.extensions ?? []).every((x) => !x.active) }, `${(overview.extensions ?? []).filter((x) => x.active).length} 个扩展运行中`))),
          h("p", { className: "qbw-sub" }, "配置模型与统一配置读写、管理员身份投影、扩展宿主、平台注册表、组件更新、备份、日志、原生浏览。QQ / B站 的运行与业务参数在各自栏目。")),
        h("div", { className: "qbw-tabs" }, TABS.map(([id, label]) => h("button", {
          key: id, className: "qbw-tab" + (active(id) ? " on" : ""), onClick: () => setTab(id),
        }, label))),
        h("div", { className: "qbw-body" },
          err ? h("div", { className: "qbw-err", style: { marginBottom: "8px" } }, err) : null,
          renderTab()),
        h("div", { className: "qbw-foot" },
          h(Btn, { onClick: () => save(), disabled: !!busy || !dirty }, busy === "save" ? "保存中…" : "保存"),
          h(Btn, { kind: "qbw-btn2", onClick: reset, disabled: !!busy || !dirty }, "撤销改动"),
          h(Btn, { kind: "qbw-btn2", onClick: reload, disabled: !!busy }, "重新读取"),
          h("span", { className: "spacer" }),
          dirty ? h("span", { className: "qbw-dirty" }, "● 有改动还没保存（改了不点保存 = 没生效）") : h("span", { className: "qbw-ok" }, "已保存"),
          toastText ? h("span", { style: { marginLeft: "10px", color: "var(--dsw-alias-label-secondary)" } }, toastText) : null));
    }

    const inject = ["slots"];
    const NS = "surfcore-core";

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject("settings.section", () =>
          ctx.slots.register({ name: "settings.section", id: NS, order: 7, label: () => NAMES.nav }, surfcoreCoreSection),
          "surfcore-core: settings section"),
        "surfcore-core: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.surfcoreCoreSection = surfcoreCoreSection;
    exports.AdminCard = AdminCard;
    exports.TABS = TABS;
    exports.__test = { API, CSS_TAG, TABS };
    return module.exports;
  },
});
