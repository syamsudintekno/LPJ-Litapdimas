// Read-only stage preview. Receipt numbers and tax remittances never add realization.
function stageReport_(spreadsheetId, request, alreadyLocked = false) {
  const {request_id, project_id, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  if (PropertiesService.getScriptProperties().getProperty('TRANSACTIONS_ENABLED') !== 'true') return fail('TEMPORARY_FAILURE', 'Rekap transaksi belum diaktifkan.');
  if (payload?.document_kind !== 'STAGE_REALIZATION' || (payload.report_stage_id !== undefined &&
      (typeof payload.report_stage_id !== 'string' || !PROJECT_UUID_.test(payload.report_stage_id)))) return fail('VALIDATION_ERROR', 'Pilih ID tahap laporan yang valid.');
  const lock = LockService.getScriptLock();
  if (!alreadyLocked && !lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Data laporan sedang diproses. Coba lagi.');
  try {
    const read = (name, fields) => rows_(spreadsheetId, name, fields);
    const unique = (rows, key) => {
      if (rows.some(row => typeof row[key] !== 'string' || !PROJECT_UUID_.test(row[key])) || new Set(rows.map(row => row[key])).size !== rows.length) throw new Error('ID sumber laporan tidak konsisten.');
      return rows;
    };
    const projects = unique(read('projects', ['project_id', 'title', 'fiscal_year', 'project_code', 'official_ceiling_amount', 'status', 'row_version']), 'project_id');
    const project = projects.find(row => row.project_id === project_id);
    if (!project) return fail('NOT_FOUND', 'Proyek tidak ditemukan.');
    if (!budgetText_(project.title, 240) || !Number.isSafeInteger(project.official_ceiling_amount) || project.official_ceiling_amount < 1 ||
        !['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(project.status) || !Number.isSafeInteger(project.row_version) || project.row_version < 1) return fail('TEMPORARY_FAILURE', 'Identitas, plafon atau versi proyek belum lengkap.');
    const stages = unique(read('report_stages', ['report_stage_id', 'project_id', 'sequence_no', 'label', 'target_bps', 'cutoff_date', 'status', 'row_version']), 'report_stage_id')
      .filter(row => row.project_id === project_id).sort((a, b) => a.sequence_no - b.sequence_no);
    if (!stages.length || stages.length > 10 || stages.some((row, index) => row.sequence_no !== index + 1 || !budgetText_(row.label, 80) ||
        !Number.isInteger(row.target_bps) || row.target_bps <= (index ? stages[index - 1].target_bps : 0) || row.target_bps > 10000 ||
        !validProjectDate_(row.cutoff_date) || (index > 0 && row.cutoff_date <= stages[index - 1].cutoff_date) ||
        !['DRAFT', 'FINALIZED'].includes(row.status) || !Number.isSafeInteger(row.row_version) || row.row_version < 1) || stages[stages.length - 1].target_bps !== 10000) return fail('TEMPORARY_FAILURE', 'Skema tahap belum lengkap atau tidak konsisten.');
    const stage = payload.report_stage_id ? stages.find(row => row.report_stage_id === payload.report_stage_id) : stages[0];
    if (!stage) return fail('NOT_FOUND', 'Tahap tidak ditemukan dalam proyek ini.');
    // Split before multiplication to preserve integer accuracy near MAX_SAFE_INTEGER.
    const ceiling = project.official_ceiling_amount, remainder = ceiling % 10000;
    const target = ((ceiling - remainder) / 10000) * stage.target_bps + Math.floor((remainder * stage.target_bps + 5000) / 10000);
    const allTransactions = unique(read('transactions', TRANSACTION_FIELDS_), 'transaction_id');
    const transactions = allTransactions.filter(row => row.project_id === project_id);
    if (transactions.some(row => !['DRAFT', 'CONFIRMED', 'VOID'].includes(row.status) || !validProjectDate_(row.payment_date) ||
        !Number.isSafeInteger(row.row_version) || row.row_version < 1)) return fail('TEMPORARY_FAILURE', 'Status, tanggal atau versi transaksi tidak konsisten.');
    const eligible = transactions.filter(row => row.status === 'CONFIRMED' && row.payment_date <= stage.cutoff_date);
    const payments = unique(read('payment_details', PAYMENT_FIELDS_), 'payment_detail_id');
    const versions = unique(read('budget_versions', BUDGET_VERSION_FIELDS_), 'budget_version_id');
    const categories = unique(read('budget_categories', BUDGET_CATEGORY_FIELDS_), 'budget_category_id');
    const items = unique(read('budget_items', BUDGET_ITEM_FIELDS_), 'budget_item_id');
    const totals = {receipt_amount: 0, withheld_tax_amount: 0, added_tax_amount: 0, net_paid_amount: 0};
    const details = [];
    for (const transaction of eligible) {
      const selected = payments.filter(row => row.transaction_id === transaction.transaction_id);
      const amounts = transactionPayments_(selected, true);
      const item = items.find(row => row.budget_item_id === transaction.budget_item_id);
      const category = item && categories.find(row => row.budget_category_id === item.budget_category_id);
      const budget = category && versions.find(row => row.budget_version_id === category.budget_version_id && row.project_id === project_id);
      if (!amounts || !budget || !['APPROVED', 'SUPERSEDED'].includes(budget.status) || !PROJECT_UUID_.test(budget.approved_by_user_id) ||
          !Number.isFinite(Date.parse(budget.approved_at)) || !Number.isSafeInteger(budget.version_no) || budget.version_no < 1 ||
          !budgetText_(item.label, 240) || !budgetText_(transaction.description, 1000)) return fail('TEMPORARY_FAILURE', 'Nominal atau rujukan RAB transaksi terkonfirmasi tidak konsisten.');
      for (const key of Object.keys(totals)) {
        totals[key] += amounts.totals[key];
        if (!Number.isSafeInteger(totals[key])) return fail('TEMPORARY_FAILURE', 'Total laporan melampaui batas rupiah integer aman.');
      }
      details.push({transaction_id: transaction.transaction_id, payment_date: transaction.payment_date, description: transaction.description,
        budget_item_id: item.budget_item_id, budget_item_label: item.label, budget_version_no: budget.version_no,
        transaction_row_version: transaction.row_version, payment_count: selected.length, ...amounts.totals});
    }
    details.sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.transaction_id.localeCompare(b.transaction_id));
    let funding = null;
    if (PropertiesService.getScriptProperties().getProperty('WORKSPACE_READY') === 'true') {
      const finance = financeContext_(spreadsheetId, project_id);
      const remittances = finance.remittances.filter(row => row.paid_at <= stage.cutoff_date);
      const assessments = finance.outstanding.filter(row => details.some(tx => tx.transaction_id === row.transaction_id));
      const allocations = finance.allocations.filter(row => assessments.some(item => item.tax_assessment_id === row.tax_assessment_id) && remittances.some(item => item.tax_remittance_id === row.tax_remittance_id));
      funding = {received_total_amount: opSum_(finance.disbursements.filter(row => row.received_date <= stage.cutoff_date), 'received_amount'),
        remitted_total_amount: opSum_(remittances), unremitted_withheld_amount: opSum_(assessments) - opSum_(allocations)};
    }
    return {ok: true, request_id, data: {document_kind: 'STAGE_REALIZATION', is_final: false, generated_at: new Date().toISOString(),
      project, stages, stage, target_amount: target, totals, transaction_count: details.length,
      target_difference_amount: totals.receipt_amount - target, ceiling_remaining_amount: ceiling - totals.receipt_amount,
      excluded: {draft_count: transactions.filter(row => row.status === 'DRAFT' && row.payment_date <= stage.cutoff_date).length,
        void_count: transactions.filter(row => row.status === 'VOID' && row.payment_date <= stage.cutoff_date).length,
        later_confirmed_count: transactions.filter(row => row.status === 'CONFIRMED' && row.payment_date > stage.cutoff_date).length},
      funding, transactions: details}};
  } finally {if (!alreadyLocked) lock.releaseLock();}
}
