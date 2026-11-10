// Reads text from a CSV file, supporting quoted cells and any line ending.
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const source = text.replace(/^﻿/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);

  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
};

// A leading = + - or @ makes a spreadsheet run the cell as a formula.
const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const cellValues = (columns, rows) =>
  rows.map((row) => columns.map((column) => column.value(row)));

export const downloadCsv = (filename, columns, rows) => {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(","),
    ...cellValues(columns, rows).map((cells) => cells.map(csvCell).join(",")),
  ];

  // The byte order mark lets Excel read Bangla text correctly.
  const blob = new Blob([`﻿${lines.join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

// Opens a clean page with the browser print dialog, which can save it as a PDF.
export const printTable = (title, columns, rows) => {
  const win = window.open("", "_blank");
  if (!win) {
    throw new Error("Allow pop-ups for this site to print the report.");
  }

  const doc = win.document;
  doc.title = title;

  const style = doc.createElement("style");
  style.textContent = `
    body { font-family: Arial, sans-serif; color: #1e293b; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    p { font-size: 12px; color: #64748b; margin: 0 0 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #f1f5f9; }
  `;
  doc.head.appendChild(style);

  const heading = doc.createElement("h1");
  heading.textContent = title;
  const generated = doc.createElement("p");
  generated.textContent = `Generated ${new Date().toLocaleString("en-GB")}`;

  const table = doc.createElement("table");
  const headerRow = table.createTHead().insertRow();
  columns.forEach((column) => {
    const th = doc.createElement("th");
    th.textContent = column.label;
    headerRow.appendChild(th);
  });
  const body = table.createTBody();
  cellValues(columns, rows).forEach((cells) => {
    const tr = body.insertRow();
    cells.forEach((value) => {
      tr.insertCell().textContent = value === null || value === undefined ? "" : String(value);
    });
  });

  doc.body.append(heading, generated, table);
  win.focus();
  win.print();
};
