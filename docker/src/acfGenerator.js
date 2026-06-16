// Asset Check Form (ACF) file generation: XLSX (exceljs), PDF (pdfkit),
// PDF owner-password encryption (qpdf), and ZIP bundling (archiver).
//
// A `form` object passed in looks like:
//   {
//     acfNo, companyName, branchName,
//     rows: [{ no, assetId, location, description, serial, found, checkedBy, date }],
//     requester: { name, signaturePng(base64), signedAt },
//     requestDate,                       // ISO string (request day)
//     endorser:  { name, signaturePng(base64), signedAt },
//     approvalDate                       // ISO string (approval day)
//   }

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const COLUMNS = [
  { key: "no", header: "No", width: 5 },
  { key: "assetId", header: "ASSET ID", width: 16 },
  { key: "location", header: "LOCATION OF ASSET", width: 18 },
  { key: "description", header: "DESCRIPTION OF ASSET", width: 46 },
  { key: "serial", header: "SERIAL NUMBER", width: 20 },
  { key: "found", header: "FOUND", width: 14 },
  { key: "checkedBy", header: "CHECKED BY", width: 14 },
  { key: "date", header: "DATE", width: 14 }
];

function randomPassword(len = 14) {
  // URL-safe, unambiguous-ish; only superadmin ever sees it.
  return crypto.randomBytes(len).toString("base64url").slice(0, len);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stripBase64(s) {
  if (!s) return null;
  return String(s).replace(/^data:image\/\w+;base64,/, "");
}

// ---------------------------------------------------------------- XLSX

async function buildXlsxBuffer(form) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1", { views: [{ showGridLines: false }] });

  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  const lastCol = COLUMNS.length; // 8

  const colLetter = (i) => ws.getColumn(i).letter;
  const merge = (r1, c1, r2, c2) => ws.mergeCells(`${colLetter(c1)}${r1}:${colLetter(c2)}${r2}`);

  // Title + meta
  merge(1, 1, 1, lastCol);
  ws.getCell("A1").value = "ASSET CHECK FORM";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A1").alignment = { horizontal: "center" };

  ws.getCell("A2").value = `ACF NO : ${form.acfNo || ""}`;
  ws.getCell("A2").font = { bold: true };
  merge(3, 1, 3, 2);
  ws.getCell("A3").value = "COMPANY :";
  merge(3, 3, 3, lastCol);
  ws.getCell("C3").value = form.companyName || "";

  // Header row
  const headerRowIdx = 5;
  const headerRow = ws.getRow(headerRowIdx);
  COLUMNS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  // Data rows
  let r = headerRowIdx + 1;
  (form.rows || []).forEach((row) => {
    const xr = ws.getRow(r);
    COLUMNS.forEach((c, i) => { xr.getCell(i + 1).value = row[c.key] ?? ""; });
    xr.alignment = { vertical: "middle", wrapText: true };
    r++;
  });

  // Borders around the table block
  for (let rr = headerRowIdx; rr < r; rr++) {
    for (let cc = 1; cc <= lastCol; cc++) {
      ws.getCell(`${colLetter(cc)}${rr}`).border = {
        top: { style: "thin" }, left: { style: "thin" },
        bottom: { style: "thin" }, right: { style: "thin" }
      };
    }
  }

  // Signature footer
  const sigRowHeight = 48;
  const checkedRow = r + 1;
  ws.getCell(`B${checkedRow}`).value = "CHECKED BY:";
  ws.getCell(`B${checkedRow}`).font = { bold: true };
  ws.getCell(`C${checkedRow}`).value = form.requester?.name || "";
  ws.getCell(`F${checkedRow}`).value = "DATE :";
  ws.getCell(`G${checkedRow}`).value = fmtDate(form.requestDate);
  ws.getRow(checkedRow).height = sigRowHeight;

  const endorsedRow = checkedRow + 1;
  ws.getCell(`B${endorsedRow}`).value = "ENDORSED BY:";
  ws.getCell(`B${endorsedRow}`).font = { bold: true };
  ws.getCell(`C${endorsedRow}`).value = form.endorser?.name || "";
  ws.getCell(`F${endorsedRow}`).value = "DATE :";
  ws.getCell(`G${endorsedRow}`).value = fmtDate(form.approvalDate);
  ws.getRow(endorsedRow).height = sigRowHeight;

  // Signature images anchored into column D (col index 3, 0-based).
  const addSig = (b64, rowIdx) => {
    const data = stripBase64(b64);
    if (!data) return;
    const imgId = wb.addImage({ base64: data, extension: "png" });
    ws.addImage(imgId, {
      tl: { col: 3, row: rowIdx - 1 + 0.05 },
      ext: { width: 150, height: 50 }
    });
  };
  addSig(form.requester?.signaturePng, checkedRow);
  addSig(form.endorser?.signaturePng, endorsedRow);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PDF

function buildPdfBuffer(form) {
  const PDFDocument = require("pdfkit");
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    // Title + meta
    doc.font("Helvetica-Bold").fontSize(15).text("ASSET CHECK FORM", { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(9).text(`ACF NO : ${form.acfNo || ""}`);
    doc.font("Helvetica").text(`COMPANY : ${form.companyName || ""}`);
    doc.moveDown(0.3);

    // Column widths proportional to the xlsx widths
    const weights = COLUMNS.map((c) => c.width);
    const totalW = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / totalW) * pageW);
    const xAt = (i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0);

    const drawRow = (cells, y, h, opts = {}) => {
      const font = opts.bold ? "Helvetica-Bold" : "Helvetica";
      doc.font(font).fontSize(opts.size || 7.5);
      cells.forEach((txt, i) => {
        const x = xAt(i);
        doc.rect(x, y, widths[i], h).strokeColor("#999").lineWidth(0.5).stroke();
        doc.fillColor("#000").text(String(txt ?? ""), x + 2, y + 2, {
          width: widths[i] - 4, height: h - 4, ellipsis: false, lineBreak: true
        });
      });
    };

    const rowH = 16;
    let y = doc.y + 2;
    drawRow(COLUMNS.map((c) => c.header), y, rowH + 4, { bold: true });
    y += rowH + 4;

    (form.rows || []).forEach((row) => {
      const h = rowH;
      if (y + h > doc.page.height - doc.page.margins.bottom - 70) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 28 });
        y = doc.page.margins.top;
        drawRow(COLUMNS.map((c) => c.header), y, rowH + 4, { bold: true });
        y += rowH + 4;
      }
      drawRow(COLUMNS.map((c) => row[c.key]), y, h);
      y += h;
    });

    // Signature footer
    y += 14;
    const sigW = 150, sigH = 44;
    const placeSig = (label, name, b64, dateLabel, dateVal, yy) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000")
        .text(`${label} ${name || ""}`, left, yy);
      const data = stripBase64(b64);
      if (data) {
        try { doc.image(Buffer.from(data, "base64"), left + 150, yy - 6, { fit: [sigW, sigH] }); }
        catch (e) { /* ignore bad image */ }
      }
      doc.font("Helvetica").fontSize(9)
        .text(`${dateLabel} ${fmtDate(dateVal)}`, left + 150 + sigW + 20, yy);
    };
    placeSig("CHECKED BY:", form.requester?.name, form.requester?.signaturePng, "DATE :", form.requestDate, y);
    y += sigH + 14;
    placeSig("ENDORSED BY:", form.endorser?.name, form.endorser?.signaturePng, "DATE :", form.approvalDate, y);

    doc.end();
  });
}

// ---------------------------------------------------------- PDF encryption

// Owner-password encryption via qpdf: file opens freely, but modification
// requires the owner password. (qpdf exit code 3 = success with warnings.)
function encryptPdf(pdfBuffer, ownerPassword) {
  return new Promise((resolve, reject) => {
    const tmp = os.tmpdir();
    const inF = path.join(tmp, `acf_${crypto.randomUUID()}.pdf`);
    const outF = path.join(tmp, `acf_${crypto.randomUUID()}_enc.pdf`);
    fs.writeFileSync(inF, pdfBuffer);
    const args = ["--encrypt", "", ownerPassword, "256", "--modify=none", "--", inF, outF];
    const p = spawn("qpdf", args);
    let stderr = "";
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("error", (err) => { cleanup(); reject(new Error(`qpdf not available: ${err.message}`)); });
    p.on("close", (code) => {
      if (code === 0 || code === 3) {
        try { const out = fs.readFileSync(outF); cleanup(); resolve(out); }
        catch (e) { cleanup(); reject(e); }
      } else {
        cleanup();
        reject(new Error(`qpdf failed (${code}): ${stderr}`));
      }
    });
    function cleanup() {
      try { fs.unlinkSync(inF); } catch {}
      try { fs.unlinkSync(outF); } catch {}
    }
  });
}

// ---------------------------------------------------------------- ZIP

// files: [{ name, buffer }]
function buildZipBuffer(files) {
  const { ZipArchive } = require("archiver"); // archiver v8: ESM class export
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("data", (c) => chunks.push(c));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    files.forEach((f) => archive.append(f.buffer, { name: f.name }));
    archive.finalize();
  });
}

module.exports = {
  randomPassword,
  fmtDate,
  buildXlsxBuffer,
  buildPdfBuffer,
  encryptPdf,
  buildZipBuffer
};
