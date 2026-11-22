export const medicalRuleKey = id => ({
  'MED-STT': 'JKN-DOC-12',
  'MED-ENSEFALOPATI': 'JKN-DOC-06',
}[id] || String(id || '').replace(/^MED-/, ''));

// Only merge explicit rule counterparts, never findings that merely share a diagnosis.
export function partitionClinicalAudits(item) {
  const active = new Set((item.medicalChecks || []).filter(check => check.status !== 'SESUAI').map(check => medicalRuleKey(check.id)));
  const linked = new Map();
  const standalone = [];
  (item.codingAudits || []).forEach(audit => {
    if (!active.has(audit.id)) { standalone.push(audit); return; }
    if (!linked.has(audit.id)) linked.set(audit.id, []);
    linked.get(audit.id).push(audit);
  });
  return { standalone, linked };
}
