const PACKAGE_TEMPLATE_ = 'LPJ_PACKAGE_V1';
function finalPackage_(spreadsheetId, request) {
  const report = stageReport_(spreadsheetId, {...request, payload: {document_kind: 'STAGE_REALIZATION', report_stage_id: request.payload.report_stage_id}}, true);
  if (!report.ok) return {error: report.error.code, message: report.error.message};
  delete report.data.generated_at;
  const projectId = request.project_id, cutoff = report.data.stage.cutoff_date, blockers = [], files = new Map();
  if (report.data.excluded.draft_count) blockers.push('Masih ada transaksi draf sampai tanggal batas. Konfirmasi atau koreksi cakupannya sebelum finalisasi.');
  const people = rows_(spreadsheetId, 'people', ['person_id', 'display_name', 'nip', 'nim']);
  const assignments = rows_(spreadsheetId, 'project_people', ['person_id', 'project_id', 'assignment_role']).filter(row => row.project_id === projectId);
  const signers = assignments.map(row => ({assignment_role: row.assignment_role, ...people.find(person => person.person_id === row.person_id)}));
  for (const role of REQUIRED_PROJECT_ROLES_) if (signers.filter(row => row.assignment_role === role && budgetText_(row.display_name, 240)).length !== 1) blockers.push('Penandatangan belum lengkap: ' + role);
  const receipts = receiptRows_(spreadsheetId, projectId), receiptDocuments = [];
  for (const tx of report.data.transactions) {
    const context = transactionConfirmationContext_(spreadsheetId, projectId, tx.transaction_id, 'FINAL');
    if (!context) {blockers.push('Transaksi sumber tidak ditemukan.'); continue;}
    blockers.push(...context.blockers);
    for (const detail of context.details) {
      const receipt = receipts.find(row => row.payment_detail_id === detail.payment.payment_detail_id && row.status === 'ISSUED');
      if (!receipt) blockers.push((detail.payee?.legal_name || 'Pembayaran') + ': terbitkan kwitansi sebelum finalisasi.');
      else receiptDocuments.push(receiptDocument_(receipt));
      if (detail.proof && detail.file) files.set(detail.proof.drive_file_id, {drive_file_id: detail.proof.drive_file_id, name: detail.file.name, modified_at: detail.file.modified_at});
    }
  }
  const finance = financeContext_(spreadsheetId, projectId);
  const income = finance.disbursements.filter(row => row.received_date <= cutoff);
  const remittances = finance.remittances.filter(row => row.paid_at <= cutoff);
  const attachments = rows_(spreadsheetId, 'attachments', ATTACHMENT_FIELDS_).filter(row => row.project_id === projectId);
  for (const proof of attachments.filter(row => report.data.transactions.some(tx => tx.transaction_id === row.transaction_id))) {
    try {const file = evidenceFile_(projectId, proof.drive_file_id); files.set(proof.drive_file_id, {drive_file_id: proof.drive_file_id, name: file.name, modified_at: file.modified_at});}
    catch {blockers.push('Ada lampiran transaksi yang tidak tersedia atau tidak privat.');}
  }
  for (const row of [...income, ...remittances]) {
    const proof = attachments.find(item => item.attachment_id === row.attachment_id);
    try {
      if (!proof) throw new Error();
      const file = evidenceFile_(projectId, proof.drive_file_id);
      files.set(proof.drive_file_id, {drive_file_id: proof.drive_file_id, name: file.name, modified_at: file.modified_at});
    } catch {blockers.push('Bukti penerimaan atau setoran tidak tersedia.');}
  }
  const activities = rows_(spreadsheetId, 'activities', ACTIVITY_FIELDS_).filter(row => row.project_id === projectId && row.activity_date <= cutoff);
  const activityDocuments = [];
  for (const activity of activities) {
    const result = activityReport_(spreadsheetId, {...request, payload: {document_kind: 'ACTIVITY_PACKAGE', activity_id: activity.activity_id}}, true);
    if (!result.ok) {blockers.push(result.error.message); continue;}
    delete result.data.generated_at;
    if (result.data.participants.some(row => row.attendance_status === 'UNRECORDED' || row.display_name === 'Personel tidak tersedia')) blockers.push(activity.title + ': kehadiran atau identitas peserta belum lengkap.');
    activityDocuments.push(result.data);
  }
  const logbook = rows_(spreadsheetId, 'logbook_entries', LOGBOOK_FIELDS_).filter(row => row.project_id === projectId && row.entry_date <= cutoff);
  const assessmentIds = new Set(finance.outstanding.filter(row => report.data.transactions.some(tx => tx.transaction_id === row.transaction_id)).map(row => row.tax_assessment_id));
  const relevantAllocations = finance.allocations.filter(row => assessmentIds.has(row.tax_assessment_id) && remittances.some(item => item.tax_remittance_id === row.tax_remittance_id));
  // Final stage requires every included withholding to have been remitted by its cutoff.
  if (report.data.stage.target_bps === 10000) for (const row of finance.outstanding.filter(row => assessmentIds.has(row.tax_assessment_id))) {
    if (opSum_(relevantAllocations.filter(item => item.tax_assessment_id === row.tax_assessment_id)) !== row.amount) blockers.push(row.payee_name + ': setoran pajak sampai tanggal batas belum lengkap.');
  }
  const document = {template_version: PACKAGE_TEMPLATE_, report: report.data, signers, receipts: receiptDocuments, activities: activityDocuments, logbook,
    disbursements: income, remittances, allocations: relevantAllocations, evidence: [...files.values()].sort((a, b) => a.drive_file_id.localeCompare(b.drive_file_id))};
  return {document, blockers: [...new Set(blockers)]};
}
function escapeHtml_(value) {return String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));}
function packageHtml_(doc) {
  const e = escapeHtml_, money = value => 'Rp ' + String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const table = (headers, rows) => '<table><thead><tr>' + headers.map(x => '<th>' + e(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(x => '<td>' + e(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const report = doc.report;
  let html = (doc.finalized_at ? '<p>Arsip final versi ' + e(doc.version_no) + ' · ' + e(doc.finalized_at) + '</p>' : '<p><strong>DRAF PRATINJAU — BELUM DIFINALKAN</strong></p>') + '<h1>Laporan Pertanggungjawaban</h1><h2>' + e(report.project.title) + '</h2><p>Tahun anggaran ' + e(report.project.fiscal_year) + ' · ' + e(report.stage.label) + ' · Batas ' + e(report.stage.cutoff_date) + '</p>';
  html += '<h2>Realisasi kumulatif</h2>' + table(['Plafon', 'Target', 'Bruto', 'Potongan', 'Netto'], [[money(report.project.official_ceiling_amount), money(report.target_amount), money(report.totals.receipt_amount), money(report.totals.withheld_tax_amount), money(report.totals.net_paid_amount)]]);
  html += table(['Tanggal', 'Pembayaran', 'Item RAB', 'Bruto', 'Pajak', 'Netto'], report.transactions.map(row => [row.payment_date, row.description, row.budget_item_label + ' (v' + row.budget_version_no + ')', money(row.receipt_amount), money(row.withheld_tax_amount), money(row.net_paid_amount)]));
  html += '<h2>Penerimaan dana aktual</h2>' + table(['Tanggal', 'Jumlah diterima'], doc.disbursements.map(row => [row.received_date, money(row.received_amount)]));
  html += '<h2>Setoran pajak</h2>' + table(['Tanggal', 'Jumlah disetor'], doc.remittances.map(row => [row.paid_at, money(row.amount)]));
  html += '<h2>Personel LPJ</h2>' + table(['Peran', 'Nama', 'NIP/NIM'], doc.signers.map(row => [row.assignment_role, row.display_name, row.nip || row.nim || '']));
  html += '<h2>Logbook penelitian</h2>' + table(['Tanggal', 'Uraian', 'Hasil'], doc.logbook.map(row => [row.entry_date, row.description, row.result]));
  for (const item of doc.activities) {
    html += '<section><h2>' + e(item.activity.title) + '</h2><p>' + e(item.activity.activity_date) + ' · ' + e(item.activity.location) + '</p><h3>Rundown</h3>';
    html += table(['Mulai', 'Selesai', 'Sesi', 'Pembicara'], item.agenda.map(row => [row.start_time, row.end_time, row.title, row.speaker_display_name]));
    html += '<h3>Daftar hadir</h3>' + table(['Nama', 'Unit', 'Kehadiran', 'Tanda tangan'], item.participants.map(row => [row.display_name, row.unit_name, {PRESENT: 'Hadir', ABSENT: 'Tidak hadir', UNRECORDED: 'Belum dicatat'}[row.attendance_status], '']));
    for (const group of item.distributions) html += '<h3>' + e({SNACK: 'Daftar snack', CONSUMPTION: 'Daftar konsumsi', TRANSPORT: 'Daftar transport'}[group.distribution_kind]) + '</h3>' + table(['Nama', 'Jumlah unit', 'Diterima', 'Tanda tangan'], group.rows.map(row => [row.display_name, row.quantity, row.received_at, '']));
    html += '</section>';
  }
  for (const {receipt, document: r} of doc.receipts) html += '<section class="receipt"><h2>Kwitansi Pembayaran</h2><p>Nomor ' + e(receipt.receipt_no) + '</p><p>' + e(r.project.title) + '</p>' +
    table(['Penerima', 'Untuk pembayaran', 'Tanggal'], [[r.payment.legal_name, r.transaction.description, r.transaction.payment_date]]) +
    table(['Bruto', 'Potongan', 'Diterima'], [[money(r.payment.receipt_amount), money(r.payment.withheld_tax_amount), money(r.payment.net_paid_amount)]]) +
    '<p>Terbilang: ' + e(r.payment.amount_in_words) + '</p><div class="signatures"><div>PPK<br><br><br><br>' + e(r.signers.ppk.display_name) + '<br>' + e(r.signers.ppk.nip) + '</div><div>Bendahara Pengeluaran<br><br><br><br>' + e(r.signers.treasurer.display_name) + '<br>' + e(r.signers.treasurer.nip) + '</div><div>Penerima<br><br><br><br>' + e(r.payment.legal_name) + '</div></div></section>';
  html += '<h2>Daftar bukti arsip</h2>' + table(['Nama', 'Hash SHA-256'], doc.evidence.map(row => [row.name, row.digest || 'Salinan dibuat saat finalisasi']));
  return '<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:16mm}body{font:10pt Arial;color:#111}h1{font-size:20pt}h2{font-size:14pt;margin-top:20pt}h3{font-size:11pt}table{border-collapse:collapse;width:100%;margin:12pt 0;table-layout:fixed}th,td{border:1px solid #777;padding:6pt;vertical-align:top;word-wrap:break-word;white-space:pre-wrap}thead{display:table-header-group}tr{page-break-inside:avoid}section{page-break-before:always}.signatures{display:table;width:100%;page-break-inside:avoid;margin-top:22pt}.signatures>div{display:table-cell;width:33%;text-align:center}p{white-space:pre-wrap}</style></head><body>' + html + '</body></html>';
}
function archiveRpc_(spreadsheetId, user, request, role) {
  const {action, payload: p, request_id, project_id} = request;
  if (['reports.package_preview', 'reports.finalize'].includes(action) && !opUuid_(p?.report_stage_id)) return failure_(request_id, 'VALIDATION_ERROR', 'Pilih tahap paket yang valid.');
  if (action === 'reports.finalize') return opMutation_(spreadsheetId, user, request, ({time, stamp, project}) => {
    if (project.status !== 'ACTIVE' || p.format_approved !== true || !opUuid_(p.preview_token)) return opError_('Periksa format dokumen dan proyek aktif sebelum finalisasi.');
    const prepared = finalPackage_(spreadsheetId, request);
    if (prepared.error) return prepared;
    const binding = requestDigest_([user.user_id, project_id, prepared]);
    if (prepared.blockers.length || CacheService.getScriptCache().get('package:' + p.preview_token) !== binding) return opError_('Sumber, bukti, atau pratinjau berubah. Muat ulang paket.', 'CONFLICT');
    const old = rows_(spreadsheetId, 'final_documents', FINAL_FIELDS_).filter(row => row.project_id === project_id && row.report_stage_id === p.report_stage_id && row.document_kind === 'STAGE_PACKAGE');
    const version = old.reduce((max, row) => Math.max(max, row.version_no), 0) + 1;
    const folder = privateChild_(managedFolder_(spreadsheetId, project_id, 'Arsip'), request_id);
    const operation = JSON.parse(operationFile_(folder, 'operation.json', Utilities.newBlob(JSON.stringify({time, version, binding}), 'application/json')).getBlob().getDataAsString());
    if (operation.binding !== binding || operation.version !== version) return opError_('Operasi arsip tidak lagi cocok dengan sumber. Buat pratinjau baru.', 'CONFLICT');
    const doc = {...prepared.document, finalized_at: operation.time, version_no: version, finalized_by_user_id: user.user_id};
    for (const row of doc.evidence) {
      const source = DriveApp.getFileById(row.drive_file_id);
      if (source.getLastUpdated().toISOString() !== row.modified_at) return opError_('Bukti berubah saat penyalinan. Tinjau paket kembali.', 'CONFLICT');
      const blob = source.getBlob(), digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes()));
      const copy = operationFile_(folder, row.drive_file_id + '-' + row.name, blob);
      if (Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, copy.getBlob().getBytes())) !== digest) return opError_('Salinan bukti berbeda.', 'CONFLICT');
      row.archived_drive_file_id = copy.getId(); row.digest = digest;
    }
    // Recheck the complete source after copying, before publishing metadata.
    const latest = finalPackage_(spreadsheetId, request);
    if (latest.error || requestDigest_([user.user_id, project_id, latest]) !== binding) return opError_('Sumber berubah saat pengarsipan. Tinjau ulang paket.', 'CONFLICT');
    const json = JSON.stringify(doc), digest = requestDigest_(doc);
    const snapshot = operationFile_(folder, 'snapshot.json', Utilities.newBlob(json, 'application/json'));
    if (requestDigest_(JSON.parse(snapshot.getBlob().getDataAsString())) !== digest) return opError_('Snapshot operasi berbeda.', 'CONFLICT');
    const pdf = operationFile_(folder, 'LPJ-v' + version + '.pdf', HtmlService.createHtmlOutput(packageHtml_(doc)).getAs(MimeType.PDF));
    const id = Utilities.getUuid(), row = {final_document_id: id, project_id, report_stage_id: p.report_stage_id, document_kind: 'STAGE_PACKAGE', version_no: version,
      template_version: PACKAGE_TEMPLATE_, pdf_drive_file_id: pdf.getId(), snapshot_drive_file_id: snapshot.getId(), finalized_by_user_id: user.user_id, finalized_at: operation.time, snapshot_digest: digest,
      pdf_digest: Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pdf.getBlob().getBytes())), ...stamp};
    return {data: {final_document_id: id, version_no: version, finalized_at: operation.time}, entity_id: id, adds: {final_documents: [row]},
      updates: [['report_stages', doc.report.stage.report_stage_id, {status: 'FINALIZED', row_version: doc.report.stage.row_version + 1, updated_at: time}]],
      audit: {final_document_id: id, version_no: version, snapshot_digest: digest, evidence_count: doc.evidence.length, format_approved: true}};
  });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return failure_(request_id, 'TEMPORARY_FAILURE', 'Arsip sedang diproses.');
  try {
    if (action === 'reports.package_preview') {
      const prepared = finalPackage_(spreadsheetId, request);
      if (prepared.error) return failure_(request_id, prepared.error, prepared.message);
      const token = Utilities.getUuid();
      CacheService.getScriptCache().put('package:' + token, requestDigest_([user.user_id, project_id, prepared]), 600);
      return {ok: true, request_id, data: {...prepared, preview_token: token, html: packageHtml_(prepared.document)}};
    }
    const rows = rows_(spreadsheetId, 'final_documents', FINAL_FIELDS_).filter(row => row.project_id === project_id);
    if (action === 'reports.list_final') return {ok: true, request_id, data: {documents: rows.map(({pdf_drive_file_id, snapshot_drive_file_id, ...row}) => row).sort((a, b) => b.version_no - a.version_no),
      stages: rows_(spreadsheetId, 'report_stages', ['report_stage_id', 'project_id', 'label', 'sequence_no', 'cutoff_date']).filter(row => row.project_id === project_id).sort((a, b) => a.sequence_no - b.sequence_no)}};
    const row = rows.find(row => row.final_document_id === p?.final_document_id);
    if (!row) return failure_(request_id, 'NOT_FOUND', 'Arsip tidak ditemukan dalam proyek.');
    const doc = JSON.parse(DriveApp.getFileById(row.snapshot_drive_file_id).getBlob().getDataAsString());
    if (requestDigest_(doc) !== row.snapshot_digest || doc.report.project.project_id !== project_id || doc.version_no !== row.version_no || doc.template_version !== PACKAGE_TEMPLATE_) throw new Error('Snapshot arsip tidak sesuai metadata.');
    if (action === 'reports.get_final') return {ok: true, request_id, data: {document: doc, html: packageHtml_(doc), final_document_id: row.final_document_id}};
    if (!['SNAPSHOT', 'PDF', 'EVIDENCE'].includes(p.file_kind)) return failure_(request_id, 'VALIDATION_ERROR', 'Pilih jenis unduhan arsip.');
    let blob, name = 'LPJ-' + row.report_stage_id + '-v' + row.version_no;
    if (p.file_kind === 'SNAPSHOT') {blob = Utilities.newBlob(JSON.stringify(doc, null, 2), 'application/json', 'snapshot.json'); name += '.json';}
    else if (p.file_kind === 'EVIDENCE') {
      const proof = doc.evidence.find(item => item.archived_drive_file_id === p.archived_drive_file_id);
      if (!proof) return failure_(request_id, 'NOT_FOUND', 'Bukti tidak ditemukan di snapshot ini.');
      blob = DriveApp.getFileById(proof.archived_drive_file_id).getBlob(); name = proof.name;
      if (Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes())) !== proof.digest) throw new Error('Salinan bukti arsip berubah.');
    } else {
      blob = DriveApp.getFileById(row.pdf_drive_file_id).getBlob(); name += '.pdf';
      if (Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes())) !== row.pdf_digest) throw new Error('PDF arsip berubah; gunakan snapshot untuk mereproduksi dokumen.');
    }
    return {ok: true, request_id, data: {name, mime_type: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes())}};
  } finally {lock.releaseLock();}
}
