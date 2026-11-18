const ATTACHMENT_FIELDS_ = ['attachment_id', 'project_id', 'activity_id', 'transaction_id', 'attachment_kind', 'drive_file_id', 'row_version'];

function evidenceFolder_(projectId) {
  const folders = JSON.parse(PropertiesService.getScriptProperties().getProperty('EVIDENCE_FOLDERS_JSON') || '{}');
  if (!folders || Array.isArray(folders) || typeof folders !== 'object' ||
      !Object.prototype.hasOwnProperty.call(folders, projectId) ||
      Object.entries(folders).some(([key, value]) => !PROJECT_UUID_.test(key) || typeof value !== 'string' || !/^[\w-]{10,200}$/.test(value)) ||
      new Set(Object.values(folders)).size !== Object.keys(folders).length) throw new Error('Folder bukti belum disiapkan.');
  const folderId = folders[projectId];
  const folder = DriveApp.getFolderById(folderId);
  if (folder.isTrashed() || folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Folder bukti tidak tersedia.');
  return folderId;
}

function evidenceFile_(projectId, fileId) {
  if (typeof fileId !== 'string' || !/^[\w-]{10,200}$/.test(fileId)) throw new Error('ID berkas tidak valid.');
  const folderId = evidenceFolder_(projectId);
  const file = DriveApp.getFileById(fileId);
  if (file.isTrashed() || file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
      !['application/pdf', 'image/jpeg', 'image/png'].includes(file.getMimeType()) || file.getSize() > 20 * 1024 * 1024) throw new Error('Bukti tidak sesuai.');
  const parents = file.getParents();
  let belongs = false;
  while (parents.hasNext()) {if (parents.next().getId() === folderId) belongs = true;}
  if (!belongs) throw new Error('Berkas berada di luar folder bukti proyek.');
  return {name: file.getName(), modified_at: file.getLastUpdated().toISOString(), folder_id: folderId};
}

function attachmentsRpc_(spreadsheetId, user, request, role) {
  const {request_id, project_id, action, payload} = request;
  const ok = data => ({ok: true, request_id, data});
  const fail = (code, message) => failure_(request_id, code, message);
  if (PropertiesService.getScriptProperties().getProperty('ATTACHMENTS_ENABLED') !== 'true') return fail('TEMPORARY_FAILURE', 'Penautan bukti belum diaktifkan.');
  const uuid = value => typeof value === 'string' && PROJECT_UUID_.test(value);
  const link = action === 'attachments.link';
  const get = action === 'attachments.get';
  if ((get ? !uuid(payload?.attachment_id) : !uuid(payload?.transaction_id)) || (link &&
      (!uuid(request_id) || !Number.isSafeInteger(payload.expected_transaction_row_version) || payload.expected_transaction_row_version < 1 ||
      !Number.isSafeInteger(payload.expected_attachment_row_version) || payload.expected_attachment_row_version < 0 ||
      (payload.attachment_id !== '' && !uuid(payload.attachment_id)) || payload.attachment_kind !== 'PAYMENT_PROOF' ||
      typeof payload.drive_file_id !== 'string' || !/^[\w-]{10,200}$/.test(payload.drive_file_id)))) return fail('VALIDATION_ERROR', 'Periksa transaksi, versi, jenis dan ID berkas bukti.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Bukti sedang diproses. Coba lagi.');
  try {
    const digest = requestDigest_([action, project_id, payload]);
    if (link) {
      const old = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status']).find(row => row.request_id === request_id);
      if (old) {
        if (old.user_id !== user.user_id || old.action !== action || old.payload_digest !== digest || old.status !== 'COMPLETED') return fail('CONFLICT', 'ID permintaan sudah digunakan.');
        return ok(JSON.parse(old.result_ref));
      }
    }
    const project = rows_(spreadsheetId, 'projects', ['project_id', 'status']).find(row => row.project_id === project_id);
    const attachments = rows_(spreadsheetId, 'attachments', ATTACHMENT_FIELDS_);
    const chosen = get ? attachments.filter(row => row.attachment_id === payload.attachment_id && row.project_id === project_id) : [];
    if (get && chosen.length !== 1) return fail('NOT_FOUND', 'Bukti tidak ditemukan dalam proyek ini.');
    const transactionId = get ? chosen[0].transaction_id : payload.transaction_id;
    const transactions = rows_(spreadsheetId, 'transactions', TRANSACTION_FIELDS_).filter(row => row.project_id === project_id && row.transaction_id === transactionId);
    if (!project || transactions.length !== 1) return fail('NOT_FOUND', 'Transaksi tidak ditemukan dalam proyek ini.');
    const transaction = transactions[0];
    const related = attachments.filter(row => row.project_id === project_id && row.transaction_id === transactionId);
    if (new Set(attachments.map(row => row.attachment_id)).size !== attachments.length || related.length > 50 || related.some(row => !Number.isSafeInteger(row.row_version) || row.row_version < 1)) throw new Error('Bukti tersimpan tidak konsisten.');
    const payments = rows_(spreadsheetId, 'payment_details', ['payment_detail_id', 'transaction_id']).filter(row => row.transaction_id === transactionId);
    const receipts = rows_(spreadsheetId, 'receipts', ['payment_detail_id']);
    const assessments = rows_(spreadsheetId, 'tax_assessments', ['tax_assessment_id', 'payment_detail_id']).filter(row => payments.some(payment => payment.payment_detail_id === row.payment_detail_id));
    const allocations = rows_(spreadsheetId, 'tax_remittance_allocations', ['tax_assessment_id']);
    const distributions = rows_(spreadsheetId, 'distributions', ['transaction_id']);
    const canLink = ['OWNER', 'EDITOR'].includes(role) && ['DRAFT', 'ACTIVE'].includes(project.status) && transaction.status === 'DRAFT' &&
      !receipts.some(row => payments.some(payment => payment.payment_detail_id === row.payment_detail_id)) &&
      !allocations.some(row => assessments.some(assessment => assessment.tax_assessment_id === row.tax_assessment_id)) &&
      !distributions.some(row => row.transaction_id === transactionId);
    if (!link) {
      const folderId = evidenceFolder_(project_id);
      const describe = row => {
        try {
          const file = evidenceFile_(project_id, row.drive_file_id);
          return {...row, name: file.name, modified_at: file.modified_at, available: true};
        }
        catch {return {attachment_id: row.attachment_id, attachment_kind: row.attachment_kind, row_version: row.row_version, available: false};}
      };
      if (get) return ok({attachment: describe(chosen[0])});
      return ok({attachments: related.map(describe), can_link: canLink, transaction_row_version: transaction.row_version,
        folder_url: role === 'OWNER' ? 'https://drive.google.com/drive/folders/' + folderId : undefined});
    }
    if (!canLink) return fail('CONFLICT', 'Bukti hanya dapat ditautkan pada transaksi draf tanpa kwitansi, setoran, atau distribusi terkait.');
    const before = payload.attachment_id ? related.find(row => row.attachment_id === payload.attachment_id) : null;
    if (before && before.attachment_kind !== 'PAYMENT_PROOF') return fail('VALIDATION_ERROR', 'Alur ini hanya mengganti bukti pembayaran.');
    if ((payload.attachment_id && !before) || transaction.row_version !== payload.expected_transaction_row_version ||
        (before?.row_version || 0) !== payload.expected_attachment_row_version) return fail('CONFLICT', 'Transaksi atau bukti berubah. Muat ulang daftar bukti.');
    if (!before && related.length >= 50) return fail('VALIDATION_ERROR', 'Maksimal 50 bukti per transaksi.');
    if (attachments.some(row => row.drive_file_id === payload.drive_file_id &&
        (row.project_id !== project_id || (row.transaction_id === transactionId && row.attachment_id !== payload.attachment_id)))) return fail('CONFLICT', 'Berkas sudah tertaut ke proyek lain atau transaksi ini.');
    let file;
    try {file = evidenceFile_(project_id, payload.drive_file_id);}
    catch {return fail('VALIDATION_ERROR', 'Gunakan PDF/JPG/PNG maksimal 20 MB yang privat dan berada langsung di folder bukti proyek.');}
    const time = new Date().toISOString();
    const stamp = {row_version: 1, created_at: time, updated_at: time};
    const value = {attachment_id: before?.attachment_id || Utilities.getUuid(), project_id, activity_id: transaction.activity_id || '',
      transaction_id: transactionId, attachment_kind: 'PAYMENT_PROOF', drive_file_id: payload.drive_file_id, row_version: before ? before.row_version + 1 : 1, updated_at: time};
    const result = {attachment_id: value.attachment_id, row_version: value.row_version, transaction_row_version: transaction.row_version + 1};
    const adds = {
      audit_log: [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action, entity_type: 'attachment', entity_id: value.attachment_id,
        occurred_at: time, change_summary: JSON.stringify({before, after: value, file})}],
      mutation_requests: [{request_id, user_id: user.user_id, action, payload_digest: digest, result_ref: JSON.stringify(result), status: 'COMPLETED', ...stamp}],
    };
    const updates = [['transactions', transactionId, {row_version: result.transaction_row_version, updated_at: time}]];
    if (before) updates.push(['attachments', before.attachment_id, value]);
    else adds.attachments = [{...stamp, ...value}];
    budgetBatch_(spreadsheetId, adds, updates);
    return ok(result);
  } finally {lock.releaseLock();}
}
