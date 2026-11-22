const splitCodes = (value) => String(value || '')
  .split(/[;,|\s]+/)
  .map((code) => code.trim().toUpperCase())
  .filter((code) => code && code !== '-');

const codeMatches = (actualCodes, expectedCode, operator) => {
  if (operator === 'REGEX') {
    try {
      const pattern = new RegExp(expectedCode);
      return actualCodes.some((code) => pattern.test(code));
    } catch {
      return false;
    }
  }
  return actualCodes.some((code) => code.startsWith(String(expectedCode || '').toUpperCase()));
};

export const evaluateAuditCodingRules = (claim, rules = []) => {
  const diagnoses = splitCodes(claim.diaglist);
  const procedures = splitCodes(claim.proclist);
  const allCodes = [...diagnoses, ...procedures];
  const hasAppendicitisLaparotomyFinding = procedures.some(code => ['54.11', '54.19'].some(prefix => code.startsWith(prefix)))
    && (diagnoses.some(code => /^K37(?:\.|$)/.test(code))
      || !diagnoses.some(code => /^K3[567](?:\.|$)/.test(code)));
  const ptd = claim.layanan === 'Rawat Inap' ? '1' : claim.layanan === 'Rawat Jalan' ? '2' : '';
  const age = Number(claim.umurTahun);
  const hasValidAge = claim.umurTahun !== null && claim.umurTahun !== undefined && claim.umurTahun !== '' && Number.isFinite(age);

  return (rules || []).flatMap((auditRule) => {
    const condition = auditRule.condition || {};
    if (auditRule.PTD === '1' && ptd === '2') return [];
    if (auditRule.PTD === '2' && ptd === '1') return [];
    // The specific appendicitis/laparotomy warning replaces the older generic
    // laparotomy-as-approach warning for the same claim.
    if (hasAppendicitisLaparotomyFinding && String(auditRule.id) === 'AUDIT-COD-34') return [];
    let matched = false;

    if (condition.type === 'grouped') {
      const groupResults = (condition.groups || []).map((group) => {
        const hasMatch = (group.codes || []).some((code) => codeMatches(allCodes, code, group.operator));
        return group.operator === 'NOT' ? !hasMatch : hasMatch;
      });
      matched = (condition.operator || 'OR') === 'AND' ? groupResults.every(Boolean) : groupResults.some(Boolean);
    } else if (condition.type === 'custom_missing') {
      const hasRequired = (condition.requires || []).some((code) => codeMatches(allCodes, code));
      const hasMissingCode = (condition.missing || []).some((code) => codeMatches(allCodes, code));
      const hasExclude = (condition.excludes || []).some((code) => codeMatches(allCodes, code));
      matched = hasRequired && !hasMissingCode && (ptd === '1' || !hasExclude);
    } else if (condition.type === 'custom_age') {
      matched = (condition.rules || []).some((ageRule) => {
        if (!codeMatches(allCodes, ageRule.code)) return false;
        if (!hasValidAge) return true;
        if (ageRule.op === '<') return age >= ageRule.limit;
        if (ageRule.op === '>') return age <= ageRule.limit;
        return false;
      });
    } else if (condition.type === 'custom_los') {
      const losVal = parseFloat(claim.los ?? claim.LOS ?? claim._los ?? claim.LAMA_RAWAT);
      const hasReq = (condition.requires || []).some((code) => codeMatches(allCodes, code));
      matched = hasReq && Number.isFinite(losVal) && losVal <= condition.max_los_days;
    } else if (condition.type === 'appendicitis_laparotomy') {
      const hasLaparotomy = procedures.some(code => ['54.11', '54.19'].some(prefix => code.startsWith(prefix)));
      const hasAppendicitis = diagnoses.some(code => /^K3[567](?:\.|$)/.test(code));
      const hasUnspecifiedAppendicitis = diagnoses.some(code => /^K37(?:\.|$)/.test(code));
      matched = hasLaparotomy && (hasUnspecifiedAppendicitis || !hasAppendicitis);
    } else if (condition.codes) {
      matched = condition.codes.some((code) => codeMatches(allCodes, code));
    }

    if (matched && auditRule.requires_primary?.length) {
      const primaryDiagnosis = diagnoses[0] || '';
      const primaryIsAllowed = auditRule.requires_primary.some((code) => {
        if (primaryDiagnosis.startsWith(String(code).toUpperCase())) return true;
        try { return new RegExp(code).test(primaryDiagnosis); } catch { return false; }
      });
      if (primaryIsAllowed) matched = false;
    }

    if (!matched) return [];
    const appendicitisWarning = condition.type === 'appendicitis_laparotomy'
      ? (diagnoses.some(code => /^K37(?:\.|$)/.test(code))
        ? 'Diagnosis K37 (appendicitis tidak spesifik) disertai kode tindakan laparotomi 54.11/54.19. Cocokkan laporan operasi dan PA, pastikan apendektomi memang dilakukan, dan bila laparotomi hanya jalan masuk untuk tindakan utama, validasi aturan omit code. Pertimbangkan kode yang lebih spesifik bila didukung dokumentasi.'
        : 'Kode tindakan laparotomi 54.11/54.19 tercatat tanpa diagnosis appendicitis K35–K37. Cocokkan laporan operasi dengan diagnosis akhir; pastikan laparotomi merupakan tindakan yang benar-benar dilakukan dan kode diagnosis utama sudah sesuai.')
      : '';
    return [{
      ruleId: String(auditRule.id || 'N/A'),
      case: String(auditRule.case || 'Audit coding'),
      warning: String(appendicitisWarning || auditRule.validation_action?.warning_message || 'Kombinasi kode memerlukan validasi auditor.'),
      requiredDocuments: Array.isArray(auditRule.validation_action?.required_documents) ? auditRule.validation_action.required_documents : [],
      sep: String(claim.sep || ''),
      mrn: String(claim.mrn || ''),
      diaglist: diagnoses.join(', '),
      proclist: procedures.join(', '),
      codes: allCodes.join(', '),
      source: 'ocr-audit-coding',
    }];
  });
};
