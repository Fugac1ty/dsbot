/**
 * dsbot-pet —— 浏览器半边：DSH 设置里的「DSBot · 桌宠」栏目。
 *
 * 自包含经典脚本：由 window.__ModuleLoader__.load({ id, factory }) 包装，
 * factory 内只有作用域，不能 import 相对文件；公共 UI 控件已内联在下面。
 * 数据流：本组件 ⇄ /dsh-dsbot-pet/api/*（同源 fetch）⇄ 本插件宿主半边。
 */
window.__ModuleLoader__.load({
  id: "dsbot-pet",
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

    const API = "/dsh-dsbot-pet/api";
    const CSS_TAG = "dsbot-pet/console.css";

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
                else if (!r.cancelled) (window.__dsbotToast || console.warn)(r.error || "打不开选择框，请手动填写");
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
          else if (!r.cancelled) (window.__dsbotToast || console.warn)(r.error || "打不开选择框，请手动填路径");
        } catch (e) { (window.__dsbotToast || console.warn)(e.message); }
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

    // ── 本插件的状态与数据 ──────────────────────────────────────────────────
    // TODO: 在这里加 <本插件> 的加载/保存/动作函数（全部走 api(...)）。
    async function loadStatus() {
      return api("/status");
    }

    function dsbotPetSection() {
      useStyleOnce();
      const [status, setStatus] = useState(null);
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      const [toastText, setToastText] = useState("");

      const toast = useCallback((text) => {
        setToastText(String(text ?? ""));
        setTimeout(() => setToastText(""), 2600);
      }, []);

      const reload = useCallback(async () => {
        try { setStatus(await loadStatus()); setErr(""); }
        catch (error) { setErr(String(error?.message ?? error)); }
      }, []);

      useEffect(() => { void reload(); }, [reload]);

      return h("div", { className: "qbw-app" },
        h("div", { className: "qbw-head" },
          h("p", { className: "qbw-kicker" }, "DSBot 拆分包"),
          h("h2", { className: "qbw-title" }, "DSBot · 桌宠"),
          h("p", { className: "qbw-sub" }, "独立插件：只负责本栏目；数据仍写原有的配置文件与状态目录。")),
        h("div", { className: "qbw-body" },
          err ? h("div", { className: "qbw-err", style: { marginBottom: "8px" } }, err) : null,
          h(Section, { title: "运行状态", note: "来自本插件的宿主半边" },
            status
              ? h("div", null,
                h(Row, { label: "插件" }, h("span", null, status.plugin ?? "dsbot-pet")),
                h(Row, { label: "版本" }, h("span", null, status.version ?? "—")),
                h(Row, { label: "状态目录" }, h("span", { className: "qbw-hint" }, status.paths?.stateDir ?? "—")),
                h(Row, { label: "统一配置" }, h(StatusDot, { ok: !!status.files?.unified }, status.files?.unified ? "已存在" : "未创建")))
              : h("div", { className: "qbw-hint" }, "加载中…")),
          h(AdvancedSettings, null,
            h(Row, { label: "API 前缀" }, h("span", { className: "qbw-hint" }, API)))),
        h("div", { className: "qbw-foot" },
          h(Btn, { onClick: () => void reload(), disabled: !!busy }, busy ? "刷新中…" : "重新读取"),
          h("span", { className: "spacer" }),
          toastText ? h("span", { style: { marginLeft: "10px", color: "var(--dsw-alias-label-secondary)" } }, toastText) : null));
    }

    const inject = ["slots"];
    const NS = "dsbot-pet";

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject("settings.section", () =>
          ctx.slots.register({ name: "settings.section", id: NS, order: 13, label: () => "DSBot · 桌宠" }, dsbotPetSection),
          "dsbot-pet: settings section"),
        "dsbot-pet: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.dsbotPetSection = dsbotPetSection;
    exports.__test = { API, CSS_TAG };
    return module.exports;
  },
});
