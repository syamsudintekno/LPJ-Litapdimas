const OP_STAMP_FIELDS_ = ['row_version', 'created_at', 'updated_at'];
const DISBURSEMENT_FIELDS_ = ['disbursement_id', 'report_stage_id', 'received_date', 'received_amount', 'attachment_id', ...OP_STAMP_FIELDS_];
const REMITTANCE_FIELDS_ = ['tax_remittance_id', 'project_id', 'paid_at', 'amount', 'attachment_id', ...OP_STAMP_FIELDS_];
const ALLOCATION_FIELDS_ = ['tax_remittance_allocation_id', 'tax_remittance_id', 'tax_assessment_id', 'amount', ...OP_STAMP_FIELDS_];
const FINAL_FIELDS_ = ['final_document_id', 'project_id', 'report_stage_id', 'document_kind', 'version_no', 'template_version', 'pdf_drive_file_id',
  'snapshot_drive_file_id', 'finalized_by_user_id', 'finalized_at', 'snapshot_digest', 'pdf_digest', ...OP_STAMP_FIELDS_];
const BACKUP_FIELDS_ = ['backup_id', 'project_id', 'folder_id', 'manifest_file_id', 'manifest_digest', 'created_by_user_id', ...OP_STAMP_FIELDS_];

function opUuid_(value) {return typeof value === 'string' && PROJECT_UUID_.test(value);}
function opSum_(rows, key = 'amount') {
  let value = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row[key]) || row[key] < 0 || !Number.isSafeInteger(value += row[key])) throw new Error('Nominal rupiah tidak konsisten atau melampaui batas.');
  }
  return value;
}
function opRows_(spreadsheetId, name, fields) {
  const rows = rows_(spreadsheetId, name, fields);
  if (new Set(rows.map(row => row[fields[0]])).size !== rows.length) throw new Error('ID ganda pada ' + name + '.');
  return rows;
}
function opMutation_(spreadsheetId, user, request, handler, allowArchived = false) {
  const {request_id, action, project_id, payload} = request;
  if (!opUuid_(request_id) || !payload || typeof payload !== 'object') return failure_(request_id, 'VALIDATION_ERROR', 'Permintaan perubahan tidak valid.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return failure_(request_id, 'TEMPORARY_FAILURE', 'Data sedang diproses. Coba kembali dengan permintaan yang sama.');
  try {
    const digest = requestDigest_([action, project_id, payload]);
    const old = opRows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status']).find(row => row.request_id === request_id);
    if (old) return old.user_id === user.user_id && old.action === action && old.payload_digest === digest && old.status === 'COMPLETED'
      ? {ok: true, request_id, data: JSON.parse(old.result_ref)} : failure_(request_id, 'CONFLICT', 'ID permintaan sudah digunakan.');
    const project = opRows_(spreadsheetId, 'projects', ['project_id', 'title', 'fiscal_year', 'project_code', 'official_ceiling_amount', 'status', 'row_version']).find(row => row.project_id === project_id);
    if (!project) return failure_(request_id, 'NOT_FOUND', 'Proyek tidak ditemukan.');
    if (!allowArchived && !['DRAFT', 'ACTIVE'].includes(project.status)) return failure_(request_id, 'CONFLICT', 'Proyek telah diarsipkan.');
    const time = new Date().toISOString(), stamp = {row_version: 1, created_at: time, updated_at: time};
    const result = handler({project, time, stamp});
    if (result.error) return failure_(request_id, result.error, result.message);
    const adds = result.adds || {};
    adds.audit_log = [...(adds.audit_log || []), {audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action,
      entity_type: result.entity_type || action.split('.')[0], entity_id: result.entity_id || project_id, occurred_at: time,
      change_summary: JSON.stringify(result.audit || {result: result.data})}];
    adds.mutation_requests = [{request_id, user_id: user.user_id, action, payload_digest: digest, result_ref: JSON.stringify(result.data), status: 'COMPLETED', ...stamp}];
    budgetBatch_(spreadsheetId, adds, result.updates || [], result.deletes || []);
    return {ok: true, request_id, data: result.data};
  } catch (error) {
    if (error.code === 'CONFLICT') return failure_(request_id, 'CONFLICT', error.message);
    throw error;
  } finally {lock.releaseLock();}
}
function opError_(message, error = 'VALIDATION_ERROR') {return {error, message};}

function managedRoot_(spreadsheetId) {
  const parents = DriveApp.getFileById(spreadsheetId).getParents();
  if (!parents.hasNext()) throw new Error('Letakkan spreadsheet dalam folder LPJ privat.');
  const root = parents.next();
  if (parents.hasNext() || root.isTrashed() || root.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Folder LPJ harus tunggal dan privat.');
  return root;
}
function privateChild_(parent, name) {
  const found = parent.getFoldersByName(name);
  const folder = found.hasNext() ? found.next() : parent.createFolder(name);
  if (found.hasNext() || folder.isTrashed() || folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Folder privat tidak konsisten: ' + name);
  return folder;
}
function managedFolder_(spreadsheetId, projectId, kind) {
  if (!opUuid_(projectId)) throw new Error('Proyek tidak valid.');
  if (kind === 'Bukti') {
    const props = PropertiesService.getScriptProperties(), mapping = JSON.parse(props.getProperty('EVIDENCE_FOLDERS_JSON') || '{}');
    if (mapping[projectId]) return DriveApp.getFolderById(evidenceFolder_(projectId));
    const folder = privateChild_(managedRoot_(spreadsheetId), 'Bukti ' + projectId);
    mapping[projectId] = folder.getId(); props.setProperty('EVIDENCE_FOLDERS_JSON', JSON.stringify(mapping));
    return folder;
  }
  return privateChild_(privateChild_(managedRoot_(spreadsheetId), 'LPJ ' + projectId), kind);
}
function operationFile_(folder, name, blob) {
  const found = folder.getFilesByName(name);
  const file = found.hasNext() ? found.next() : folder.createFile(blob.setName(name));
  if (found.hasNext() || file.isTrashed() || file.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Berkas operasi tidak konsisten.');
  return file;
}

// Explicit owner setup. Appends missing headers and creates missing tables, never rewrites existing data.
function prepareWorkspace() {
  const props = PropertiesService.getScriptProperties(), spreadsheetId = props.getProperty('SPREADSHEET_ID');
  const email = normalizeEmail_(Session.getActiveUser().getEmail());
  const owners = rows_(spreadsheetId, 'users', ['user_id', 'login_email', 'system_role', 'active']).filter(row => normalizeEmail_(row.login_email) === email && row.system_role === 'OWNER' && row.active === true);
  if (!email || owners.length !== 1) throw new Error('Jalankan prepareWorkspace dari editor dengan akun pemilik.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Workspace sedang diproses.');
  try {
    const required = {...DEPLOYMENT_HEADERS_, project_members: [...DEPLOYMENT_HEADERS_.project_members, ...OP_STAMP_FIELDS_], disbursements: DISBURSEMENT_FIELDS_, tax_remittances: REMITTANCE_FIELDS_,
      tax_remittance_allocations: ALLOCATION_FIELDS_, final_documents: FINAL_FIELDS_, backups: BACKUP_FIELDS_, settings: ['setting_key', 'setting_value']};
    const metadata = Sheets.Spreadsheets.get(spreadsheetId, {fields: 'sheets(properties(sheetId,title))'});
    const ids = Object.fromEntries(metadata.sheets.map(sheet => [sheet.properties.title, sheet.properties.sheetId]));
    const requests = [], taken = new Set(Object.values(ids));
    for (const [name, fields] of Object.entries(required)) {
      let id = ids[name], header = [];
      if (id === undefined) {
        do {id = Math.floor(Math.random() * 1000000000);} while (taken.has(id)); taken.add(id);
        requests.push({addSheet: {properties: {sheetId: id, title: name, gridProperties: {rowCount: 1000, columnCount: 26, frozenRowCount: 1}}}});
      } else header = Sheets.Spreadsheets.Values.get(spreadsheetId, name + '!A1:Z1', {valueRenderOption: 'UNFORMATTED_VALUE'}).values?.[0] || [];
      if (header.length && (header[0] !== fields[0] || new Set(header).size !== header.length)) throw new Error('Header tidak konsisten: ' + name);
      const missing = fields.filter(field => !header.includes(field));
      if (header.length + missing.length > 26) throw new Error('Skema melebihi 26 kolom: ' + name);
      if (missing.length) requests.push({updateCells: {start: {sheetId: id, rowIndex: 0, columnIndex: header.length},
        rows: [{values: missing.map(field => ({userEnteredValue: {stringValue: field}, userEnteredFormat: {textFormat: {bold: true}, wrapStrategy: 'WRAP'}}))}], fields: 'userEnteredValue,userEnteredFormat'}});
    }
    if (requests.length) Sheets.Spreadsheets.batchUpdate({requests}, spreadsheetId);
    managedRoot_(spreadsheetId);
    props.setProperty('WORKSPACE_READY', 'true');
    const result = {ok: true, schema_changes: requests.length}; console.log(JSON.stringify(result)); return result;
  } finally {lock.releaseLock();}
}
