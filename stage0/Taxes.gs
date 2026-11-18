const TAX_RULE_FIELDS_ = ['tax_rule_version_id', 'rule_code', 'version_no', 'tax_kind', 'expense_kind', 'payee_kind', 'eligibility', 'base_kind', 'rate_bps', 'effective_from', 'effective_to', 'source_ref'];
const TAX_ASSESSMENT_FIELDS_ = ['tax_assessment_id', 'payment_detail_id', 'tax_rule_version_id', 'tax_kind', 'tax_treatment', 'tax_base_amount', 'amount', 'status',
  'verified_by_user_id', 'verified_at', 'override_reason', 'decision_source_ref', 'evidence_attachment_id', 'evidence_row_version', 'evidence_drive_file_id', 'evidence_modified_at', 'rule_snapshot', 'row_version'];

function taxAmount_(amount, rate) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(rate) || rate < 0 || rate > 10000) return null;
  const remainder = amount % 10000;
  const scaled = remainder * rate;
  const fraction = scaled % 10000;
  const value = ((amount - remainder) / 10000) * rate + (scaled - fraction) / 10000 + (fraction >= 5000 ? 1 : 0);
  return Number.isSafeInteger(value) ? value : null;
}

function taxRule_(row) {
  const eligibility = JSON.parse(row.eligibility);
  if (typeof row.tax_rule_version_id !== 'string' || !PROJECT_UUID_.test(row.tax_rule_version_id) || !budgetText_(row.rule_code, 80) || !Number.isSafeInteger(row.version_no) || row.version_no < 1 ||
      !budgetText_(row.tax_kind, 40) || !EXPENSE_KINDS_.includes(row.expense_kind) || !['PERSON', 'ORGANIZATION', 'GROUP'].includes(row.payee_kind) ||
      row.base_kind !== 'RECEIPT_AMOUNT' || taxAmount_(0, row.rate_bps) === null || !validProjectDate_(row.effective_from) ||
      (row.effective_to !== '' && (!validProjectDate_(row.effective_to) || row.effective_to < row.effective_from)) ||
      !budgetText_(row.source_ref, 1000) || !eligibility || Array.isArray(eligibility) || typeof eligibility !== 'object' ||
      Object.keys(eligibility).some(key => key !== 'civil_service_grades') ||
      (eligibility.civil_service_grades !== undefined && (!Array.isArray(eligibility.civil_service_grades) || !eligibility.civil_service_grades.length ||
        eligibility.civil_service_grades.length > 30 || !eligibility.civil_service_grades.every(grade => budgetText_(grade, 40))))) {
    throw new Error('Aturan pajak tidak lengkap.');
  }
  return {...row, eligibility};
}

function taxContext_(spreadsheetId, projectId, paymentId, owner) {
  const project = rows_(spreadsheetId, 'projects', ['project_id', 'status']).find(row => row.project_id === projectId);
  const paymentMatches = rows_(spreadsheetId, 'payment_details', PAYMENT_FIELDS_).filter(row => row.payment_detail_id === paymentId);
  const payment = paymentMatches.length === 1 ? paymentMatches[0] : null;
  const transaction = payment && rows_(spreadsheetId, 'transactions', TRANSACTION_FIELDS_)
    .find(row => row.transaction_id === payment.transaction_id && row.project_id === projectId);
  if (!project || !payment || !transaction) return null;
  if (!transactionPayments_([payment], true)) throw new Error('Nilai pembayaran tidak konsisten.');
  const payees = rows_(spreadsheetId, 'payees', ['payee_id', 'payee_kind', 'person_id', 'legal_name'], ['tax_profile_ref', 'row_version']).filter(row => row.payee_id === payment.payee_id);
  if (payees.length !== 1) throw new Error('Penerima tidak konsisten.');
  const payee = payees[0];
  const person = payee.person_id ? rows_(spreadsheetId, 'people', ['person_id'], ['person_kind', 'civil_service_grade'])
    .find(row => row.person_id === payee.person_id) : null;
  const rules = rows_(spreadsheetId, 'tax_rule_versions', TAX_RULE_FIELDS_).map(taxRule_);
  if (new Set(rules.map(row => row.tax_rule_version_id)).size !== rules.length ||
      new Set(rules.map(row => row.rule_code + ':' + row.version_no)).size !== rules.length) throw new Error('Versi aturan pajak ganda.');
  const candidates = rules.filter(row => row.expense_kind === transaction.expense_kind && row.payee_kind === payee.payee_kind &&
    row.effective_from <= transaction.payment_date && (!row.effective_to || row.effective_to >= transaction.payment_date) &&
    (!row.eligibility.civil_service_grades || row.eligibility.civil_service_grades.includes(person?.civil_service_grade)));
  let reason = '';
  if (['CONSUMPTION', 'SNACK'].includes(transaction.expense_kind)) reason = 'CLASSIFICATION_REVIEW_REQUIRED';
  else if (transaction.expense_kind === 'HONOR' && (payee.payee_kind !== 'PERSON' ||
      !['DOSEN', 'PEGAWAI'].includes(person?.person_kind) || !person?.civil_service_grade || !payee.tax_profile_ref)) reason = 'PROFILE_INCOMPLETE';
  else if (candidates.length !== 1) reason = candidates.length ? 'OVERLAPPING_RULES' : 'NO_MATCHING_RULE';
  const proposed = !reason ? candidates[0] : null;
  const proposal = {status: 'PENDING', reason, amount: proposed ? taxAmount_(payment.receipt_amount, proposed.rate_bps) : null,
    tax_base_amount: payment.receipt_amount, tax_kind: proposed?.tax_kind || '', tax_rule_version_id: proposed?.tax_rule_version_id || '', source_ref: proposed?.source_ref || ''};
  const assessments = rows_(spreadsheetId, 'tax_assessments', TAX_ASSESSMENT_FIELDS_).filter(row => row.payment_detail_id === paymentId);
  const attachments = rows_(spreadsheetId, 'attachments', ['attachment_id', 'project_id', 'transaction_id', 'attachment_kind', 'drive_file_id', 'row_version'])
    .filter(row => row.project_id === projectId && row.transaction_id === transaction.transaction_id);
  if (attachments.length > 50) throw new Error('Terlalu banyak bukti untuk satu transaksi.');
  if (new Set(attachments.map(row => row.attachment_id)).size !== attachments.length) throw new Error('ID bukti ganda.');
  const evidence = owner ? attachments.map(row => {
    try {
      if (!/^[\w-]{10,200}$/.test(row.drive_file_id) || !Number.isSafeInteger(row.row_version) || row.row_version < 1) throw new Error();
      const file = DriveApp.getFileById(row.drive_file_id);
      if (file.isTrashed() || file.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error();
      return {...row, available: true, name: file.getName(), modified_at: file.getLastUpdated().toISOString()};
    } catch {
      return {...row, available: false, modified_at: ''};
    }
  }) : [];
  const receipts = rows_(spreadsheetId, 'receipts', ['payment_detail_id']);
  const allocations = rows_(spreadsheetId, 'tax_remittance_allocations', ['tax_assessment_id']);
  const distributions = rows_(spreadsheetId, 'distributions', ['transaction_id']);
  const canVerify = owner && ['DRAFT', 'ACTIVE'].includes(project.status) && transaction.status === 'DRAFT' && assessments.length <= 1 &&
    !receipts.some(row => row.payment_detail_id === paymentId) &&
    !allocations.some(row => assessments.some(assessment => assessment.tax_assessment_id === row.tax_assessment_id)) &&
    !distributions.some(row => row.transaction_id === transaction.transaction_id);
  return {project, transaction, payment, payee, person, rules, candidates, proposal, assessments, attachments, evidence, canVerify};
}

function taxRpc_(spreadsheetId, user, request, role) {
  const {request_id, project_id, payload, action} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  const uuid = value => typeof value === 'string' && PROJECT_UUID_.test(value);
  if (PropertiesService.getScriptProperties().getProperty('TAXES_ENABLED') !== 'true') return fail('TEMPORARY_FAILURE', 'Penilaian pajak belum diaktifkan.');
  const verify = action === 'taxes.verify';
  if (!uuid(payload?.payment_detail_id) || (verify && (!uuid(request_id) || !uuid(payload.preview_token) || !uuid(payload.evidence_attachment_id) ||
      !Number.isSafeInteger(payload.expected_transaction_row_version) || !Number.isSafeInteger(payload.expected_payment_row_version) ||
      !Number.isSafeInteger(payload.expected_assessment_row_version) || payload.expected_assessment_row_version < 0 ||
      !['VERIFIED', 'NOT_APPLICABLE'].includes(payload.status) || !budgetText_(payload.tax_kind, 40) ||
      !Number.isSafeInteger(payload.tax_base_amount) || payload.tax_base_amount < 0 || !Number.isSafeInteger(payload.amount) || payload.amount < 0 ||
      !budgetText_(payload.decision_source_ref, 1000) || typeof payload.override_reason !== 'string' || payload.override_reason.length > 1000 ||
      (payload.tax_rule_version_id !== '' && !uuid(payload.tax_rule_version_id))))) {
    return fail('VALIDATION_ERROR', 'Periksa identitas, versi, dasar/nominal, bukti, dan referensi keputusan pajak.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Pajak sedang diproses. Coba lagi.');
  try {
    const digest = requestDigest_([action, project_id, payload]);
    if (verify) {
      const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status'])
        .find(row => row.request_id === request_id);
      if (previous) {
        if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest || previous.status !== 'COMPLETED') return fail('CONFLICT', 'ID permintaan sudah digunakan.');
        return ok(JSON.parse(previous.result_ref));
      }
    }
    const context = taxContext_(spreadsheetId, project_id, payload.payment_detail_id, role === 'OWNER');
    if (!context) return fail('NOT_FOUND', 'Pembayaran tidak ditemukan dalam proyek ini.');
    const {transaction, payment, proposal, candidates, assessments, evidence, canVerify} = context;
    const binding = requestDigest_([user.user_id, project_id, context]);
    const cache = CacheService.getScriptCache();
    if (!verify) {
      let token;
      if (role === 'OWNER') {token = Utilities.getUuid(); cache.put('tax-preview:' + token, binding, 600);}
      const old = assessments.length === 1 ? assessments[0] : null;
      const proof = old && context.attachments.find(row => row.attachment_id === old.evidence_attachment_id);
      const file = old && evidence.find(row => row.attachment_id === old.evidence_attachment_id);
      const stale = !old || !['VERIFIED', 'NOT_APPLICABLE'].includes(old.status) || old.amount !== payment.withheld_tax_amount ||
        !proof || proof.row_version !== old.evidence_row_version || proof.drive_file_id !== old.evidence_drive_file_id ||
        (role === 'OWNER' && (!file?.available || file.modified_at !== old.evidence_modified_at));
      const assessment = old ? Object.fromEntries(Object.entries(old).filter(([key]) => role === 'OWNER' || !['evidence_drive_file_id', 'evidence_modified_at'].includes(key))) : null;
      return ok({payment, transaction, payee_name: context.payee.legal_name, proposal,
        candidates: candidates.map(({tax_rule_version_id, rule_code, version_no, tax_kind, rate_bps, source_ref}) => ({tax_rule_version_id, rule_code, version_no, tax_kind, rate_bps, source_ref})),
        assessment, needs_review: stale, can_verify: canVerify, preview_token: token,
        evidence: evidence.map(({attachment_id, attachment_kind, drive_file_id, row_version, modified_at, available, name}) =>
          ({attachment_id, attachment_kind, drive_file_id, row_version, modified_at, available, name: name || ''}))});
    }
    if (!canVerify) return fail('CONFLICT', 'Pembayaran tidak dapat diverifikasi lewat alur ini: periksa status, penilaian majemuk, kwitansi, setoran atau distribusi terkait.');
    const old = assessments[0] || null;
    if (cache.get('tax-preview:' + payload.preview_token) !== binding || transaction.row_version !== payload.expected_transaction_row_version ||
        payment.row_version !== payload.expected_payment_row_version || (old?.row_version || 0) !== payload.expected_assessment_row_version) {
      return fail('CONFLICT', 'Data atau bukti berubah, atau pratinjau kedaluwarsa. Muat ulang penilaian pajak.');
    }
    const proof = evidence.find(row => row.attachment_id === payload.evidence_attachment_id && row.available);
    if (!proof) return fail('VALIDATION_ERROR', 'Pilih bukti privat yang tersedia pada transaksi ini.');
    const rule = payload.tax_rule_version_id ? candidates.find(row => row.tax_rule_version_id === payload.tax_rule_version_id) : null;
    if ((payload.tax_rule_version_id && (!rule || rule.tax_kind !== payload.tax_kind.trim())) ||
        payload.amount > payment.receipt_amount || payload.tax_base_amount > payment.receipt_amount ||
        (payload.status === 'NOT_APPLICABLE' && payload.amount !== 0)) return fail('VALIDATION_ERROR', 'Nominal atau aturan pajak tidak sesuai dengan pembayaran.');
    const correction = old || payload.status === 'NOT_APPLICABLE' || !rule || proposal.amount === null ||
      payload.amount !== taxAmount_(payment.receipt_amount, rule.rate_bps) || payload.tax_base_amount !== payment.receipt_amount;
    if (correction && !payload.override_reason.trim()) return fail('VALIDATION_ERROR', 'Koreksi, keputusan manual, atau tidak dikenai pajak memerlukan alasan.');
    const time = new Date().toISOString();
    const stamp = {row_version: 1, created_at: time, updated_at: time};
    const assessmentId = old?.tax_assessment_id || Utilities.getUuid();
    const value = {payment_detail_id: payment.payment_detail_id, tax_rule_version_id: rule?.tax_rule_version_id || '',
      tax_kind: payload.tax_kind.trim(), tax_treatment: payload.status === 'NOT_APPLICABLE' ? 'NONE' : 'WITHHELD',
      tax_base_amount: payload.tax_base_amount, amount: payload.amount, status: payload.status, verified_by_user_id: user.user_id, verified_at: time,
      override_reason: payload.override_reason.trim(), decision_source_ref: payload.decision_source_ref.trim(),
      rule_snapshot: JSON.stringify(rule || null),
      evidence_attachment_id: proof.attachment_id, evidence_row_version: proof.row_version, evidence_drive_file_id: proof.drive_file_id,
      evidence_modified_at: proof.modified_at, row_version: old ? old.row_version + 1 : 1, updated_at: time};
    const paymentChanges = {withheld_tax_amount: value.amount, net_paid_amount: payment.receipt_amount - value.amount,
      row_version: payment.row_version + 1, updated_at: time};
    const result = {tax_assessment_id: assessmentId, status: value.status, row_version: value.row_version,
      payment_detail_id: payment.payment_detail_id, payment_row_version: paymentChanges.row_version,
      transaction_row_version: transaction.row_version + 1, withheld_tax_amount: value.amount, net_paid_amount: paymentChanges.net_paid_amount};
    const adds = {
      audit_log: [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action, entity_type: 'tax_assessment', entity_id: assessmentId,
        occurred_at: time, change_summary: JSON.stringify({before: old, before_payment: payment, after: value, after_payment: paymentChanges})}],
      mutation_requests: [{request_id, user_id: user.user_id, action, payload_digest: digest, result_ref: JSON.stringify(result), status: 'COMPLETED', ...stamp}],
    };
    const updates = [['payment_details', payment.payment_detail_id, paymentChanges],
      ['transactions', transaction.transaction_id, {row_version: transaction.row_version + 1, updated_at: time}]];
    if (old) updates.push(['tax_assessments', assessmentId, value]);
    else adds.tax_assessments = [{tax_assessment_id: assessmentId, ...stamp, ...value}];
    budgetBatch_(spreadsheetId, adds, updates);
    cache.remove('tax-preview:' + payload.preview_token);
    return ok(result);
  } finally {
    lock.releaseLock();
  }
}
