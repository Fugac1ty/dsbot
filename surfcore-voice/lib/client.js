/**
 * surfcore-voice —— 浏览器半边：DSH 设置里的「SurfCore · 语音」栏目。
 *
 * 自包含经典脚本：由 window.__ModuleLoader__.load({ id, factory }) 包装，
 * factory 内只有作用域，不能 import 相对文件；公共 UI 控件已内联在下面。
 * 数据流：本组件 ⇄ /dsh-surfcore-voice/api/*（同源 fetch）⇄ 本插件宿主半边。
 */
window.__ModuleLoader__.load({
  id: "surfcore-voice",
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

    const API = "/dsh-surfcore-voice/api";
    const CSS_TAG = "surfcore-voice/console.css";

    // 本栏目自己的 toast 出口：公共套件里的「浏览…」失败提示用它（不依赖旧全局 __voiceToast）。
    let __voiceToast = null;

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
                const r = await pickNativeDir(f.browse, f.label || "选择路径").catch((e) => ({ ok: false, error: e.message }));
                if (r.ok && r.path) onChange(String(r.path));
                else if (!r.cancelled) (__voiceToast || console.warn)(r.error || "打不开选择框，请手动填写");
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
          const r = await pickNativeDir(mode, title || (mode === "file" ? "选择文件" : "选择目录"));
          if (r.ok && r.path) onPick(String(r.path));
          else if (!r.cancelled) (__voiceToast || console.warn)(r.error || "打不开选择框，请手动填路径");
        } catch (e) { (__voiceToast || console.warn)(e.message); }
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



    function CloudStats() {
      const [st, setSt] = useState(null);
      const [err, setErr] = useState("");
      useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            // 组合代理：本包把桥接的 cloud-config + cloud-stats 合成一个 GET /voice/cloud。
            const merged = await api("/voice/cloud");
            const r = merged.stats && merged.stats.ok !== false ? merged.stats : null;
            if (!r) throw new Error(merged.stats?.error || merged.config?.error || "云端语音包未安装或未启动");
            if (alive) { setSt(r); setErr(""); }
          } catch (e) { if (alive) setErr(e.message); }
        };
        tick();
        const timer = setInterval(tick, 5000);
        return () => { alive = false; clearInterval(timer); };
      }, []);
      const cell = (label, value, hint) => h("div", { style: { minWidth: "110px" } },
        h("div", { style: { fontSize: "11px", opacity: 0.6 } }, label),
        h("div", { style: { fontSize: "15px", fontWeight: 600 } }, value),
        hint ? h("div", { style: { fontSize: "11px", opacity: 0.55 } }, hint) : null);
      return h("div", { style: { marginTop: "10px", padding: "10px", borderRadius: "8px", background: "rgba(127,127,127,.06)" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" } },
          h("strong", { style: { fontSize: "13px" } }, "云端用量"),
          h("span", { style: { fontSize: "11px", opacity: 0.6 } }, "每 5 秒刷新")),
        err ? h("div", { style: { fontSize: "12px", color: "#e66" } }, err) : null,
        st ? h("div", { style: { display: "flex", gap: "20px", flexWrap: "wrap" } },
          cell("当前模型", st.model || "—", st.speaker ? "音色 " + st.speaker : ""),
          cell("今日", st.todayChars + " 字", st.todayCalls + " 次"),
          cell("本月", st.monthChars + " 字", st.monthCalls + " 次"),
          cell("估算费用", st.monthCost == null ? "未设单价" : "¥" + st.monthCost, st.pricePerKChar ? "¥" + st.pricePerKChar + "/千字" : "在下方填"),
          cell("剩余额度", st.remainChars == null ? "未设额度" : st.remainChars + " 字", st.monthlyQuota ? "额度 " + st.monthlyQuota : "在下方填")) : null,
        h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "8px", flexWrap: "wrap", fontSize: "12px" } },
          "单价 ¥", h("input", { type: "number", step: "0.01", value: st ? st.pricePerKChar || "" : "", onChange: async (e) => {
            await api("/voice/rules", { method: "POST", body: { pricePerKChar: Number(e.target.value) } }).catch(() => {});
          }, style: { width: "80px" } }), "/千字",
          "本月额度", h("input", { type: "number", value: st ? st.monthlyQuota || "" : "", onChange: async (e) => {
            await api("/voice/rules", { method: "POST", body: { monthlyQuota: Number(e.target.value) } }).catch(() => {});
          }, style: { width: "100px" } }), "字"),
        h("div", { style: { fontSize: "11px", opacity: 0.55, marginTop: "6px" } },
          "费用/额度是按你填的数字估算的（火山不提供余额查询）；字数来自本机实际合成日志。"));
    }

    function CloudForm({ toast }) {
      const [cfg, setCfg] = useState(null);
      const [form, setForm] = useState({ appId: "", accessKey: "", speaker: "" });
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState("");

      const read = useCallback(async () => {
        try {
          // GET /voice/cloud = 桥接 cloud-config + cloud-stats 的组合视图；pack 没装时带 missing 标记。
          const merged = await api("/voice/cloud");
          const raw = merged.config && merged.config.ok !== false ? merged.config : null;
          const r = raw || { configured: false, missing: true, error: merged.config?.error || merged.stats?.error || "" };
          setCfg(r);
          setForm({ appId: r.appId || "", accessKey: "", speaker: r.speaker || "" });
        } catch (e) { setMsg(String(e?.message ?? e)); }
      }, []);
      useEffect(() => { read(); }, [read]);

      const save = async () => {
        setBusy(true); setMsg("保存中…");
        let saved = false;
        try {
          await api("/voice/cloud", { method: "POST", body: { ...form } });
          saved = true;
          setMsg("已保存");
          try { await read(); } catch {}
          // 通知是界面层的事：失败也不能把"保存成功"改写成失败（2026-10-30 用户反馈）
          try { toast("✓ 云端密钥已保存"); } catch {}
        } catch (e) {
          setMsg(saved ? "已保存（界面提示失败）" : "保存失败：" + e.message);
        } finally { setBusy(false); }
      };
      const test = async () => {
        setBusy(true); setMsg("测试中…");
        try { const r = await api("/voice/packs/test", { method: "POST", body: { id: "voice-cloud" } }); setMsg("✅ 连接成功，" + r.ms + "ms"); }
        catch (e) { setMsg("❌ " + e.message); }
        finally { setBusy(false); }
      };

      const downloadSample = async () => {
        setBusy(true); setMsg("下载参考音频…");
        try {
          const res = await fetch(`${API}/voice/packs/sample?id=voice-cloud`, { headers: { accept: "audio/wav" } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const disp = res.headers.get("content-disposition") || "";
          const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
          const name = m ? decodeURIComponent(m[1]) : "小语-参考音频19秒.wav";
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          setMsg(`✓ 已开始下载：${name}`);
        } catch (e) {
          setMsg(`下载失败：${e.message}；可点「打开所在目录」手动复制`);
        } finally { setBusy(false); }
      };

      const openSampleFolder = async () => {
        setBusy(true); setMsg("打开目录…");
        try {
          const r = await api("/voice/packs/sample-open", { method: "POST", body: { id: "voice-cloud" } });
          if (!r.ok) throw new Error(r.error || "打开目录失败");
          setMsg(`✓ 已打开：${r.path || r.dir || ""}`);
        } catch (e) {
          setMsg(`打开目录失败：${e.message}`);
        } finally { setBusy(false); }
      };

      const row = (label, node) => h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" } },
        h("span", { style: { width: "96px", fontSize: "13px" } }, label), node);

      if (cfg && cfg.missing) {
        // 云端包没装/没启动：桥接的 cloud-config 拿不到，先给一条明确的下一步。
        return h("div", { style: { marginTop: "14px" } },
          h(CloudStats, null),
          h("div", { className: "qbw-warnbox" },
            "云端语音包还没安装或没启动：", cfg.error || "先到「语音」内页安装云端语音包，再回来填密钥。"),
          h("div", { className: "qbw-hint" },
            "云端凭据由桥接的语音包服务提供（本插件只是代理转发）；密钥只写在本机包内的 config.toml，不上传任何服务器。"));
      }
      return h("div", { id: "surfcore-cloud-voice-form", style: { marginTop: "14px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
        h(CloudStats, null),
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginTop: "12px" } },
          h("strong", null, "云端包：密钥与音色"),
          h("span", { style: { fontSize: "12px", opacity: 0.75 } }, cfg && cfg.configured ? "已配置（可随时修改）" : "未配置 —— 填完才能用")),
        h("ol", { style: { fontSize: "12px", margin: "8px 0", paddingLeft: "20px", lineHeight: "1.7", opacity: 0.8 } },
          h("li", null,
            h(Btn, { kind: "qbw-btn2", disabled: busy, onClick: downloadSample }, "下载参考音频"),
            "（19 秒，包里自带，不用自己录） ",
            h(Btn, { kind: "qbw-btn2", disabled: busy, onClick: openSampleFolder }, "打开所在目录")),
          h("li", null, h("a", { href: "https://console.volcengine.com/speech/service/8", target: "_blank", rel: "noreferrer" }, "打开火山引擎控制台 ↗"), " → 语音技术 → 声音复刻 → 上传 wav → 训练，拿到 S_xxxxxxxx"),
          h("li", null, "把下面三项填进来，点「保存」，再点「测试连接」")),
        row("AppID", h("input", { type: "text", value: form.appId, placeholder: "控制台「语音技术」页里的 AppID", onChange: (e) => setForm({ ...form, appId: e.target.value }), style: { width: "240px" } })),
        row("Access Key", h("input", { type: "password", value: form.accessKey, placeholder: cfg && cfg.hasAccessKey ? "已保存：" + cfg.accessKeyMasked + "（留空则不修改）" : "控制台里的 Access Key", onChange: (e) => setForm({ ...form, accessKey: e.target.value }), style: { width: "240px" } })),
        row("音色 ID", h("input", { type: "text", value: form.speaker, placeholder: "S_xxxxxxxx", onChange: (e) => setForm({ ...form, speaker: e.target.value }), style: { width: "240px" } })),
        h("div", { style: { display: "flex", gap: "8px", marginTop: "10px", alignItems: "center", flexWrap: "wrap" } },
          h(Btn, { disabled: busy, onClick: save }, busy ? "保存中…" : "保存"),
          h(Btn, { kind: "qbw-btn2", disabled: busy, onClick: test }, "测试连接"),
          msg ? h("span", { style: { fontSize: "12px", opacity: 0.85 } }, msg) : null),
        h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } },
          "密钥只写在本机包内的 config.toml，不上传任何服务器。安装包不预置任何密钥，AppID 和 Access Key 都要自己填（别人的填进去会花别人的额度）。"));
    }

    function VoiceTab({ toast }) {
      const [packs, setPacks] = useState([]);
      const [packsDir, setPacksDir] = useState("");
      const [dirInput, setDirInput] = useState("");
      const [mirror, setMirror] = useState("");
      const [rules, setRules] = useState(null);
      const [err, setErr] = useState("");
      const [busyId, setBusyId] = useState("");
      const [pick, setPick] = useState("voice-local");
      const [switchMsg, setSwitchMsg] = useState("");
      const [msg, setMsg] = useState({});
      const [importPick, setImportPick] = useState(null);
      const [importErr, setImportErr] = useState(null);
      const [importDone, setImportDone] = useState(null);

      const load = useCallback(async () => {
        try {
          const r = await api("/voice/packs");
          setPacks(r.packs || []);
          setPacksDir(r.packsDir || "");
          setDirInput((prev) => prev || r.packsDir || "");
          setErr("");
          setRules(await api("/voice/rules"));
          const run = (r.packs || []).find((p) => p.running);
          if (run) setPick(run.id);
        } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      // 页面刷新/切回来时，导入仍在后台跑：自动轮询，不能只靠发起导入的那个调用栈。
      useEffect(() => {
        const active = (packs || []).some((p) => p.import && p.import.phase !== "完成" && p.import.phase !== "失败");
        if (!active) return undefined;
        const t = setInterval(() => { load(); }, 1500);
        return () => clearInterval(t);
      }, [packs, load]);

      const poll = useCallback(async (id, tries = 240) => {
        for (let i = 0; i < tries; i += 1) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const r = await api("/voice/packs");
            setPacks(r.packs || []);
            const p = (r.packs || []).find((x) => x.id === id);
            if (!p) return "failed";
            if (p.install && p.install.phase === "失败") { setMsg((m) => ({ ...m, [id]: "✗ " + (p.install.error || "安装失败") })); return "failed"; }
            if (p.installed && !p.install) return "ok";
          } catch {}
        }
        return "timeout";
      }, []);

      const waitImport = async (id) => {
        for (let i = 0; i < 900; i += 1) {
          await new Promise((r) => setTimeout(r, 1000));
          let r;
          try { r = await api("/voice/packs"); } catch { continue; }
          setPacks(r.packs || []);
          const p = (r.packs || []).find((x) => x.id === id);
          const im = p?.import;
          if (!im) continue;
          if (im.phase === "失败") {
            if (im.code === "IMPORT_CANCELLED") {
              if (toast) toast("已取消导入（旧包未动）");
            } else {
              setImportErr({ id, ...im });
            }
            await load();
            return;
          }
          if (im.phase === "完成") {
            setImportDone({ id, ...(im.result || {}) });
            await load();
            return;
          }
        }
        setImportErr({ id, error: "导入进度长时间没有更新", hint: "检查桥接是否还在运行；如果文件仍在复制，稍等后刷新设置页。", code: "IMPORT_TIMEOUT" });
      };

      const startImportFlow = async (id) => {
        setImportErr(null);
        setImportDone(null);
        let picked;
        try {
          picked = await browseNative("dir", `选择解压后的 ${id === "voice-local" ? "voice-local" : "voice-cloud"} 文件夹`);
        } catch (e) {
          setImportErr({ id, error: `选择框打不开：${e.message || e}`, hint: "可以手动把包放到设置页显示的安装目录后重启桥接；或检查是否在本机桌面运行。" });
          return;
        }
        if (!picked?.ok) {
          if (!picked?.cancelled) {
            setImportErr({ id, error: picked?.error || "没有选到目录", hint: "重新点「导入离线包…」，选择解压出来的 voice-local / voice-cloud 文件夹。" });
          }
          return;
        }
        setBusyId("__import");
        try {
          const info = await api("/voice/packs/import-inspect", { method: "POST", body: { id, sourceDir: picked.path } });
          setImportPick({ id, info });
        } catch (e) {
          setImportErr({ id, sourceDir: picked.path, error: e.message, code: e.code, hint: e.hint, missing: e.missing });
        } finally {
          setBusyId("");
        }
      };

      const submitImport = async (allowUnverified = false) => {
        const job = importPick;
        if (!job) return;
        setImportPick(null);
        setBusyId("__import");
        try {
          await api("/voice/packs/import", { method: "POST", body: { id: job.id, sourceDir: job.info.sourceDir, allowUnverified } });
          await waitImport(job.id);
        } catch (e) {
          if (e.code === "IMPORT_UNVERIFIED" && !allowUnverified) {
            setImportPick({ ...job, unverified: true });
          } else {
            setImportErr({ id: job.id, sourceDir: job.info.sourceDir, error: e.message, code: e.code, hint: e.hint, missing: e.missing });
          }
        } finally {
          setBusyId("");
        }
      };

      const removeImportedSource = async (id, sourceDir) => {
        if (!sourceDir) return;
        if (!window.confirm(`删除导入用的源文件夹？\n\n${sourceDir}\n\n删除不影响 SurfCore 使用；zip 和父目录不会动。`)) return;
        try {
          const r = await api("/voice/packs/import-delete-source", { method: "POST", body: { id, sourceDir } });
          setImportDone((d) => (d ? { ...d, sourceDir: null } : d));
          if (toast) toast(`✓ 已删除源文件夹（释放 ${fmt(r.freedBytes || 0)}）`);
          await load();
        } catch (e) {
          setImportErr({ id, error: e.message, code: e.code, hint: e.hint, missing: e.missing });
        }
      };

      const removeImportBackup = async (id, backupDir) => {
        if (!backupDir) return;
        if (!window.confirm(`删除旧包备份？\n\n${backupDir}\n\n只有确认新包能正常启动/自检后才建议删除。`)) return;
        try {
          await api("/voice/packs/import-delete-backup", { method: "POST", body: { id, backupDir } });
          setImportDone((d) => (d ? { ...d, backupDir: null } : d));
          if (toast) toast("✓ 已删除旧包备份");
          await load();
        } catch (e) {
          setImportErr({ id, error: e.message, code: e.code, hint: e.hint, missing: e.missing });
        }
      };

      const runningId = ((packs.filter((p) => p.running)[0]) || {}).id || "";
      const toggle = async () => {
        setBusyId("__switch"); setSwitchMsg("");
        try {
          if (runningId === pick) {
            await api("/voice/packs/stop", { method: "POST", body: { id: pick } });
            setSwitchMsg("已停止");
          } else {
            const r = await api("/voice/packs/activate", { method: "POST", body: { id: pick } });
            setSwitchMsg(r.ok ? "已启动：" + (pick === "voice-cloud" ? "云端" : "本地") : ("启动失败：" + (r.error || "")));
          }
          await load();
        } catch (e) { setSwitchMsg("失败：" + e.message); }
        finally { setBusyId(""); }
      };

      // 网盘离线包：Electron 里新窗口会被拦，交给宿主用系统浏览器打开；失败则复制链接兜底。
      const NETDISK_URL = "https://pan.quark.cn/s/ec6cf2b123de?pwd=sxUZ";
      const copyNetdisk = async () => {
        try { await navigator.clipboard.writeText(NETDISK_URL); if (toast) toast("✓ 网盘链接已复制（提取码 sxUZ）"); }
        catch (e) { if (toast) toast(`复制失败：${e.message}；链接：${NETDISK_URL}`); }
      };
      const openNetdisk = async () => {
        try {
          const r = await api("/voice/packs/netdisk", { method: "POST" });
          if (r.ok) { if (toast) toast("✓ 已用浏览器打开网盘（提取码 sxUZ）"); return; }
          if (toast) toast(`✗ ${r.error || "打不开浏览器"}${r.hint ? `；${r.hint}` : ""}`);
        } catch (e) {
          if (toast) toast(`✗ ${e.message}`);
        }
        await copyNetdisk();
      };

      const act = async (id, action, body) => {
        setBusyId(id);
        setMsg((m) => ({ ...m, [id]: action === "install" ? "开始安装…" : "处理中…" }));
        try {
          await api("/voice/packs/" + action, { method: "POST", body: { id, ...(action === "install" ? { mirror } : {}), ...(body || {}) } });
          if (action === "install") {
            const done = await poll(id);
            setMsg((m) => ({
              ...m,
              [id]: done === "ok"
                ? (id === "voice-cloud"
                  ? "✓ 安装完成 — 下一步：在下方「云端包：密钥与音色」填 AppID / Access Key / 音色 ID，否则启动不了"
                  : "✓ 安装完成")
                : done === "failed" ? "✗ 安装失败：见上方进度条下方的原因"
                  : "⏳ 还在安装（依赖阶段可能要几十分钟）；卡住可以点「取消安装」再来",
            }));
          }
          else setMsg((m) => ({ ...m, [id]: "" }));
          await load();
          if (action === "install" && id === "voice-cloud") {
            // 装完直接滚到密钥表单：新装不预置任何凭据，这一步不做云端包就是死的。
            setTimeout(() => {
              try { document.getElementById("surfcore-cloud-voice-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
            }, 300);
          }
        } catch (e) {
          setMsg((m) => ({ ...m, [id]: e.message }));
        } finally { setBusyId(""); }
      };

      const fmt = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.round(b / 1e6) + " MB");
      const saveRules = async () => {
        try { await api("/voice/rules", { method: "POST", body: rules }); toast("✓ 触发规则已保存"); }
        catch (e) { toast("✗ " + e.message); }
      };

      const card = (p) => h("div", {
        key: p.id,
        style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px", padding: "12px", marginBottom: "10px" },
      },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" } },
          h("strong", null, p.name),
          h("span", { style: { opacity: 0.75, fontSize: "12px" } },
            fmt(p.sizeBytes) + " · 端口 " + p.port + " · " + (p.install
              ? p.install.phase + " " + p.install.progress + "%"
              : p.running
                ? ((p.external ? "● 运行中（外部目录）" : "● 运行中")
                  + (p.enginePort && p.engineUp === false ? " · ⚠️ 音色引擎未起" : ""))
                : p.installed ? (p.needsCloudConfig ? "○ 已安装 · 待填云端密钥" : "○ 已安装 · 未运行") : "未安装"))),
        h("div", { style: { opacity: 0.8, margin: "6px 0", fontSize: "13px" } }, p.about && p.about.summary ? p.about.summary : ""),
        h("div", { style: { display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "12px", opacity: 0.8 } },
          h("ul", { style: { margin: 0, paddingLeft: "18px" } }, ((p.about && p.about.pros) || []).map((x) => h("li", { key: x }, x))),
          h("ul", { style: { margin: 0, paddingLeft: "18px", opacity: 0.7 } }, ((p.about && p.about.cons) || []).map((x) => h("li", { key: x }, x)))),
        p.about && p.about.billing ? h("div", { style: { fontSize: "12px", marginTop: "6px", opacity: 0.75 } },
          p.about.billing, h("br"), p.about.disclaimer || "") : null,
        (p.install || busyId === p.id)
          ? h("div", null,
            h(ProgressBar, {
              pct: p.install?.progress ?? 0,
              // 依赖阶段没有百分比：显示"已 X 分钟 + 最近在装什么"，否则用户不知道卡没卡
              phase: (() => {
                if (!p.install) return "正在启动安装…";
                const mins = Math.max(0, Math.round((Date.now() - Number(p.install.startedAt || Date.now())) / 60000));
                const tail = String(p.install.logTail || "").split(String.fromCharCode(10)).filter(Boolean).pop() || "";
                const phase = String(p.install.phase || "安装中");
                // 阶段名里已经带百分比时不再拼日志尾，避免出现"下载中 93%…下载中 93%"
                const showTail = tail && !/%/.test(phase);
                return `${phase} · 已 ${mins} 分钟${showTail ? ` · ${tail.slice(-60)}` : ""}`;
              })(),
              err: p.install?.error,
              indeterminate: !p.install || (/依赖|模型/.test(String(p.install.phase || '')) && Number(p.install.progress || 0) >= 99),
            }),
            p.install && p.install.phase !== "完成" && p.install.phase !== "失败"
              ? h("div", { style: { marginTop: "6px" } },
                h(Btn, { kind: "qbw-btn2", onClick: async () => {
                  try {
                    await api("/voice/packs/cancel", { method: "POST", body: { id: p.id } });
                    if (toast) toast("已取消安装（已下载的模型会保留）");
                    await load();
                  } catch (e) { if (toast) toast(`✗ ${e.message}`); }
                } }, "取消安装"))
              : null)
          : null,
        p.import && p.import.phase !== "完成" && p.import.phase !== "失败"
          ? h("div", { style: { marginTop: "8px" } },
            h(ProgressBar, { pct: p.import.progress, phase: p.import.phase, indeterminate: p.import.progress < 5 }),
            h("div", { style: { marginTop: "6px" } },
              h(Btn, { kind: "qbw-btn2", onClick: async () => {
                try { await api("/voice/packs/import-cancel", { method: "POST", body: { id: p.id } }); if (toast) toast("正在取消导入…"); await load(); }
                catch (e) { if (toast) toast(`✗ ${e.message}`); }
              } }, "取消导入")))
          : null,
        p.import && p.import.phase === "失败" && p.import.error
          ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, `导入失败：${p.import.error}`, p.import.hint ? ` — ${p.import.hint}` : "")
          : null,
        p.installed && p.dir ? h("div", { style: { fontSize: "12px", marginTop: "4px", opacity: 0.7 } }, "路径：", h("code", null, p.dir)) : null,
        p.id === "voice-cloud" && p.needsCloudConfig
          ? h("div", { style: { fontSize: "12px", marginTop: "4px", opacity: 0.9, color: "#e6a23c" } },
            "还没有密钥：安装包不预置任何凭据，请到本页下方「云端包：密钥与音色」填 AppID / Access Key / 音色 ID，否则云端语音启动不了。")
          : null,
        p.enginePort && p.running && p.engineUp === false
          ? h("div", { style: { fontSize: "12px", marginTop: "4px", opacity: 0.85 } },
            `本地音色引擎（GPT-SoVITS ${p.enginePort}）还没起来：点「启动」会自动拉起，约 40 秒后再试；期间发语音会失败。`)
          : null,
        h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" } },
          !p.installed ? h(Btn, { disabled: busyId === p.id, onClick: () => act(p.id, "install") }, "安装（" + fmt(p.sizeBytes) + "）") : null,
          h(Btn, { kind: "qbw-btn2", disabled: busyId === "__import" || (p.import && p.import.phase !== "完成" && p.import.phase !== "失败"), onClick: () => startImportFlow(p.id) },
            p.installed ? "重新导入离线包…" : "导入离线包…"),
          p.external ? h("span", { style: { fontSize: "12px", opacity: 0.7 } }, p.dir ? `已在别处安装：${p.dir}` : "已在别处安装（端口在跑）") : null,
          p.external && p.dir
            ? h(Btn, { kind: "qbw-btn2", onClick: async () => {
              const parent = String(p.dir).replace(/[\/][^\/]+$/, "");
              try {
                await api("/voice/tts", { method: "POST", body: { voicePacks: { dir: parent.split("\\").join("/") } } });
                if (toast) toast(`✓ 安装目录已指向 ${parent}`);
                await load();
              } catch (e) { if (toast) toast(`✗ ${e.message}`); }
            } }, "把安装目录设为这里")
            : null,
          p.installed ? h(Btn, { kind: "qbw-btn2", disabled: busyId === p.id, onClick: () => act(p.id, "remove") }, "卸载") : null,
          !p.installed ? h(Btn, { kind: "qbw-btn2", onClick: async () => {
            try {
              const r = await api("/voice/packs/clean", { method: "POST", body: { id: p.id } });
              const mb = ((r.freedBytes || 0) / 1024 / 1024).toFixed(1);
              toast(`✓ 已清理未完成的下载（${mb} MB）`);
              await load();
            } catch (e) { toast(`✗ ${e.message}`); }
          } }, "清理下载残留") : null,
          msg[p.id] ? h("span", { style: { fontSize: "12px", opacity: 0.8 } }, msg[p.id]) : null));

      const cloud = packs.find((p) => p.id === "voice-cloud");
      return h("div", null,
        h("div", { style: { fontSize: "13px", opacity: 0.85, marginBottom: "10px" } },
          "语音引擎不随插件分发。不装也能正常聊天，只是不能发语音。两个包互相独立，可只装一个。"),
        h(VoiceTtsSection, { toast }),
        h(VoiceSendParams, { toast }),
        err ? h("div", { className: "qbw-err" }, err) : null,
        h("div", { style: { marginTop: "14px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
          h("div", { style: { display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", fontSize: "13px" } },
            h("strong", null, "使用"),
            h("label", { style: { display: "flex", gap: "6px", alignItems: "center" } },
              h("input", { type: "radio", name: "voicePick", checked: pick === "voice-local", onChange: () => setPick("voice-local") }), "本地语音包"),
            h("label", { style: { display: "flex", gap: "6px", alignItems: "center" } },
              h("input", { type: "radio", name: "voicePick", checked: pick === "voice-cloud", onChange: () => setPick("voice-cloud") }), "云端语音包"),
            h(Btn, { disabled: busyId === "__switch", onClick: toggle }, busyId === "__switch" ? "处理中…" : (runningId === pick ? "停止" : "启动")),
            h("span", { style: { fontSize: "13px" } }, "语音系统：",
              runningId
                ? h("b", { style: { color: "#67c23a" } }, "● 已启动")
                : h("b", { style: { color: "#909399" } }, "○ 未启动")),
            h("span", { style: { fontSize: "13px" } }, "当前：",
              h("b", null, (runningId || pick) === "voice-cloud" ? "云端语音包" : "本地语音包"))),
          switchMsg ? h("div", { style: { fontSize: "12px", marginTop: "6px", opacity: 0.85 } }, switchMsg) : null,
          h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } }, "只能运行一个；切换会自动停掉另一个。")),
        packs.map(card),
        h("div", { style: { marginTop: "10px", padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(230,162,60,.45)", background: "rgba(230,162,60,.08)" } },
          h("div", { style: { fontSize: "13px", fontWeight: 600 } }, "网络不稳定装不上？用网盘下载离线包（本地包 / 云端包都适用）"),
          h("div", { style: { fontSize: "12px", opacity: 0.85, marginTop: "2px" } },
            "网盘里是完整的离线包。下载解压后，点对应卡片的「导入离线包…」，选择解压出来的 voice-local 或 voice-cloud 文件夹；导入会校验文件、保留旧包备份，失败会告诉你缺什么。"),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" } },
            h(Btn, { onClick: openNetdisk }, "打开网盘下载（提取码 sxUZ）"),
            h(Btn, { kind: "qbw-btn2", onClick: copyNetdisk }, "复制链接"),
            h("span", { style: { fontSize: "12px", opacity: 0.7 } }, "装完仍要按卡片提示启动/填密钥"))),

        h("div", { style: { marginTop: "10px", padding: "10px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
          h("div", { style: { fontSize: "13px", fontWeight: 600 } }, "下载链路"),
          h("div", { style: { fontSize: "12px", opacity: 0.75, marginTop: "2px" } },
            "官方源慢或连不上时换镜像。内容都有 sha256 校验，镜像方看不到你的会话，但能看到你下了什么。"),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" } },
            ...[
              { id: "", label: "官方（GitHub）" },
              { id: "https://ghfast.top", label: "镜像 · ghfast" },
              { id: "https://gh-proxy.com", label: "镜像 · gh-proxy" },
              { id: "https://ghproxy.net", label: "镜像 · ghproxy" },
            ].map((opt) => h(Btn, {
              key: opt.id || "official",
              kind: mirror === opt.id ? "qbw-btn" : "qbw-btn2",
              onClick: () => setMirror(opt.id),
            }, (mirror === opt.id ? "● " : "") + opt.label))),
          h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } },
            mirror ? `当前：${mirror}（下载时会拼在原地址前面）` : "当前：官方源；分卷下载默认 3 路并发")),
        h("div", { style: { marginTop: "10px", padding: "10px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
          h("div", { style: { fontSize: "13px", fontWeight: 600 } }, "安装目录"),
          h("div", { style: { fontSize: "12px", opacity: 0.75, marginTop: "2px" } },
            "默认在 ~/.dsh/surfcore/state/voice-packs；磁盘紧张或用户目录只读时改到这里。改完要重启桥接，已装的包请手动移动过去。安装依赖默认走清华源（可用 SURFCORE_PIP_INDEX 覆盖）。"),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" } },
            h("input", { className: "qbw-input", value: dirInput, placeholder: packsDir || "D:/voice-packs", style: { flex: "1 1 320px" }, onChange: (e) => setDirInput(e.target.value) }),
            h(Browse, { mode: "dir", title: "选择语音包安装目录", onPick: (v) => setDirInput(v) }),
            h(Btn, { kind: "qbw-btn2", onClick: async () => {
              const next = String(dirInput || "").trim();
              if (!next) { toast("✗ 目录不能为空"); return; }
              if (!/^[A-Za-z]:/.test(next) && !next.startsWith("/")) { toast("✗ 请填绝对路径，例如 D:/voice-packs"); return; }
              try {
                await api("/voice/tts", { method: "POST", body: { voicePacks: { dir: next.split(String.fromCharCode(92)).join("/") } } });
                toast("✓ 已保存；重启桥接后生效（已装的包请先移动到新目录）");
                await load();
              } catch (e) { toast(`✗ ${e.message}`); }
            } }, "保存路径")),
          h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } }, "当前生效：", h("code", null, packsDir || "（读不到）"))),
        h("div", { className: "qbw-hint", style: { marginTop: "10px" } },
          "⚠️ 改完语音总开关 / TTS / 发语音工具后，需要重启 DSH：工具列表在 MCP 进程启动时就固定了，不重启她还会说“没有语音入口”。"),

        // 云端凭据表单在内页「云端」里；这里不再重复渲染（2026-11-03 拆分时调整）

        importPick ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setImportPick(null); } },
          h("div", { className: "qbw-modal" },
            h("h3", null, "确认导入离线包"),
            h("div", { style: { fontSize: "13px", lineHeight: "1.8" } },
              h("div", null, "类型：", h("b", null, importPick.id === "voice-local" ? "本地语音包（voice-local）" : "云端语音包（voice-cloud）")),
              h("div", null, "来源：", h("code", null, importPick.info.sourceDir)),
              h("div", null, "目标：", h("code", null, importPick.info.targetDir || "标准安装目录")),
              h("div", null, "大小：", fmt(importPick.info.sizeBytes)),
              h("div", null, "版本：", importPick.info.version || "—"),
              h("div", null, "完整性：", importPick.info.verified ? "manifest 已校验" : "未验证（没有 manifest 或未声明哈希）")),
            (importPick.info.warnings || []).length
              ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
                (importPick.info.warnings || []).map((w, i) => h("div", { key: i }, "⚠️ ", w.message, w.hint ? ` ${w.hint}` : "")))
              : null,
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", onClick: () => setImportPick(null) }, "取消"),
              h(Btn, { onClick: () => submitImport(!importPick.info.verified) },
                importPick.info.verified ? "开始导入" : "仍要导入（未验证）")))
        ) : null,

        importErr ? h(ErrorModal, {
          title: "离线包导入失败",
          message: [
            importErr.code ? `错误代码：${importErr.code}` : "",
            importErr.error || "导入失败",
            (importErr.missing || []).length ? `缺失：${importErr.missing.join("、")}` : "",
          ].filter(Boolean).join("；"),
          hint: importErr.hint || "重新选择目录；如果包不完整，重新下载后再导入。",
          actions: [
            importErr.id ? {
              label: "重新选择目录",
              onClick: () => { const id = importErr.id; setImportErr(null); startImportFlow(id); },
            } : null,
            importErr.id && importErr.code === "IMPORT_TARGET_RUNNING" ? {
              label: "先停止语音包",
              onClick: async () => {
                try {
                  await api("/voice/packs/stop", { method: "POST", body: { id: importErr.id } });
                  const id = importErr.id; setImportErr(null); startImportFlow(id);
                } catch (e) { if (toast) toast(`✗ ${e.message}`); }
              },
            } : null,
          ].filter(Boolean),
          onClose: () => setImportErr(null),
        }) : null,

        importDone ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setImportDone(null); } },
          h("div", { className: "qbw-modal" },
            h("h3", null, "已导入，尚未验证运行"),
            h("div", { style: { fontSize: "13px", lineHeight: "1.8" } },
              h("div", null, "目标：", h("code", null, importDone.targetDir || "")),
              importDone.sourceDir ? h("div", null, "源文件夹仍保留：", h("code", null, importDone.sourceDir)) : null,
              importDone.backupDir ? h("div", null, "旧包备份：", h("code", null, importDone.backupDir)) : null,
              h("div", null, "完整性：", importDone.verified ? "manifest 已校验" : "未验证")),
            h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
              "文件已导入；语音服务能否正常出声还没有验证。请点「启动语音包」后再试一条语音；有旧包备份时，确认新包可用前不要删除。"),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: async () => { setImportDone(null); await act(importDone.id, "start"); } }, "启动语音包"),
              importDone.sourceDir && !importDone.alreadyInPlace
                ? h(Btn, { kind: "qbw-btn2", onClick: () => removeImportedSource(importDone.id, importDone.sourceDir) }, "删除源文件夹")
                : null,
              importDone.backupDir
                ? h(Btn, { kind: "qbw-btn2", onClick: () => removeImportBackup(importDone.id, importDone.backupDir) }, "删除旧备份")
                : null,
              h(Btn, { kind: "qbw-btn2", onClick: () => setImportDone(null) }, "关闭")))
        ) : null,

        rules ? h("div", { style: { marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--dsw-alias-border-l2)" } },
          h("strong", null, "触发规则"),
          h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "8px", flexWrap: "wrap", fontSize: "13px" } },
            "允许谁触发",
            h("select", { value: rules.triggerWho, onChange: (e) => setRules({ ...rules, triggerWho: e.target.value }), style: { width: "180px" } },
              h("option", { value: "owner" }, "仅主人（推荐）"),
              h("option", { value: "anyone" }, "任何人"),
              h("option", { value: "list" }, "指定成员"))),
          h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "8px", flexWrap: "wrap", fontSize: "13px" } },
            "频率上限",
            h("input", { type: "number", min: 1, max: 60, value: rules.maxPerMinute, onChange: (e) => setRules({ ...rules, maxPerMinute: Number(e.target.value) }), style: { width: "70px" } }), "条/分钟",
            h("input", { type: "number", min: 1, max: 600, value: rules.maxPerHour, onChange: (e) => setRules({ ...rules, maxPerHour: Number(e.target.value) }), style: { width: "70px" } }), "条/小时"),
          h("label", { style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", fontSize: "13px" } },
            h("input", { type: "checkbox", checked: !!rules.aiEnabled, onChange: (e) => setRules({ ...rules, aiEnabled: e.target.checked }) }),
            "允许 AI 主动发语音（默认关；关着只有你手动试发才出声）"),
          h("div", { style: { marginTop: "8px" } }, h(Btn, { onClick: saveRules }, "保存触发规则")),
          h("div", { style: { fontSize: "12px", opacity: 0.7, marginTop: "6px" } },
            "仅主人可触发：群聊里最后一条消息必须是你发的（5 分钟内），且一条消息最多换一条语音。")) : null);
    }

    // ── 本插件的状态与数据 ──────────────────────────────────────────────────
    // 原生目录选择：架构上由「SurfCore · 核心」提供 /browse（见 SPLIT-ARCHITECTURE §1）。
    // 本包不重复实现原生弹框；这里先问自己（未实现会 404），再退到 core 包前缀（同源 HTTP），
    // 都不可用时给一句可读提示，让用户手动填绝对路径。
    async function browseAt(base, mode, title) {
      const q = `mode=${mode === "file" ? "file" : "dir"}&title=${encodeURIComponent(title)}`;
      try {
        const res = await fetch(`${base}/browse?${q}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(180000) });
        const data = await res.json().catch(() => ({}));
        return { ...data, _status: res.status };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error), _status: 0 };
      }
    }

    async function pickNativeDir(mode = "dir", title = "") {
      const bases = [API, "/dsh-surfcore-core/api"];
      let last = null;
      for (const base of bases) {
        const r = await browseAt(base, mode, title);
        last = r;
        // 404/连不上 = 这个前缀没有 browse（本包本来就没有；core 没装也没有）→ 换下一个
        if (r._status === 404 || r._status === 0) continue;
        return r;
      }
      return {
        ok: false,
        error: `没有可用的原生选择框${last?.error ? `（${last.error}）` : ""}`,
        hint: "原生选择框由「SurfCore · 核心」提供；也可以手动填绝对路径。",
      };
    }

    const STATUS_ROUTE_OPTIONS = [
      ["local", "本地（voxd 8765 + GPT-SoVITS 9880）"],
      ["cloud", "云端语音包（8767）"],
    ];

    // ── TTS 路由 / 角色音色 / 端口体检 ────────────────────────────────────
    // 旧版这几个值只在「全部参数」里裸改；拆出来后本包是 socialV2.voice* 的唯一写者，
    // 所以在这里给一个正经表单（走 /voice/tts，宿主半边用 config-lock 落盘）。
    function VoiceTtsSection({ toast }) {
      const [info, setInfo] = useState(null);
      const [form, setForm] = useState(null);
      const [health, setHealth] = useState(null);
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState("");

      const load = useCallback(async () => {
        try {
          const r = await api("/voice/tts");
          setInfo(r);
          const t = r.voice?.tts ?? {};
          setForm({
            enabled: r.voice?.enabled === true,
            ttsEnabled: t.enabled === true,
            route: t.route === "cloud" ? "cloud" : "local",
            character: t.character || "",
            baseUrl: t.baseUrl || "http://127.0.0.1:8765",
            endpoints: {
              local: t.endpoints?.local || "http://127.0.0.1:8765",
              cloud: t.endpoints?.cloud || "http://127.0.0.1:8767",
            },
            maxChars: t.maxChars ?? 120,
          });
          setErr("");
        } catch (e) { setErr(String(e?.message ?? e)); }
      }, []);
      useEffect(() => { void load(); }, [load]);

      const save = async () => {
        if (!form) return;
        setBusy(true); setMsg("保存中…");
        try {
          await api("/voice/tts", {
            method: "POST",
            body: {
              voice: {
                enabled: form.enabled,
                tts: {
                  enabled: form.ttsEnabled,
                  route: form.route,
                  character: form.character,
                  baseUrl: form.baseUrl,
                  endpoints: { local: form.endpoints.local, cloud: form.endpoints.cloud },
                  maxChars: Number(form.maxChars) || 120,
                },
              },
            },
          });
          setMsg("✓ 已保存（重启 QQ 桥接后完全生效）");
          if (toast) toast("✓ TTS 路由与角色音色已保存");
          await load();
        } catch (e) {
          setMsg(`保存失败：${e.message}${e.hint ? `（${e.hint}）` : ""}`);
        } finally { setBusy(false); }
      };

      const check = async () => {
        setBusy(true); setMsg("检查中…");
        try { setHealth(await api("/voice/health")); setMsg("✓ 已重新检查端口"); }
        catch (e) { setMsg(`检查失败：${e.message}`); }
        finally { setBusy(false); }
      };

      const boxStyle = { marginTop: "14px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" };
      if (!form) {
        return h("div", { style: boxStyle },
          h("strong", null, "TTS 路由 / 角色音色"),
          err ? h("div", { className: "qbw-err" }, err) : h("div", { className: "qbw-hint" }, "读取中…"));
      }
      const characters = info?.characters || [];
      const ports = health?.ports || info?.ports || [];
      return h("div", { style: boxStyle },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" } },
          h("strong", null, "TTS 路由 / 角色音色"),
          h("span", { style: { fontSize: "12px", opacity: 0.7 } }, "改完点保存；桥接在启动时读配置")),
        err ? h("div", { className: "qbw-err" }, err) : null,
        h(Row, { label: "启用语音发送", hint: "总开关：关掉后 QQ 不发语音消息（socialV2.voice.enabled）" },
          h("input", { className: "qbw-switch", type: "checkbox", checked: !!form.enabled, onChange: (e) => setForm({ ...form, enabled: e.target.checked }) })),
        h(Row, { label: "启用 TTS 合成", hint: "文字现场合成语音（socialV2.voice.tts.enabled）" },
          h("input", { className: "qbw-switch", type: "checkbox", checked: !!form.ttsEnabled, onChange: (e) => setForm({ ...form, ttsEnabled: e.target.checked }) })),
        h(Row, { label: "TTS 路由", hint: "local=本机 voxd（8765，角色音色走 9880）；cloud=云端语音包（8767）" },
          h("select", { className: "qbw-select", value: form.route, onChange: (e) => setForm({ ...form, route: e.target.value }) },
            STATUS_ROUTE_OPTIONS.map(([value, label]) => h("option", { key: value, value }, label)))),
        h(Row, { label: "角色音色", hint: characters.length ? `可选：${characters.join("、")}` : "还没检测到已安装语音包的角色；可先安装/启动语音包，或留空用运行时默认" },
          h("select", { className: "qbw-select", value: form.character, onChange: (e) => setForm({ ...form, character: e.target.value }) },
            h("option", { value: "" }, "（留空）"),
            characters.map((c) => h("option", { key: c, value: c }, c)),
            // 配置里已有、但包内读不到（包没装/没启动）时也要能显示，避免看起来像被清空了。
            form.character && !characters.includes(form.character)
              ? h("option", { value: form.character }, `${form.character}（包内未找到）`)
              : null)),
        h(Row, { label: "本地入口 baseUrl", hint: "默认 http://127.0.0.1:8765" },
          h("input", { className: "qbw-input", value: form.baseUrl, onChange: (e) => setForm({ ...form, baseUrl: e.target.value }) })),
        h(Row, { label: "本地 / 云端端点", hint: "tts.endpoints.local / tts.endpoints.cloud" },
          h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
            h("input", { className: "qbw-input", value: form.endpoints.local, onChange: (e) => setForm({ ...form, endpoints: { ...form.endpoints, local: e.target.value } }) }),
            h("input", { className: "qbw-input", value: form.endpoints.cloud, onChange: (e) => setForm({ ...form, endpoints: { ...form.endpoints, cloud: e.target.value } }) }))),
        h(Row, { label: "单条最多字数", hint: "超过会被拒绝（tts.maxChars）" },
          h("input", { className: "qbw-input", type: "number", min: 1, value: form.maxChars, onChange: (e) => setForm({ ...form, maxChars: Number(e.target.value) || 120 }) })),
        h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" } },
          h(Btn, { disabled: busy, onClick: save }, busy ? "处理中…" : "保存 TTS 配置"),
          h(Btn, { kind: "qbw-btn2", disabled: busy, onClick: check }, "重新检查端口"),
          msg ? h("span", { style: { fontSize: "12px", opacity: 0.85 } }, msg) : null),
        h("div", { style: { display: "flex", gap: "14px", flexWrap: "wrap", marginTop: "8px", fontSize: "12px" } },
          ports.map((port) => h(StatusDot, { key: port.key, ok: port.open, warn: false },
            `${port.label}（${port.port}）${port.open ? "在监听" : "没监听"}`))),
        h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          "角色音色必须填 [voice.characters] 里的名字，不能填音色 id（如 loli12-gsv / age12-cloud）。"),
        health?.hints?.length
          ? h("div", { className: "qbw-warnbox" }, health.hints.map((text, i) => h("div", { key: i }, "⚠️ ", text)))
          : null);
    }

    // ── 发语音参数（socialV2.voice.*，本包是唯一写者）────────────────────
    const SEND_FIELDS = [
      { key: "dir", label: "语音库目录", hint: "相对 surfcore 根目录；也可以填绝对路径（需打开「允许绝对路径」）", kind: "text", wide: true },
      { key: "maxSeconds", label: "最长秒数", kind: "number", min: 1 },
      { key: "maxBytes", label: "最大字节", kind: "number" },
      { key: "maxPerMinute", label: "每分钟最多", kind: "number", min: 0 },
      { key: "maxPerHour", label: "每小时最多", kind: "number", min: 0 },
      { key: "allowAbsolutePath", label: "允许绝对路径", hint: "⚠️ 会扩大文件读取面", kind: "switch" },
      { key: "defaultVolume", label: "默认音量倍数", kind: "number", min: 0, max: 4, step: 0.1 },
      { key: "loudness", label: "响度档位", kind: "select", options: [["quiet", "quiet"], ["normal", "normal"], ["loud", "loud"]] },
      { key: "ffmpegPath", label: "ffmpeg 路径", hint: "留空走 PATH", kind: "text", wide: true },
      { key: "autoReadback", label: "自动回读", kind: "switch" },
    ];

    function VoiceSendParams({ toast }) {
      const [voice, setVoice] = useState(null);
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState("");

      const load = useCallback(async () => {
        try { const r = await api("/voice/tts"); setVoice(r.voice ?? {}); setErr(""); }
        catch (e) { setErr(String(e?.message ?? e)); }
      }, []);
      useEffect(() => { void load(); }, [load]);

      const save = async () => {
        if (!voice) return;
        setBusy(true); setMsg("保存中…");
        try {
          // 只提交本面板负责的键：tts / trigger / cloud 由别的面板或桥接管，不能被整份覆盖。
          const patch = {};
          for (const f of SEND_FIELDS) if (voice[f.key] !== undefined) patch[f.key] = voice[f.key];
          await api("/voice/tts", { method: "POST", body: { voice: patch } });
          setMsg("✓ 已保存（重启桥接后完全生效）");
          if (toast) toast("✓ 发语音参数已保存");
          await load();
        } catch (e) { setMsg(`保存失败：${e.message}${e.hint ? `（${e.hint}）` : ""}`); }
        finally { setBusy(false); }
      };

      return h(Section, { title: "发语音参数", note: "socialV2.voice.*（本包是唯一写者，写前走配置锁）", defaultOpen: false },
        err ? h("div", { className: "qbw-err" }, err) : null,
        !voice ? h("div", { className: "qbw-hint" }, "读取中…") : SEND_FIELDS.map((f) => h(Field, {
          key: f.key,
          f: { ...f, path: p(`voice.${f.key}`) },
          value: voice[f.key],
          onChange: (value) => setVoice({ ...voice, [f.key]: value }),
        })),
        h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", alignItems: "center", flexWrap: "wrap" } },
          h(Btn, { disabled: busy, onClick: save }, busy ? "保存中…" : "保存发语音参数"),
          msg ? h("span", { style: { fontSize: "12px", opacity: 0.85 } }, msg) : null),
        h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          "桥接只在启动时读 config.json：改完先保存，再到「SurfCore · QQ」栏目点「重启桥接」才完全生效。"));
    }

    // ── 栏目外壳：内页「语音 / 云端」──────────────────────────────────────
    const TABS = [
      ["voice", "语音"],
      ["cloud", "云端"],
    ];
    const NS = "surfcore-voice";

    function surfcoreVoiceSection() {
      useStyleOnce();
      const [tab, setTab] = useState("voice");
      const [status, setStatus] = useState(null);
      const [health, setHealth] = useState(null);
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      const [toastText, setToastText] = useState("");

      const toast = useCallback((text) => {
        const value = String(text ?? "");
        __voiceToast = value;
        setToastText(value);
        setTimeout(() => {
          setToastText("");
          if (__voiceToast === value) __voiceToast = null;
        }, 3200);
      }, []);
      // 公共套件里 Field/Browse 的失败提示用这个出口；挂载时赋值、卸载时清掉（不污染旧全局）。
      useEffect(() => {
        __voiceToast = toast;
        return () => { __voiceToast = null; };
      }, [toast]);

      const reload = useCallback(async () => {
        setBusy(true);
        try {
          const [st, he] = await Promise.all([api("/status"), api("/voice/health")]);
          setStatus(st);
          setHealth(he);
          setErr("");
        } catch (error) { setErr(String(error?.message ?? error)); }
        finally { setBusy(false); }
      }, []);
      useEffect(() => { void reload(); }, [reload]);

      const bridgeOk = status?.bridge?.consoleReachable === true;
      const ports = health?.ports ?? [];
      const running = ports.find((port) => port.key === "voxd")?.open === true;

      return h("div", { className: "qbw-app" },
        h("div", { className: "qbw-head" },
          h("p", { className: "qbw-kicker" }, "DeepSeek Harness · SurfCore"),
          h("h3", { className: "qbw-title" }, "SurfCore · 语音",
            h("span", { className: "qbw-badge" }, `v${status?.version ?? "0.1.0"}`),
            h("span", { className: "qbw-dots" },
              h(StatusDot, { ok: bridgeOk, warn: false }, bridgeOk ? "桥接在线" : "桥接未运行"),
              h(StatusDot, { ok: running, warn: !running }, running ? "语音服务在跑" : "语音服务未启动"),
              h(StatusDot, { ok: health?.healthy === true, warn: health?.healthy !== true }, health?.healthy ? "链路正常" : "链路待检查"))),
          h("p", { className: "qbw-sub" },
            "语音包安装/启停、TTS 路由与角色音色、云端凭据与额度。语音服务本体在 QQ 桥接进程里：本栏目只负责配置、代理与健康检查，不自己起 TTS。")),
        h("div", { className: "qbw-tabs" }, TABS.map(([id, label]) => h("button", {
          key: id, className: "qbw-tab" + (tab === id ? " on" : ""), onClick: () => setTab(id),
        }, label))),
        h("div", { className: "qbw-body" },
          err ? h("div", { className: "qbw-err", style: { marginBottom: "8px" } }, err) : null,
          tab === "voice" ? h(VoiceTab, { toast }) : null,
          tab === "cloud" ? h("div", null,
            h("div", { style: { fontSize: "13px", opacity: 0.85, marginBottom: "10px" } },
              "云端语音包（火山引擎声音复刻）的凭据与额度。密钥只写在本机包内的 config.toml，不上传任何服务器。"),
            h(CloudForm, { toast }),
            health ? h("div", { className: "qbw-hint", style: { marginTop: "10px" } },
              `端口体检：${ports.map((port) => `${port.port}=${port.open ? "开" : "关"}`).join(" · ")}`) : null) : null),
        h("div", { className: "qbw-foot" },
          h(Btn, { onClick: () => void reload(), disabled: busy }, busy ? "刷新中…" : "重新读取"),
          h("span", { className: "spacer" }),
          h("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px" } },
            health?.hints?.[0] ? `⚠️ ${health.hints[0]}` : "语音引擎不随插件分发；不装也能正常聊天，只是不能发语音。"),
          toastText ? h("span", { style: { marginLeft: "10px", color: "var(--dsw-alias-label-secondary)" } }, toastText) : null));
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject("settings.section", () =>
          ctx.slots.register({ name: "settings.section", id: NS, order: 14, label: () => "SurfCore · 语音" }, surfcoreVoiceSection),
          "surfcore-voice: settings section"),
        "surfcore-voice: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.surfcoreVoiceSection = surfcoreVoiceSection;
    exports.VoiceTab = VoiceTab;
    exports.CloudForm = CloudForm;
    exports.__test = { API, CSS_TAG };
    return module.exports;
  },
});
