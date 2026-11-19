function adminList_(spreadsheetId, request) {
  const users = opRows_(spreadsheetId, 'users', ['user_id', 'login_email', 'system_role', 'active']);
  const members = opRows_(spreadsheetId, 'project_members', ['project_member_id', 'project_id', 'user_id', 'project_role', 'revoked_at', 'row_version']).filter(row => row.project_id === request.project_id);
  const audit = rows_(spreadsheetId, 'audit_log', ['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary'])
    .filter(row => row.project_id === request.project_id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.audit_id.localeCompare(b.audit_id));
  const offset = Number.isSafeInteger(request.payload?.offset) && request.payload.offset >= 0 ? request.payload.offset : 0;
  const backups = rows_(spreadsheetId, 'backups', BACKUP_FIELDS_).filter(row => row.project_id === request.project_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {ok: true, request_id: request.request_id, data: {users: users.map(row => ({...row})), members, audit: audit.slice(offset, offset + 25), audit_count: audit.length, offset, backups}};
}
function accessSave_(spreadsheetId, owner, request) {
  return opMutation_(spreadsheetId, owner, request, ({time, stamp}) => {
    const p = request.payload, email = normalizeEmail_(p.login_email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !['EDITOR', 'VIEWER', 'REVOKED'].includes(p.project_role)) return opError_('Isi akun Google dan peran yang valid.');
    const users = opRows_(spreadsheetId, 'users', ['user_id', 'login_email', 'system_role', 'active']);
    const matches = users.filter(row => normalizeEmail_(row.login_email) === email);
    if (matches.length > 1 || matches[0]?.system_role === 'OWNER' || matches[0]?.active === false) return opError_('Akun pemilik/nonaktif/ambigu tidak dapat diubah lewat undangan proyek.');
    const userId = matches[0]?.user_id || Utilities.getUuid();
    const members = rows_(spreadsheetId, 'project_members', ['project_member_id', 'project_id', 'user_id', 'project_role', 'revoked_at', 'row_version']);
    const existing = members.filter(row => row.project_id === request.project_id && row.user_id === userId);
    if (existing.length > 1) return opError_('Keanggotaan ganda.');
    const before = existing[0];
    if ((before?.row_version || 0) !== p.expected_row_version) return opError_('Hak akses berubah. Muat ulang anggota.', 'CONFLICT');
    if (!before && p.project_role === 'REVOKED') return opError_('Akun belum mempunyai akses proyek.');
    const value = {project_role: p.project_role === 'REVOKED' ? before.project_role : p.project_role, revoked_at: p.project_role === 'REVOKED' ? time : '',
      row_version: (before?.row_version || 0) + 1, updated_at: time};
    const id = before?.project_member_id || Utilities.getUuid(), adds = {};
    if (!matches.length) adds.users = [{user_id: userId, login_email: email, system_role: 'MEMBER', active: true}];
    if (!before) adds.project_members = [{project_member_id: id, project_id: request.project_id, user_id: userId, ...stamp, ...value}];
    return {data: {project_member_id: id, row_version: value.row_version}, entity_id: id, adds,
      updates: before ? [['project_members', id, value]] : [], audit: {before, after: value, user_id: userId}};
  }, true);
}
function backupRpc_(spreadsheetId, user, request) {
  return opMutation_(spreadsheetId, user, request, ({time, stamp}) => {
    const root = managedFolder_(spreadsheetId, request.project_id, 'Cadangan');
    if (request.action === 'backups.create') {
      const folder = privateChild_(root, request.request_id), dataFolder = privateChild_(folder, 'Berkas');
      const source = DriveApp.getFileById(spreadsheetId), found = folder.getFilesByName('Data LPJ');
      const copy = found.hasNext() ? found.next() : source.makeCopy('Data LPJ', folder);
      if (found.hasNext() || copy.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Cadangan spreadsheet ganda atau tidak privat.');
      const sourceMetadata = Sheets.Spreadsheets.get(spreadsheetId, {fields: 'sheets(properties(title))'});
      const sourceTables = Object.fromEntries(sourceMetadata.sheets.map(sheet => {
        const title = sheet.properties.title;
        const current = Sheets.Spreadsheets.Values.get(spreadsheetId, "'" + title.replace(/'/g, "''") + "'!A:Z", {valueRenderOption: 'UNFORMATTED_VALUE'}).values || [];
        const saved = Sheets.Spreadsheets.Values.get(copy.getId(), "'" + title.replace(/'/g, "''") + "'!A:Z", {valueRenderOption: 'UNFORMATTED_VALUE'}).values || [];
        if (requestDigest_(current) !== requestDigest_(saved)) {const error = new Error('Sumber berubah sejak salinan dibuat. Buat cadangan baru.'); error.code = 'CONFLICT'; throw error;}
        return [title, requestDigest_(current)];
      }));
      const attachments = rows_(spreadsheetId, 'attachments', ATTACHMENT_FIELDS_);
      const finals = rows_(spreadsheetId, 'final_documents', FINAL_FIELDS_);
      const ids = new Set(attachments.map(row => row.drive_file_id));
      const projectsByFile = Object.fromEntries(attachments.map(row => [row.drive_file_id, row.project_id]));
      for (const row of finals) {
        ids.add(row.pdf_drive_file_id); ids.add(row.snapshot_drive_file_id);
        projectsByFile[row.pdf_drive_file_id] = row.project_id; projectsByFile[row.snapshot_drive_file_id] = row.project_id;
        const doc = JSON.parse(DriveApp.getFileById(row.snapshot_drive_file_id).getBlob().getDataAsString());
        for (const file of doc.evidence || []) if (file.archived_drive_file_id) {ids.add(file.archived_drive_file_id); projectsByFile[file.archived_drive_file_id] = row.project_id;}
      }
      const files = [];
      for (const id of [...ids].sort()) {
        if (!id) throw new Error('ID berkas cadangan kosong.');
        const file = DriveApp.getFileById(id);
        if (file.isTrashed() || file.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Berkas sumber cadangan tidak privat/tersedia.');
        const blob = file.getBlob(), saved = operationFile_(dataFolder, id, blob);
        const digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes()));
        if (Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saved.getBlob().getBytes())) !== digest) throw new Error('Salinan cadangan berbeda.');
        files.push({source_file_id: id, backup_file_id: saved.getId(), project_id: projectsByFile[id], name: file.getName(), mime_type: file.getMimeType(), digest});
      }
      for (const [title, digest] of Object.entries(sourceTables)) {
        const values = Sheets.Spreadsheets.Values.get(spreadsheetId, "'" + title.replace(/'/g, "''") + "'!A:Z", {valueRenderOption: 'UNFORMATTED_VALUE'}).values || [];
        if (requestDigest_(values) !== digest) return opError_('Sumber berubah selama cadangan. Buat operasi baru setelah data stabil.', 'CONFLICT');
      }
      const manifest = {schema_version: 1, spreadsheet_copy_id: copy.getId(), source_spreadsheet_id: spreadsheetId, created_at: time, table_digests: sourceTables, files};
      const manifestFile = operationFile_(folder, 'manifest.json', Utilities.newBlob(JSON.stringify(manifest), 'application/json'));
      const savedManifest = JSON.parse(manifestFile.getBlob().getDataAsString());
      if (requestDigest_({...savedManifest, created_at: ''}) !== requestDigest_({...manifest, created_at: ''})) throw new Error('Sumber berubah selama operasi cadangan. Buat cadangan baru.');
      const id = Utilities.getUuid();
      return {data: {backup_id: id, file_count: files.length, folder_url: folder.getUrl()}, entity_id: id,
        adds: {backups: [{backup_id: id, project_id: request.project_id, folder_id: folder.getId(), manifest_file_id: manifestFile.getId(), manifest_digest: requestDigest_(savedManifest), created_by_user_id: user.user_id, ...stamp}]},
        audit: {backup_id: id, file_count: files.length, manifest_digest: requestDigest_(savedManifest)}};
    }
    const row = rows_(spreadsheetId, 'backups', BACKUP_FIELDS_).find(row => row.backup_id === request.payload.backup_id && row.project_id === request.project_id);
    if (!row || request.payload.confirm_restore !== true) return opError_('Pilih cadangan dan konfirmasikan pemulihan ke salinan baru.');
    const manifest = JSON.parse(DriveApp.getFileById(row.manifest_file_id).getBlob().getDataAsString());
    if (manifest.schema_version !== 1 || manifest.source_spreadsheet_id !== spreadsheetId || requestDigest_(manifest) !== row.manifest_digest) return opError_('Manifest cadangan tidak sesuai atau berubah.');
    for (const [title, digest] of Object.entries(manifest.table_digests || {})) {
      const values = Sheets.Spreadsheets.Values.get(manifest.spreadsheet_copy_id, "'" + title.replace(/'/g, "''") + "'!A:Z", {valueRenderOption: 'UNFORMATTED_VALUE'}).values || [];
      if (requestDigest_(values) !== digest) return opError_('Spreadsheet cadangan telah berubah. Pemulihan dihentikan.', 'CONFLICT');
    }
    const folder = privateChild_(root, 'Pulih ' + request.request_id), mapping = {}, evidenceFolders = {};
    for (const entry of manifest.files) {
      const blob = DriveApp.getFileById(entry.backup_file_id).getBlob();
      if (Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, blob.getBytes())) !== entry.digest) return opError_('Hash cadangan berbeda; pemulihan dihentikan.', 'CONFLICT');
      const files = privateChild_(folder, 'Bukti ' + entry.project_id);
      evidenceFolders[entry.project_id] = files.getId();
      mapping[entry.source_file_id] = operationFile_(files, entry.source_file_id, blob).getId();
    }
    const found = folder.getFilesByName('Data LPJ dipulihkan');
    const restored = found.hasNext() ? found.next() : DriveApp.getFileById(manifest.spreadsheet_copy_id).makeCopy('Data LPJ dipulihkan', folder);
    if (found.hasNext()) throw new Error('Salinan pemulihan ganda.');
    const oldAttachments = rows_(restored.getId(), 'attachments', ATTACHMENT_FIELDS_);
    const oldFinals = rows_(restored.getId(), 'final_documents', FINAL_FIELDS_);
    const updates = oldAttachments.map(item => ['attachments', item.attachment_id, {drive_file_id: mapping[item.drive_file_id] || item.drive_file_id}]);
    for (const item of oldFinals) {
      const original = JSON.parse(DriveApp.getFileById(mapping[item.snapshot_drive_file_id] || item.snapshot_drive_file_id).getBlob().getDataAsString());
      for (const proof of original.evidence || []) if (proof.archived_drive_file_id) proof.archived_drive_file_id = mapping[proof.archived_drive_file_id] || proof.archived_drive_file_id;
      const snapshot = operationFile_(folder, 'snapshot-' + item.final_document_id + '.json', Utilities.newBlob(JSON.stringify(original), 'application/json'));
      updates.push(['final_documents', item.final_document_id, {pdf_drive_file_id: mapping[item.pdf_drive_file_id] || item.pdf_drive_file_id, snapshot_drive_file_id: snapshot.getId(), snapshot_digest: requestDigest_(original)}]);
    }
    for (const assessment of rows_(restored.getId(), 'tax_assessments', TAX_ASSESSMENT_FIELDS_)) if (mapping[assessment.evidence_drive_file_id]) {
      const evidenceId = mapping[assessment.evidence_drive_file_id];
      updates.push(['tax_assessments', assessment.tax_assessment_id, {evidence_drive_file_id: evidenceId, evidence_modified_at: DriveApp.getFileById(evidenceId).getLastUpdated().toISOString()}]);
    }
    if (updates.length) budgetBatch_(restored.getId(), {}, updates);
    const settings = rows_(restored.getId(), 'settings', ['setting_key', 'setting_value']);
    const existingSetting = settings.find(item => item.setting_key === 'EVIDENCE_FOLDERS_JSON');
    budgetBatch_(restored.getId(), existingSetting ? {} : {settings: [{setting_key: 'EVIDENCE_FOLDERS_JSON', setting_value: JSON.stringify(evidenceFolders)}]},
      existingSetting ? [['settings', 'EVIDENCE_FOLDERS_JSON', {setting_value: JSON.stringify(evidenceFolders)}]] : []);
    operationFile_(folder, 'pemetaan-pemulihan.json', Utilities.newBlob(JSON.stringify(mapping, null, 2), 'application/json'));
    return {data: {spreadsheet_url: 'https://docs.google.com/spreadsheets/d/' + restored.getId() + '/edit', folder_url: folder.getUrl()},
      audit: {backup_id: row.backup_id, recovered_spreadsheet_id: restored.getId(), active_workspace_unchanged: true}};
  }, true);
}

// Set SPREADSHEET_ID to the recovered spreadsheet first, then explicitly activate its folder mapping.
function activateRecoveredWorkspace() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty('SPREADSHEET_ID');
  const email = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!email || !rows_(id, 'users', ['login_email', 'system_role', 'active']).some(row => normalizeEmail_(row.login_email) === email && row.system_role === 'OWNER' && row.active === true)) throw new Error('Hanya pemilik yang dapat mengaktifkan hasil pemulihan.');
  const setting = rows_(id, 'settings', ['setting_key', 'setting_value']).find(row => row.setting_key === 'EVIDENCE_FOLDERS_JSON');
  if (!setting) throw new Error('Pemetaan pemulihan belum tersedia.');
  const mapping = JSON.parse(setting.setting_value);
  for (const [projectId, folderId] of Object.entries(mapping)) {
    if (!opUuid_(projectId) || DriveApp.getFolderById(folderId).getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Folder pemulihan tidak privat.');
  }
  props.setProperty('EVIDENCE_FOLDERS_JSON', JSON.stringify(mapping));
  return prepareWorkspace();
}
