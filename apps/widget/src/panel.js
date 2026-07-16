/* RhetorLint widget panel — the in-page UI.
 *
 * Depends on `analyze`, `strip` and `RULES` being in scope (the build step
 * prepends the real @rhetorlint/core engine and the rule pack). It reads the
 * current text selection, marks the tells, and shows them in a floating panel
 * rendered in a Shadow DOM so no page styles leak in or out.
 *
 * Everything runs on-device. Nothing the reader selects ever leaves the page.
 */
const CAP_FAMILY_HUE = {
  "manipulative-wording": 41,
  "simplification": 22,
  "distraction": 200,
  "attack-on-reputation": 350,
  "justification": 270,
  "call": 150,
  "agency-hiding": 3
};

function capEscape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* Render the selected text with each marked phrase wrapped, handling overlaps
   by segmenting on mark boundaries. */
function capMarkup(text, marks) {
  if (!marks.length) return capEscape(text);
  const bounds = new Set([0, text.length]);
  for (const m of marks) { bounds.add(m.position.start.offset); bounds.add(m.position.end.offset); }
  const pts = [...bounds].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const covering = marks.filter((m) => m.position.start.offset <= a && m.position.end.offset >= b);
    const seg = capEscape(text.slice(a, b));
    if (covering.length) {
      const fam = covering[0].family;
      const hue = CAP_FAMILY_HUE[fam] ?? 41;
      const title = covering.map((m) => m.ruleId + " — " + m.note).join(" · ");
      html += `<mark style="--h:${hue}" title="${capEscape(title)}">${seg}</mark>`;
    } else html += seg;
  }
  return html;
}

function capBand(v) { return v >= 15 ? "hot" : v >= 6 ? "warm" : "cool"; }

const CAP_CSS = `
:host{ all: initial; }
.cap-wrap{ position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
  width: min(420px, calc(100vw - 36px)); max-height: min(76vh, 720px); overflow: auto;
  font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.5;
  background: #faf7ef; color: #221f18; border: 1px solid #d8d0bd; border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0,0,0,.28); }
@media (prefers-color-scheme: dark){ .cap-wrap{ background:#191b1f; color:#e9e3d4; border-color:#333; } }
.cap-head{ display:flex; align-items:center; justify-content:space-between; gap:.5rem;
  padding:.7rem .9rem; border-bottom:1px solid #e4dcc9; position:sticky; top:0; background:inherit; }
@media (prefers-color-scheme: dark){ .cap-head{ border-color:#2c2c2c; } }
.cap-title{ font-weight:700; letter-spacing:.02em; }
.cap-title small{ font-weight:400; opacity:.6; font-size:.72rem; }
.cap-x{ border:none; background:none; cursor:pointer; font-size:1.1rem; color:inherit; opacity:.6; padding:.1rem .3rem; }
.cap-x:hover{ opacity:1; }
.cap-body{ padding:.8rem .9rem 1rem; }
.cap-density{ display:flex; align-items:baseline; gap:.5rem; margin-bottom:.7rem;
  font-variant-numeric:tabular-nums; }
.cap-num{ font-size:1.7rem; font-weight:700; font-family:ui-monospace, Menlo, monospace; }
.cap-num.hot{ color:#b1442f; } .cap-num.warm{ color:#a6742a; } .cap-num.cool{ color:#2f7a52; }
@media (prefers-color-scheme: dark){ .cap-num.hot{color:#e0765d;} .cap-num.warm{color:#d4a24e;} .cap-num.cool{color:#5fbd8a;} }
.cap-den-lbl{ opacity:.6; font-size:.82rem; }
.cap-read{ font-family:"Iowan Old Style", Palatino, Georgia, serif; font-size:1.02rem; line-height:1.7;
  background:#fff; border:1px solid #e4dcc9; border-radius:6px; padding:.7rem .8rem; margin-bottom:.8rem; }
@media (prefers-color-scheme: dark){ .cap-read{ background:#111; border-color:#2c2c2c; } }
.cap-read mark{ background: hsla(var(--h,41), 75%, 55%, .28); color:inherit; padding:0 .04em;
  border-bottom:2px solid hsl(var(--h,41), 60%, 45%); border-radius:2px; cursor:help; }
.cap-mark{ display:flex; gap:.55rem; padding:.45rem 0; border-top:1px dashed #e4dcc9; }
@media (prefers-color-scheme: dark){ .cap-mark{ border-color:#2c2c2c; } }
.cap-swatch{ width:.7rem; height:.7rem; border-radius:2px; margin-top:.35rem; flex:0 0 auto; }
.cap-mark .rid{ font-family:ui-monospace, Menlo, monospace; font-size:.72rem; opacity:.7; }
.cap-mark .phrase{ font-weight:600; }
.cap-mark .note{ opacity:.8; font-size:.86rem; }
.cap-strip{ margin-top:.8rem; padding-top:.7rem; border-top:1px solid #e4dcc9; }
.cap-strip .k{ font-size:.7rem; text-transform:uppercase; letter-spacing:.1em; opacity:.55; }
.cap-strip .v{ font-family:"Iowan Old Style", Palatino, Georgia, serif; }
.cap-foot{ margin-top:.8rem; font-size:.74rem; opacity:.55; }
.cap-empty{ opacity:.7; font-style:italic; }
`;

function capShow(result, selectedText) {
  document.getElementById("rhetorlint-widget-host")?.remove();
  const host = document.createElement("div");
  host.id = "rhetorlint-widget-host";
  const root = host.attachShadow({ mode: "open" });
  const d = result.density;
  const marksHtml = result.marks.length
    ? result.marks.map((m) => {
        const hue = CAP_FAMILY_HUE[m.family] ?? 41;
        return `<div class="cap-mark">
          <span class="cap-swatch" style="background:hsl(${hue},60%,50%)"></span>
          <div><div class="phrase">${capEscape(m.actual)} <span class="rid">${capEscape(m.ruleId)}</span></div>
          <div class="note">${capEscape(m.note)}</div></div></div>`;
      }).join("")
    : `<p class="cap-empty">No tells found. The language is doing what it says.</p>`;

  root.innerHTML = `<style>${CAP_CSS}</style>
    <div class="cap-wrap" role="dialog" aria-label="RhetorLint reading">
      <div class="cap-head">
        <div class="cap-title">RhetorLint <small>reads the words, not the person</small></div>
        <button class="cap-x" aria-label="Close">✕</button>
      </div>
      <div class="cap-body">
        <div class="cap-density">
          <span class="cap-num ${capBand(d.per100Words)}">${d.per100Words}</span>
          <span class="cap-den-lbl">tells per 100 words · ${d.tells} in ${result.source.words}</span>
        </div>
        <div class="cap-read">${capMarkup(selectedText, result.marks)}</div>
        ${marksHtml}
        ${result.marks.length ? `<div class="cap-strip"><div class="k">strip · spin removed, hidden agents flagged</div><div class="v">${capEscape(result.strip)}</div></div>` : ""}
        <div class="cap-foot">On-device · nothing you selected left this page.</div>
      </div>
    </div>`;
  root.querySelector(".cap-x").addEventListener("click", () => host.remove());
  document.body.appendChild(host);
}

function capRun() {
  const sel = String(window.getSelection ? window.getSelection() : "").trim();
  const text = sel || document.body.innerText.slice(0, 4000);
  if (!text.trim()) return;
  try { capShow(analyze(text, { rules: RULES }), text); }
  catch (e) { /* engine should never throw on string input; fail silent to not disrupt the page */ }
}
