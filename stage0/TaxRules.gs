// Rules are global to the owner's workspace. Published versions are append-only.
function taxRulesRead_(spreadsheetId) {
  const rules = rows_(spreadsheetId, 'tax_rule_versions', TAX_RULE_FIELDS_).map(taxRule_);
  if (new Set(rules.map(row => row.tax_rule_version_id)).size !== rules.length ||
      new Set(rules.map(row => row.rule_code + ':' + row.version_no)).size !== rules.length) throw new Error('Versi aturan pajak ganda.');
  return rules;
}

function taxRulesOnDate_(rules, date) {
  const selected = new Map();
  for (const row of rules) {
    if (row.effective_from > date || (row.effective_to && row.effective_to < date)) continue;
    if (!selected.has(row.rule_code) || selected.get(row.rule_code).version_no < row.version_no) selected.set(row.rule_code, row);
  }
  return [...selected.values()];
}

function taxRulesRpc_(spreadsheetId, user, request) {
  const {request_id, action, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  if (PropertiesService.getScriptProperties().getProperty('TAXES_ENABLED') !== 'true') return fail('TEMPORARY_FAILURE', 'Pengelolaan pajak belum diaktifkan.');
  if (request.project_id !== undefined && request.project_id !== '') return fail('VALIDATION_ERROR', 'Aturan pajak dikelola secara global, tanpa ID proyek.');
  const save = action === 'taxes.save_rule_version';
  let submitted;
  if (save) {
    if (!PROJECT_UUID_.test(request_id) || !payload || typeof payload.rule_code !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(payload.rule_code) ||
        !Number.isSafeInteger(payload.expected_latest_version) || payload.expected_latest_version < 0 ||
        !payload.eligibility || typeof payload.eligibility !== 'object' || Array.isArray(payload.eligibility)) return fail('VALIDATION_ERROR', 'Periksa kode aturan, versi, dan syarat golongan.');
    try {
      submitted = taxRule_({tax_rule_version_id: Utilities.getUuid(), rule_code: payload.rule_code,
        version_no: payload.expected_latest_version + 1, tax_kind: payload.tax_kind, expense_kind: payload.expense_kind,
        payee_kind: payload.payee_kind, eligibility: JSON.stringify(payload.eligibility), base_kind: payload.base_kind,
        rate_bps: payload.rate_bps, effective_from: payload.effective_from, effective_to: payload.effective_to, source_ref: payload.source_ref});
      submitted.tax_kind = submitted.tax_kind.trim(); submitted.source_ref = submitted.source_ref.trim();
      if (submitted.eligibility.civil_service_grades) {
        submitted.eligibility.civil_service_grades = submitted.eligibility.civil_service_grades.map(grade => grade.trim());
        if (new Set(submitted.eligibility.civil_service_grades).size !== submitted.eligibility.civil_service_grades.length) throw new Error();
      }
    } catch {return fail('VALIDATION_ERROR', 'Periksa referensi, periode, jenis, golongan dan tarif basis point 0–10.000.');}
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Aturan pajak sedang diproses. Coba lagi.');
  try {
    const digest = requestDigest_([action, payload]);
    if (save) {
      const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status']).find(row => row.request_id === request_id);
      if (previous) {
        if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest || previous.status !== 'COMPLETED') return fail('CONFLICT', 'ID permintaan sudah digunakan.');
        return ok(JSON.parse(previous.result_ref));
      }
    }
    const rules = taxRulesRead_(spreadsheetId);
    if (!save) return ok({rules: rules.sort((a, b) => a.rule_code.localeCompare(b.rule_code) || b.version_no - a.version_no)});
    const history = rules.filter(row => row.rule_code === submitted.rule_code).sort((a, b) => b.version_no - a.version_no);
    const latest = history[0] || null;
    if ((latest?.version_no || 0) !== payload.expected_latest_version) return fail('CONFLICT', 'Versi aturan berubah. Muat ulang daftar sebelum membuat versi baru.');
    if (history.some(row => ['tax_kind', 'expense_kind', 'payee_kind', 'base_kind'].some(field => row[field] !== submitted[field]))) {
      return fail('VALIDATION_ERROR', 'Jenis pajak, belanja, penerima dan dasar harus tetap untuk kode yang sama. Gunakan kode baru untuk jenis berbeda.');
    }
    const time = new Date().toISOString();
    const stamp = {row_version: 1, created_at: time, updated_at: time};
    const result = {tax_rule_version_id: submitted.tax_rule_version_id, rule_code: submitted.rule_code, version_no: submitted.version_no};
    budgetBatch_(spreadsheetId, {
      tax_rule_versions: [{...submitted, eligibility: JSON.stringify(submitted.eligibility), ...stamp}],
      audit_log: [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id: '', action,
        entity_type: 'tax_rule_version', entity_id: result.tax_rule_version_id, occurred_at: time,
        change_summary: JSON.stringify({previous_version: latest, after: submitted})}],
      mutation_requests: [{request_id, user_id: user.user_id, action, payload_digest: digest, result_ref: JSON.stringify(result), status: 'COMPLETED', ...stamp}],
    }, []);
    return ok(result);
  } finally {lock.releaseLock();}
}
