const RECEIPT_TEMPLATE_ = 'LPJ_RECEIPT_V1';
const RECEIPT_FIELDS_ = ['receipt_id', 'payment_detail_id', 'project_id', 'receipt_no', 'issued_on', 'status', 'sequence_no',
  'issued_by_user_id', 'template_version', 'document_snapshot', 'snapshot_digest', 'row_version', 'created_at'];

function rupiahWords_(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Nominal terbilang tidak valid.');
  const units = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function small(value) {
    if (value < 12) return units[value];
    if (value < 20) return units[value - 10] + ' belas';
    if (value < 100) return units[Math.floor(value / 10)] + ' puluh' + (value % 10 ? ' ' + small(value % 10) : '');
    return (value < 200 ? 'seratus' : units[Math.floor(value / 100)] + ' ratus') + (value % 100 ? ' ' + small(value % 100) : '');
  }
  if (amount === 0) return 'nol rupiah';
  const scales = ['', 'ribu', 'juta', 'miliar', 'triliun', 'kuadriliun'];
  const parts = [];
  let rest = amount, index = 0;
  while (rest) {
    const group = rest % 1000;
    if (group) parts.unshift(index === 1 && group === 1 ? 'seribu' : small(group) + (scales[index] ? ' ' + scales[index] : ''));
    rest = (rest - group) / 1000; index++;
  }
  return parts.join(' ') + ' rupiah';
}

function receiptRows_(spreadsheetId, projectId) {
  const all = rows_(spreadsheetId, 'receipts', RECEIPT_FIELDS_);
  if (new Set(all.map(row => row.receipt_id)).size !== all.length) throw new Error('ID kwitansi ganda.');
  const selected = all.filter(row => row.project_id === projectId);
  if (selected.some(row => !PROJECT_UUID_.test(row.receipt_id) || !PROJECT_UUID_.test(row.payment_detail_id) ||
      !budgetText_(row.receipt_no, 80) || !validProjectDate_(row.issued_on) || !['ISSUED', 'VOID'].includes(row.status) ||
      !Number.isSafeInteger(row.sequence_no) || row.sequence_no < 1 || !PROJECT_UUID_.test(row.issued_by_user_id) ||
      !Number.isSafeInteger(row.row_version) || row.row_version < 1) ||
      new Set(selected.map(row => row.receipt_no)).size !== selected.length || new Set(selected.map(row => row.sequence_no)).size !== selected.length ||
      new Set(selected.filter(row => row.status === 'ISSUED').map(row => row.payment_detail_id)).size !== selected.filter(row => row.status === 'ISSUED').length) {
    throw new Error('Nomor atau data kwitansi belum konsisten.');
  }
  return selected;
}

function receiptDocument_(row) {
  const document = JSON.parse(row.document_snapshot);
  if (requestDigest_(document) !== row.snapshot_digest || document.template_version !== RECEIPT_TEMPLATE_ || row.template_version !== RECEIPT_TEMPLATE_ ||
      document.receipt?.receipt_id !== row.receipt_id || document.receipt?.receipt_no !== row.receipt_no || document.receipt?.issued_on !== row.issued_on ||
      document.project?.project_id !== row.project_id || document.payment?.payment_detail_id !== row.payment_detail_id) throw new Error('Snapshot kwitansi tidak sesuai metadata.');
  return {receipt: Object.fromEntries(['receipt_id', 'receipt_no', 'payment_detail_id', 'issued_on', 'status', 'created_at', 'template_version'].map(key => [key, row[key]])), document};
}

function receiptContext_(spreadsheetId, projectId, paymentId) {
  const payments = rows_(spreadsheetId, 'payment_details', PAYMENT_FIELDS_).filter(row => row.payment_detail_id === paymentId);
  if (payments.length !== 1) return null;
  const context = transactionConfirmationContext_(spreadsheetId, projectId, payments[0].transaction_id, 'RECEIPT');
  if (!context) return null;
  // Numbering other payments must not invalidate an otherwise unchanged issue preview.
  context.receipts = [];
  const payment = context.details.find(row => row.payment.payment_detail_id === paymentId);
  const project = rows_(spreadsheetId, 'projects', ['project_id', 'title', 'fiscal_year', 'project_code']).find(row => row.project_id === projectId);
  const assignments = rows_(spreadsheetId, 'project_people', ['project_id', 'person_id', 'assignment_role']).filter(row => row.project_id === projectId);
  const people = rows_(spreadsheetId, 'people', ['person_id', 'display_name'], ['nip']);
  if (new Set(people.map(row => row.person_id)).size !== people.length) throw new Error('ID personel ganda.');
  const blockers = [...context.blockers];
  const signers = {};
  for (const [key, role] of [['ppk', 'PPK'], ['treasurer', 'Bendahara Pengeluaran']]) {
    const matching = assignments.filter(row => row.assignment_role === role);
    const person = matching.length === 1 ? people.find(row => row.person_id === matching[0].person_id) : null;
    if (!person || !budgetText_(person.display_name, 240) || (person.nip !== undefined && (typeof person.nip !== 'string' || person.nip.length > 40))) blockers.push('Nama atau NIP teks ' + role + ' belum lengkap/konsisten.');
    else signers[key] = {person_id: person.person_id, display_name: person.display_name, nip: person.nip || ''};
  }
  if (!project || !budgetText_(project.title, 240) || typeof project.project_code !== 'string' || project.project_code.length > 80 ||
      !Number.isSafeInteger(project.fiscal_year) || project.fiscal_year < 1900 || project.fiscal_year > 9999) blockers.push('Identitas proyek belum lengkap.');
  if (!payment) blockers.push('Pembayaran belum konsisten.');
  if (blockers.length) return {context, blockers, document: null};
  const value = payment.payment;
  return {context, blockers, document: {template_version: RECEIPT_TEMPLATE_, project,
    receipt: {receipt_no: '', issued_on: context.transaction.payment_date},
    transaction: {transaction_id: context.transaction.transaction_id, payment_date: context.transaction.payment_date, description: context.transaction.description,
      expense_kind: context.transaction.expense_kind, budget_item_label: context.item?.label || ''},
    payment: {...value, legal_name: payment.payee.legal_name, amount_in_words: rupiahWords_(value.net_paid_amount)}, signers}};
}

function receiptRpc_(spreadsheetId, user, request) {
  const {request_id, project_id, payload, action} = request;
  const ok = data => ({ok: true, request_id, data});
  const fail = (code, message) => failure_(request_id, code, message);
  const uuid = value => typeof value === 'string' && PROJECT_UUID_.test(value);
  const get = action === 'receipts.get', issue = action === 'receipts.issue';
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TRANSACTIONS_ENABLED') !== 'true' || (!get && props.getProperty('TAXES_ENABLED') !== 'true')) return fail('TEMPORARY_FAILURE', 'Transaksi dan pajak harus diaktifkan.');
  if ((get ? !uuid(payload?.receipt_id) : !uuid(payload?.payment_detail_id)) || (issue &&
      (!uuid(request_id) || !uuid(payload.preview_token) || !Number.isSafeInteger(payload.expected_transaction_row_version) || payload.expected_transaction_row_version < 1 ||
       !Number.isSafeInteger(payload.expected_payment_row_version) || payload.expected_payment_row_version < 1))) return fail('VALIDATION_ERROR', 'Periksa identitas, versi dan pratinjau kwitansi.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Kwitansi sedang diproses. Coba lagi.');
  try {
    const digest = requestDigest_([action, project_id, payload]);
    if (issue) {
      const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status']).find(row => row.request_id === request_id);
      if (previous) {
        if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest || previous.status !== 'COMPLETED') return fail('CONFLICT', 'ID permintaan sudah digunakan.');
        return ok(JSON.parse(previous.result_ref));
      }
    }
    const receipts = receiptRows_(spreadsheetId, project_id);
    if (get) {
      const row = receipts.find(row => row.receipt_id === payload.receipt_id);
      if (!row) return fail('NOT_FOUND', 'Kwitansi tidak ditemukan dalam proyek ini.');
      return ok(receiptDocument_(row));
    }
    const existing = receipts.find(row => row.payment_detail_id === payload.payment_detail_id && row.status === 'ISSUED');
    if (existing) return issue ? fail('CONFLICT', 'Kwitansi pembayaran ini sudah terbit. Muat ulang untuk membaca snapshotnya.') :
      ok({...receiptDocument_(existing), can_issue: false, blockers: [], already_issued: true});
    const context = receiptContext_(spreadsheetId, project_id, payload.payment_detail_id);
    if (!context) return fail('NOT_FOUND', 'Pembayaran tidak ditemukan dalam proyek ini.');
    const cache = CacheService.getScriptCache();
    const binding = requestDigest_([user.user_id, project_id, context]);
    if (!issue) {
      const token = context.blockers.length ? undefined : Utilities.getUuid();
      if (token) cache.put('receipt-issue:' + token, binding, 600);
      const selected = context.context.details.find(row => row.payment.payment_detail_id === payload.payment_detail_id);
      return ok({document: context.document, can_issue: !context.blockers.length, blockers: context.blockers, preview_token: token,
        transaction_row_version: context.context.transaction.row_version, payment_row_version: selected?.payment.row_version});
    }
    const selected = context.context.details.find(row => row.payment.payment_detail_id === payload.payment_detail_id);
    if (context.blockers.length || cache.get('receipt-issue:' + payload.preview_token) !== binding ||
        context.context.transaction.row_version !== payload.expected_transaction_row_version || selected?.payment.row_version !== payload.expected_payment_row_version) {
      return fail('CONFLICT', 'Data, penandatangan, pajak atau bukti berubah, atau pratinjau kedaluwarsa. Muat ulang kwitansi.');
    }
    const sequence = receipts.reduce((max, row) => Math.max(max, row.sequence_no), 0) + 1;
    if (!Number.isSafeInteger(sequence)) return fail('CONFLICT', 'Urutan nomor kwitansi melampaui batas.');
    const id = Utilities.getUuid(), time = new Date().toISOString();
    const receiptNo = String(sequence).padStart(4, '0') + '/KWT/' + context.document.project.fiscal_year;
    const document = {...context.document, receipt: {receipt_id: id, receipt_no: receiptNo, issued_on: context.document.receipt.issued_on}};
    const row = {receipt_id: id, payment_detail_id: payload.payment_detail_id, project_id, receipt_no: receiptNo, issued_on: document.receipt.issued_on,
      status: 'ISSUED', sequence_no: sequence, issued_by_user_id: user.user_id, template_version: RECEIPT_TEMPLATE_,
      document_snapshot: JSON.stringify(document), snapshot_digest: requestDigest_(document), row_version: 1, created_at: time, updated_at: time};
    const result = receiptDocument_(row);
    budgetBatch_(spreadsheetId, {
      receipts: [row],
      audit_log: [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action, entity_type: 'receipt', entity_id: id, occurred_at: time,
        change_summary: JSON.stringify({receipt_no: receiptNo, payment_detail_id: payload.payment_detail_id, snapshot_digest: row.snapshot_digest,
          net_paid_amount: selected.payment.net_paid_amount, tax_assessment_id: selected.assessment.tax_assessment_id,
          attachment_id: selected.proof.attachment_id, attachment_row_version: selected.proof.row_version, evidence_modified_at: selected.file.modified_at})}],
      mutation_requests: [{request_id, user_id: user.user_id, action, payload_digest: digest, result_ref: JSON.stringify(result), status: 'COMPLETED',
        row_version: 1, created_at: time, updated_at: time}],
    }, []);
    cache.remove('receipt-issue:' + payload.preview_token);
    return ok(result);
  } finally {lock.releaseLock();}
}
