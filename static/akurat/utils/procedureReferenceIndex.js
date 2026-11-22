import builtinPageIndex from '../data/ingenixProcedurePageIndex.json' with { type: 'json' };

const SCHEMA = 'akurat-icd9-desk-reference/v1';
export const PROCEDURE_REFERENCE_KIND = 'icd9-desk-reference';
const RANGES = [[1, 100], [101, 300], [301, 500], [501, 600], [601, 787]];
const CODE = /^\d{2}\.\d{1,2}$/;

function documentInfo(start, end) {
  const name = `Optum ${start}-${end}.pdf`;
  return {
    id: `ingenix-icd9-2010-${start}-${end}`, name,
    title: `Ingenix ICD-9-CM Procedures 2010 · ${name}`,
    type: 'REFERENSI KODING', level: 'Pendukung', year: '2010',
    sourceKind: PROCEDURE_REFERENCE_KIND, totalPages: end - start + 1,
  };
}

const pageId = (start, page) => `CDR_ICD9_2010_${start}_P${page}`;

export const builtinProcedureReferences = builtinPageIndex.map(([start, pages]) => ({
  ...documentInfo(start, start + pages.length - 1),
  builtin: true,
  chunks: pages.flatMap((record, offset) => {
    if (!record) return [];
    const [codes, headingCodes, keywords] = record;
    const page = offset + 1;
    const id = pageId(start, page);
    return [{ id, sourceId: id, page, scanPage: start + offset, codes, headingCodes, keywords }];
  }),
}));

export function parseProcedureReferenceIndex(index) {
  if (index?.schema !== SCHEMA || index?.year !== 2010 || !Array.isArray(index.documents) || index.documents.length !== RANGES.length) {
    throw new Error('Format indeks referensi ICD-9-CM 2010 tidak dikenali.');
  }

  return RANGES.map(([start, end], indexPosition) => {
    const document = index.documents[indexPosition];
    const info = documentInfo(start, end);
    const { name, totalPages } = info;
    if (document?.name !== name || document.scanStart !== start || !Array.isArray(document.pages) || document.pages.length !== totalPages) {
      throw new Error(`Cakupan indeks ${name} tidak lengkap.`);
    }

    let blankPages = 0;
    const chunks = document.pages.map((record, offset) => {
      const page = offset + 1;
      if (record?.page !== page || record.scanPage !== start + offset || typeof record.text !== 'string' || (!record.text.trim() && record.blank !== true) || record.text.length > 50000) {
        throw new Error(`Halaman ${page} pada ${name} tidak valid.`);
      }
      if (record.blank === true && !record.text.trim()) {
        blankPages += 1;
        return null;
      }
      const codes = validCodes(record.codes);
      const headingCodes = validCodes(record.headingCodes).filter((code) => codes.includes(code));
      const sourceId = pageId(start, page);
      return { id: sourceId, sourceId, page, scanPage: record.scanPage, content: record.text, codes, headingCodes };
    }).filter(Boolean);
    return { ...info, ocrPages: totalPages - blankPages, chunks };
  });
}

function validCodes(values) {
  return Array.isArray(values) ? [...new Set(values.filter((value) => typeof value === 'string' && CODE.test(value)))] : [];
}

export function buildProcedureReferenceLookup(documents) {
  const lookup = new Map();
  const available = new Map(builtinProcedureReferences.map((doc) => [doc.id, doc]));
  for (const document of documents) {
    if (document.sourceKind === PROCEDURE_REFERENCE_KIND) available.set(document.id, document);
  }
  for (const document of available.values()) {
    for (const chunk of document.chunks) {
      for (const code of chunk.codes) {
        if (!lookup.has(code)) lookup.set(code, []);
        lookup.get(code).push({ code, file: document.name, ...chunk, heading: chunk.headingCodes.includes(code) });
      }
    }
  }
  for (const pages of lookup.values()) pages.sort((a, b) => Number(b.heading) - Number(a.heading) || a.scanPage - b.scanPage);
  return lookup;
}

export function listProcedureCodes(proclist) {
  const codes = String(proclist || '').split(/[;,|#\s]+/)
    .map((code) => code.replace(/^(\d{2})(\d{1,2})$/, '$1.$2')).filter((code) => CODE.test(code));
  return [...new Set(codes)];
}

export function findIndexedProcedureReferences(proclist, lookup) {
  return listProcedureCodes(proclist).map((code) => ({ code, matches: (lookup.get(code) || []).slice(0, 3) }));
}

export function procedureReferenceExcerpt(match) {
  const content = String(match.content || '').replace(/\s+/g, ' ').trim();
  if (!content) return '';
  const position = content.indexOf(match.code);
  const offset = Math.max(0, position - 50);
  return `${offset ? '… ' : ''}${content.slice(offset, offset + 420).trim()}${offset + 420 < content.length ? ' …' : ''}`;
}
