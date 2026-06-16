"use strict";
/* Feature screens. Depends on globals from app.js + acf.js. */

function topbar(title, ...actions) {
  return h("div", { class: "topbar" }, h("h1", {}, title), h("div", { class: "row" }, ...actions));
}
function company(id) { return State.companies.find(c => c.id === id); }
function skuByCode(code) { return State.skus.find(s => (s.skuCode || s.skuNumber) === code); }
async function reloadAndRender() { await refresh(); renderApp(); }

// ============================================================ INVENTORY
Screens.inventory = function (screen, route) {
  const parts = route.split("/");
  if (parts[1] === "sku" && parts[2]) return skuDetail(screen, decodeURIComponent(parts[2]));

  let filter = null, q = "";
  const canManage = State.permissions?.canManageInventory;
  const canExport = ["admin", "superadmin"].includes(State.user?.role);
  const actions = [];
  actions.push(h("button", { class: "btn outline", onclick: () => openScan() }, "📷 Scan"));
  if (canManage) actions.push(h("button", { class: "btn outline", onclick: () => openImportAcf() }, "⬇ Import"));
  if (canExport) actions.push(h("button", { class: "btn outline", onclick: () => Components.openExportAcf() }, "⬆ Export"));
  if (canManage) actions.push(h("button", { class: "btn", onclick: () => openAddSku() }, "+ Add"));
  screen.append(topbar("Inventory", ...actions));

  const search = h("input", { placeholder: "Search by SKU code or serial", value: q });
  search.addEventListener("input", () => { q = search.value; drawList(); });
  screen.append(h("div", { style: "margin-bottom:12px" }, search));

  const chips = h("div", { class: "chips" });
  const list = h("div", {});
  screen.append(chips, list);

  function drawChips() {
    clear(chips);
    const opts = [["All", null], ["Available", "available"], ["Borrowed", "borrowed"], ["Repairing", "repairing"], ["Disposed", "disposed"]];
    for (const [label, val] of opts) chips.append(h("button", { class: "chip" + (filter === val ? " active" : ""), onclick: () => { filter = val; drawChips(); drawList(); } }, label));
  }
  function drawList() {
    clear(list);
    let items = filter ? State.skus.filter(s => s.status === filter) : State.skus.slice();
    if (q.trim()) { const t = q.trim().toLowerCase(); items = items.filter(s => (s.displayCode || s.skuCode || s.skuNumber || "").toLowerCase().includes(t) || (s.serialNumber || "").toLowerCase().includes(t) || (s.descriptionText || "").toLowerCase().includes(t)); }
    items.sort((a, b) => (a.skuCode || a.skuNumber || "").localeCompare(b.skuCode || b.skuNumber || ""));
    if (!items.length) { list.append(h("div", { class: "empty" }, "No items")); return; }
    for (const s of items) {
      list.append(h("div", { class: "card list-card list", onclick: () => location.hash = "#/inventory/sku/" + encodeURIComponent(s.id) },
        h("div", { class: "grow" },
          h("div", { class: "title" }, s.skuCode || s.skuNumber || ""),
          h("div", { class: "muted" }, [s.categoryCode, s.parkName].filter(Boolean).join(" · "))),
        h("span", { class: "pill " + s.status }, s.status)));
    }
  }
  drawChips(); drawList();
};

function skuDetail(screen, skuId) {
  const sku = State.skus.find(s => s.id === skuId);
  screen.append(topbar(sku ? (sku.skuCode || sku.skuNumber) : "Item", h("button", { class: "btn outline", onclick: () => history.back() }, "‹ Back")));
  if (!sku) { screen.append(h("div", { class: "empty" }, "Item not found")); return; }
  const canManage = State.permissions?.canManageInventory;
  const isSuper = State.user?.role === "superadmin";
  const rows = [
    ["Company", sku.companyName], ["Branch", sku.parkName], ["Location", sku.locationName],
    ["Category", sku.categoryCode], ["Serial", sku.serialNumber], ["Description", sku.descriptionText],
    ["Last scanned", sku.lastScannedByName ? `${sku.lastScannedByName} · ${fmtDateTime(sku.lastScannedAt)}` : fmtDateTime(sku.lastScannedAt)],
  ].filter(r => r[1]);
  const info = h("div", { class: "card", style: "padding:16px" }, h("div", { class: "row", style: "margin-bottom:10px" },
    h("div", { class: "grow title", style: "font-size:18px" }, sku.skuCode || sku.skuNumber), h("span", { class: "pill " + sku.status }, sku.status)),
    ...rows.map(r => h("div", { class: "row", style: "padding:4px 0" }, h("span", { class: "muted grow" }, r[0]), h("span", {}, r[1]))));
  screen.append(info);

  const act = h("div", { class: "stack", style: "margin-top:16px" });
  screen.append(act);
  const doAction = async (label, fn) => { try { await fn(); toast(label); await reloadAndRender(); } catch (e) { toast(e.message); } };
  if (sku.status === "available" && canManage) {
    if (isSuper) act.append(h("button", { class: "btn outline", onclick: () => openEditSku(sku) }, "✎ Edit Item"));
    act.append(h("button", { class: "btn outline", onclick: () => openRepair(sku) }, "Request Repair"));
    act.append(h("button", { class: "btn outline", onclick: () => openTransfer(sku) }, "Transfer"));
    act.append(h("button", { class: "btn danger-outline", onclick: () => openDisposal(sku) }, "Request Disposal"));
  } else if (sku.status === "borrowed") {
    act.append(h("button", { class: "btn", onclick: () => doAction("Returned", () => api("return", { method: "POST", body: { skuNumber: sku.skuCode || sku.skuNumber } })) }, "Return"));
  } else if (sku.status === "repairing") {
    act.append(h("button", { class: "btn", onclick: () => doAction("Returned from repair", () => api("return-after-repair", { method: "POST", body: { skuNumber: sku.skuCode || sku.skuNumber } })) }, "Return from Repair"));
  } else if (sku.status === "available") {
    act.append(h("button", { class: "btn", onclick: () => doAction("Borrowed", () => api("borrow", { method: "POST", body: { skuNumber: sku.skuCode || sku.skuNumber } })) }, "Borrow"));
  }
}

// Camera scan (BarcodeDetector where available) + manual entry fallback.
// On a hit, look up the SKU and open its detail (which has borrow/return etc.).
function openScan() {
  let stream = null, raf = null, stopped = false;
  const video = h("video", { class: "scan-video", autoplay: true, muted: true, playsinline: true });
  const status = h("div", { class: "muted", style: "margin:8px 0" }, "");
  const manual = fieldInput("Or enter SKU code", "");
  function stop() { stopped = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); }
  function go(code) {
    code = (code || "").trim(); if (!code) return;
    const sku = State.skus.find(s => (s.skuCode || s.skuNumber) === code || s.displayCode === code || s.serialNumber === code);
    stop(); close();
    if (sku) location.hash = "#/inventory/sku/" + encodeURIComponent(sku.id);
    else toast("Not found: " + code);
  }
  async function start() {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
      video.style.display = "none"; status.textContent = "Camera scanning isn't supported in this browser — enter the code manually."; return;
    }
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "data_matrix"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream; status.textContent = "Point the camera at the SKU code…";
      const tick = async () => {
        if (stopped) return;
        try { const codes = await detector.detect(video); if (codes.length) return go(codes[0].rawValue); } catch (e) {}
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch (e) { video.style.display = "none"; status.textContent = "Camera unavailable — enter the code manually."; }
  }
  manual.input.addEventListener("keydown", e => { if (e.key === "Enter") go(manual.input.value); });
  const close = modal({ title: "Scan SKU", body: h("div", {}, video, status, manual,
    h("button", { class: "btn", style: "width:100%;margin-top:4px", onclick: () => go(manual.input.value) }, "Look up")),
    actions: [h("button", { class: "btn outline", onclick: () => { stop(); close(); } }, "Cancel")], onClose: stop });
  start();
}

// Import an exported ACF: pick company+branch+file, the server diffs it against
// inventory into New / Mismatched / Already-correct, then you apply the changes.
function openImportAcf() {
  let companyId = "", branchId = "", result = null, fileB64 = null, fileName = "";
  const createSel = new Set(), updateSel = new Set();
  let placements = {};   // remark index -> { active, branchId, location }
  const body = h("div", {}); const err = h("div", { class: "err" });

  function branches() { return company(companyId)?.branches?.slice().sort((a,b)=>a.name.localeCompare(b.name)) || []; }
  function branchLocs(bid) { return (company(companyId)?.branches?.find(b => b.id === bid)?.locations) || []; }
  // A placement is complete when a branch is chosen, and (if that branch has any
  // locations) a location is chosen too.
  function placementsComplete() {
    return (result?.remarks || []).every((x, i) => {
      const pl = placements[i];
      if (!pl || !pl.active) return true;
      if (!pl.branchId) return false;
      if (branchLocs(pl.branchId).length && !pl.location) return false;
      return true;
    });
  }
  function updateApply() { if (applyBtn) applyBtn.disabled = !placementsComplete(); }
  function drawPick() {
    clear(body);
    const compSel = selectField("Company", companyId, [{ value: "", label: "Select a company" }, ...State.companies.map(c => ({ value: c.id, label: c.name }))]);
    compSel.select.onchange = () => { companyId = compSel.select.value; branchId = ""; drawPick(); };
    const brSel = selectField("Branch", branchId, [{ value: "", label: "Select a branch" }, ...branches().map(b => ({ value: b.id, label: b.name }))]);
    brSel.select.onchange = () => { branchId = brSel.select.value; updateSubmit(); };
    const fileBtn = h("input", { type: "file", accept: ".xlsx,.xls,.csv" });
    fileBtn.onchange = () => {
      const f = fileBtn.files[0]; if (!f) return; fileName = f.name;
      const reader = new FileReader();
      reader.onload = () => { fileB64 = String(reader.result).split(",")[1]; updateSubmit(); };
      reader.readAsDataURL(f);
    };
    body.append(compSel, brSel, h("div", { class: "field" }, h("label", {}, "Asset Check Form file (.xlsx)"), fileBtn),
      h("div", { class: "muted", style: "font-size:12px" }, "We'll match each ASSET ID against your inventory and show what's new, what differs, and what already matches."),
      err);
    updateSubmit();
  }
  function canSubmit() { return companyId && branchId && fileB64; }
  function updateSubmit() { if (submitBtn) submitBtn.disabled = !canSubmit(); analyzeBtn && (analyzeBtn.disabled = !canSubmit()); }

  function badge(n, color) { return h("span", { class: "pill", style: `background:${color}22;color:${color}` }, String(n)); }
  function drawReview() {
    clear(body);
    createSel.clear(); updateSel.clear();
    result.newItems.forEach(x => createSel.add(x.assetId));
    result.mismatched.forEach(x => updateSel.add(x.skuId));
    body.append(h("div", { class: "row", style: "gap:10px;margin-bottom:12px" },
      h("span", {}, "New "), badge(result.counts.new, "#1b873f"),
      h("span", {}, "Mismatched "), badge(result.counts.mismatched, "#e08600"),
      h("span", {}, "Already correct "), badge(result.counts.existing, "#0071e3")));

    if (result.newItems.length) {
      body.append(h("div", { class: "section-label" }, "New — will be created"));
      result.newItems.forEach(x => {
        const cb = h("input", { type: "checkbox" }); cb.checked = true;
        cb.onchange = () => { if (cb.checked) createSel.add(x.assetId); else createSel.delete(x.assetId); };
        body.append(h("label", { class: "row", style: "gap:8px;padding:4px 0" }, cb,
          h("div", { class: "grow" }, h("div", { class: "title" }, x.assetId),
            h("div", { class: "muted" }, [x.description, x.serial && "SN: "+x.serial, x.location].filter(Boolean).join(" · ")))));
      });
    }
    if (result.mismatched.length) {
      body.append(h("div", { class: "section-label" }, "Mismatched — will be updated"));
      result.mismatched.forEach(x => {
        const cb = h("input", { type: "checkbox" }); cb.checked = true;
        cb.onchange = () => { if (cb.checked) updateSel.add(x.skuId); else updateSel.delete(x.skuId); };
        const diffLines = x.diffs.map(d => h("div", { class: "muted", style: "font-size:12px" },
          `${d.field}: ${d.current || "—"} → ${d.imported || "—"}`));
        body.append(h("label", { class: "row", style: "gap:8px;padding:6px 0;align-items:flex-start" }, cb,
          h("div", { class: "grow" }, h("div", { class: "title" }, x.assetId), ...diffLines)));
      });
    }
    if ((result.newLocations || []).length) {
      body.append(h("div", { class: "section-label" }, `New locations — will be created (${result.newLocations.length})`),
        h("div", { class: "muted", style: "font-size:12px" }, result.newLocations.join(", ")));
    }
    if (result.existing.length) {
      body.append(h("div", { class: "section-label" }, `Already correct (${result.existing.length}) — no change`),
        h("div", { class: "muted", style: "font-size:12px" }, result.existing.map(x => x.assetId).join(", ")));
    }
    if (!result.newItems.length && !result.mismatched.length) {
      body.append(h("div", { class: "empty" }, "Everything already matches — nothing to import."));
    }
    // Remarks (your column-J notes, e.g. "To OW") pulled out at the very bottom.
    // Each row can be placed: existing → transfer to a chosen branch/location;
    // new → choose which branch/location it belongs to.
    if ((result.remarks || []).length) {
      const compBranches = (company(companyId)?.branches || []).slice().sort((a,b)=>a.name.localeCompare(b.name));
      body.append(h("div", { class: "section-label", style: "color:var(--orange)" }, `⚑ Remarks — needs attention (${result.remarks.length})`));
      result.remarks.forEach((x, i) => {
        const isExisting = !!x.skuId;
        // Default unselected — the user picks branch (and location, if the branch
        // has any) like the Add-Inventory flow; must be complete before saving.
        const pl = placements[i] || (placements[i] = { active: false, branchId: "", location: "" });
        const controls = h("div", { style: "margin-top:6px" });
        function locsOf(bid) { return (compBranches.find(b => b.id === bid)?.locations || []).slice().sort((a,b)=>a.name.localeCompare(b.name)); }
        function drawControls() {
          clear(controls);
          if (!pl.active) { updateApply(); return; }
          const brSel = selectField(isExisting ? "Transfer to branch" : "Branch", pl.branchId,
            [{ value: "", label: "Not selected" }, ...compBranches.map(b => ({ value: b.id, label: b.name }))]);
          brSel.select.onchange = () => { pl.branchId = brSel.select.value; pl.location = ""; drawControls(); };
          controls.append(brSel);
          const locs = pl.branchId ? locsOf(pl.branchId) : [];
          if (locs.length) {
            const locSel = selectField("Location", pl.location,
              [{ value: "", label: "Not selected" }, ...locs.map(l => ({ value: l.name, label: l.name }))]);
            locSel.select.onchange = () => { pl.location = locSel.select.value; updateApply(); };
            controls.append(locSel);
          }
          updateApply();
        }
        const toggle = h("input", { type: "checkbox" }); toggle.checked = pl.active;
        toggle.onchange = () => { pl.active = toggle.checked; if (!pl.active) { pl.branchId = ""; pl.location = ""; } drawControls(); };
        body.append(h("div", { class: "card", style: "padding:8px 12px;margin-bottom:6px" },
          h("div", { class: "row" }, h("span", { class: "title grow" }, x.assetId),
            h("span", { class: "muted", style: x.skuId ? "" : "color:var(--orange)" }, x.skuId ? "existing" : "not in inventory")),
          h("div", { style: "color:var(--orange)" }, x.remark),
          h("label", { class: "row", style: "gap:6px;margin-top:4px;font-size:13px" }, toggle,
            h("span", {}, isExisting ? "Transfer to another branch / location" : "Assign branch / location")),
          controls));
        drawControls();
      });
    }
    body.append(err);
    footer.replaceChildren(
      h("button", { class: "btn outline", onclick: () => { result = null; drawPick(); footerPick(); } }, "‹ Back"),
      applyBtn);
  }

  let submitBtn, analyzeBtn, applyBtn, footer;
  analyzeBtn = h("button", { class: "btn", onclick: async () => {
    if (!canSubmit()) return; err.textContent = ""; analyzeBtn.disabled = true; analyzeBtn.textContent = "Analyzing…";
    try {
      result = await api("inventory/import/parse", { method: "POST", body: { companyId, branchId, fileBase64: fileB64 } });
      placements = {};
      drawReview();
    } catch (e) { err.textContent = e.message; analyzeBtn.disabled = false; analyzeBtn.textContent = "Analyze"; }
  } }, "Analyze");
  submitBtn = analyzeBtn;
  applyBtn = h("button", { class: "btn", onclick: async () => {
    err.textContent = ""; applyBtn.disabled = true; applyBtn.textContent = "Applying…";
    const create = result.newItems.filter(x => createSel.has(x.assetId));
    const update = result.mismatched.filter(x => updateSel.has(x.skuId))
      .map(x => ({ skuId: x.skuId, assetId: x.assetId, description: x.description, serial: x.serial, location: x.location }));
    // Remark placements (transfers / explicit new-item branch assignment).
    const place = (result.remarks || []).map((x, i) => ({ x, pl: placements[i] }))
      .filter(o => o.pl && o.pl.active && o.pl.branchId)
      .map(o => ({ assetId: o.x.assetId, skuId: o.x.skuId || undefined, branchId: o.pl.branchId, location: o.pl.location,
        description: o.x.description, serial: o.x.serial }));
    try {
      const r = await api("inventory/import/apply", { method: "POST", body: { companyId, branchId, create, update, place } });
      close(); await reloadAndRender();
      toast(`Imported: ${r.created} created, ${r.updated} updated` + (r.transferred ? `, ${r.transferred} transferred` : "") + (r.errors?.length ? `, ${r.errors.length} skipped` : ""));
    } catch (e) { err.textContent = e.message; applyBtn.disabled = false; applyBtn.textContent = "Apply"; }
  } }, "Apply");

  function footerPick() { footer.replaceChildren(h("button", { class: "btn outline", onclick: () => close() }, "Cancel"), analyzeBtn); }
  footer = h("div", { class: "modal-actions" });
  const close = modal({ title: "Import Asset Form", body, actions: [] });
  // Replace the (empty) default actions row with our dynamic footer.
  body.parentElement.append(footer);
  drawPick(); footerPick();
}

function openRepair(sku) {
  const reason = fieldInput("Reason for repair", ""); const dest = fieldInput("Send to (destination)", "");
  const close = modal({ title: "Request Repair", body: h("div", {}, reason, dest), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => { try { await api("repair", { method: "POST", body: { skuNumber: sku.skuCode || sku.skuNumber, reason: reason.input.value, destination: dest.input.value } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Submit"),
  ]});
}
function openTransfer(sku) {
  const comp = company(sku.warehouseId);
  const branches = (comp?.branches || []).filter(b => b.id !== sku.branchId);
  const sel = selectField("Transfer to", "", [{ value: "", label: "Select branch" }, ...branches.map(b => ({ value: b.id, label: b.name }))]);
  const reason = fieldInput("Reason", "");
  const close = modal({ title: "Transfer", body: h("div", {}, sel, reason), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => { if (!sel.select.value) return; try { await api("transfer", { method: "POST", body: { skuNumber: sku.skuCode || sku.skuNumber, toBranchId: sel.select.value, reason: reason.input.value } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Submit"),
  ]});
}
function openDisposal(sku) {
  const reason = fieldInput("Reason for disposal", ""); const nbv = fieldInput("Net book value", "");
  const close = modal({ title: "Request Disposal", body: h("div", {}, reason, nbv, h("div", { class: "muted" }, "This will be sent to superadmin for approval.")), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn danger", onclick: async () => { try { await api("disposal", { method: "POST", body: { skuNumber: sku.skuCode || sku.skuNumber, reason: reason.input.value, netBookValue: nbv.input.value } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Submit"),
  ]});
}

function openAddSku() {
  let cId = "", bId = "", lId = "", catId = "", num = "", descId = null, descText = "", serial = "";
  const wrap = h("div", {}); const err = h("div", { class: "err" });
  function draw() {
    clear(wrap);
    const comp = company(cId);
    const branches = comp?.branches?.slice().sort((a,b)=>a.name.localeCompare(b.name)) || [];
    const br = branches.find(b => b.id === bId);
    const locs = br?.locations?.slice().sort((a,b)=>a.name.localeCompare(b.name)) || [];
    const cats = comp?.categories?.slice().sort((a,b)=>a.code.localeCompare(b.code)) || [];
    const descs = comp?.descriptions || [];
    const compSel = selectField("Company", cId, [{value:"",label:"Select"}, ...State.companies.map(c=>({value:c.id,label:c.name}))]);
    compSel.select.onchange = () => { cId = compSel.select.value; bId=""; lId=""; catId=""; draw(); };
    const brSel = selectField("Branch", bId, [{value:"",label:"Select"}, ...branches.map(b=>({value:b.id,label:b.name}))]);
    brSel.select.onchange = () => { bId = brSel.select.value; lId=""; draw(); };
    wrap.append(compSel, brSel);
    if (locs.length) { const lSel = selectField("Location", lId, [{value:"",label:"Select"}, ...locs.map(l=>({value:l.id,label:l.name}))]); lSel.select.onchange = () => { lId = lSel.select.value; }; wrap.append(lSel); }
    const catSel = selectField("Category", catId, [{value:"",label:"Select"}, ...cats.map(c=>({value:c.id,label:c.code}))]);
    catSel.select.onchange = () => { catId = catSel.select.value; draw(); };
    wrap.append(catSel);
    const numF = fieldInput("4-digit number", num, { maxlength: 4 });
    numF.input.oninput = () => { num = numF.input.value.replace(/\D/g,"").slice(0,4); numF.input.value = num; updatePreview(); };
    wrap.append(numF);
    const prev = h("div", { class: "mono muted", id: "skuPrev" }); wrap.append(prev);
    if (descs.length) { const dSel = selectField("Description preset", descId || "", [{value:"",label:"Custom text"}, ...descs.map(d=>({value:d.id,label:d.text}))]); dSel.select.onchange = () => { descId = dSel.select.value || null; draw(); }; wrap.append(dSel); }
    if (!descId) { const dF = fieldInput("Description", descText); dF.input.oninput = () => descText = dF.input.value; wrap.append(dF); }
    const sF = fieldInput("Serial Number (optional)", serial); sF.input.oninput = () => serial = sF.input.value; wrap.append(sF, err);
    function updatePreview() { const c = company(cId); const cat = cats.find(x=>x.id===catId); $("#skuPrev").textContent = (c && cat && num.length===4) ? `${c.code}-${cat.code}-${num}` : ""; }
    updatePreview();
  }
  const close = modal({ title: "Add Item", body: wrap, actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => {
      const comp = company(cId); const br = comp?.branches.find(b=>b.id===bId);
      if (!cId || !bId || !catId || num.length!==4) { err.textContent = "Fill all required fields."; return; }
      if ((br?.locations||[]).length && !lId) { err.textContent = "Select a location."; return; }
      try { await api("skus", { method: "POST", body: { warehouseId: cId, branchId: bId, categoryId: catId, locationId: lId || null, skuNumber: num, descriptionId: descId, descriptionText: descId ? null : descText, serialNumber: serial || null } });
        close(); await reloadAndRender(); } catch (e) { err.textContent = e.message; }
    } }, "Add"),
  ]});
  draw();
}

function openEditSku(sku) {
  const comp = company(sku.warehouseId);
  let bId = sku.branchId || "", lId = sku.locationId || "", catId = sku.categoryId || "";
  let num = (sku.skuCode || "").split("-").pop() || "", descId = sku.descriptionId, descText = sku.descriptionId ? "" : (sku.descriptionText || ""), serial = sku.serialNumber || "";
  const wrap = h("div", {}); const err = h("div", { class: "err" });
  function usedNumbers() { return new Set(State.skus.filter(s => s.id !== sku.id && s.warehouseId === sku.warehouseId && s.categoryId === catId).map(s => parseInt((s.skuCode||"").split("-").pop()||"", 10)).filter(n => !isNaN(n))); }
  function draw() {
    clear(wrap);
    const branches = comp?.branches?.slice().sort((a,b)=>a.name.localeCompare(b.name)) || [];
    const br = branches.find(b => b.id === bId);
    const locs = br?.locations?.slice().sort((a,b)=>a.name.localeCompare(b.name)) || [];
    const cats = comp?.categories?.slice().sort((a,b)=>a.code.localeCompare(b.code)) || [];
    const descs = comp?.descriptions || [];
    const numF = fieldInput("Number (blank = auto)", num, { maxlength: 4 });
    numF.input.oninput = () => { num = numF.input.value.replace(/\D/g,"").slice(0,4); numF.input.value = num; draw(); };
    wrap.append(numF);
    // preview + dup
    const used = usedNumbers(); const auto = num === "";
    let eff = auto ? (() => { let n=1; while (used.has(n)) n++; return n; })() : parseInt(num, 10);
    const dup = !auto && !isNaN(eff) && used.has(eff);
    const padded = isNaN(eff) ? null : String(eff).padStart(4, "0");
    const cat = cats.find(x=>x.id===catId);
    if (comp && cat && padded) wrap.append(h("div", { class: "mono", style: "color:" + (dup ? "var(--red)" : "var(--green)") }, (auto?"auto · ":"") + `${comp.code}-${cat.code}-${padded}`));
    if (dup) wrap.append(h("div", { class: "err" }, "This SKU code already exists — pick another number or leave blank."));
    const brSel = selectField("Branch", bId, branches.map(b=>({value:b.id,label:b.name}))); brSel.select.onchange = () => { bId = brSel.select.value; lId=""; draw(); }; wrap.append(brSel);
    if (locs.length) { const lSel = selectField("Location", lId, [{value:"",label:"Select"}, ...locs.map(l=>({value:l.id,label:l.name}))]); lSel.select.onchange = () => lId = lSel.select.value; wrap.append(lSel); }
    const catSel = selectField("Category", catId, cats.map(c=>({value:c.id,label:c.code}))); catSel.select.onchange = () => { catId = catSel.select.value; draw(); }; wrap.append(catSel);
    if (descs.length) { const dSel = selectField("Description preset", descId || "", [{value:"",label:"Custom text"}, ...descs.map(d=>({value:d.id,label:d.text}))]); dSel.select.onchange = () => { descId = dSel.select.value || null; draw(); }; wrap.append(dSel); }
    if (!descId) { const dF = fieldInput("Description", descText); dF.input.oninput = () => descText = dF.input.value; wrap.append(dF); }
    const sF = fieldInput("Serial Number", serial); sF.input.oninput = () => serial = sF.input.value; wrap.append(sF, err);
  }
  const close = modal({ title: "Edit Item", body: wrap, actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => {
      const used = usedNumbers(); const auto = num === ""; let eff = auto ? (() => { let n=1; while (used.has(n)) n++; return n; })() : parseInt(num, 10);
      if (!bId || !catId || isNaN(eff) || (!auto && used.has(eff))) { err.textContent = "Invalid number or fields."; return; }
      try { await api("skus/" + sku.id, { method: "PATCH", body: { categoryId: catId, branchId: bId, locationId: lId || null, skuNumber: String(eff).padStart(4,"0"), descriptionId: descId, descriptionText: descId ? null : descText, serialNumber: serial || null } });
        close(); await reloadAndRender(); } catch (e) { err.textContent = e.message; }
    } }, "Save"),
  ]});
  draw();
}

// ============================================================ NOTIFICATIONS
Screens.notifications = function (screen) {
  screen.append(topbar("Notifications"));
  const canReview = State.permissions?.canReviewApprovals;
  const myId = State.user?.id;
  const amRecipient = n => (n.recipientUserIds || []).includes(myId);
  const list = h("div", {}); screen.append(list);
  const sorted = State.notifications.slice().sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  if (!sorted.length) { list.append(h("div", { class: "empty" }, "No notifications")); return; }
  for (const n of sorted) list.append(notifCard(n, { canReview, amRecipient }));
};

function notifCard(n, { canReview, amRecipient }) {
  const isAcf = (n.type || "").startsWith("acf_");
  const card = h("div", { class: "card", style: "padding:16px" });
  const head = h("div", { class: "row", style: "align-items:flex-start" }, h("div", { class: "grow title" }, n.title), statusDot(n.status));
  card.append(head);
  if (n.type === "acf_completed" && n.acf) card.append(acfCompletedBody(n.acf));
  else card.append(h("div", { class: "muted", style: "margin:6px 0" }, n.body));
  card.append(h("div", { class: "muted", style: "font-size:12px" }, isAcf ? fmtDateTime(n.createdAt) : fmtDateTime(n.createdAt)));

  const acts = h("div", { class: "row", style: "margin-top:8px;gap:8px" });
  if (n.status === "pending" && canReview) {
    acts.append(h("button", { class: "btn small", onclick: () => approve(n, true) }, "Approve"),
      h("button", { class: "btn danger-outline small", onclick: () => denyReview(n) }, "Deny"));
  }
  if (n.type === "acf_sign_request" && n.status === "unread" && amRecipient(n)) {
    acts.append(h("button", { class: "btn small", onclick: () => acfSign(n) }, "Sign"),
      h("button", { class: "btn danger-outline small", onclick: () => acfDeny(n) }, "Deny"));
  }
  if (n.type === "acf_submitted" && n.status === "unread" && amRecipient(n)) {
    acts.append(h("button", { class: "btn danger-outline small", onclick: async () => { try { await api("asset-check-forms/" + n.relatedEntityId + "/withdraw", { method: "POST" }); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Withdraw"));
  }
  if (["acf_denied", "acf_withdrawn"].includes(n.type) && amRecipient(n)) {
    card.append(h("div", { class: "link", style: "margin-top:6px", onclick: () => { acfResubmit(n); if (n.status === "unread") api("notifications/" + n.id, { method: "PATCH", body: { status: "read" } }).then(reloadAndRender); } }, "Tap to review & resubmit"));
  }
  if (n.type === "acf_completed") {
    card.append(h("div", { class: "link", style: "margin-top:6px", onclick: async () => { try { await Components.downloadAcf(n.relatedEntityId); if (n.status === "unread") { await api("notifications/" + n.id, { method: "PATCH", body: { status: "read" } }); await reloadAndRender(); } } catch (e) { toast(e.message); } } }, "⬇ Click to download"));
  }
  if (acts.childNodes.length) card.append(acts);
  if (n.reviewNote) card.append(h("div", { class: "muted", style: "margin-top:4px" }, "Note: " + n.reviewNote));
  return card;
}
function statusDot(status) {
  if (status === "pending") return h("span", { style: "color:var(--orange);font-size:12px;font-weight:600" }, "Pending");
  if (status === "unread") return h("span", { style: "width:8px;height:8px;border-radius:50%;background:var(--blue);display:inline-block" });
  if (status === "approved") return h("span", { style: "color:var(--green)" }, "✓");
  if (status === "denied") return h("span", { style: "color:var(--red)" }, "✕");
  return h("span", {});
}
function acfCompletedBody(meta) {
  const callable = (name, phone) => phone ? h("span", { class: "link", onclick: () => location.href = "tel:" + phone.replace(/[^\d+]/g,"") }, name || "—") : h("span", {}, name || "—");
  const wrap = h("div", { style: "margin:6px 0" },
    h("div", { class: "row", style: "gap:4px" }, h("span", { class: "muted" }, "Submitted by"), callable(meta.requesterName, meta.requesterPhone)),
    h("div", { class: "row", style: "gap:4px" }, h("span", { class: "muted" }, "Approved by"), callable(meta.endorserName, meta.endorserPhone)));
  if (meta.password) wrap.append(h("div", { class: "row", style: "gap:4px" }, h("span", { class: "muted" }, "PDF edit password:"),
    h("span", { class: "link mono", onclick: () => { navigator.clipboard?.writeText(meta.password); toast("Password copied"); } }, meta.password)));
  return wrap;
}
async function approve(n, ok) { try { await api("notifications/" + n.id + "/review", { method: "POST", body: { status: ok ? "approved" : "denied" } }); await reloadAndRender(); } catch (e) { toast(e.message); } }
function denyReview(n) {
  const r = fieldInput("Reason for denial", "");
  const close = modal({ title: "Deny Request", body: r, actions: [h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn danger", onclick: async () => { try { await api("notifications/" + n.id + "/review", { method: "POST", body: { status: "denied", reviewNote: r.input.value } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Deny")] });
}
function acfSign(n) {
  const sig = Components.makeSignaturePad();
  const close = modal({ title: "Sign Asset Form", body: h("div", {}, h("div", { class: "muted", style: "margin-bottom:8px" }, n.body), sig.node, h("button", { class: "btn secondary small", onclick: () => sig.clear() }, "Clear")), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => { if (sig.isEmpty()) return; try { await api("asset-check-forms/" + n.relatedEntityId + "/sign", { method: "POST", body: { signaturePng: sig.toBase64Png() } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Sign"),
  ]});
}
function acfDeny(n) {
  const r = fieldInput("Reason for denial", "");
  const close = modal({ title: "Deny Asset Form", body: r, actions: [h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn danger", onclick: async () => { try { await api("asset-check-forms/" + n.relatedEntityId + "/deny", { method: "POST", body: { reason: r.input.value } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Deny")] });
}
async function acfResubmit(n) {
  let form; try { form = await api("asset-check-forms/" + n.relatedEntityId).then(r => r.form); } catch (e) { toast(e.message); return; }
  let cId = form.companyId || "", bId = form.branchId || "", fileName = form.acfNo || "";
  const sig = Components.makeSignaturePad();
  const wrap = h("div", {}); const err = h("div", { class: "err" });
  function included() { return State.skus.filter(s => s.warehouseId === cId && s.branchId === bId && ["available","borrowed","repairing"].includes(s.status)); }
  function branchOf() { return company(cId)?.branches.find(b => b.id === bId); }
  function draw() {
    clear(wrap);
    if (form.denyReason) wrap.append(h("div", { class: "err", style: "margin-bottom:8px" }, "Denied: " + form.denyReason));
    const comp = company(cId); const branches = comp?.branches?.slice().sort((a,b)=>a.name.localeCompare(b.name)) || [];
    const compSel = selectField("Company", cId, State.companies.map(c=>({value:c.id,label:c.name}))); compSel.select.onchange = () => { cId = compSel.select.value; bId=""; draw(); };
    const brSel = selectField("Branch", bId, [{value:"",label:"Select"}, ...branches.map(b=>({value:b.id,label:b.name}))]); brSel.select.onchange = () => { bId = brSel.select.value; draw(); };
    const fileF = fieldInput("File name (.pdf)", fileName); fileF.input.oninput = () => fileName = fileF.input.value;
    const b = branchOf();
    wrap.append(compSel, brSel, h("div", { class: "row" }, h("span", { class: "grow" }, "Assets"), h("b", {}, String(included().length))),
      h("div", { class: "row" }, h("span", { class: "grow" }, "Endorser"), h("span", { style: b?.endorserName?"":"color:var(--orange)" }, b?.endorserName || "Not set")),
      fileF);
    if ((form.rows||[]).length) {
      wrap.append(h("div", { class: "section-label" }, `Assets in this form (${form.rows.length})`));
      form.rows.slice(0,3).forEach(r => wrap.append(h("div", { class: "muted" }, `${r.assetId} ${r.description||""}`)));
      if (form.rows.length > 3) wrap.append(h("div", { class: "link", onclick: () => acfAssetList(form.rows) }, `View all ${form.rows.length} assets`));
    }
    wrap.append(h("div", { class: "section-label" }, "Your signature"), sig.node, h("button", { class: "btn secondary small", onclick: () => sig.clear() }, "Clear"), err);
  }
  const close = modal({ title: "Review & Resubmit", body: wrap, actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => {
      const b = branchOf();
      if (!cId || !bId || !fileName.trim() || !included().length || !b?.endorserUserId || sig.isEmpty()) { err.textContent = "Fill all fields, set endorser, and sign."; return; }
      try { await api("asset-check-forms/" + form.id + "/resubmit", { method: "POST", body: { companyId: cId, branchId: bId, acfNo: fileName.trim(), signaturePng: sig.toBase64Png() } }); close(); await reloadAndRender(); } catch (e) { err.textContent = e.message; }
    } }, "Resubmit"),
  ]});
  draw();
}
function acfAssetList(rows) {
  let cat = "All";
  const cats = ["All", ...[...new Set(rows.map(r => acfCategory(r.assetId)))].sort()];
  const wrap = h("div", {});
  function draw() {
    clear(wrap);
    const chips = h("div", { class: "chips" });
    cats.forEach(c => chips.append(h("button", { class: "chip" + (cat===c?" active":""), onclick: () => { cat = c; draw(); } }, c)));
    const items = cat === "All" ? rows.slice().sort((a,b)=>a.assetId.localeCompare(b.assetId)) : rows.filter(r => acfCategory(r.assetId)===cat).sort((a,b)=>acfNumber(a.assetId)-acfNumber(b.assetId));
    wrap.append(h("div", { style: "font-weight:600;margin-bottom:8px" }, `${items.length} Assets`), chips);
    items.forEach(r => wrap.append(h("div", { class: "card", style: "padding:12px;margin-bottom:6px" },
      h("div", { class: "title" }, r.assetId), r.description ? h("div", { class: "muted" }, r.description) : "",
      h("div", { class: "muted" }, [r.found && "Found: "+r.found, r.checkedBy && "By: "+r.checkedBy].filter(Boolean).join(" · ")))));
  }
  const close = modal({ title: "Assets", body: wrap, actions: [h("button", { class: "btn", onclick: () => close() }, "Close")] });
  draw();
}

// ============================================================ RECORDS
Screens.records = function (screen) {
  screen.append(topbar("Records"));
  const recs = State.records.slice().sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  if (!recs.length) { screen.append(h("div", { class: "empty" }, "No records")); return; }
  const table = h("table", {}, h("thead", {}, h("tr", {}, h("th",{},"Type"), h("th",{},"SKU"), h("th",{},"Date"))),
    h("tbody", {}, ...recs.map(r => h("tr", {}, h("td",{},r.type), h("td",{},r.skuCode||""), h("td",{},fmtDateTime(r.createdAt))))));
  screen.append(h("div", { class: "card", style: "padding:8px 16px" }, table));
};

// ============================================================ USERS
Screens.users = function (screen) {
  const canManage = State.permissions?.canManageUsers;
  screen.append(topbar("Users", canManage ? h("button", { class: "btn", onclick: () => openUserForm(null) }, "+ New User") : ""));
  const me = State.user;
  const visible = State.users.filter(u => u.id !== me?.id && (me?.role === "superadmin" || (me?.role === "admin" && u.role !== "superadmin") || (me?.role === "warehouse_manager" && u.role === "staff"))).sort((a,b)=>a.name.localeCompare(b.name));

  // Filters: role + company work together (a user must match both). Company maps
  // to the user's warehouseIds.
  let roleF = null, companyF = null;
  const roleChips = h("div", { class: "chips" });
  const companyChips = h("div", { class: "chips" });
  const list = h("div", {});
  screen.append(roleChips, companyChips, list);

  function drawRoleChips() {
    clear(roleChips);
    [["All", null], ["Admin", "admin"], ["Manager", "warehouse_manager"], ["Staff", "staff"]].forEach(([label, val]) =>
      roleChips.append(h("button", { class: "chip" + (roleF === val ? " active" : ""), onclick: () => { roleF = val; drawRoleChips(); drawList(); } }, label)));
  }
  function drawCompanyChips() {
    clear(companyChips);
    if (!State.companies.length) return;
    companyChips.append(h("button", { class: "chip" + (companyF === null ? " active" : ""), onclick: () => { companyF = null; drawCompanyChips(); drawList(); } }, "All companies"));
    State.companies.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c =>
      companyChips.append(h("button", { class: "chip" + (companyF === c.id ? " active" : ""), onclick: () => { companyF = c.id; drawCompanyChips(); drawList(); } }, c.name)));
  }
  function drawList() {
    clear(list);
    const items = visible.filter(u =>
      (roleF === null || u.role === roleF) &&
      (companyF === null || (u.warehouseIds || []).includes(companyF)));
    if (!items.length) { list.append(h("div", { class: "empty" }, "No users")); return; }
    for (const u of items) {
      const disabled = u.isDisabled;
      const actions = h("div", { class: "row", style: "gap:4px" });
      if (canManage) {
        actions.append(h("button", { class: "icon-btn", title: "Edit", onclick: () => openUserForm(u) }, "✎"));
        actions.append(h("button", { class: "icon-btn", title: "Reset password", onclick: () => confirmDialog("Reset password for "+u.name+"?", "Their password is cleared; they set a new one on next login.", "Reset", async () => { try { await api("users/"+u.id+"/reset-password-required", { method: "POST" }); toast("Reset"); await reloadAndRender(); } catch(e){toast(e.message);} }, false) }, "🔑"));
        if (disabled) actions.append(h("button", { class: "icon-btn", title: "Resume", onclick: () => confirmDialog("Resume "+u.name+"?", "Reactivate this account.", "Resume", async () => { try { await api("users/"+u.id+"/resume", { method: "PATCH" }); await reloadAndRender(); } catch(e){toast(e.message);} }, false) }, "↩"));
        else actions.append(h("button", { class: "icon-btn", title: "Disable", onclick: () => confirmDialog("Disable "+u.name+"?", "The account expires after 30 days disabled.", "Disable", async () => { try { await api("users/"+u.id+"/disable", { method: "PATCH" }); await reloadAndRender(); } catch(e){toast(e.message);} }) }, "🚫"));
      }
      const comps = (u.warehouseIds || []).map(id => company(id)?.name).filter(Boolean);
      list.append(h("div", { class: "card list-card list" },
        h("div", { class: "grow" }, h("div", { class: "title" }, u.name + (disabled ? " (disabled)" : "")),
          h("div", { class: "muted" }, `${u.username} · ${roleLabel(u.role)}${u.phone ? " · " + (u.phoneCountryCode||"") + u.phone : ""}`),
          comps.length ? h("div", { class: "muted", style: "font-size:12px" }, "Companies: " + comps.join(", ")) : ""),
        actions));
    }
  }
  drawRoleChips(); drawCompanyChips(); drawList();
};
function roleLabel(r) { return ({ staff: "Staff", warehouse_manager: "Manager", admin: "Admin", superadmin: "Superadmin" })[r] || r; }
function openUserForm(editUser) {
  const isEdit = !!editUser;
  let username = editUser?.username || "", name = editUser?.name || "", role = editUser?.role || "staff";
  let cc = editUser?.phoneCountryCode || "+86", phone = editUser?.phone || "", email = editUser?.email || "";
  const companyIds = new Set(editUser?.warehouseIds || []);
  const branchIds = new Set(editUser?.branchIds || []);
  const me = State.user;
  const roles = me?.role === "superadmin" ? ["staff","warehouse_manager","admin","superadmin"] : me?.role === "admin" ? ["staff","warehouse_manager"] : ["staff"];
  const err = h("div", { class: "err" });
  const unameF = isEdit ? null : fieldInput("Employee ID", username, { autocomplete: "off" });
  const nameF = fieldInput("Display name", name);
  const roleSel = selectField("Role", role, roles.map(r => ({ value: r, label: roleLabel(r) })));
  const ccF = fieldInput("Country code", cc); const phoneF = fieldInput("Phone", phone); const emailF = fieldInput("Email", email);
  const companyBox = h("div", {});
  // Company scope (warehouseIds): controls which companies a manager/staff can
  // access. Superadmin/admin see everything, so it's hidden for them.
  function drawCompanies() {
    clear(companyBox);
    role = roleSel.select.value;
    if (role === "superadmin") return;
    companyBox.append(h("div", { class: "section-label" }, "Companies (access scope)"));
    if (!State.companies.length) { companyBox.append(h("div", { class: "muted", style: "font-size:12px" }, "No companies yet.")); return; }
    State.companies.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
      const cb = h("input", { type: "checkbox" }); cb.checked = companyIds.has(c.id);
      cb.onchange = () => {
        if (cb.checked) companyIds.add(c.id);
        else { companyIds.delete(c.id); (c.branches||[]).forEach(b => branchIds.delete(b.id)); }
        drawCompanies();
      };
      companyBox.append(h("label", { class: "row", style: "gap:8px;padding:3px 0" }, cb, h("span", {}, c.name)));
      // When a company is selected, optionally narrow to specific branches.
      // None checked = manage the whole company.
      if (companyIds.has(c.id) && (c.branches||[]).length) {
        const branchWrap = h("div", { style: "margin-left:22px" });
        c.branches.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(b => {
          const bb = h("input", { type: "checkbox" }); bb.checked = branchIds.has(b.id);
          bb.onchange = () => { if (bb.checked) branchIds.add(b.id); else branchIds.delete(b.id); };
          branchWrap.append(h("label", { class: "row", style: "gap:8px;padding:2px 0;font-size:13px" }, bb, h("span", { class: "muted" }, b.name)));
        });
        const anyBranch = (c.branches||[]).some(b => branchIds.has(b.id));
        branchWrap.append(h("div", { class: "muted", style: "font-size:11px;padding:2px 0" }, anyBranch ? "Limited to the checked branches." : "No branch checked = whole company."));
        companyBox.append(branchWrap);
      }
    });
  }
  roleSel.select.addEventListener("change", drawCompanies);
  const body = h("div", {}, isEdit ? "" : unameF, nameF, roleSel,
    h("div", { class: "grid2" }, ccF, phoneF), emailF, companyBox,
    isEdit ? "" : h("div", { class: "muted", style: "font-size:12px" }, "No password needed — the user sets their own on first login."), err);
  const close = modal({ title: isEdit ? "Edit User" : "New User", body, actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => {
      role = roleSel.select.value;
      const isAll = (role === "superadmin");
      // Keep only branches belonging to a selected company.
      const validBranches = [...branchIds].filter(bid => State.companies.some(c => companyIds.has(c.id) && (c.branches||[]).some(b => b.id === bid)));
      const payload = { name: nameF.input.value.trim(), role,
        phone: phoneF.input.value.trim() || null, phoneCountryCode: phoneF.input.value.trim() ? ccF.input.value.trim() : null, email: emailF.input.value.trim() || null,
        warehouseIds: isAll ? [] : [...companyIds], branchIds: isAll ? [] : validBranches };
      if (!payload.name) { err.textContent = "Name required."; return; }
      try {
        if (isEdit) await api("users/" + editUser.id, { method: "PATCH", body: Object.assign({ isDisabled: editUser.isDisabled || false }, payload) });
        else { if (!unameF.input.value.trim()) { err.textContent = "Employee ID required."; return; } await api("users", { method: "POST", body: Object.assign({ username: unameF.input.value.trim() }, payload) }); }
        close(); await reloadAndRender();
      } catch (e) { err.textContent = e.message; }
    } }, isEdit ? "Save" : "Add"),
  ]});
  drawCompanies();
}

// ============================================================ MANAGE
Screens.manage = function (screen, route) {
  const parts = route.split("/");
  if (parts[1] === "branches") return manageBranches(screen, parts[2]);
  if (parts[1] === "locations") return manageLocations(screen, parts[2], parts[3]);
  if (parts[1] === "categories") return manageCategories(screen);
  // company list
  screen.append(topbar("Manage",
    h("button", { class: "btn outline", onclick: () => location.hash = "#/manage/categories" }, "Categories"),
    h("button", { class: "btn", onclick: () => companyForm(null) }, "+ Company")));
  const list = h("div", {}); screen.append(list);
  if (!State.companies.length) { list.append(h("div", { class: "empty" }, "No companies yet")); return; }
  for (const c of State.companies) list.append(h("div", { class: "card list-card list", onclick: () => location.hash = "#/manage/branches/" + c.id },
    h("div", { class: "grow" }, h("div", { class: "title" }, c.name), h("div", { class: "muted" }, `${c.code} · ${c.branches.length} branch(es)`)),
    h("button", { class: "icon-btn", onclick: e => { e.stopPropagation(); companyForm(c); } }, "✎"),
    h("button", { class: "icon-btn", onclick: e => { e.stopPropagation(); confirmDialog("Delete "+c.name+"?", "This deletes the company and all its branches, locations and categories. This cannot be undone.", "Delete", async () => { try { await api("warehouses/"+c.id, { method: "DELETE" }); await reloadAndRender(); } catch(ex){toast(ex.message);} }); } }, "🗑"),
    h("span", {}, "›")));
};
function companyForm(c) {
  const nameF = fieldInput("Name", c?.name || ""); const codeF = fieldInput("Short code (e.g. PWBJ)", c?.code || "");
  const close = modal({ title: c ? "Edit Company" : "New Company", body: h("div", {}, nameF, codeF), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => { const name = nameF.input.value.trim(), code = codeF.input.value.trim().toUpperCase(); if (!name || !code) return;
      try { if (c) await api("warehouses/"+c.id, { method: "PATCH", body: { name, code } }); else await api("warehouses", { method: "POST", body: { name, code } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Save"),
  ]});
}
function manageBranches(screen, companyId) {
  const c = company(companyId);
  screen.append(topbar(c?.name || "Branches", h("button", { class: "btn outline", onclick: () => history.back() }, "‹ Back"), h("button", { class: "btn", onclick: () => branchForm(companyId, null) }, "+ Branch")));
  const list = h("div", {}); screen.append(list);
  const branches = (c?.branches || []).slice().sort((a,b)=>a.name.localeCompare(b.name));
  if (!branches.length) { list.append(h("div", { class: "empty" }, "No branches yet")); return; }
  for (const b of branches) list.append(h("div", { class: "card list-card list", onclick: () => location.hash = `#/manage/locations/${companyId}/${b.id}` },
    h("div", { class: "grow" }, h("div", { class: "title" }, b.name),
      h("div", { class: "muted" }, [(b.locations||[]).length ? (b.locations.length+" location(s)") : "", b.endorserName ? "Endorser: "+b.endorserName : ""].filter(Boolean).join(" · "))),
    h("button", { class: "icon-btn", onclick: e => { e.stopPropagation(); branchForm(companyId, b); } }, "✎"),
    h("button", { class: "icon-btn", onclick: e => { e.stopPropagation(); confirmDialog("Delete "+b.name+"?", "This cannot be undone.", "Delete", async () => { try { await api(`warehouses/${companyId}/branches/${b.id}`, { method: "DELETE" }); await reloadAndRender(); } catch(ex){toast(ex.message);} }); } }, "🗑"),
    h("span", {}, "›")));
}
function branchForm(companyId, b) {
  let endorserId = b?.endorserUserId || null;
  const nameF = fieldInput("Branch name", b?.name || "");
  const endorserBtn = h("button", { class: "btn outline", style: "width:100%;text-align:left", onclick: () => pickEndorser(endorserId, id => { endorserId = id; endorserBtn.textContent = "Endorser: " + (State.users.find(u=>u.id===id)?.name || "None"); }) },
    "Endorser: " + (State.users.find(u=>u.id===endorserId)?.name || b?.endorserName || "None"));
  const close = modal({ title: b ? "Edit Branch" : "New Branch", body: h("div", {}, nameF, h("div", { class: "field" }, h("label", {}, "Endorser"), endorserBtn), h("div", { class: "muted", style: "font-size:12px" }, "Signs this branch's Asset Check Form. Must be an existing user.")), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => { const name = nameF.input.value.trim(); if (!name) return;
      try { if (b) await api(`warehouses/${companyId}/branches/${b.id}`, { method: "PATCH", body: { name, endorserUserId: endorserId } }); else await api(`warehouses/${companyId}/branches`, { method: "POST", body: { name, endorserUserId: endorserId } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Save"),
  ]});
}
function pickEndorser(selectedId, onPick) {
  let qv = "";
  const wrap = h("div", {});
  function draw() {
    clear(wrap);
    const s = h("input", { placeholder: "Search by name or phone", value: qv }); s.oninput = () => { qv = s.value; draw(); };
    wrap.append(s);
    const items = State.users.slice().sort((a,b)=>a.name.localeCompare(b.name)).filter(u => !qv || u.name.toLowerCase().includes(qv.toLowerCase()) || (u.phone||"").includes(qv));
    const listBox = h("div", { style: "max-height:300px;overflow:auto;margin-top:8px" });
    listBox.append(h("div", { class: "list-card", onclick: () => { onPick(null); close(); } }, h("span", { class: "grow" }, "None"), selectedId == null ? h("span", {}, "✓") : ""));
    items.forEach(u => listBox.append(h("div", { class: "list-card", onclick: () => { onPick(u.id); close(); } }, h("div", { class: "grow" }, h("div", {}, u.name), h("div", { class: "muted" }, roleLabel(u.role))), selectedId === u.id ? h("span", {}, "✓") : "")));
    wrap.append(listBox);
  }
  const close = modal({ title: "Endorser", body: wrap, actions: [h("button", { class: "btn outline", onclick: () => close() }, "Cancel")] });
  draw();
}
function manageLocations(screen, companyId, branchId) {
  const b = company(companyId)?.branches.find(x => x.id === branchId);
  screen.append(topbar(b?.name || "Locations", h("button", { class: "btn outline", onclick: () => history.back() }, "‹ Back"), h("button", { class: "btn", onclick: () => locationForm(companyId, branchId, null) }, "+ Location")));
  const list = h("div", {}); screen.append(list);
  const locs = (b?.locations || []).slice().sort((a,b)=>a.name.localeCompare(b.name));
  if (!locs.length) { list.append(h("div", { class: "empty" }, "No locations yet")); return; }
  for (const l of locs) list.append(h("div", { class: "card list-card list" },
    h("div", { class: "grow title" }, l.name),
    h("button", { class: "icon-btn", onclick: () => locationForm(companyId, branchId, l) }, "✎"),
    h("button", { class: "icon-btn", onclick: () => confirmDialog("Delete "+l.name+"?", "This cannot be undone.", "Delete", async () => { try { await api(`warehouses/${companyId}/branches/${branchId}/locations/${l.id}`, { method: "DELETE" }); await reloadAndRender(); } catch(ex){toast(ex.message);} }) }, "🗑")));
}
function locationForm(companyId, branchId, l) {
  const nameF = fieldInput("Name (e.g. Shelf A1)", l?.name || "");
  const close = modal({ title: l ? "Edit Location" : "New Location", body: nameF, actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => { const name = nameF.input.value.trim(); if (!name) return;
      try { if (l) await api(`warehouses/${companyId}/branches/${branchId}/locations/${l.id}`, { method: "PATCH", body: { name } }); else await api(`warehouses/${companyId}/branches/${branchId}/locations`, { method: "POST", body: { name } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Save"),
  ]});
}
function manageCategories(screen) {
  let cId = State.companies[0]?.id || "";
  screen.append(topbar("Categories", h("button", { class: "btn outline", onclick: () => history.back() }, "‹ Back")));
  const box = h("div", {}); screen.append(box);
  function draw() {
    clear(box);
    const compSel = selectField("Company", cId, State.companies.map(c=>({value:c.id,label:c.name}))); compSel.select.onchange = () => { cId = compSel.select.value; draw(); };
    box.append(compSel);
    const c = company(cId);
    box.append(h("div", { style: "margin:8px 0" }, h("button", { class: "btn small", onclick: () => categoryForm(cId, null) }, "+ Category")));
    const cats = (c?.categories || []).slice().sort((a,b)=>a.code.localeCompare(b.code));
    if (!cats.length) { box.append(h("div", { class: "empty" }, "No categories yet")); return; }
    cats.forEach(cat => box.append(h("div", { class: "card list-card list" },
      h("div", { class: "grow" }, h("div", { class: "title" }, cat.code),
        h("div", { class: "muted" }, cat.branchIds.length ? c.branches.filter(b=>cat.branchIds.includes(b.id)).map(b=>b.name).join(", ") : "All branches")),
      h("button", { class: "icon-btn", onclick: () => categoryForm(cId, cat) }, "✎"),
      h("button", { class: "icon-btn", onclick: () => confirmDialog("Delete "+cat.code+"?", "This cannot be undone.", "Delete", async () => { try { await api(`warehouses/${cId}/categories/${cat.id}`, { method: "DELETE" }); await reloadAndRender(); } catch(ex){toast(ex.message);} }) }, "🗑"))));
  }
  draw();
}
function categoryForm(companyId, cat) {
  const c = company(companyId);
  const codeF = fieldInput("Code (e.g. CAM)", cat?.code || "");
  const selected = new Set(cat?.branchIds || []);
  const checks = (c?.branches || []).slice().sort((a,b)=>a.name.localeCompare(b.name)).map(b => {
    const cb = h("input", { type: "checkbox" }); cb.checked = selected.has(b.id);
    cb.onchange = () => { if (cb.checked) selected.add(b.id); else selected.delete(b.id); };
    return h("label", { class: "row", style: "gap:8px;padding:4px 0" }, cb, h("span", {}, b.name));
  });
  const close = modal({ title: cat ? "Edit Category" : "New Category", body: h("div", {}, codeF, h("div", { class: "muted", style: "margin-bottom:4px" }, "Branches (none = all)"), ...checks), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => { const code = codeF.input.value.trim().toUpperCase(); if (!code) return; const branchIds = [...selected];
      try { if (cat) await api(`warehouses/${companyId}/categories/${cat.id}`, { method: "PATCH", body: { code, branchIds } }); else await api(`warehouses/${companyId}/categories`, { method: "POST", body: { code, branchIds } }); close(); await reloadAndRender(); } catch (e) { toast(e.message); } } }, "Save"),
  ]});
}

// ============================================================ ME
Screens.me = function (screen, route) {
  if (route.split("/")[1] === "email") return smtpSettings(screen);
  const u = State.user;
  screen.append(topbar("Me"));
  screen.append(h("div", { class: "card", style: "padding:16px;margin-bottom:12px" },
    h("div", { class: "title", style: "font-size:18px" }, u?.name || ""),
    h("div", { class: "muted" }, `${u?.username || ""} · ${roleLabel(u?.role)}`),
    u?.phone ? h("div", { class: "muted" }, (u.phoneCountryCode||"") + u.phone) : "",
    u?.email ? h("div", { class: "muted" }, u.email) : ""));
  const menu = h("div", { class: "card", style: "overflow:hidden" });
  menu.append(h("button", { class: "nav-item", onclick: () => openNodePicker() },
    h("span", { class: "grow" }, "🖧 Server Node"), h("span", { class: "muted" }, Node.label)));
  menu.append(h("button", { class: "nav-item", onclick: () => changePassword() }, "🔒 Change Password"));
  if (u?.role === "superadmin") menu.append(h("button", { class: "nav-item", onclick: () => location.hash = "#/me/email" }, "✉ Email Alerts"));
  menu.append(h("button", { class: "nav-item", style: "color:var(--red)", onclick: () => confirmDialog("Log out?", "You'll need to sign in again.", "Log Out", () => logout()) }, "⎋ Log Out"));
  screen.append(menu);
  screen.append(h("div", { class: "muted", style: "text-align:center;margin-top:24px;font-size:12px" }, "PictureWorks Inventory · Web"));
};
function changePassword() {
  const cur = fieldInput("Current password", "", { type: "password" }); const nw = fieldInput("New password (min 8)", "", { type: "password" }); const cf = fieldInput("Confirm password", "", { type: "password" });
  const err = h("div", { class: "err" });
  const close = modal({ title: "Change Password", body: h("div", {}, cur, nw, cf, err), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn", onclick: async () => { if (nw.input.value.length < 8) { err.textContent = "Min 8 characters."; return; } if (nw.input.value !== cf.input.value) { err.textContent = "Passwords don't match."; return; }
      try { await api("change-password", { method: "POST", body: { currentPassword: cur.input.value, newPassword: nw.input.value, confirmPassword: cf.input.value } }); close(); toast("Password changed"); } catch (e) { err.textContent = e.message; } } }, "Save"),
  ]});
}
function smtpSettings(screen) {
  screen.append(topbar("Email Alerts", h("button", { class: "btn outline", onclick: () => location.hash = "#/me" }, "‹ Back")));
  const box = h("div", {}); screen.append(box);
  box.append(h("div", { class: "muted" }, "Loading…"));
  api("notification-settings").then(r => {
    const s = r.notificationSettings?.smtp || {};
    clear(box);
    const enabled = h("input", { type: "checkbox" }); enabled.checked = !!s.enabled;
    const host = fieldInput("Host", s.host || ""); const port = fieldInput("Port", s.port || 587, { type: "number" });
    const secure = h("input", { type: "checkbox" }); secure.checked = !!s.secure;
    const username = fieldInput("Username", s.username || ""); const password = fieldInput("Password", s.password || "", { type: "password" });
    const fromName = fieldInput("From name", s.fromName || ""); const fromAddr = fieldInput("From email", s.fromAddress || "");
    const msg = h("div", {});
    function collect() { return { enabled: enabled.checked, host: host.input.value.trim(), port: parseInt(port.input.value)||587, secure: secure.checked, username: username.input.value.trim(), password: password.input.value, fromName: fromName.input.value, fromAddress: fromAddr.input.value.trim() }; }
    box.append(
      h("label", { class: "row", style: "gap:8px;margin-bottom:8px" }, enabled, h("span", {}, "Enable email alerts")),
      h("div", { class: "muted", style: "margin-bottom:12px" }, "Daily stock-check and borrow/return/disposal approvals are emailed to relevant users with an email on file."),
      h("div", { class: "section-label" }, "SMTP Server"), host, port, h("label", { class: "row", style: "gap:8px;margin-bottom:8px" }, secure, h("span", {}, "Use SSL (port 465)")),
      h("div", { class: "section-label" }, "Authentication"), username, password,
      h("div", { class: "section-label" }, "Sender"), fromName, fromAddr,
      h("div", { class: "row", style: "gap:8px;margin-top:8px" },
        h("button", { class: "btn", onclick: async () => { try { await api("notification-settings", { method: "PATCH", body: { smtp: collect() } }); msg.textContent = "Saved."; msg.style.color = "var(--green)"; } catch (e) { msg.textContent = e.message; msg.style.color = "var(--red)"; } } }, "Save"),
        h("button", { class: "btn outline", onclick: async () => { try { await api("notification-settings", { method: "PATCH", body: { smtp: collect() } }); const r2 = await api("notification-settings/smtp-test", { method: "POST", body: {} }); msg.textContent = r2.message; msg.style.color = r2.ok ? "var(--green)" : "var(--red)"; } catch (e) { msg.textContent = e.message; msg.style.color = "var(--red)"; } } }, "Send Test Email")),
      msg, h("div", { class: "muted", style: "margin-top:8px;font-size:12px" }, "The test email is sent to your profile email."));
  }).catch(e => { clear(box); box.append(h("div", { class: "err" }, e.message)); });
}

// ============================================================ USER LOGS
// IP + GPS coordinate where each operation happened. The coordinate is a link
// that opens the exact pin on Google Maps so you can see the place by name.
function logLocationCell(l) {
  const cell = h("div", {});
  if (l.ipAddress) cell.append(h("div", { class: "muted", style: "font-size:11px" }, l.ipAddress));
  const g = l.metadata && l.metadata.geo;
  if (g && g.lat != null && g.lng != null) {
    cell.append(h("a", { href: `https://maps.google.com/?q=${g.lat},${g.lng}`, target: "_blank", rel: "noopener",
      style: "font-size:11px" }, `📍 ${(+g.lat).toFixed(5)}, ${(+g.lng).toFixed(5)}`));
  }
  return cell.childNodes.length ? cell : "—";
}

Screens.logs = function (screen) {
  screen.append(topbar("User Logs"));
  const box = h("div", {}); screen.append(box);
  api("user-logs").then(r => {
    const logs = r.userLogs || [];
    if (!logs.length) { box.append(h("div", { class: "empty" }, "No logs")); return; }
    const table = h("table", {}, h("thead",{},h("tr",{},h("th",{},"Actor"),h("th",{},"Action"),h("th",{},"Message"),h("th",{},"Location"),h("th",{},"Date"))),
      h("tbody", {}, ...logs.map(l => h("tr",{},h("td",{},l.actorName||"—"),h("td",{},l.type),h("td",{},l.message||""),h("td",{},logLocationCell(l)),h("td",{},fmtDateTime(l.createdAt))))));
    box.append(h("div", { class: "card", style: "padding:8px 16px" }, table));
  }).catch(e => box.append(h("div", { class: "err" }, e.message)));
};
