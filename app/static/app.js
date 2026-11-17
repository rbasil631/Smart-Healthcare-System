(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NS = "http://www.w3.org/2000/svg";
  const BASE_Y = 150, TOP_Y = 34;
  let W = 1000;
  const state = { user: null, model: null, band: { refer_low: 0.39, refer_high: 0.61 }, threshold: 0.385, last: null, ctx: null };

  const EXAMPLES = {
    low:  { age: 39, sex: 0, chest_pain_type: 2, resting_bp_s: 120, cholesterol: 204, fasting_blood_sugar: 0, resting_ecg: 0, max_heart_rate: 170, exercise_angina: 0, oldpeak: 0.0, ST_slope: 1 },
    high: { age: 56, sex: 1, chest_pain_type: 4, resting_bp_s: 128, cholesterol: 223, fasting_blood_sugar: 0, resting_ecg: 1, max_heart_rate: 119, exercise_angina: 1, oldpeak: 2.0, ST_slope: 3 },
  };
  const NUMERIC = ["age", "resting_bp_s", "cholesterol", "max_heart_rate", "oldpeak"];
  const RADIOS = ["sex", "chest_pain_type", "fasting_blood_sugar", "resting_ecg", "exercise_angina", "ST_slope"];
  const LIMITS = { age: [18, 100], resting_bp_s: [60, 250], cholesterol: [80, 700], max_heart_rate: [50, 230], oldpeak: [-3, 7] };

  const pct = (p, d = 0) => `${(p * 100).toFixed(d)}%`;
  const pts = (v) => Math.abs(v) < 0.0005 ? "0.0 pts" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} pts`;
  const x = (p) => Math.max(0, Math.min(1, p)) * W;
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if ((k === "fill" || k === "stroke") && String(v).startsWith("var(")) n.style.setProperty(k, v);
      else n.setAttribute(k, v);
    }
    if (parent) parent.appendChild(n);
    return n;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sexWord = (s) => (Number(s) === 1 ? "male" : "female");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  function toast(msg, isError = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("error", isError);
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 3400);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      state.user = null; showAuth("login");
      throw new Error("Your session has ended. Please sign in again.");
    }
    if (!res.ok) {
      let detail = res.statusText;
      try { const j = await res.json(); detail = typeof j.detail === "string" ? j.detail : (j.detail || []).map(d => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join("; "); } catch (_) {}
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return res.json();
  }
  const post = (path, body, method = "POST") => api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  function verdictKind(decision) {
    if (decision.startsWith("Disease")) return "risk";
    if (decision.startsWith("No disease")) return "safe";
    return "refer";
  }
  const shortDecision = (d) => d.replace(" - refer to clinician", "");
  const tag = (d) => `<span class="tag ${verdictKind(d)}"><i></i>${esc(shortDecision(d))}</span>`;
  const posBar = (p) => `<div class="pos" style="--lo:${state.band.refer_low * 100}%;--hi:${state.band.refer_high * 100}%"><b style="left:${p * 100}%"></b></div>`;

  /* ------------------------------------------------------------ risk strip */
  function measureStrip() {
    W = Math.max(300, Math.round($("#strip").parentElement.clientWidth) || 1000);
    $("#strip").setAttribute("viewBox", `0 0 ${W} 230`);
  }
  function drawStrip() {
    measureStrip();
    const narrow = W < 640;
    const z = $("#zones"); z.innerHTML = "";
    const { refer_low: lo, refer_high: hi } = state.band;
    const zones = [
      [0, lo, "var(--safe-tint)", "var(--safe)", narrow ? "No disease" : "No disease likely"],
      [lo, hi, "var(--refer-tint)", "var(--refer)", narrow ? "Refer" : "Refer to clinician"],
      [hi, 1, "var(--risk-tint)", "var(--risk)", narrow ? "Disease" : "Disease likely"],
    ];
    for (const [a, b, fill, ink, label] of zones) {
      el("rect", { x: x(a), y: 0, width: x(b) - x(a), height: 196, fill, opacity: 0.55 }, z);
      el("rect", { x: x(a), y: 192, width: x(b) - x(a), height: 4, fill: ink }, z);
      const t = el("text", { x: (x(a) + x(b)) / 2, y: 22, "text-anchor": "middle", class: "zone-label", fill: ink }, z);
      t.textContent = label;
    }
    // ECG-paper grid on the probability scale: minor line every 1 point, major every 5.
    const g = $("#grid"); g.innerHTML = "";
    const step = narrow ? 2 : 1;
    for (let i = 0; i <= 100; i += step) {
      const major = i % 10 === 0 || (!narrow && i % 5 === 0);
      el("line", { x1: x(i / 100), x2: x(i / 100), y1: 0, y2: 192, stroke: major ? "var(--grid-major)" : "var(--grid-minor)", "stroke-width": 1, opacity: major ? 0.9 : 0.75 }, g);
    }
    for (let yy = 0; yy <= 190; yy += 10) {
      el("line", { x1: 0, x2: W, y1: yy, y2: yy, stroke: yy % 50 === 0 ? "var(--grid-major)" : "var(--grid-minor)", "stroke-width": 1, opacity: yy % 50 === 0 ? 0.9 : 0.75 }, g);
    }
    const thr = el("g", {}, z);
    el("line", { x1: x(state.threshold), x2: x(state.threshold), y1: 40, y2: 192, stroke: "var(--ink-3)", "stroke-width": 1, "stroke-dasharray": "1 4" }, thr);
    const tt = el("text", { x: x(state.threshold) + 6, y: 186, class: "axis" }, thr);
    tt.textContent = narrow ? `threshold ${pct(state.threshold)}` : `decision threshold ${pct(state.threshold)}`;

    const ax = $("#axis"); ax.innerHTML = "";
    for (let i = 0; i <= 10; i += narrow ? 2 : 1) {
      const p = i / 10;
      const t = el("text", { x: Math.min(W - 4, Math.max(4, x(p))), y: 218, "text-anchor": i === 0 ? "start" : i === 10 ? "end" : "middle", class: "axis" }, ax);
      t.textContent = `${i * 10}%`;
    }
  }

  // One ECG beat (P, QRS, T) of width ~110, scaled by amplitude a, starting at x0.
  function beat(x0, a, peak = null) {
    const r = peak ?? BASE_Y - 70 * a;
    return [
      `L${x0} ${BASE_Y}`,
      `Q${x0 + 10} ${BASE_Y - 12 * a} ${x0 + 20} ${BASE_Y}`,
      `L${x0 + 30} ${BASE_Y}`, `L${x0 + 35} ${BASE_Y + 10 * a}`,
      `L${x0 + 42} ${r}`, `L${x0 + 49} ${BASE_Y + 22 * a}`, `L${x0 + 54} ${BASE_Y}`,
      `L${x0 + 70} ${BASE_Y}`, `Q${x0 + 84} ${BASE_Y - 20 * a} ${x0 + 98} ${BASE_Y}`,
    ].join(" ");
  }
  function tracePath(p) {
    const mx = x(p);
    let d = `M0 ${BASE_Y}`;
    const period = 125;
    let cur = 8;
    while (cur + period < mx - 60) { d += " " + beat(cur, 0.55); cur += period; }
    // final beat: R peak lands exactly on the probability
    const start = mx - 42;
    d += ` L${start} ${BASE_Y} ` + beat(start, 0.9, TOP_Y).replace(/^L[^L]*?(?=Q)/, "");
    d += ` L${W} ${BASE_Y}`;
    return d;
  }
  function plotProbability(p, animate = true) {
    const trace = $("#trace");
    trace.setAttribute("class", "");
    trace.setAttribute("d", tracePath(p));
    const len = trace.getTotalLength();
    trace.style.strokeDasharray = len;
    trace.style.strokeDashoffset = len;
    void trace.getBoundingClientRect();
    if (animate) trace.setAttribute("class", "drawing");
    else { trace.style.strokeDasharray = ""; trace.style.strokeDashoffset = ""; }
    $("#markerLine").setAttribute("x1", x(p)); $("#markerLine").setAttribute("x2", x(p));
    $("#markerDot").setAttribute("cx", x(p));
    $("#marker").classList.remove("show"); void $("#marker").getBoundingClientRect(); $("#marker").classList.add("show");
  }
  function stripPending() {
    const trace = $("#trace");
    trace.style.strokeDasharray = ""; trace.style.strokeDashoffset = "";
    let d = `M0 ${BASE_Y}`;
    for (let c = 8; c < W - 110; c += 125) d += " " + beat(c, 0.45);
    trace.setAttribute("d", d + ` L${W} ${BASE_Y}`);
    trace.setAttribute("class", "pending");
    $("#marker").classList.remove("show");
  }
  function stripIdle() {
    const trace = $("#trace");
    trace.style.strokeDasharray = ""; trace.style.strokeDashoffset = "";
    trace.setAttribute("d", `M0 ${BASE_Y} H${W}`);
    trace.setAttribute("class", "idle");
    $("#marker").classList.remove("show");
  }

  /* ------------------------------------------------------------ assessment form */
  const form = $("#form");
  const chol = $("#cholesterol"), cholMissing = $("#chol_missing");
  cholMissing.addEventListener("change", () => {
    chol.disabled = cholMissing.checked;
    if (cholMissing.checked) { chol.value = ""; clearError(chol); }
  });

  function setError(input, msg) {
    input.setAttribute("aria-invalid", "true");
    const field = input.closest(".field");
    let m = field.querySelector(".err-msg");
    if (!m) { m = document.createElement("span"); m.className = "err-msg"; field.appendChild(m); }
    m.textContent = msg;
  }
  function clearError(input) {
    input.removeAttribute("aria-invalid");
    input.closest(".field")?.querySelector(".err-msg")?.remove();
  }
  form.addEventListener("input", (e) => { if (e.target.matches("input")) clearError(e.target); });
  form.addEventListener("change", (e) => {
    if (e.target.type === "radio") e.target.closest(".field").querySelector(".err-msg")?.remove();
  });

  function readForm() {
    const data = {}; let firstBad = null;
    for (const k of NUMERIC) {
      const input = $(`#${k}`);
      if (k === "cholesterol" && cholMissing.checked) { data[k] = null; continue; }
      const raw = input.value.trim();
      const v = Number(raw);
      const [lo, hi] = LIMITS[k];
      if (raw === "" || Number.isNaN(v)) { setError(input, "Enter a value"); firstBad ??= input; }
      else if (v < lo || v > hi) { setError(input, `Expected between ${lo} and ${hi}`); firstBad ??= input; }
      else data[k] = v;
    }
    for (const k of RADIOS) {
      const c = form.querySelector(`input[name="${k}"]:checked`);
      if (!c) {
        const first = form.querySelector(`input[name="${k}"]`);
        const field = first.closest(".field");
        if (!field.querySelector(".err-msg")) { const m = document.createElement("span"); m.className = "err-msg"; m.textContent = "Choose one"; field.appendChild(m); }
        firstBad ??= first;
      } else data[k] = Number(c.value);
    }
    data.notes = $("#notes").value.trim() || null;
    return { data, firstBad };
  }

  // Only the keys present in v are changed, so a profile can pre-fill age and sex alone.
  function fillForm(v) {
    for (const k of NUMERIC) {
      if (!(k in v)) continue;
      if (k === "cholesterol") {
        const missing = v.cholesterol == null || Number(v.cholesterol) === 0;
        cholMissing.checked = missing; chol.disabled = missing; chol.value = missing ? "" : v.cholesterol;
      } else $(`#${k}`).value = v[k] ?? "";
      clearError($(`#${k}`));
    }
    for (const k of RADIOS) {
      if (!(k in v)) continue;
      const r = form.querySelector(`input[name="${k}"][value="${v[k]}"]`);
      if (r) r.checked = true;
    }
    $$(".err-msg", form).forEach(m => m.remove());
  }
  function clearForm() {
    form.reset(); chol.disabled = false;
    $$(".err-msg", form).forEach(m => m.remove());
    $$("[aria-invalid]", form).forEach(i => i.removeAttribute("aria-invalid"));
  }
  const profileValues = () => state.ctx ? { age: state.ctx.patient.age, sex: state.ctx.patient.sex } : {};

  $$("[data-example]").forEach(b => b.addEventListener("click", () => fillForm({ ...EXAMPLES[b.dataset.example], ...profileValues() })));
  $("#fillLast").addEventListener("click", () => {
    if (state.ctx?.lastInputs) { fillForm({ ...state.ctx.lastInputs, ...profileValues() }); toast("Filled with the values from the last visit. Update what has changed."); }
  });
  $("#clearBtn").addEventListener("click", () => { clearForm(); fillForm(profileValues()); resetReadout(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.ctx) return;
    const { data, firstBad } = readForm();
    if (firstBad) { firstBad.focus(); toast("Some values need attention before assessing", true); return; }
    const btn = $("#submitBtn");
    btn.disabled = true; btn.textContent = "Assessing";
    $("#readout").setAttribute("aria-busy", "true");
    stripPending(); renderLoading();
    try {
      const a = await post(`/api/patients/${state.ctx.pid}/assessments`, data);
      renderResult(a.result);
      state.ctx.lastInputs = a.inputs;
      $("#fillLast").hidden = false;
      const self = state.user.role === "patient";
      const where = self ? "#history" : `#patient/${state.ctx.pid}`;
      const note = $("#savedNote");
      note.innerHTML = `Saved on ${esc(fmtDate(a.created_at))} at ${esc(fmtTime(a.created_at))} to ${self ? "your" : esc(state.ctx.patient.full_name) + "'s"} history. <a href="${where}">View the history</a>`;
      note.hidden = false;
      if (window.matchMedia("(max-width: 1080px)").matches) $("#readout").scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Assessment saved");
    } catch (err) {
      stripIdle(); resetReadout(false);
      toast(`Assessment failed: ${err.message}`, true);
    } finally {
      btn.disabled = false; btn.textContent = "Assess and save";
      $("#readout").setAttribute("aria-busy", "false");
    }
  });

  /* ------------------------------------------------------------ readout */
  function resetReadout(clearStrip = true) {
    state.last = null;
    if (clearStrip) stripIdle();
    const v = $("#verdict"); v.className = "verdict empty";
    $("#verdictTitle").textContent = "No assessment yet";
    $("#verdictText").textContent = "Enter the patient's values and select Assess and save. The probability, how certain the model is, and the inputs that drove the result will appear here.";
    $("#facts").hidden = true; $("#notices").hidden = true; $("#explain").hidden = true;
    $("#stripDesc").textContent = "Risk strip. No result yet.";
    $("#savedNote").hidden = true;
  }
  function renderLoading() {
    $("#verdict").className = "verdict empty";
    $("#verdictTitle").textContent = "Assessing";
    $("#verdictText").textContent = "Running the ensemble and computing the explanation. This takes a few seconds.";
    $("#facts").hidden = true; $("#notices").hidden = true; $("#savedNote").hidden = true;
    $("#explain").hidden = false;
    $("#explainLede").textContent = "";
    $("#explainSummary").textContent = ""; $("#explainMethod").textContent = "";
    $("#waterfallWrap").innerHTML = '<div class="skeleton"></div>'.repeat(6);
  }


  function renderResult(r) {
    const p = r.probability, kind = verdictKind(r.decision);
    const { refer_low: lo, refer_high: hi } = r.band;
    state.last = r;
    plotProbability(p);
    $("#stripDesc").textContent = `Probability ${pct(p)}. ${r.decision}.`;
    $("#stripMeta").textContent = `Referral band ${pct(lo)} to ${pct(hi)}`;

    $("#verdict").className = `verdict ${kind}`;
    $("#verdictTitle").textContent = r.decision.replace(" - ", ": ");
    const above = p >= r.threshold;
    let text;
    if (kind === "refer") {
      text = `The estimated probability is ${pct(p)}, inside the referral band (${pct(lo)} to ${pct(hi)}). At this level the model's 90% prediction set contains both outcomes, so it does not commit to a label. Review with a clinician.`;
    } else {
      text = `The estimated probability of heart disease is ${pct(p)}, ${above ? "above" : "below"} the decision threshold of ${pct(r.threshold)}. The 90% prediction set contains only "${r.conformal_set[0]}".`;
    }
    $("#verdictText").textContent = text;
    $("#facts").hidden = false;
    $("#fProb").textContent = pct(p);
    $("#fPred").textContent = r.prediction;
    $("#fSet").textContent = r.conformal_set.length ? r.conformal_set.join(" or ") : "Empty";

    const notes = [...(r.warnings || [])];
    const est = r.explanation?.estimated_inputs || {};
    if (est.cholesterol != null) notes.unshift(`Cholesterol was not measured. The model estimated ${Math.round(est.cholesterol)} mg/dl from the other values.`);
    if (est.resting_bp_s != null) notes.unshift(`Resting blood pressure was missing. The model estimated ${Math.round(est.resting_bp_s)} mmHg.`);
    const ul = $("#notices");
    ul.innerHTML = notes.map(n => `<li>${esc(n)}</li>`).join("");
    ul.hidden = notes.length === 0;

    renderExplanation(r.explanation, p);
  }

  function renderExplanation(ex, p) {
    const box = $("#explain");
    if (!ex) { box.hidden = true; return; }
    box.hidden = false;
    $("#explainLede").textContent = `Each bar shows how far one input moved the probability, starting from the average training patient (${pct(ex.base_value)}) and ending at this patient (${pct(p)}). Red bars raise the risk, green bars lower it.`;
    const items = ex.contributions;

    // Waterfall: rows = base, each feature (sorted by |shap|), final.
    const width = Math.max(280, $("#waterfallWrap").clientWidth || 600);
    const narrow = width < 560;
    const rowH = narrow ? 50 : 34, top = narrow ? 10 : 30, right = narrow ? 64 : 70;
    const left = narrow ? 8 : Math.min(300, Math.round(width * 0.38));
    const barY = narrow ? 20 : 3;   // narrow: label line above the bar
    const height = top + rowH * (items.length + 2) + 26;
    let cum = ex.base_value;
    const steps = items.map(c => { const s = { ...c, from: cum, to: cum + c.shap }; cum += c.shap; return s; });
    const all = [ex.base_value, p, ...steps.flatMap(s => [s.from, s.to])];
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = Math.max(0.04, (hi - lo) * 0.08); lo = Math.max(0, lo - pad); hi = Math.min(1, hi + pad);
    const sx = (v) => left + (v - lo) / (hi - lo) * (width - left - right);

    const wrap = $("#waterfallWrap"); wrap.innerHTML = "";
    const svg = el("svg", { id: "waterfall", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "SHAP contribution of each input" }, wrap);

    // grid ticks every 10 points
    for (let t = Math.ceil(lo * 10) / 10; t <= hi + 1e-9; t += 0.1) {
      el("line", { x1: sx(t), x2: sx(t), y1: top - 8, y2: height - 22, stroke: "var(--line)", "stroke-width": 1 }, svg);
      const lab = el("text", { x: sx(t), y: height - 6, "text-anchor": "middle", class: "val" }, svg);
      lab.textContent = `${Math.round(t * 100)}%`;
    }
    const refRow = (i, value, label) => {
      const y = top + i * rowH;
      el("line", { x1: sx(value), x2: sx(value), y1: y + barY - 4, y2: y + rowH - 10, stroke: "var(--ink)", "stroke-width": 2 }, svg);
      const t = narrow ? el("text", { x: 0, y: y + 12, class: "ref" }, svg)
                       : el("text", { x: left - 14, y: y + 16, "text-anchor": "end", class: "ref" }, svg);
      t.textContent = label;
      const n = el("text", { x: sx(value) + 8, y: y + barY + 13, class: "num", fill: "var(--ink)" }, svg); n.textContent = pct(value, 1);
    };
    refRow(0, ex.base_value, "Average patient");
    steps.forEach((s, i) => {
      const y = top + (i + 1) * rowH;
      const up = s.shap >= 0, color = up ? "var(--risk)" : "var(--safe)";
      const a = sx(Math.min(s.from, s.to)), b = sx(Math.max(s.from, s.to));
      if (narrow) {
        const f = el("text", { x: 0, y: y + 12, class: "feat" }, svg);
        f.textContent = `${s.label}: `;
        const v = el("tspan", { class: "val" }, f); v.textContent = s.display;
      } else {
        const f = el("text", { x: 0, y: y + 11, class: "feat" }, svg); f.textContent = s.label;
        const v = el("text", { x: 0, y: y + 25, class: "val" }, svg); v.textContent = s.display;
      }
      const bh = narrow ? rowH - 30 : rowH - 14;
      el("rect", { x: a, y: y + barY, width: Math.max(2, b - a), height: bh, rx: 3, fill: color, opacity: 0.88 }, svg);
      // connector from previous step
      el("line", { x1: sx(s.from), x2: sx(s.from), y1: y - rowH + barY, y2: y + barY + bh, stroke: "var(--ink-3)", "stroke-width": 1, "stroke-dasharray": "2 3" }, svg);
      const label = el("text", { x: up ? b + 6 : a - 6, y: y + barY + 13, "text-anchor": up ? "start" : "end", class: "num", fill: color }, svg);
      label.textContent = pts(s.shap);
    });
    refRow(items.length + 1, p, "This patient");

    const ups = items.filter(c => c.shap > 0.005).slice(0, 3);
    const downs = items.filter(c => c.shap < -0.005).slice(0, 3);
    const fmt = (c) => `<b>${esc(c.label)}</b> (${esc(c.display)})`;
    let s = "";
    if (ups.length) s += `Raised the risk most: ${ups.map(fmt).join(", ")}. `;
    if (downs.length) s += `Lowered it most: ${downs.map(fmt).join(", ")}.`;
    $("#explainSummary").innerHTML = s || "No single input moved the probability by more than half a point.";
    $("#explainMethod").textContent = `${ex.method}. Contributions add up to the prediction (difference ${Math.abs(ex.additivity_error * 100).toFixed(2)} pts). They explain the model, not medical causation.`;
  }


  /* ------------------------------------------------------------ model card */
  function renderModel(m) {
    const t = m.test_metrics || {};
    $("#mTitle").textContent = m.model_name || "Model";
    $("#mSub").textContent = `Trained on ${m.trained_on || "the training split"}. Missing cholesterol handled by ${m.impute === "regress" ? "regression imputation" : (m.impute || "imputation")}.`;
    const f = (v, d = 1) => v == null ? "–" : `${(v * 100).toFixed(d)}%`;
    $("#mMetrics").innerHTML = [
      ["Accuracy", f(t.accuracy)], ["AUC", t.auc == null ? "–" : t.auc.toFixed(3)],
      ["Sensitivity", f(t.sensitivity)], ["Specificity", f(t.specificity)],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
    const c = m.conformal || {};
    const kv = [
      ["AUC 95% interval", t.auc_95ci ? `${t.auc_95ci[0].toFixed(3)} to ${t.auc_95ci[1].toFixed(3)}` : "–"],
      ["Decision threshold", pct(m.threshold, 1)],
      ["Referral band", `${pct(m.band.refer_low, 1)} to ${pct(m.band.refer_high, 1)}`],
      ["Prediction-set coverage", c.coverage != null ? `${f(c.coverage)} (target ${pct(1 - m.alpha)})` : "–"],
      ["Patients given a single label", f(c.decisive_rate)],
      ["Accuracy on those patients", f(c.accuracy_on_decisive)],
      ["Brier score", t.brier == null ? "–" : t.brier.toFixed(4)],
    ];
    $("#mKv").innerHTML = kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    const ext = m.external_validation;
    if (ext) {
      $("#mExtText").textContent = `${ext.description} Mean AUC across hospitals ${ext.mean_auc.toFixed(3)}, against about ${t.auc ? t.auc.toFixed(2) : "0.93"} on patients from the training hospitals. Expect lower performance, and recalibrate, at a new site.`;
      $("#mSites").innerHTML = Object.entries(ext.per_site).map(([s, a]) =>
        `<div class="site"><span>${esc(s)}</span><div class="track"><i style="width:${((a - 0.5) / 0.5) * 100}%"></i></div><b>${a.toFixed(3)}</b></div>`).join("")
        + `<small style="color:var(--ink-3)">Bars start at AUC 0.5 (chance).</small>`;
    }
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawStrip();
      if (state.last) { plotProbability(state.last.probability, false); renderExplanation(state.last.explanation, state.last.probability); }
      else if (!$("#trace").classList.contains("pending")) stripIdle();
    }, 150);
  });

  /* ============================================================ dialogs */
  function ask({ title, text = "", okLabel = "OK", danger = false, passwordLabel = null }) {
    const d = $("#askDialog");
    $("#askTitle").textContent = title; $("#askText").textContent = text;
    $("#askOk").textContent = okLabel; $("#askOk").className = `btn small solid${danger ? " danger" : ""}`;
    $("#askField").hidden = !passwordLabel; $("#askLabel").textContent = passwordLabel || "";
    $("#askInput").value = ""; $("#askError").hidden = true;
    return new Promise((resolve) => {
      const onSubmit = (e) => {
        if (e.submitter?.value !== "ok") return;
        if (passwordLabel && $("#askInput").value.length < 8) {
          e.preventDefault(); $("#askError").textContent = "Use at least 8 characters."; $("#askError").hidden = false; return;
        }
      };
      $("#askForm").addEventListener("submit", onSubmit);
      d.addEventListener("close", () => {
        $("#askForm").removeEventListener("submit", onSubmit);
        resolve(d.returnValue === "ok" ? (passwordLabel ? $("#askInput").value : true) : null);
      }, { once: true });
      d.returnValue = ""; d.showModal();
      (passwordLabel ? $("#askInput") : $("#askOk")).focus();
    });
  }

  // Edit one account's details. `role` decides which block of fields is shown; the server
  // allows this for an administrator (anybody) or for the signed-in person themselves.
  function editDetails(person, role, onSaved) {
    const d = $("#editDialog"), self = person.id === state.user.id;
    $("#editTitle").textContent = self ? "My details" : `Edit ${person.full_name}`;
    $("#editText").textContent = role === "patient"
      ? "Age and sex are taken from here when an assessment is started. Assessments already saved keep the values recorded with them."
      : role === "doctor" ? "Patients see the name, specialty, hospital and description when they choose a doctor."
      : "Your name as it appears in the application.";
    $$("[data-role-fields]", d).forEach(b => (b.hidden = b.dataset.roleFields !== role));
    $("#editError").hidden = true;
    $("#ed_name").value = person.full_name || "";
    $("#ed_email").value = person.email || "";
    $("#ed_phone").value = person.phone || "";
    if (role === "patient") {
      $("#ed_dob").value = person.date_of_birth || "";
      $$('input[name="ed_sex"]').forEach(r => (r.checked = Number(r.value) === Number(person.sex)));
    } else if (role === "doctor") {
      $("#ed_spec").value = person.specialty || "";
      $("#ed_hosp").value = person.hospital || "";
      $("#ed_reg").value = person.registration_no || "";
      $("#ed_bio").value = person.bio || "";
    }

    const onSubmit = async (e) => {
      if (e.submitter?.value !== "ok") return;
      e.preventDefault();
      const err = (m) => { $("#editError").textContent = m; $("#editError").hidden = false; };
      const body = { full_name: $("#ed_name").value.trim(), email: $("#ed_email").value.trim() || null, phone: $("#ed_phone").value.trim() || null };
      if (body.full_name.length < 2) return err("Enter the full name.");
      if (role === "patient") {
        const sex = $('input[name="ed_sex"]:checked');
        if (!$("#ed_dob").value) return err("Enter the date of birth.");
        if (!sex) return err("Choose male or female.");
        body.date_of_birth = $("#ed_dob").value;
        body.sex = Number(sex.value);
      } else if (role === "doctor") {
        body.specialty = $("#ed_spec").value.trim();
        body.hospital = $("#ed_hosp").value.trim();
        body.registration_no = $("#ed_reg").value.trim() || null;
        body.bio = $("#ed_bio").value.trim() || null;
        if (!body.specialty || !body.hospital) return err("Specialty and hospital are required.");
      }
      const btn = $("#editSave"); btn.disabled = true;
      try {
        const saved = await post(`/api/users/${person.id}`, body, "PATCH");
        if (self) { state.user = { ...state.user, ...saved }; $("#whoName").textContent = saved.full_name; }
        d.close();
        toast(self ? "Your details were saved" : `Details saved for ${saved.full_name}`);
        onSaved?.(saved);
      } catch (ex) { err(ex.message); } finally { btn.disabled = false; }
    };
    $("#editForm").addEventListener("submit", onSubmit);
    d.addEventListener("close", () => $("#editForm").removeEventListener("submit", onSubmit), { once: true });
    d.returnValue = ""; d.showModal(); $("#ed_name").focus();
  }

  $("#profileBtn").addEventListener("click", () => editDetails(state.user, state.user.role, () => route()));

  $("#pwBtn").addEventListener("click", () => {
    $("#pwForm").reset(); $("#pwError").hidden = true; $("#pwDialog").showModal(); $("#pw_cur").focus();
  });
  $("#pwForm").addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    const err = (m) => { $("#pwError").textContent = m; $("#pwError").hidden = false; };
    const cur = $("#pw_cur").value, nw = $("#pw_new").value, nw2 = $("#pw_new2").value;
    if (nw.length < 8) return err("The new password needs at least 8 characters.");
    if (nw !== nw2) return err("The new passwords do not match.");
    try { await post("/api/auth/password", { current_password: cur, new_password: nw }); $("#pwDialog").close(); toast("Password changed"); }
    catch (ex) { err(ex.message); }
  });

  /* ============================================================ sign in / register */
  function showAuth(which = "login") {
    $("#appShell").hidden = true; $("#authScreen").hidden = false;
    $("#loginForm").hidden = which !== "login"; $("#registerForm").hidden = which !== "register";
    if (which === "register") loadRegisterDoctors();
    (which === "login" ? $("#li_user") : $("#rg_name")).focus();
  }
  $$("[data-auth]").forEach(b => b.addEventListener("click", () => showAuth(b.dataset.auth)));

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("#loginError"); errBox.hidden = true;
    const username = $("#li_user").value.trim(), password = $("#li_pass").value;
    if (!username || !password) { errBox.textContent = "Enter your username and password."; errBox.hidden = false; return; }
    const btn = $("#loginBtn"); btn.disabled = true;
    try { const u = await post("/api/auth/login", { username, password }); $("#li_pass").value = ""; await enterApp(u, true); }
    catch (ex) { errBox.textContent = ex.message; errBox.hidden = false; }
    finally { btn.disabled = false; }
  });

  async function loadRegisterDoctors() {
    const box = $("#rg_doctors");
    if (box.dataset.loaded) return;
    try {
      const docs = await api("/api/public/doctors");
      box.innerHTML = docs.map(d => `<label><input type="checkbox" value="${d.id}"><b>${esc(d.full_name)}</b><small>${esc(d.specialty)}, ${esc(d.hospital)}</small></label>`).join("");
      box.dataset.loaded = "1";
    } catch (_) { box.innerHTML = `<small>Doctors could not be loaded. You can choose them after signing in.</small>`; }
  }

  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("#regError"); errBox.hidden = true;
    const fail = (m, input) => { errBox.textContent = m; errBox.hidden = false; input?.focus(); errBox.scrollIntoView({ block: "nearest" }); };
    const body = {
      full_name: $("#rg_name").value.trim(), username: $("#rg_user").value.trim(),
      password: $("#rg_pass").value, date_of_birth: $("#rg_dob").value,
      sex: Number($("input[name=rg_sex]:checked")?.value ?? -1),
      email: $("#rg_email").value.trim() || null, phone: $("#rg_phone").value.trim() || null,
      doctor_ids: $$("#rg_doctors input:checked").map(i => Number(i.value)),
    };
    if (body.full_name.length < 2) return fail("Enter your full name.", $("#rg_name"));
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(body.username)) return fail("Choose a username of 3 to 40 letters, digits, dots, dashes or underscores.", $("#rg_user"));
    if (!body.date_of_birth) return fail("Enter your date of birth.", $("#rg_dob"));
    if (body.sex < 0) return fail("Choose your sex. The model uses it in the assessment.");
    if (body.password.length < 8) return fail("The password needs at least 8 characters.", $("#rg_pass"));
    if (body.password !== $("#rg_pass2").value) return fail("The two passwords do not match.", $("#rg_pass2"));
    const btn = $("#registerBtn"); btn.disabled = true;
    try {
      const u = await post("/api/auth/register", body);
      $("#registerForm").reset();
      toast("Account created. Welcome to SmartHeart.");
      await enterApp(u, true);
    } catch (ex) { fail(ex.message); }
    finally { btn.disabled = false; }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    try { await post("/api/auth/logout"); } catch (_) {}
    state.user = null; state.ctx = null;
    history.replaceState(null, "", location.pathname);
    showAuth("login");
  });

  /* ============================================================ shell + router */
  const NAV = {
    patient: [["assess", "New assessment"], ["history", "My history"], ["doctors", "My doctors"], ["model", "Model"]],
    doctor: [["patients", "My patients"], ["model", "Model"]],
    admin: [["overview", "Overview"], ["patients", "Patients"], ["doctors", "Doctors"], ["assessments", "Assessments"], ["model", "Model"]],
  };
  const HOME = { patient: "history", doctor: "patients", admin: "overview" };
  const ALLOWED = {
    patient: ["assess", "history", "doctors", "model", "assessment"],
    doctor: ["patients", "patient", "assess", "assessment", "model"],
    admin: ["overview", "patients", "patient", "doctors", "assessments", "assess", "assessment", "model"],
  };

  async function enterApp(user, fresh = false) {
    state.user = user;
    $("#authScreen").hidden = true; $("#appShell").hidden = false;
    $("#whoName").textContent = user.full_name;
    $("#whoRole").textContent = user.role; $("#whoRole").className = `role-pill ${user.role}`;
    $("#nav").innerHTML = NAV[user.role].map(([k, label]) => `<a class="tab" href="#${k}" data-tab="${k}">${label}</a>`).join("");
    $("#homeLink").setAttribute("href", `#${HOME[user.role]}`);
    if (!state.model) {
      try {
        const m = await api("/api/model");
        state.model = m; state.band = m.band; state.threshold = m.threshold; renderModel(m);
      } catch (ex) { toast(`Model information unavailable: ${ex.message}`, true); }
    }
    if (fresh) history.replaceState(null, "", `#${HOME[user.role]}`);
    route();
  }

  function setNav(active) {
    $$("#nav .tab").forEach(t => {
      const on = t.dataset.tab === active;
      t.setAttribute("aria-current", on ? "page" : "false");
      t.setAttribute("aria-selected", String(on));
    });
  }
  function showView(name) {
    $("#view-assess").hidden = name !== "assess";
    $("#view-dyn").hidden = name !== "dyn";
    $("#view-model").hidden = name !== "model";
  }
  const dyn = () => $("#view-dyn");
  function loading() { dyn().innerHTML = '<div class="skeleton" style="height:40px;max-width:360px"></div><div class="skeleton" style="height:220px"></div><div class="skeleton" style="height:160px"></div>'; }

  window.addEventListener("hashchange", route);
  async function route() {
    if (!state.user) return;
    const role = state.user.role;
    const [view, arg] = (location.hash.slice(1) || HOME[role]).split("/");
    if (!ALLOWED[role].includes(view)) { location.hash = HOME[role]; return; }
    const parent = { patient: "patients", assessment: role === "patient" ? "history" : "patients", assess: role === "patient" ? "assess" : "patients" }[view] || view;
    setNav(parent);
    window.scrollTo(0, 0);
    try {
      if (view === "assess") { showView("assess"); await openAssess({ pid: role === "patient" ? state.user.id : Number(arg) }); return; }
      if (view === "assessment") { showView("assess"); await openAssess({ aid: Number(arg) }); return; }
      if (view === "model") { showView("model"); return; }
      showView("dyn"); loading();
      if (view === "history") await viewPatient(state.user.id);
      else if (view === "patient") await viewPatient(Number(arg));
      else if (view === "patients") await viewPatients();
      else if (view === "doctors") await (role === "admin" ? viewDoctorsAdmin() : viewMyDoctors());
      else if (view === "overview") await viewOverview();
      else if (view === "assessments") await viewAllAssessments();
    } catch (ex) {
      showView("dyn");
      dyn().innerHTML = `<div class="card empty-state"><h2>This page could not be loaded</h2><p>${esc(ex.message)}</p><a class="btn small" href="#${HOME[role]}">Go to the start page</a></div>`;
    }
  }

  /* ============================================================ assessment view */
  async function openAssess({ pid = null, aid = null }) {
    let saved = null;
    if (aid) { saved = await api(`/api/assessments/${aid}`); pid = saved.patient_id; }
    const [patient, list] = await Promise.all([api(`/api/patients/${pid}`), api(`/api/patients/${pid}/assessments`)]);
    state.ctx = { pid, patient, lastInputs: list.length ? list[list.length - 1].inputs : null };
    const self = state.user.role === "patient";
    clearForm(); resetReadout(); drawStrip();
    const back = $("#ctxBack");
    back.hidden = self && !saved;
    back.setAttribute("href", self ? "#history" : `#patient/${pid}`);
    back.textContent = self ? "My history" : `${patient.full_name}'s history`;
    const who = `${patient.full_name}, ${patient.age} years, ${sexWord(patient.sex)}`;
    if (saved) {
      fillForm(saved.inputs); $("#notes").value = saved.notes || "";
      $("#ctxTitle").textContent = `Assessment of ${fmtDate(saved.created_at)}`;
      $("#ctxSub").textContent = `${who}. Entered by ${saved.created_by_name} at ${fmtTime(saved.created_at)}. Change any value and select Assess and save to record a new visit; this one stays in the history.`;
      $("#fillLast").hidden = true;
      renderResult(saved.result);
    } else {
      fillForm({ age: patient.age, sex: patient.sex });
      $("#ctxTitle").textContent = self ? "New assessment" : `New assessment for ${patient.full_name}`;
      $("#ctxSub").textContent = `${who}. Age and sex come from the profile.${list.length ? ` Visit ${list.length + 1}.` : " First visit."}`;
      $("#fillLast").hidden = !state.ctx.lastInputs;
    }
  }

  /* ============================================================ patient page (history over time) */
  function drawTrend(box, list, onOpen) {
    box.innerHTML = "";
    if (!list.length) return;
    const width = Math.max(300, box.clientWidth || 640), height = 260;
    const m = { l: 44, r: 18, t: 16, b: 34 };
    const svg = el("svg", { id: "trendSvg", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Probability of heart disease at each assessment" }, box);
    // Real time axis; when all visits fall within two days, space them evenly by visit order instead.
    const real = list.map(a => new Date(a.created_at).getTime());
    const sameDay = Math.max(...real) - Math.min(...real) < 2 * 864e5;
    const times = sameDay ? list.map((_, i) => i) : real;
    let t0 = Math.min(...times), t1 = Math.max(...times);
    if (t1 === t0) { t0 -= 1; t1 += 1; }
    const pad = (t1 - t0) * 0.08; t0 -= pad; t1 += pad;
    const sx = (t) => m.l + (t - t0) / (t1 - t0) * (width - m.l - m.r);
    const sy = (p) => m.t + (1 - p) * (height - m.t - m.b);
    const { refer_low: lo, refer_high: hi } = state.band;
    for (const [a, b, fill] of [[0, lo, "var(--safe-tint)"], [lo, hi, "var(--refer-tint)"], [hi, 1, "var(--risk-tint)"]])
      el("rect", { x: m.l, y: sy(b), width: width - m.l - m.r, height: sy(a) - sy(b), fill, opacity: 0.7 }, svg);
    for (let p = 0; p <= 1.0001; p += 0.25) {
      el("line", { x1: m.l, x2: width - m.r, y1: sy(p), y2: sy(p), stroke: "var(--line)", "stroke-width": 1 }, svg);
      const t = el("text", { x: m.l - 8, y: sy(p) + 4, "text-anchor": "end", class: "ax" }, svg); t.textContent = `${p * 100}%`;
    }
    const nTicks = Math.min(5, list.length);
    const tickIdx = nTicks <= 1 ? [0] : [...new Set(Array.from({ length: nTicks }, (_, i) => Math.round(i * (list.length - 1) / (nTicks - 1))))];
    tickIdx.forEach(i => {
      const anchor = tickIdx.length > 1 && i === tickIdx[0] ? "start" : tickIdx.length > 1 && i === tickIdx[tickIdx.length - 1] ? "end" : "middle";
      const t = el("text", { x: sx(times[i]), y: height - 10, "text-anchor": anchor, class: "ax" }, svg);
      t.textContent = sameDay ? `Visit ${i + 1}, ${fmtTime(list[i].created_at)}` : new Date(times[i]).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
    });
    if (list.length > 1) el("polyline", { points: list.map((a, i) => `${sx(times[i])},${sy(a.probability)}`).join(" "), fill: "none", stroke: "var(--ink)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
    const colors = { risk: "var(--risk)", safe: "var(--safe)", refer: "var(--refer-mark)" };
    list.forEach((a, i) => {
      const g = el("g", { class: "pt", tabindex: 0, role: "button", "aria-label": `${fmtDate(a.created_at)}: ${pct(a.probability)}, ${a.decision}` }, svg);
      const ttl = el("title", {}, g); ttl.textContent = `${fmtDate(a.created_at)}: ${pct(a.probability)} (${shortDecision(a.decision)})`;
      el("circle", { cx: sx(times[i]), cy: sy(a.probability), r: 6, fill: colors[verdictKind(a.decision)], stroke: "var(--surface)", "stroke-width": 2 }, g);
      if (list.length <= 12) {
        const lab = el("text", { x: sx(times[i]), y: sy(a.probability) - 12, "text-anchor": "middle", class: "lab" }, g);
        lab.textContent = pct(a.probability);
      }
      g.addEventListener("click", () => onOpen(a.id));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(a.id); } });
    });
  }

  async function viewPatient(pid) {
    const [p, list] = await Promise.all([api(`/api/patients/${pid}`), api(`/api/patients/${pid}/assessments`)]);
    const role = state.user.role, self = role === "patient", admin = role === "admin";
    const canEdit = admin || self;   // a doctor reads a patient's profile but does not change it
    const newHref = self ? "#assess" : `#assess/${pid}`;
    const last = list[list.length - 1];
    const doctorsHtml = p.doctors.length
      ? `<div class="chips">${p.doctors.map(d => `<span class="dchip">${esc(d.full_name)}${admin ? `<button type="button" data-unassign="${d.id}" aria-label="Remove ${esc(d.full_name)}">×</button>` : ""}</span>`).join("")}</div>`
      : `<p class="muted" style="margin:0">${self ? "You have not chosen a doctor yet." : "No doctor assigned."}</p>`;
    dyn().innerHTML = `
      <div class="page-head">
        <div>
          ${self ? "" : `<a class="back" href="#patients">${admin ? "All patients" : "My patients"}</a>`}
          <h1>${self ? "My history" : esc(p.full_name)}</h1>
          <p>${esc(p.full_name)}, ${p.age} years, ${sexWord(p.sex)}. ${list.length ? `${plural(list.length, "assessment")} since ${esc(fmtDate(list[0].created_at))}.` : "No assessments yet."}</p>
        </div>
        <div class="toolbar">
          ${list.length ? `<a class="btn small" href="/api/patients/${pid}/export.csv" download>Export CSV</a>` : ""}
          ${p.is_active ? `<a class="btn small solid" href="${newHref}">New assessment</a>` : ""}
        </div>
      </div>
      <div class="patient-grid">
        <div class="card">
          <h2>Risk over time</h2>
          ${list.length ? `<p class="muted" style="margin:-6px 0 12px;font-size:13.5px">Each point is one assessment. Latest: <b>${pct(last.probability)}</b>, ${esc(shortDecision(last.decision).toLowerCase())}, on ${esc(fmtDate(last.created_at))}. Select a point to open it.</p><div class="trend-wrap" id="trend"></div>`
            : `<div class="empty-state" style="padding:28px 8px"><h2>No assessments yet</h2><p>${self ? "Run your first assessment. Every later one is added here with its date, so you can see how your risk changes." : "Run the first assessment for this patient."}</p>${p.is_active ? `<a class="btn small solid" href="${newHref}">Start the first assessment</a>` : ""}</div>`}
        </div>
        <div class="card">
          <div class="card-head"><h3>Profile</h3>${canEdit ? `<button class="btn small" type="button" id="editProfile">Edit details</button>` : ""}</div>
          <dl class="kv tight">
            <dt>Username</dt><dd>${esc(p.username)}</dd>
            <dt>Date of birth</dt><dd>${esc(fmtDate(p.date_of_birth))}</dd>
            ${p.email ? `<dt>Email</dt><dd>${esc(p.email)}</dd>` : ""}
            ${p.phone ? `<dt>Phone</dt><dd>${esc(p.phone)}</dd>` : ""}
            <dt>Registered</dt><dd>${esc(fmtDate(p.created_at))}</dd>
            ${admin ? `<dt>Status</dt><dd class="status ${p.is_active ? "" : "off"}">${p.is_active ? "Active" : "Deactivated"}</dd>` : ""}
          </dl>
          <h3>${self ? "My doctors" : "Doctors"}</h3>
          ${doctorsHtml}
          ${self ? `<p style="margin:10px 0 0"><a href="#doctors">Choose doctors</a></p>` : ""}
          ${admin ? `<div class="inline-form"><select id="assignSel" aria-label="Doctor to assign"><option value="">Assign a doctor</option></select><button class="btn small" type="button" id="assignBtn">Assign</button></div>
            <h3>Account</h3><div class="stack-actions"><button class="btn small" type="button" id="resetPw">Reset password</button><button class="btn small ${p.is_active ? "danger" : ""}" type="button" id="toggleActive">${p.is_active ? "Deactivate" : "Reactivate"}</button></div>` : ""}
        </div>
      </div>
      ${list.length ? `<h2 class="section-title">All assessments</h2><div class="table-wrap">${assessmentTable([...list].reverse(), { showPatient: false, deltas: list, canDelete: admin || self })}</div>` : ""}`;

    if (list.length) drawTrend($("#trend"), list, (id) => (location.hash = `assessment/${id}`));
    wireAssessmentTable(() => viewPatient(pid));
    if (canEdit) $("#editProfile").addEventListener("click", () => editDetails(p, "patient", () => viewPatient(pid)));
    if (admin) {
      const docs = await api("/api/doctors");
      const have = new Set(p.doctors.map(d => d.id));
      $("#assignSel").innerHTML += docs.filter(d => d.is_active && !have.has(d.id)).map(d => `<option value="${d.id}">${esc(d.full_name)}, ${esc(d.specialty)}</option>`).join("");
      $("#assignBtn").addEventListener("click", async () => {
        const did = Number($("#assignSel").value); if (!did) return;
        try { await post("/api/admin/assignments", { patient_id: pid, doctor_id: did }); toast("Doctor assigned"); viewPatient(pid); } catch (ex) { toast(ex.message, true); }
      });
      $$("[data-unassign]").forEach(b => b.addEventListener("click", async () => {
        try { await api(`/api/admin/assignments?patient_id=${pid}&doctor_id=${b.dataset.unassign}`, { method: "DELETE" }); toast("Doctor removed"); viewPatient(pid); } catch (ex) { toast(ex.message, true); }
      }));
      $("#resetPw").addEventListener("click", () => resetPassword(pid, p.full_name));
      $("#toggleActive").addEventListener("click", () => toggleActive(pid, p.full_name, p.is_active, () => viewPatient(pid)));
    }
  }

  // rows newest first; `deltas` = chronological list for change-from-previous
  function assessmentTable(rows, { showPatient, deltas = null, canDelete = false }) {
    const prev = {};
    if (deltas) deltas.forEach((a, i) => { if (i > 0) prev[a.id] = a.probability - deltas[i - 1].probability; });
    const dcell = (id) => {
      if (!(id in prev)) return `<span class="delta flat">First</span>`;
      const d = prev[id];
      if (Math.abs(d) < 0.005) return `<span class="delta flat">No change</span>`;
      return `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(1)} pts</span>`;
    };
    return `<table><thead><tr>
        <th>Date</th>${showPatient ? "<th>Patient</th>" : ""}<th>Probability</th><th class="hide-sm">Position</th>${deltas ? '<th class="hide-sm">Change</th>' : ""}<th>Decision</th><th class="hide-sm">Entered by</th><th class="hide-sm">Notes</th><th><span hidden>Actions</span></th>
      </tr></thead><tbody>${rows.map(a => `<tr>
        <td>${esc(fmtDate(a.created_at))}<br><small>${esc(fmtTime(a.created_at))}</small></td>
        ${showPatient ? `<td><a class="plain" href="#patient/${a.patient_id}">${esc(a.patient_name)}</a></td>` : ""}
        <td class="num">${pct(a.probability)}</td>
        <td class="hide-sm">${posBar(a.probability)}</td>
        ${deltas ? `<td class="hide-sm">${dcell(a.id)}</td>` : ""}
        <td>${tag(a.decision)}</td>
        <td class="hide-sm">${esc(a.created_by_name)}${a.created_by_role !== "patient" ? `<br><small>${esc(a.created_by_role)}</small>` : ""}</td>
        <td class="notes hide-sm" title="${esc(a.notes || "")}">${esc(a.notes || "")}</td>
        <td><div class="row-actions"><a class="btn small" href="#assessment/${a.id}">Open</a>${canDelete ? `<button class="btn small danger" type="button" data-del="${a.id}" aria-label="Delete assessment of ${esc(fmtDate(a.created_at))}">Delete</button>` : ""}</div></td>
      </tr>`).join("")}</tbody></table>`;
  }
  function wireAssessmentTable(reload) {
    $$("[data-del]", dyn()).forEach(b => b.addEventListener("click", async () => {
      const ok = await ask({ title: "Delete this assessment?", text: "It is removed from the history for everyone. This cannot be undone.", okLabel: "Delete", danger: true });
      if (!ok) return;
      try { await api(`/api/assessments/${b.dataset.del}`, { method: "DELETE" }); toast("Assessment deleted"); reload(); } catch (ex) { toast(ex.message, true); }
    }));
  }

  async function resetPassword(uid, name) {
    const pw = await ask({ title: `Reset password for ${name}`, text: "They will be signed out everywhere and must use the new password.", okLabel: "Reset password", passwordLabel: "New password" });
    if (!pw) return;
    try { await post(`/api/admin/users/${uid}/password`, { new_password: pw }); toast(`Password reset for ${name}`); } catch (ex) { toast(ex.message, true); }
  }
  async function toggleActive(uid, name, isActive, reload) {
    const ok = await ask(isActive
      ? { title: `Deactivate ${name}?`, text: "They can no longer sign in. Their data is kept and you can reactivate them later.", okLabel: "Deactivate", danger: true }
      : { title: `Reactivate ${name}?`, text: "They will be able to sign in again.", okLabel: "Reactivate" });
    if (!ok) return;
    try { await post(`/api/admin/users/${uid}`, { is_active: !isActive }, "PATCH"); toast(isActive ? `${name} deactivated` : `${name} reactivated`); reload(); } catch (ex) { toast(ex.message, true); }
  }

  /* ============================================================ patient list (doctor, admin) */
  async function viewPatients() {
    const rows = await api("/api/patients");
    const admin = state.user.role === "admin";
    dyn().innerHTML = `
      <div class="page-head">
        <div><h1>${admin ? "Patients" : "My patients"}</h1>
          <p>${admin ? `${plural(rows.length, "registered patient")}.` : `${plural(rows.length, "patient")} ${rows.length === 1 ? "has" : "have"} chosen you or been assigned to you.`}</p></div>
        <div class="toolbar"><input type="search" id="pSearch" placeholder="Search by name or username" aria-label="Search patients"></div>
      </div>
      <div class="table-wrap" id="pTable"></div>`;
    const render = () => {
      const q = $("#pSearch").value.trim().toLowerCase();
      const list = rows.filter(r => !q || r.full_name.toLowerCase().includes(q) || r.username.toLowerCase().includes(q));
      if (!rows.length) {
        $("#pTable").innerHTML = `<div class="empty-state"><h2>${admin ? "No patients yet" : "No patients yet"}</h2><p>${admin ? "Patients appear here once they create an account." : "Patients add their doctors from their own account, or an administrator can assign them to you."}</p></div>`;
        return;
      }
      if (!list.length) { $("#pTable").innerHTML = `<div class="empty-state"><h2>No matches</h2><p>No patient matches "${esc(q)}".</p></div>`; return; }
      $("#pTable").innerHTML = `<table><thead><tr><th>Patient</th><th>Age, sex</th><th class="hide-sm">Assessments</th><th>Latest</th><th class="hide-sm">Position</th><th>Decision</th>${admin ? '<th class="hide-sm">Doctors</th><th class="hide-sm">Status</th>' : ""}<th><span hidden>Actions</span></th></tr></thead><tbody>
        ${list.map(r => `<tr>
          <td><a class="plain" href="#patient/${r.id}">${esc(r.full_name)}</a><br><small>${esc(r.username)}</small></td>
          <td>${r.age}, ${sexWord(r.sex)}</td>
          <td class="hide-sm">${r.n_assessments}${r.last_assessed ? `<br><small>last ${esc(fmtDate(r.last_assessed))}</small>` : ""}</td>
          <td class="num">${r.last_probability == null ? "–" : pct(r.last_probability)}</td>
          <td class="hide-sm">${r.last_probability == null ? "" : posBar(r.last_probability)}</td>
          <td>${r.last_decision ? tag(r.last_decision) : '<span class="muted">Not assessed</span>'}</td>
          ${admin ? `<td class="hide-sm">${r.doctors.length ? r.doctors.map(d => esc(d.full_name)).join("<br>") : '<span class="status off">None</span>'}</td><td class="hide-sm status ${r.is_active ? "" : "off"}">${r.is_active ? "Active" : "Deactivated"}</td>` : ""}
          <td><div class="row-actions"><a class="btn small" href="#patient/${r.id}">Open</a>${r.is_active ? `<a class="btn small" href="#assess/${r.id}">Assess</a>` : ""}</div></td>
        </tr>`).join("")}</tbody></table>`;
    };
    $("#pSearch").addEventListener("input", render);
    render();
  }

  /* ============================================================ doctors (patient) */
  async function viewMyDoctors() {
    const [mine, all] = await Promise.all([api("/api/me/doctors"), api("/api/doctors")]);
    const mineIds = new Set(mine.map(d => d.id));
    const card = (d, isMine) => `<div class="doc-card${isMine ? " mine" : ""}">
        <h3>${esc(d.full_name)}</h3><span class="spec">${esc(d.specialty)}</span>
        <p>${esc(d.hospital)}</p>${d.bio ? `<p>${esc(d.bio)}</p>` : ""}
        <button class="btn small ${isMine ? "danger" : "solid"}" type="button" data-${isMine ? "remove" : "add"}="${d.id}">${isMine ? "Remove" : "Add as my doctor"}</button>
      </div>`;
    const others = all.filter(d => !mineIds.has(d.id));
    dyn().innerHTML = `
      <div class="page-head"><div><h1>My doctors</h1><p>Doctors you add can see all your assessments and record new ones for you. You can remove them at any time.</p></div></div>
      ${mine.length ? `<div class="doc-grid">${mine.map(d => card(d, true)).join("")}</div>` : `<div class="card empty-state"><h2>No doctor chosen yet</h2><p>Add one or more doctors below so they can follow your results.</p></div>`}
      <h2 class="section-title">Find a doctor</h2>
      <div class="toolbar" style="margin-bottom:14px"><input type="search" id="dSearch" placeholder="Search by name, specialty or hospital" aria-label="Search doctors"></div>
      <div class="doc-grid" id="dGrid"></div>`;
    const render = () => {
      const q = $("#dSearch").value.trim().toLowerCase();
      const list = others.filter(d => !q || [d.full_name, d.specialty, d.hospital].join(" ").toLowerCase().includes(q));
      $("#dGrid").innerHTML = list.length ? list.map(d => card(d, false)).join("") : `<p class="muted">${others.length ? `No doctor matches "${esc(q)}".` : "You have added every available doctor."}</p>`;
      $$("[data-add]").forEach(b => b.addEventListener("click", async () => {
        try { await post(`/api/me/doctors/${b.dataset.add}`); toast("Doctor added"); viewMyDoctors(); } catch (ex) { toast(ex.message, true); }
      }));
    };
    $("#dSearch").addEventListener("input", render);
    render();
    $$("[data-remove]").forEach(b => b.addEventListener("click", async () => {
      const d = mine.find(x => x.id === Number(b.dataset.remove));
      const ok = await ask({ title: `Remove ${d.full_name}?`, text: "They will no longer see your assessments. You can add them again later.", okLabel: "Remove", danger: true });
      if (!ok) return;
      try { await api(`/api/me/doctors/${d.id}`, { method: "DELETE" }); toast("Doctor removed"); viewMyDoctors(); } catch (ex) { toast(ex.message, true); }
    }));
  }

  /* ============================================================ admin */
  async function viewOverview() {
    const s = await api("/api/admin/stats");
    const mix = s.latest_decision_mix, total = Object.values(mix).reduce((a, b) => a + b, 0);
    const mixRow = (label, n, color) => `<div class="mix-row"><span>${label}</span><div class="track"><i style="width:${total ? n / total * 100 : 0}%;background:${color}"></i></div><b>${n}</b></div>`;
    dyn().innerHTML = `
      <div class="page-head"><div><h1>Overview</h1><p>Everything in the SmartHeart database.</p></div>
        <div class="toolbar"><a class="btn small" href="/api/admin/export.csv" download>Export all assessments</a></div></div>
      <div class="tiles">
        <a class="tile" href="#patients" style="text-decoration:none"><span>Patients</span><b>${s.patients}</b><small>${s.active_patients} active</small></a>
        <a class="tile" href="#doctors" style="text-decoration:none"><span>Doctors</span><b>${s.doctors}</b><small>active accounts</small></a>
        <a class="tile" href="#assessments" style="text-decoration:none"><span>Assessments</span><b>${s.assessments}</b><small>${s.assessments_30d} in the last 30 days</small></a>
        <a class="tile ${s.unassigned_patients ? "warn" : ""}" href="#patients" style="text-decoration:none"><span>Patients without a doctor</span><b>${s.unassigned_patients}</b><small>${s.unassigned_patients ? "assign them from the patient page" : "everyone has a doctor"}</small></a>
      </div>
      <div class="overview-grid">
        <div class="card"><h2>Latest result per patient</h2>
          ${total ? `<div class="mix">${mixRow("Disease likely", mix["Disease likely"] || 0, "var(--risk)")}${mixRow("Refer to clinician", mix["Refer"] || 0, "var(--refer-mark)")}${mixRow("No disease likely", mix["No disease likely"] || 0, "var(--safe)")}</div>
            <p class="muted" style="margin:12px 0 0;font-size:13px">${plural(total, "patient")} with at least one assessment.</p>` : `<p class="muted">No assessments yet.</p>`}
        </div>
        <div><h2 class="section-title" style="margin-top:0">Recent assessments</h2>
          ${s.recent.length ? `<div class="table-wrap">${assessmentTable(s.recent, { showPatient: true })}</div>` : `<div class="card empty-state"><h2>No assessments yet</h2><p>They appear here as patients and doctors record them.</p></div>`}
        </div>
      </div>`;
  }

  async function viewAllAssessments() {
    const rows = await api("/api/admin/assessments");
    dyn().innerHTML = `
      <div class="page-head"><div><h1>All assessments</h1><p>${plural(rows.length, "assessment")}, newest first.</p></div>
        <div class="toolbar"><input type="search" id="aSearch" placeholder="Search patient, decision or notes" aria-label="Search assessments"><a class="btn small" href="/api/admin/export.csv" download>Export CSV</a></div></div>
      <div class="table-wrap" id="aTable"></div>`;
    const render = () => {
      const q = $("#aSearch").value.trim().toLowerCase();
      const list = rows.filter(a => !q || [a.patient_name, a.decision, a.notes || "", a.created_by_name].join(" ").toLowerCase().includes(q));
      $("#aTable").innerHTML = rows.length ? (list.length ? assessmentTable(list, { showPatient: true, canDelete: true }) : `<div class="empty-state"><h2>No matches</h2><p>Nothing matches "${esc(q)}".</p></div>`)
        : `<div class="empty-state"><h2>No assessments yet</h2><p>They appear here as patients and doctors record them.</p></div>`;
      wireAssessmentTable(viewAllAssessments);
    };
    $("#aSearch").addEventListener("input", render);
    render();
  }

  async function viewDoctorsAdmin() {
    const docs = await api("/api/doctors");
    dyn().innerHTML = `
      <div class="page-head"><div><h1>Doctors</h1><p>${plural(docs.filter(d => d.is_active).length, "active doctor")}. Patients choose from this list; you can also assign them from a patient's page.</p></div>
        <div class="toolbar"><button class="btn small solid" type="button" id="addDocBtn">Add doctor</button></div></div>
      <form class="card" id="docForm" hidden novalidate style="margin-bottom:22px">
        <h2>New doctor account</h2>
        <p class="form-error" id="docError" hidden></p>
        <div class="form-grid">
          <div class="field"><label for="nd_name">Full name</label><input type="text" id="nd_name" maxlength="80" placeholder="Dr. ..."></div>
          <div class="field"><label for="nd_spec">Specialty</label><input type="text" id="nd_spec" maxlength="80" placeholder="Clinical Cardiology"></div>
          <div class="field"><label for="nd_hosp">Hospital</label><input type="text" id="nd_hosp" maxlength="120"></div>
          <div class="field"><label for="nd_user">Username</label><input type="text" id="nd_user" maxlength="40" autocomplete="off"></div>
          <div class="field"><label for="nd_pass">Initial password</label><input type="password" id="nd_pass" autocomplete="new-password"><small>At least 8 characters; share it with the doctor</small></div>
          <div class="field"><label for="nd_reg">Registration number <small>(optional)</small></label><input type="text" id="nd_reg" maxlength="40"></div>
          <div class="field"><label for="nd_email">Email <small>(optional)</small></label><input type="email" id="nd_email" maxlength="120"></div>
          <div class="field"><label for="nd_phone">Phone <small>(optional)</small></label><input type="tel" id="nd_phone" maxlength="30"></div>
        </div>
        <div class="stack-actions"><button class="btn small solid" type="submit">Create doctor</button><button class="btn small" type="button" id="docCancel">Cancel</button></div>
      </form>
      <div class="table-wrap"><table><thead><tr><th>Doctor</th><th>Specialty</th><th class="hide-sm">Hospital</th><th>Patients</th><th class="hide-sm">Status</th><th><span hidden>Actions</span></th></tr></thead><tbody>
        ${docs.map(d => `<tr>
          <td><b>${esc(d.full_name)}</b><br><small>${esc(d.username)}${d.registration_no ? `, ${esc(d.registration_no)}` : ""}</small></td>
          <td>${esc(d.specialty)}</td><td class="hide-sm">${esc(d.hospital)}</td>
          <td class="num">${d.n_patients}</td>
          <td class="hide-sm status ${d.is_active ? "" : "off"}">${d.is_active ? "Active" : "Deactivated"}</td>
          <td><div class="row-actions"><button class="btn small" type="button" data-edit="${d.id}">Edit details</button><button class="btn small" type="button" data-reset="${d.id}">Reset password</button><button class="btn small ${d.is_active ? "danger" : ""}" type="button" data-toggle="${d.id}">${d.is_active ? "Deactivate" : "Reactivate"}</button></div></td>
        </tr>`).join("")}</tbody></table></div>`;
    const f = $("#docForm");
    $("#addDocBtn").addEventListener("click", () => { f.hidden = false; $("#nd_name").focus(); });
    $("#docCancel").addEventListener("click", () => { f.reset(); f.hidden = true; });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = (m) => { $("#docError").textContent = m; $("#docError").hidden = false; };
      const body = { full_name: $("#nd_name").value.trim(), specialty: $("#nd_spec").value.trim(), hospital: $("#nd_hosp").value.trim(),
        username: $("#nd_user").value.trim(), password: $("#nd_pass").value, registration_no: $("#nd_reg").value.trim() || null,
        email: $("#nd_email").value.trim() || null, phone: $("#nd_phone").value.trim() || null };
      if (!body.full_name || !body.specialty || !body.hospital) return err("Name, specialty and hospital are required.");
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(body.username)) return err("Username: 3 to 40 letters, digits, dots, dashes or underscores.");
      if (body.password.length < 8) return err("The initial password needs at least 8 characters.");
      try { await post("/api/admin/doctors", body); toast(`${body.full_name} can now sign in as ${body.username}`); viewDoctorsAdmin(); } catch (ex) { err(ex.message); }
    });
    $$("[data-edit]").forEach(b => b.addEventListener("click", () => { const d = docs.find(x => x.id === Number(b.dataset.edit)); editDetails(d, "doctor", viewDoctorsAdmin); }));
    $$("[data-reset]").forEach(b => b.addEventListener("click", () => { const d = docs.find(x => x.id === Number(b.dataset.reset)); resetPassword(d.id, d.full_name); }));
    $$("[data-toggle]").forEach(b => b.addEventListener("click", () => { const d = docs.find(x => x.id === Number(b.dataset.toggle)); toggleActive(d.id, d.full_name, d.is_active, viewDoctorsAdmin); }));
  }

  /* ============================================================ start */
  async function init() {
    drawStrip();
    try { const u = await api("/api/auth/me"); await enterApp(u); }
    catch (_) { showAuth(location.hash === "#register" ? "register" : "login"); }
  }
  init();
})();
