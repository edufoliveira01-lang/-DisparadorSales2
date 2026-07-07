export interface ContatoImportado {
  nome: string;
  telefone: string;
  observacoes: string;
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizarCabecalho(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizarTelefone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function parseCsvContent(content: string): ContatoImportado[] {
  const rows = parseCsvRows(content);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizarCabecalho);

  const nomeIdx = headers.findIndex((h) => ["name", "nome", "full name", "display name"].includes(h));
  const givenIdx = headers.findIndex((h) => h.includes("given name") || h.includes("first name"));
  const familyIdx = headers.findIndex((h) => h.includes("family name") || h.includes("last name"));

  const phoneIdxs = headers
    .map((h, idx) => ({ h, idx }))
    .filter(({ h }) => /phone|telefone|celular|mobile|whatsapp/.test(h) && !/type|label|tipo/.test(h))
    .map(({ idx }) => idx);

  const obsIdx = headers.findIndex((h) => ["notes", "note", "observacoes", "observações", "obs"].includes(h));

  const contatos: ContatoImportado[] = [];
  for (const row of rows.slice(1)) {
    let nome = nomeIdx >= 0 ? row[nomeIdx]?.trim() : "";
    if (!nome && (givenIdx >= 0 || familyIdx >= 0)) {
      nome = [givenIdx >= 0 ? row[givenIdx] : "", familyIdx >= 0 ? row[familyIdx] : ""]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(" ");
    }

    let telefone = "";
    for (const idx of phoneIdxs) {
      if (row[idx]?.trim()) {
        telefone = row[idx].trim();
        break;
      }
    }

    const observacoes = obsIdx >= 0 ? row[obsIdx]?.trim() || "" : "";

    if (nome && telefone) {
      contatos.push({ nome, telefone: normalizarTelefone(telefone), observacoes });
    }
  }
  return contatos;
}

function parseVCardContent(content: string): ContatoImportado[] {
  const cards = content.split(/BEGIN:VCARD/i).slice(1);
  const contatos: ContatoImportado[] = [];

  for (const raw of cards) {
    const block = raw.split(/END:VCARD/i)[0];
    const lines = block.split(/\r?\n/);
    let nome = "";
    let telefone = "";
    let observacoes = "";

    for (const line of lines) {
      if (/^FN[:;]/i.test(line) && !nome) {
        nome = line.slice(line.indexOf(":") + 1).trim();
      } else if (/^TEL/i.test(line) && !telefone) {
        telefone = line.slice(line.lastIndexOf(":") + 1).trim();
      } else if (/^NOTE[:;]/i.test(line) && !observacoes) {
        observacoes = line.slice(line.indexOf(":") + 1).trim();
      }
    }

    if (nome && telefone) {
      contatos.push({ nome, telefone: normalizarTelefone(telefone), observacoes });
    }
  }
  return contatos;
}

/** Detecta o formato (CSV ou vCard) pelo conteúdo e extrai nome/telefone/observações. */
export function parseImportContent(content: string): ContatoImportado[] {
  if (/^﻿?BEGIN:VCARD/i.test(content.trim())) {
    return parseVCardContent(content);
  }
  return parseCsvContent(content);
}
