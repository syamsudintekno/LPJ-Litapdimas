const TRANSACTION_FIELDS_ = ['transaction_id', 'project_id', 'budget_item_id', 'activity_id', 'payment_date', 'expense_kind', 'description', 'status', 'row_version'];
const PAYMENT_FIELDS_ = ['payment_detail_id', 'transaction_id', 'payee_id', 'receipt_amount', 'withheld_tax_amount', 'added_tax_amount', 'net_paid_amount', 'row_version'];
const EXPENSE_KINDS_ = ['HONOR', 'TRANSPORT', 'CONSUMPTION', 'SNACK', 'OTHER'];

function transactionPayments_(rows, stored = false) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 30 ||
      new Set(rows.map(row => row?.payee_id)).size !== rows.length) return null;
  const totals = {receipt_amount: 0, withheld_tax_amount: 0, added_tax_amount: 0, net_paid_amount: 0};
  const payments = [];
  for (const row of rows) {
    if (!row || typeof row.payee_id !== 'string' || !PROJECT_UUID_.test(row.payee_id) ||
        !Number.isSafeInteger(row.receipt_amount) || row.receipt_amount < 1 ||
        !Number.isSafeInteger(row.withheld_tax_amount) || row.withheld_tax_amount < 0 || row.withheld_tax_amount > row.receipt_amount ||
        (row.added_tax_amount !== undefined && row.added_tax_amount !== 0)) return null;
    const net = row.receipt_amount - row.withheld_tax_amount;
    if (stored && row.net_paid_amount !== net) return null;
    const payment = {payee_id: row.payee_id, receipt_amount: row.receipt_amount, withheld_tax_amount: row.withheld_tax_amount,
      added_tax_amount: 0, net_paid_amount: net,
      ...(row.payment_detail_id === undefined ? {} : {payment_detail_id: row.payment_detail_id})};
    for (const field of Object.keys(totals)) {
      totals[field] += payment[field];
      if (!Number.isSafeInteger(totals[field])) return null;
    }
    payments.push(payment);
  }
  return {payments, totals};
}

function transactionRpc_(spreadsheetId, user, request, role) {
  const {request_id, project_id, action, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  const uuid = value => typeof value === 'string' && PROJECT_UUID_.test(value);
  if (PropertiesService.getScriptProperties().getProperty('TRANSACTIONS_ENABLED') !== 'true') {
    return fail('TEMPORARY_FAILURE', 'Pengelolaan transaksi belum diaktifkan.');
  }
  const save = action === 'transactions.save';
  const edit = save && payload?.transaction_id !== undefined;
  const input = payload?.transaction;
  const calculated = save ? transactionPayments_(payload?.payments) : null;
  if (save && (!uuid(request_id) || !input || !uuid(input.budget_item_id) ||
      !validProjectDate_(input.payment_date) || !EXPENSE_KINDS_.includes(input.expense_kind) ||
      !budgetText_(input.description, 1000) || (input.activity_id !== undefined && input.activity_id !== '' && !uuid(input.activity_id)) ||
      !calculated || (edit && (!uuid(payload.transaction_id) || !Number.isSafeInteger(payload.expected_row_version) || payload.expected_row_version < 1)))) {
    return fail('VALIDATION_ERROR', 'Periksa transaksi, penerima, dan nominal rupiah integer. Pajak tambahan belum didukung pada draf ini.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Transaksi sedang diproses. Coba lagi.');
  try {
    const project = rows_(spreadsheetId, 'projects', ['project_id', 'status', 'active_budget_version_id'])
      .find(row => row.project_id === project_id);
    if (!project) return fail('NOT_FOUND', 'Proyek tidak ditemukan.');
    const allTransactions = rows_(spreadsheetId, 'transactions', TRANSACTION_FIELDS_);
    const allPayments = rows_(spreadsheetId, 'payment_details', PAYMENT_FIELDS_);
    if (new Set(allTransactions.map(row => row.transaction_id)).size !== allTransactions.length ||
        new Set(allPayments.map(row => row.payment_detail_id)).size !== allPayments.length) {
      return fail('TEMPORARY_FAILURE', 'ID transaksi atau pembayaran ganda. Periksa data sumber.');
    }
    const transactions = allTransactions.filter(row => row.project_id === project_id);
    const ids = new Set(transactions.map(row => row.transaction_id));
    const payments = allPayments.filter(row => ids.has(row.transaction_id));
    const digest = requestDigest_([action, project_id, payload]);
    if (save) {
      const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status'])
        .find(row => row.request_id === request_id);
      if (previous) {
        if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest || previous.status !== 'COMPLETED') {
          return fail('CONFLICT', 'ID permintaan sudah digunakan.');
        }
        return ok(JSON.parse(previous.result_ref));
      }
    }
    const versions = rows_(spreadsheetId, 'budget_versions', BUDGET_VERSION_FIELDS_).filter(row => row.project_id === project_id);
    const categories = rows_(spreadsheetId, 'budget_categories', BUDGET_CATEGORY_FIELDS_)
      .filter(row => versions.some(version => version.budget_version_id === row.budget_version_id));
    const items = rows_(spreadsheetId, 'budget_items', BUDGET_ITEM_FIELDS_).filter(row =>
      categories.some(category => category.budget_category_id === row.budget_category_id)).map(row => {
      const category = categories.find(category => category.budget_category_id === row.budget_category_id);
      const version = versions.find(version => version.budget_version_id === category.budget_version_id);
      return {...row, budget_version_id: version.budget_version_id, version_no: version.version_no, version_status: version.status,
        is_current: version.status === 'APPROVED' && version.budget_version_id === project.active_budget_version_id};
    });
    const activities = rows_(spreadsheetId, 'activities', ['activity_id', 'project_id', 'title']).filter(row => row.project_id === project_id);
    const assignments = rows_(spreadsheetId, 'project_people', ['project_id', 'person_id']).filter(row => row.project_id === project_id);
    const participants = rows_(spreadsheetId, 'activity_participants', ['activity_id', 'person_id'])
      .filter(row => activities.some(activity => activity.activity_id === row.activity_id));
    const allowedPeople = new Set([...assignments, ...participants].map(row => row.person_id));
    const knownPayees = new Set(payments.map(row => row.payee_id));
    const allPayees = rows_(spreadsheetId, 'payees', ['payee_id', 'payee_kind', 'person_id', 'legal_name']);
    const choices = allPayees.filter(row => uuid(row.payee_id) && budgetText_(row.legal_name, 240) &&
      ['PERSON', 'ORGANIZATION', 'GROUP'].includes(row.payee_kind) &&
      (role === 'OWNER' || allowedPeople.has(row.person_id) || knownPayees.has(row.payee_id)));
    const canWrite = ['OWNER', 'EDITOR'].includes(role) && ['DRAFT', 'ACTIVE'].includes(project.status);
    const assessments = rows_(spreadsheetId, 'tax_assessments', ['payment_detail_id']);
    const receipts = rows_(spreadsheetId, 'receipts', ['payment_detail_id']);
    const distributions = rows_(spreadsheetId, 'distributions', ['transaction_id']);
    const locked = transaction => distributions.some(row => row.transaction_id === transaction.transaction_id) ||
      payments.filter(row => row.transaction_id === transaction.transaction_id).some(payment =>
        [...assessments, ...receipts].some(row => row.payment_detail_id === payment.payment_detail_id));
    if (!save) {
      let draftTotal = 0;
      let confirmedTotal = 0;
      const result = [];
      for (const transaction of transactions) {
        const rows = payments.filter(row => row.transaction_id === transaction.transaction_id);
        const amounts = transactionPayments_(rows, true);
        if (!amounts) return fail('TEMPORARY_FAILURE', 'Nominal pembayaran tersimpan tidak konsisten.');
        if (transaction.status === 'DRAFT') draftTotal += amounts.totals.receipt_amount;
        if (transaction.status === 'CONFIRMED') confirmedTotal += amounts.totals.receipt_amount;
        if (!Number.isSafeInteger(draftTotal) || !Number.isSafeInteger(confirmedTotal)) return fail('TEMPORARY_FAILURE', 'Total rupiah melampaui batas integer aman.');
        result.push({...transaction, totals: amounts.totals, can_edit: canWrite && transaction.status === 'DRAFT' && !locked(transaction),
          budget_version_no: items.find(item => item.budget_item_id === transaction.budget_item_id)?.version_no || null,
          budget_item_label: items.find(item => item.budget_item_id === transaction.budget_item_id)?.label || '',
          activity_title: activities.find(row => row.activity_id === transaction.activity_id)?.title || '',
          payments: rows.map(payment => ({...payment, legal_name: allPayees.find(row => row.payee_id === payment.payee_id)?.legal_name || 'Penerima tidak tersedia'}))});
      }
      return ok({transactions: result.sort((a, b) => b.payment_date.localeCompare(a.payment_date) || a.transaction_id.localeCompare(b.transaction_id)),
        budget_items: items.filter(row => row.is_current || transactions.some(transaction => transaction.budget_item_id === row.budget_item_id))
          .map(({budget_item_id, label, version_no, is_current}) => ({budget_item_id, label, version_no, is_current})),
        activities: activities.map(({activity_id, title}) => ({activity_id, title})),
        payees: choices.map(({payee_id, payee_kind, legal_name}) => ({payee_id, payee_kind, legal_name})),
        can_write: canWrite, can_create: canWrite && items.some(row => row.is_current), draft_total_amount: draftTotal, confirmed_total_amount: confirmedTotal,
        can_manage_attachments: PropertiesService.getScriptProperties().getProperty('ATTACHMENTS_ENABLED') === 'true' && role !== 'VIEWER',
        can_preview_taxes: PropertiesService.getScriptProperties().getProperty('TAXES_ENABLED') === 'true' && role !== 'VIEWER'});
    }
    if (!canWrite) return fail('VALIDATION_ERROR', 'Transaksi hanya dapat disimpan pada proyek draf atau aktif.');
    const before = edit ? transactions.find(row => row.transaction_id === payload.transaction_id) : null;
    if (edit && !before) return fail('NOT_FOUND', 'Transaksi tidak ditemukan dalam proyek ini.');
    if (edit && (before.status !== 'DRAFT' || before.row_version !== payload.expected_row_version || locked(before))) {
      return fail('CONFLICT', 'Transaksi sudah berubah, terverifikasi, atau tertaut dokumen. Muat ulang sebelum menyunting.');
    }
    const oldPayments = edit ? payments.filter(row => row.transaction_id === before.transaction_id) : [];
    if (edit && (!payload.expected_payment_versions || typeof payload.expected_payment_versions !== 'object' ||
        Array.isArray(payload.expected_payment_versions) || Object.keys(payload.expected_payment_versions).length !== oldPayments.length ||
        oldPayments.some(row => payload.expected_payment_versions[row.payment_detail_id] !== row.row_version))) {
      return fail('CONFLICT', 'Rincian pembayaran sudah berubah. Muat ulang transaksi.');
    }
    const item = items.find(row => row.budget_item_id === input.budget_item_id);
    if (!item || (!item.is_current && (!before || before.budget_item_id !== item.budget_item_id || !['APPROVED', 'SUPERSEDED'].includes(item.version_status)))) {
      return fail('VALIDATION_ERROR', 'Pilih item RAB aktif yang sudah disahkan dalam proyek ini.');
    }
    if (input.activity_id && !activities.some(row => row.activity_id === input.activity_id)) return fail('NOT_FOUND', 'Kegiatan tidak ditemukan dalam proyek ini.');
    if (calculated.payments.some(payment => choices.filter(row => row.payee_id === payment.payee_id).length !== 1)) {
      return fail('FORBIDDEN', 'Ada penerima yang tidak tersedia untuk proyek ini.');
    }
    const retained = calculated.payments.filter(row => row.payment_detail_id !== undefined).map(row => row.payment_detail_id);
    if (new Set(retained).size !== retained.length || retained.some(id => !uuid(id) || !oldPayments.some(row => row.payment_detail_id === id))) {
      return fail('VALIDATION_ERROR', 'ID rincian pembayaran tidak sesuai dengan transaksi.');
    }
    const time = new Date().toISOString();
    const stamp = {row_version: 1, created_at: time, updated_at: time};
    const transactionId = edit ? before.transaction_id : Utilities.getUuid();
    const value = {budget_item_id: input.budget_item_id, activity_id: input.activity_id || '', payment_date: input.payment_date,
      expense_kind: input.expense_kind, description: input.description.trim(), status: 'DRAFT', row_version: edit ? before.row_version + 1 : 1, updated_at: time};
    const adds = {};
    const updates = edit ? [['transactions', transactionId, value]] : [];
    if (!edit) adds.transactions = [{transaction_id: transactionId, project_id, ...stamp, ...value}];
    const newPayments = [];
    const afterPayments = [];
    for (const payment of calculated.payments) {
      const old = oldPayments.find(row => row.payment_detail_id === payment.payment_detail_id);
      const data = {...payment, row_version: old ? old.row_version + 1 : 1, updated_at: time};
      if (old) updates.push(['payment_details', old.payment_detail_id, data]);
      else newPayments.push({payment_detail_id: Utilities.getUuid(), transaction_id: transactionId, ...stamp, ...data});
      afterPayments.push(old ? {...old, ...data} : newPayments[newPayments.length - 1]);
    }
    if (newPayments.length) adds.payment_details = newPayments;
    const deletes = oldPayments.filter(row => !retained.includes(row.payment_detail_id)).map(row => ['payment_details', row.payment_detail_id]);
    const result = {transaction_id: transactionId, status: 'DRAFT', row_version: value.row_version, totals: calculated.totals};
    adds.audit_log = [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action, entity_type: 'transaction',
      entity_id: transactionId, occurred_at: time, change_summary: JSON.stringify({before, before_payments: oldPayments, after: value, after_payments: afterPayments})}];
    adds.mutation_requests = [{request_id, user_id: user.user_id, action, payload_digest: digest, result_ref: JSON.stringify(result), status: 'COMPLETED', ...stamp}];
    budgetBatch_(spreadsheetId, adds, updates, deletes);
    return ok(result);
  } finally {
    lock.releaseLock();
  }
}
