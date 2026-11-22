const normalized = value => String(value ?? '').trim().toUpperCase();
const auditOrder = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
const compareValue = (left, right) => {
  const a = normalized(left), b = normalized(right);
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return auditOrder.compare(a, b);
};

export const compareAuditFindings = (left, right) =>
  compareValue(left.ruleId, right.ruleId) ||
  compareValue(left.namaPasien, right.namaPasien) ||
  compareValue(left.mrn, right.mrn) ||
  compareValue(left.sep, right.sep);
const sepOf = row => normalized(row.sep || row.SEP || row.NO_SEP || row.NOSEP || row.NOMOR_SEP);
const serviceOf = row => {
  const value = normalized(row.layanan || row.PTD || row.JENIS_RAWAT || row.PELAYANAN);
  if (['1', 'RI', 'RITL', 'RAWAT INAP'].includes(value)) return 'ri';
  if (['2', 'RJ', 'RJTL', 'RAWAT JALAN'].includes(value)) return 'rj';
  return null;
};

export function summarizeAuditVerdicts(findings, verdicts) {
  const reviewed = new Set();
  const sesuai = new Set();
  const tidak = new Set();
  findings.forEach(({ sep, ruleId }) => {
    const key = String(sep || '').trim();
    const verdict = verdicts[`${key}|${ruleId}`];
    if (!verdict) return;
    reviewed.add(key);
    (verdict === 'sesuai' ? sesuai : tidak).add(key);
  });
  return { totalReviewed: reviewed.size, totalSesuai: sesuai.size, totalTidak: tidak.size };
}

export function groupAuditByService(findings, rows = [], { excludeOutpatientEcho = false } = {}) {
  const sources = new Map();
  rows.forEach(row => {
    const sep = sepOf(row), service = serviceOf(row);
    if (!sep || !service) return;
    if (!sources.has(sep)) sources.set(sep, new Set());
    sources.get(sep).add(service);
  });
  const sections = [
    { id: 'ri', title: 'Rawat Inap', findings: [] },
    { id: 'rj', title: 'Rawat Jalan', findings: [] },
    { id: 'unknown', title: 'Jenis rawat belum diketahui', findings: [] },
  ];
  findings.forEach(finding => {
    const candidates = sources.get(sepOf(finding));
    const service = serviceOf(finding) || (candidates?.size === 1 ? [...candidates][0] : 'unknown');
    if (excludeOutpatientEcho && service === 'rj' && finding.ruleId === 'AUDIT-COD-65') return;
    sections.find(section => section.id === service).findings.push(finding);
  });
  sections.forEach(section => section.findings.sort(compareAuditFindings));
  return sections.filter(section => section.id !== 'unknown' || section.findings.length);
}
