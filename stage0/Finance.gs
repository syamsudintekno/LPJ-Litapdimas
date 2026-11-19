function financeContext_(spreadsheetId, projectId) {
  const stages = opRows_(spreadsheetId, 'report_stages', ['report_stage_id', 'project_id', 'sequence_no', 'label', 'target_bps', 'cutoff_date', 'status', 'row_version']).filter(row => row.project_id === projectId).sort((a, b) => a.sequence_no - b.sequence_no);
  const transactions = opRows_(spreadsheetId, 'transactions', TRANSACTION_FIELDS_).filter(row => row.project_id === projectId);
  const payments = opRows_(spreadsheetId, 'payment_details', PAYMENT_FIELDS_).filter(row => transactions.some(tx => tx.transaction_id === row.transaction_id));
  const assessments = opRows_(spreadsheetId, 'tax_assessments', TAX_ASSESSMENT_FIELDS_).filter(row => payments.some(payment => payment.payment_detail_id === row.payment_detail_id));
  const payees = opRows_(spreadsheetId, 'payees', ['payee_id', 'person_id', 'legal_name', 'payee_kind']);
  const remittances = opRows_(spreadsheetId, 'tax_remittances', REMITTANCE_FIELDS_).filter(row => row.project_id === projectId);
  const allAllocations = opRows_(spreadsheetId, 'tax_remittance_allocations', ALLOCATION_FIELDS_);
  const allocations = allAllocations.filter(row => remittances.some(remittance => remittance.tax_remittance_id === row.tax_remittance_id));
  if (allocations.some(row => !assessments.some(assessment => assessment.tax_assessment_id === row.tax_assessment_id)) ||
      allAllocations.some(row => assessments.some(assessment => assessment.tax_assessment_id === row.tax_assessment_id) && !remittances.some(remittance => remittance.tax_remittance_id === row.tax_remittance_id))) throw new Error('Alokasi setoran lintas proyek atau tanpa induk.');
  for (const remittance of remittances) {
    if (!Number.isSafeInteger(remittance.amount) || remittance.amount < 1 || opSum_(allocations.filter(row => row.tax_remittance_id === remittance.tax_remittance_id)) !== remittance.amount) throw new Error('Total alokasi setoran tidak konsisten.');
  }
  const outstanding = assessments.map(assessment => {
    const payment = payments.find(row => row.payment_detail_id === assessment.payment_detail_id), tx = transactions.find(row => row.transaction_id === payment.transaction_id);
    const allocated = opSum_(allocations.filter(row => row.tax_assessment_id === assessment.tax_assessment_id));
    if (!Number.isSafeInteger(assessment.amount) || assessment.amount < 0 || allocated > assessment.amount) throw new Error('Potongan atau setoran tidak konsisten.');
    return {tax_assessment_id: assessment.tax_assessment_id, payment_detail_id: payment.payment_detail_id, transaction_id: tx.transaction_id,
      tax_kind: assessment.tax_kind, payee_name: payees.find(row => row.payee_id === payment.payee_id)?.legal_name || 'Penerima',
      description: tx.description, payment_date: tx.payment_date, amount: assessment.amount, allocated_amount: allocated,
      remaining_amount: assessment.amount - allocated, row_version: assessment.row_version,
      can_allocate: tx.status === 'CONFIRMED' && assessment.status === 'VERIFIED' && assessment.tax_treatment === 'WITHHELD' && payment.withheld_tax_amount === assessment.amount && assessment.amount > allocated};
  });
  const disbursements = opRows_(spreadsheetId, 'disbursements', DISBURSEMENT_FIELDS_).filter(row => stages.some(stage => stage.report_stage_id === row.report_stage_id));
  opSum_(disbursements, 'received_amount');
  return {stages, transactions, payments, assessments, remittances, allocations, outstanding, disbursements};
}
function financeList_(spreadsheetId, request, role) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return failure_(request.request_id, 'TEMPORARY_FAILURE', 'Keuangan sedang diproses.');
  try {
    const project = rows_(spreadsheetId, 'projects', ['project_id', 'status']).find(row => row.project_id === request.project_id);
    if (!project) return failure_(request.request_id, 'NOT_FOUND', 'Proyek tidak ditemukan.');
    const context = financeContext_(spreadsheetId, request.project_id);
    const activities = rows_(spreadsheetId, 'activities', ['activity_id', 'project_id', 'title']).filter(row => row.project_id === request.project_id);
    const people = rows_(spreadsheetId, 'people', ['person_id', 'display_name']);
    const participants = rows_(spreadsheetId, 'activity_participants', PARTICIPANT_FIELDS_).filter(row => activities.some(activity => activity.activity_id === row.activity_id));
    const distributions = rows_(spreadsheetId, 'distributions', DISTRIBUTION_FIELDS_).filter(row => participants.some(person => person.activity_participant_id === row.activity_participant_id))
      .map(row => {const person = participants.find(person => person.activity_participant_id === row.activity_participant_id); return {...row,
        person_name: people.find(item => item.person_id === person.person_id)?.display_name || 'Peserta', activity_id: person.activity_id,
        activity_title: activities.find(activity => activity.activity_id === person.activity_id)?.title || ''};});
    const attachments = role === 'OWNER' ? rows_(spreadsheetId, 'attachments', ATTACHMENT_FIELDS_).filter(row => row.project_id === request.project_id) : [];
    return {ok: true, request_id: request.request_id, data: {stages: context.stages, disbursements: context.disbursements, remittances: context.remittances,
      allocations: context.allocations, outstanding: context.outstanding, distributions, attachments,
      transactions: context.transactions.filter(row => row.status === 'CONFIRMED'), can_write: role === 'OWNER' && project.status === 'ACTIVE',
      received_total_amount: opSum_(context.disbursements, 'received_amount'), remitted_total_amount: opSum_(context.remittances)}};
  } finally {lock.releaseLock();}
}
function financeWrite_(spreadsheetId, user, request) {
  return opMutation_(spreadsheetId, user, request, ({project, stamp, time}) => {
    const p = request.payload, projectId = request.project_id;
    if (project.status !== 'ACTIVE') return opError_('Aktifkan proyek sebelum mencatat keuangan.', 'CONFLICT');
    const context = financeContext_(spreadsheetId, projectId);
    const proof = (id, kind) => {
      const row = rows_(spreadsheetId, 'attachments', ATTACHMENT_FIELDS_).find(row => row.attachment_id === id && row.project_id === projectId && row.attachment_kind === kind && !row.transaction_id);
      if (!row) return null;
      try {return {attachment: row, file: evidenceFile_(projectId, row.drive_file_id)};} catch {return null;}
    };
    if (request.action === 'disbursements.save') {
      const stage = context.stages.find(row => row.report_stage_id === p.report_stage_id);
      if (!stage || !validProjectDate_(p.received_date) || !Number.isSafeInteger(p.received_amount) || p.received_amount < 1) return opError_('Pilih tahap, tanggal dan nominal penerimaan yang valid.');
      if (stage.status !== 'DRAFT' || stage.row_version !== p.expected_stage_row_version) return opError_('Tahap berubah atau telah final. Muat ulang sebelum menyimpan.', 'CONFLICT');
      const evidence = proof(p.attachment_id, 'DISBURSEMENT_PROOF');
      if (!evidence) return opError_('Unggah bukti penerimaan yang privat pada proyek ini.');
      const before = p.disbursement_id ? context.disbursements.find(row => row.disbursement_id === p.disbursement_id) : null;
      if (p.disbursement_id && (!before || before.row_version !== p.expected_row_version || !budgetText_(p.correction_reason, 1000))) return opError_('Koreksi memerlukan versi terbaru dan alasan.', 'CONFLICT');
      const id = before?.disbursement_id || Utilities.getUuid();
      if (context.disbursements.some(row => row.attachment_id === p.attachment_id && row.disbursement_id !== id)) return opError_('Bukti penerimaan sudah dipakai.');
      const value = {report_stage_id: stage.report_stage_id, received_date: p.received_date, received_amount: p.received_amount,
        attachment_id: p.attachment_id, row_version: (before?.row_version || 0) + 1, updated_at: time};
      opSum_([...context.disbursements.filter(row => row.disbursement_id !== id), value], 'received_amount');
      return {data: {disbursement_id: id, row_version: value.row_version}, entity_id: id, audit: {before, after: value, reason: p.correction_reason || '', evidence},
        adds: before ? {} : {disbursements: [{disbursement_id: id, ...stamp, ...value}]}, updates: before ? [['disbursements', id, value]] : []};
    }
    if (request.action === 'tax_remittances.save') {
      if (!validProjectDate_(p.paid_at) || !Number.isSafeInteger(p.amount) || p.amount < 1 || !Array.isArray(p.allocations) || !p.allocations.length || p.allocations.length > 100 || p.allocations.some(row => !row || typeof row !== 'object') ||
          new Set(p.allocations.map(row => row.tax_assessment_id)).size !== p.allocations.length || p.allocations.some(row => !Number.isSafeInteger(row.amount) || row.amount < 1) || opSum_(p.allocations) !== p.amount) return opError_('Total alokasi harus sama dengan nominal setoran rupiah utuh.');
      const evidence = proof(p.attachment_id, 'TAX_REMITTANCE_PROOF');
      if (!evidence || context.remittances.some(row => row.attachment_id === p.attachment_id)) return opError_('Unggah bukti setoran privat yang belum dipakai.');
      for (const allocation of p.allocations) {
        const row = context.outstanding.find(row => row.tax_assessment_id === allocation.tax_assessment_id);
        if (!row || !row.can_allocate || row.row_version !== allocation.expected_row_version || allocation.amount > row.remaining_amount) return opError_('Potongan atau sisa setoran berubah. Muat ulang alokasi.', 'CONFLICT');
      }
      const id = Utilities.getUuid();
      const remittance = {tax_remittance_id: id, project_id: projectId, paid_at: p.paid_at, amount: p.amount, attachment_id: p.attachment_id, ...stamp};
      opSum_([...context.remittances, remittance]);
      return {data: {tax_remittance_id: id, amount: p.amount}, entity_id: id, audit: {remittance, allocations: p.allocations, evidence},
        adds: {tax_remittances: [remittance], tax_remittance_allocations: p.allocations.map(row => ({tax_remittance_allocation_id: Utilities.getUuid(),
          tax_remittance_id: id, tax_assessment_id: row.tax_assessment_id, amount: row.amount, ...stamp}))}};
    }
    if (request.action === 'distributions.link') {
      const row = rows_(spreadsheetId, 'distributions', DISTRIBUTION_FIELDS_).find(row => row.distribution_id === p.distribution_id);
      const participant = row && rows_(spreadsheetId, 'activity_participants', PARTICIPANT_FIELDS_).find(person => person.activity_participant_id === row.activity_participant_id);
      const activity = participant && rows_(spreadsheetId, 'activities', ['activity_id', 'project_id']).find(item => item.activity_id === participant.activity_id && item.project_id === projectId);
      const tx = context.transactions.find(tx => tx.transaction_id === p.transaction_id);
      if (!activity || !tx || tx.activity_id !== activity.activity_id || tx.status !== 'CONFIRMED' || tx.expense_kind !== {TRANSPORT: 'TRANSPORT', CONSUMPTION: 'CONSUMPTION', SNACK: 'SNACK'}[row.distribution_kind] || row.quantity < 1) return opError_('Pilih transaksi terkonfirmasi dengan kegiatan dan jenis distribusi yang sama.');
      if (row.row_version !== p.expected_row_version || (row.transaction_id && row.transaction_id !== p.transaction_id)) return opError_('Distribusi berubah atau sudah tertaut ke transaksi lain.', 'CONFLICT');
      const payees = rows_(spreadsheetId, 'payees', ['payee_id', 'person_id', 'payee_kind']);
      if (!context.payments.some(payment => payment.transaction_id === tx.transaction_id && payees.some(payee => payee.payee_id === payment.payee_id &&
          (payee.person_id === participant.person_id || ['GROUP', 'ORGANIZATION'].includes(payee.payee_kind))))) return opError_('Peserta atau vendor distribusi belum tercakup pada pembayaran transaksi.');
      return {data: {distribution_id: row.distribution_id, transaction_id: tx.transaction_id, row_version: row.row_version + 1}, entity_id: row.distribution_id,
        audit: {before: row, transaction_id: tx.transaction_id}, updates: [['distributions', row.distribution_id, {transaction_id: tx.transaction_id, row_version: row.row_version + 1, updated_at: time}]]};
    }
    return opError_('Tindakan keuangan tidak dikenal.');
  });
}
