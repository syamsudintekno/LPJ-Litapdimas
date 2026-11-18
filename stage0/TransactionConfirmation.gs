function transactionConfirmationContext_(spreadsheetId, projectId, transactionId) {
  const read = (name, fields, optional = []) => rows_(spreadsheetId, name, fields, optional);
  const unique = (rows, key) => {if (new Set(rows.map(row => row[key])).size !== rows.length) throw new Error('ID sumber konfirmasi ganda.'); return rows;};
  const project = unique(read('projects', ['project_id', 'status', 'official_ceiling_amount', 'row_version']), 'project_id').find(row => row.project_id === projectId);
  const transaction = unique(read('transactions', TRANSACTION_FIELDS_), 'transaction_id').find(row => row.transaction_id === transactionId && row.project_id === projectId);
  if (!project || !transaction) return null;
  const payments = unique(read('payment_details', PAYMENT_FIELDS_), 'payment_detail_id').filter(row => row.transaction_id === transactionId);
  const amounts = transactionPayments_(payments, true);
  const blockers = [];
  if (project.status !== 'ACTIVE' || !Number.isSafeInteger(project.official_ceiling_amount) || project.official_ceiling_amount < 1 ||
      !Number.isSafeInteger(project.row_version) || project.row_version < 1) blockers.push('Proyek harus aktif dengan plafon resmi dan versi yang valid.');
  if (transaction.status !== 'DRAFT') blockers.push('Transaksi harus berstatus draf.');
  if (!Number.isSafeInteger(transaction.row_version) || transaction.row_version < 1 || !validProjectDate_(transaction.payment_date) ||
      !budgetText_(transaction.description, 1000) || !EXPENSE_KINDS_.includes(transaction.expense_kind) || !amounts ||
      payments.some(row => !PROJECT_UUID_.test(row.payment_detail_id) || !Number.isSafeInteger(row.row_version) || row.row_version < 1)) blockers.push('Rincian transaksi atau nominal pembayaran tidak konsisten.');
  if (!amounts) return {project, transaction, details: [], totals: null, blockers};
  const versions = unique(read('budget_versions', BUDGET_VERSION_FIELDS_), 'budget_version_id');
  const categories = unique(read('budget_categories', BUDGET_CATEGORY_FIELDS_), 'budget_category_id');
  const item = unique(read('budget_items', BUDGET_ITEM_FIELDS_), 'budget_item_id').find(row => row.budget_item_id === transaction.budget_item_id);
  const category = item && categories.find(row => row.budget_category_id === item.budget_category_id);
  const budget = category && versions.find(row => row.budget_version_id === category.budget_version_id && row.project_id === projectId);
  if (!budget || !['APPROVED', 'SUPERSEDED'].includes(budget.status) || !PROJECT_UUID_.test(budget.approved_by_user_id) ||
      !Number.isFinite(Date.parse(budget.approved_at)) || !Number.isSafeInteger(budget.row_version) || budget.row_version < 1) blockers.push('Item transaksi harus merujuk versi RAB proyek yang sudah pernah disahkan.');
  const activity = transaction.activity_id ? unique(read('activities', ['activity_id', 'project_id']), 'activity_id').find(row => row.activity_id === transaction.activity_id && row.project_id === projectId) : null;
  if (transaction.activity_id && !activity) blockers.push('Kegiatan transaksi tidak ditemukan dalam proyek.');
  const payees = unique(read('payees', ['payee_id', 'payee_kind', 'person_id', 'legal_name'], ['tax_profile_ref', 'row_version']), 'payee_id');
  const people = unique(read('people', ['person_id'], ['person_kind', 'civil_service_grade']), 'person_id');
  const rules = taxRulesRead_(spreadsheetId);
  const assessments = unique(read('tax_assessments', TAX_ASSESSMENT_FIELDS_), 'tax_assessment_id').filter(row => payments.some(payment => payment.payment_detail_id === row.payment_detail_id));
  const attachments = unique(read('attachments', ATTACHMENT_FIELDS_), 'attachment_id').filter(row => row.project_id === projectId && row.transaction_id === transactionId);
  const receipts = read('receipts', ['payment_detail_id']).filter(row => payments.some(payment => payment.payment_detail_id === row.payment_detail_id));
  const allocations = read('tax_remittance_allocations', ['tax_assessment_id']).filter(row => assessments.some(assessment => assessment.tax_assessment_id === row.tax_assessment_id));
  const distributions = read('distributions', ['transaction_id']).filter(row => row.transaction_id === transactionId);
  if (receipts.length || allocations.length || distributions.length) blockers.push('Transaksi sudah tertaut kwitansi, setoran, atau distribusi; tinjau melalui alur rekonsiliasi.');
  const files = new Map();
  const details = payments.map(payment => {
    const payee = payees.find(row => row.payee_id === payment.payee_id);
    const person = payee?.person_id ? people.find(row => row.person_id === payee.person_id) : null;
    const candidates = taxRulesOnDate_(rules, transaction.payment_date).filter(row => row.expense_kind === transaction.expense_kind && row.payee_kind === payee?.payee_kind &&
      (!row.eligibility.civil_service_grades || row.eligibility.civil_service_grades.includes(person?.civil_service_grade)));
    const matching = assessments.filter(row => row.payment_detail_id === payment.payment_detail_id);
    const assessment = matching.length === 1 ? matching[0] : null;
    const proof = assessment && attachments.find(row => row.attachment_id === assessment.evidence_attachment_id && row.attachment_kind === 'PAYMENT_PROOF');
    let file = null;
    if (proof) {
      if (!files.has(proof.drive_file_id)) {
        try {files.set(proof.drive_file_id, evidenceFile_(projectId, proof.drive_file_id));} catch {files.set(proof.drive_file_id, null);}
      }
      file = files.get(proof.drive_file_id);
    }
    let current = false;
    if (payee && budgetText_(payee.legal_name, 240) && ['PERSON', 'ORGANIZATION', 'GROUP'].includes(payee.payee_kind) &&
        assessment && proof && Number.isSafeInteger(proof.row_version) && proof.row_version > 0 && file) {
      const rule = assessment.tax_rule_version_id ? candidates.find(row => row.tax_rule_version_id === assessment.tax_rule_version_id) : null;
      let snapshotMatches = false;
      try {
        const snapshot = JSON.parse(assessment.rule_snapshot);
        snapshotMatches = rule ? requestDigest_(TAX_RULE_FIELDS_.map(key => snapshot?.[key])) === requestDigest_(TAX_RULE_FIELDS_.map(key => rule[key])) :
          !assessment.tax_rule_version_id && snapshot === null;
      } catch {}
      const manual = !rule || assessment.status === 'NOT_APPLICABLE' || assessment.tax_base_amount !== payment.receipt_amount ||
        assessment.amount !== taxAmount_(payment.receipt_amount, rule.rate_bps);
      current = ['VERIFIED', 'NOT_APPLICABLE'].includes(assessment.status) &&
        assessment.tax_treatment === (assessment.status === 'NOT_APPLICABLE' ? 'NONE' : 'WITHHELD') &&
        (assessment.status !== 'NOT_APPLICABLE' || assessment.amount === 0) &&
        Number.isSafeInteger(assessment.amount) && assessment.amount >= 0 && assessment.amount === payment.withheld_tax_amount &&
        Number.isSafeInteger(assessment.tax_base_amount) && assessment.tax_base_amount >= 0 && assessment.tax_base_amount <= payment.receipt_amount &&
        Number.isSafeInteger(assessment.row_version) && assessment.row_version > 0 &&
        typeof assessment.verified_by_user_id === 'string' && PROJECT_UUID_.test(assessment.verified_by_user_id) && Number.isFinite(Date.parse(assessment.verified_at)) &&
        budgetText_(assessment.tax_kind, 40) && budgetText_(assessment.decision_source_ref, 1000) &&
        (!manual || budgetText_(assessment.override_reason, 1000)) && snapshotMatches && (!rule || rule.tax_kind === assessment.tax_kind) &&
        proof.row_version === assessment.evidence_row_version && proof.drive_file_id === assessment.evidence_drive_file_id &&
        file.modified_at === assessment.evidence_modified_at &&
        assessment.verification_context_digest === taxVerificationDigest_({project, transaction, payment, payee, person, candidates});
    }
    if (!current) blockers.push((payee?.legal_name || 'Penerima pembayaran') + ': verifikasi pajak dan bukti perlu dilengkapi atau ditinjau ulang.');
    return {payment, payee, person, candidates, assessment, proof, file, current};
  });
  return {project, transaction, budget, category, item, activity, details, receipts, allocations, distributions,
    totals: amounts?.totals || null, blockers};
}

function transactionConfirmationRpc_(spreadsheetId, user, request) {
  const {request_id, project_id, action, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  const uuid = value => typeof value === 'string' && PROJECT_UUID_.test(value);
  const confirm = action === 'transactions.confirm';
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TRANSACTIONS_ENABLED') !== 'true' || props.getProperty('TAXES_ENABLED') !== 'true') return fail('TEMPORARY_FAILURE', 'Transaksi dan penilaian pajak harus diaktifkan.');
  if (!uuid(payload?.transaction_id) || (confirm && (!uuid(request_id) || !uuid(payload.preview_token) ||
      !Number.isSafeInteger(payload.expected_row_version) || payload.expected_row_version < 1 || payload.evidence_reviewed !== true))) return fail('VALIDATION_ERROR', 'Periksa identitas, versi, pratinjau dan pernyataan pemeriksaan bukti.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Konfirmasi sedang diproses. Coba lagi.');
  try {
    const digest = requestDigest_([action, project_id, payload]);
    if (confirm) {
      const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status']).find(row => row.request_id === request_id);
      if (previous) {
        if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest || previous.status !== 'COMPLETED') return fail('CONFLICT', 'ID permintaan sudah digunakan.');
        return ok(JSON.parse(previous.result_ref));
      }
    }
    const context = transactionConfirmationContext_(spreadsheetId, project_id, payload.transaction_id);
    if (!context) return fail('NOT_FOUND', 'Transaksi tidak ditemukan dalam proyek ini.');
    const cache = CacheService.getScriptCache();
    const binding = requestDigest_([user.user_id, project_id, context]);
    if (!confirm) {
      const token = context.blockers.length ? undefined : Utilities.getUuid();
      if (token) cache.put('transaction-confirm:' + token, binding, 600);
      return ok({transaction: context.transaction, totals: context.totals, blockers: context.blockers, can_confirm: !context.blockers.length,
        preview_token: token, payments: context.details.map(({payment, payee, assessment, proof, file, current}) => ({...payment,
          legal_name: payee?.legal_name || '', tax_status: assessment?.status || 'PENDING', needs_review: !current,
          evidence: proof && file ? {attachment_id: proof.attachment_id, name: file.name, drive_file_id: proof.drive_file_id, modified_at: file.modified_at} : null}))});
    }
    if (context.blockers.length || context.transaction.row_version !== payload.expected_row_version || cache.get('transaction-confirm:' + payload.preview_token) !== binding) return fail('CONFLICT', 'Data, aturan, atau bukti berubah, pratinjau kedaluwarsa, atau syarat belum lengkap. Muat ulang tinjauan konfirmasi.');
    const time = new Date().toISOString();
    const result = {transaction_id: payload.transaction_id, status: 'CONFIRMED', row_version: context.transaction.row_version + 1,
      confirmed_by_user_id: user.user_id, confirmed_at: time, totals: context.totals};
    budgetBatch_(spreadsheetId, {
      audit_log: [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action, entity_type: 'transaction', entity_id: payload.transaction_id,
        occurred_at: time, change_summary: JSON.stringify({before: context.transaction, after: result, evidence_reviewed: true,
          payments: context.details.map(({payment, payee, assessment, proof, file}) => ({payment,
            legal_name: payee.legal_name, tax_assessment_id: assessment.tax_assessment_id, assessment_row_version: assessment.row_version,
            tax_rule_version_id: assessment.tax_rule_version_id, verification_context_digest: assessment.verification_context_digest,
            attachment_id: proof.attachment_id, attachment_row_version: proof.row_version, drive_file_id: proof.drive_file_id, evidence_modified_at: file.modified_at}))})}],
      mutation_requests: [{request_id, user_id: user.user_id, action, payload_digest: digest, result_ref: JSON.stringify(result), status: 'COMPLETED',
        row_version: 1, created_at: time, updated_at: time}],
    }, [['transactions', payload.transaction_id, {status: result.status, row_version: result.row_version, confirmed_by_user_id: user.user_id, confirmed_at: time, updated_at: time}]]);
    cache.remove('transaction-confirm:' + payload.preview_token);
    return ok(result);
  } finally {lock.releaseLock();}
}
