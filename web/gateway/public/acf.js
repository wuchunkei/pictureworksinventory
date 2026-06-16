"use strict";
/* ACF signature pad + helpers. Depends on globals from app.js. */

// Returns { node, isEmpty(), toBase64Png(), clear() }
function makeSignaturePad() {
  const canvas = h("canvas", { class: "sig-pad" });
  let drawing = false, dirty = false, last = null;
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return;
    const data = canvas.toDataURL();
    canvas.width = r.width; canvas.height = r.height;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = getComputedStyle(document.body).color; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (dirty) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = data; }
  }
  function pos(e) { const r = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; }
  function start(e) { e.preventDefault(); drawing = true; last = pos(e); }
  function move(e) {
    if (!drawing) return; e.preventDefault();
    const ctx = canvas.getContext("2d"); const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; dirty = true;
  }
  function end() { drawing = false; }
  canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false }); canvas.addEventListener("touchmove", move, { passive: false }); canvas.addEventListener("touchend", end);
  setTimeout(resize, 0);
  return {
    node: canvas,
    isEmpty: () => !dirty,
    clear: () => { const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    toBase64Png: () => dirty ? canvas.toDataURL("image/png").split(",")[1] : null,
  };
}

function acfCategory(assetId) { const p = (assetId || "").split("-"); return p.length >= 3 ? p[p.length - 2] : "—"; }
function acfNumber(assetId) { const last = (assetId || "").split("-").pop() || ""; return parseInt(last.replace(/\D/g, ""), 10) || 0; }

// Download the role-appropriate file and trigger a browser download.
async function downloadAcf(formId) {
  const headers = {}; if (State.token) headers["Authorization"] = "Bearer " + State.token;
  if (Geo.lat != null && Geo.lng != null) headers["X-Client-Geo"] = `${Geo.lat},${Geo.lng}`;
  const res = await fetch(`${apiBase()}asset-check-forms/${formId}/download`, { headers });
  if (!res.ok) throw new Error("Download failed (" + res.status + ")");
  const disp = res.headers.get("Content-Disposition") || "";
  const m = disp.match(/filename="([^"]+)"/);
  const name = m ? m[1] : "AssetCheckForm";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Export ACF modal
function openExportAcf() {
  let companyId = "", branchId = "", fileName = "";
  const sig = makeSignaturePad();
  const bodyWrap = h("div", {});
  const errEl = h("div", { class: "err" });

  function included() {
    if (!companyId || !branchId) return [];
    return State.skus.filter(s => s.warehouseId === companyId && s.branchId === branchId &&
      ["available", "borrowed", "repairing"].includes(s.status));
  }
  function branch() { return State.companies.find(c => c.id === companyId)?.branches.find(b => b.id === branchId); }
  function draw() {
    clear(bodyWrap);
    const company = State.companies.find(c => c.id === companyId);
    const branches = company?.branches?.slice().sort((a, b) => a.name.localeCompare(b.name)) || [];
    const compSel = selectField("Company", companyId, [{ value: "", label: "Select a company" }, ...State.companies.map(c => ({ value: c.id, label: c.name }))]);
    compSel.select.addEventListener("change", () => { companyId = compSel.select.value; branchId = ""; draw(); });
    const brSel = selectField("Branch", branchId, [{ value: "", label: "Select a branch" }, ...branches.map(b => ({ value: b.id, label: b.name }))]);
    brSel.select.addEventListener("change", () => { branchId = brSel.select.value; draw(); });
    const fileF = fieldInput("File name (.pdf)", fileName);
    fileF.input.addEventListener("input", () => { fileName = fileF.input.value; updateSubmit(); });
    const b = branch();
    bodyWrap.append(compSel, brSel,
      branchId ? h("div", { class: "row", style: "margin-bottom:8px" }, h("span", { class: "grow" }, "Assets to include"), h("b", {}, String(included().length))) : "",
      branchId ? h("div", { class: "row", style: "margin-bottom:12px" }, h("span", { class: "grow" }, "Endorser"),
        h("span", { style: b?.endorserName ? "" : "color:var(--orange)" }, b?.endorserName || "Not set")) : "",
      fileF,
      h("div", { class: "section-label" }, "Your signature"),
      sig.node,
      h("div", {}, h("button", { class: "btn secondary small", onclick: () => { sig.clear(); } }, "Clear")),
      branchId && !b?.endorserUserId ? h("div", { style: "color:var(--orange);font-size:13px" }, "This branch has no endorser. Set one before exporting.") : "",
      errEl);
    updateSubmit();
  }
  let submitBtn;
  function canSubmit() { const b = branch(); return companyId && branchId && fileName.trim() && included().length && b?.endorserUserId && !sig.isEmpty(); }
  function updateSubmit() { if (submitBtn) submitBtn.disabled = !canSubmit(); }
  sig.node.addEventListener("mouseup", updateSubmit); sig.node.addEventListener("touchend", updateSubmit);

  submitBtn = h("button", { class: "btn", onclick: async () => {
    if (!canSubmit()) return;
    submitBtn.disabled = true;
    try { await api("asset-check-forms", { method: "POST", body: { companyId, branchId, acfNo: fileName.trim(), signaturePng: sig.toBase64Png() } });
      close(); await refresh(); renderApp(); toast("Asset form submitted"); }
    catch (e) { errEl.textContent = e.message; submitBtn.disabled = false; }
  } }, "Submit");
  const close = modal({ title: "Export Asset Form", body: bodyWrap, actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"), submitBtn,
  ]});
  draw();
}

Components.makeSignaturePad = makeSignaturePad;
Components.openExportAcf = openExportAcf;
Components.downloadAcf = downloadAcf;
