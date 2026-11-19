const assert = require('node:assert/strict');
const {createHash, randomUUID} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const read = name => readFileSync(path.join(__dirname, name), 'utf8');
const source = ['Code.gs', 'Projects.gs', 'PeopleImport.gs', 'Budgets.gs', 'Activities.gs', 'Logbook.gs', 'Participants.gs', 'ActivityReports.gs', 'Transactions.gs', 'Taxes.gs', 'TaxRules.gs', 'Attachments.gs', 'TransactionConfirmation.gs', 'Receipts.gs', 'StageReports.gs'].map(read).join('\n');
const tables = ['users', 'project_members', 'projects', 'people', 'project_people'];

function setup() {
  const sheets = Object.fromEntries(tables.map(name => [
    name, read('fixtures/' + name + '.tsv').trimEnd().split(/\r?\n/).map(line =>
      line.split('\t').map(value => {
        if (value === 'TRUE') return true;
        if (/^\d+$/.test(value)) return Number(value);
        return value;
      })
    ),
  ]));
  const [owner, editor, viewer] = sheets.users.slice(1).map(row => row[1]);
  const [projectA, projectB] = sheets.projects.slice(1).map(row => row[0]);
  let email = '';
  const reads = [];
  const properties = {
    CAMPUS_DOMAIN: 'example.test',
    SPREADSHEET_ID: 'synthetic-id',
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
  };
  const claims = {
    aud: properties.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', sub: 'fixture-subject',
    email: editor, email_verified: 'true', hd: 'example.test',
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const verifier = {status: 200, calls: 0};
  const writes = {batches: 0, fail: false, locked: false};
  const cache = new Map();
  const driveFiles = new Map();
  const driveFolders = new Map();
  const driveReads = [];
  const context = vm.createContext({
    Session: {getActiveUser: () => ({getEmail: () => email})},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => properties[key]})},
    ContentService: {
      MimeType: {JSON: 'application/json'},
      createTextOutput: content => ({setMimeType: mimeType => ({content, mimeType})}),
    },
    UrlFetchApp: {fetch(url, options) {
      assert.equal(url, 'https://oauth2.googleapis.com/tokeninfo');
      assert.equal(options.method, 'post');
      assert.equal(options.payload.id_token, 'test.jwt.signature');
      assert.equal(options.followRedirects, false);
      verifier.calls++;
      return {getResponseCode: () => verifier.status, getContentText: () => JSON.stringify(claims)};
    }},
    CacheService: {getScriptCache: () => ({
      get: key => cache.get(key) ?? null,
      put: (key, value) => cache.set(key, value),
      remove: key => cache.delete(key),
    })},
    LockService: {getScriptLock: () => ({
      tryLock() {
        if (writes.locked) return false;
        writes.locked = true;
        return true;
      },
      releaseLock() { writes.locked = false; },
    })},
    Utilities: {
      getUuid: randomUUID,
      DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest: (algorithm, text, encoding) => createHash(algorithm).update(text, encoding).digest(),
      base64EncodeWebSafe: bytes => bytes.toString('base64url'),
    },
    DriveApp: {Access: {PRIVATE: 'PRIVATE'}, getFolderById(id) {
      const folder = driveFolders.get(id);
      if (!folder || folder.fail) throw new Error('Folder uji tidak tersedia.');
      return {isTrashed: () => folder.trashed || false, getSharingAccess: () => folder.access || 'PRIVATE'};
    }, getFileById(id) {
      driveReads.push(id);
      const file = driveFiles.get(id);
      if (!file || file.fail) throw new Error('Berkas uji tidak tersedia.');
      const parents = [...(file.parents || [])];
      return {isTrashed: () => file.trashed || false, getSharingAccess: () => file.access || 'PRIVATE', getName: () => file.name || 'Bukti sintetis',
        getMimeType: () => file.mime || 'application/pdf', getSize: () => file.size ?? 1024,
        getParents: () => ({hasNext: () => parents.length > 0, next: () => ({getId: () => parents.shift()})}),
        getLastUpdated: () => new Date(file.modified_at)};
    }},
    Sheets: {Spreadsheets: {get() {
      return {sheets: Object.keys(sheets).map((title, sheetId) => ({properties: {title, sheetId}}))};
    }, batchUpdate({requests}) {
      if (!writes.locked) throw new Error('Perubahan di luar lock.');
      if (writes.fail) throw new Error('Batch ditolak.');
      const valueOf = ({userEnteredValue: value}) => value?.numberValue ?? value?.stringValue ?? value?.boolValue ?? '';
      const names = Object.keys(sheets);
      for (const {appendCells, updateCells, deleteDimension} of requests) {
        if (appendCells) sheets[names[appendCells.sheetId]].push(...appendCells.rows.map(row => row.values.map(valueOf)));
        else if (deleteDimension) {
          const {sheetId, startIndex, endIndex, dimension} = deleteDimension.range;
          assert.equal(dimension, 'ROWS');
          sheets[names[sheetId]].splice(startIndex, endIndex - startIndex);
        }
        else {
          const {sheetId, rowIndex, columnIndex} = updateCells.start;
          sheets[names[sheetId]][rowIndex][columnIndex] = valueOf(updateCells.rows[0].values[0]);
        }
      }
      writes.batches++;
    }, Values: {get(id, range, options) {
      assert.equal(id, 'synthetic-id');
      assert.equal(options.valueRenderOption, 'UNFORMATTED_VALUE');
      const [tab] = range.split('!');
      reads.push(tab);
      return {values: sheets[tab]};
    }}}},
  });
  vm.runInContext(source, context);

  function rpc(sessionEmail, action, project_id, extra = {}) {
    email = sessionEmail;
    const request = {api_version: 1, action, project_id, request_id: randomUUID(), ...extra};
    const response = JSON.parse(JSON.stringify(context.dispatch(request)));
    assert.equal(response.request_id, request.request_id);
    return response;
  }
  function post(request, id_token) {
    const raw = JSON.stringify({id_token, request});
    const response = context.doPost({postData: {contents: raw}});
    assert.equal(response.mimeType, 'application/json');
    return JSON.parse(response.content);
  }
  return {rpc, post, owner, editor, viewer, projectA, projectB, sheets, reads, properties, claims, verifier, writes, cache, driveFiles, driveFolders, driveReads, taxAmount: context.taxAmount_, rupiahWords: context.rupiahWords_};
}

function setupLogbook() {
  const env = setup();
  const {sheets, projectA, projectB} = env;
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('status');
  sheets.projects.slice(1).forEach(row => row.push('ACTIVE'));
  const activityA = randomUUID();
  const activityB = randomUUID();
  sheets.activities = [['activity_id', 'project_id', 'title', 'activity_date'],
    [activityA, projectA, 'FGD Sintetis A', '2026-11-18'],
    [activityB, projectB, 'FGD Sintetis B', '2026-11-19']];
  sheets.logbook_entries = [['logbook_entry_id', 'project_id', 'activity_id', 'entry_date', 'description', 'result', ...stamp]];
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...stamp]];
  return {...env, activityA, activityB};
}

function setupParticipants() {
  const env = setupLogbook();
  const {sheets, activityA, activityB, projectA, editor, rpc} = env;
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.activity_participants = [['activity_participant_id', 'activity_id', 'person_id', 'attendance_status', ...stamp]];
  sheets.distributions = [['distribution_id', 'activity_participant_id', 'transaction_id', 'distribution_kind', 'quantity', 'received_at', ...stamp]];
  const rows = [{source_row: 2, person_id: sheets.people[1][0], attendance_status: 'PRESENT'}];
  const call = (action, payload = {}, account = editor, project = projectA, request_id = randomUUID()) =>
    rpc(account, action, project, {request_id, payload: {activity_id: activityA, ...payload}});
  const preview = () => call('participants.preview_import', {rows});
  const enroll = () => {
    const {import_token} = preview().data;
    return call('participants.commit_import', {rows, import_token});
  };
  return {...env, rows, call, preview, enroll};
}

function setupActivityDocuments() {
  const env = setupParticipants();
  const {sheets, activityA, activityB, projectA, projectB, properties} = env;
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.activities = [['activity_id', 'project_id', 'activity_kind', 'title', 'activity_date', 'location', 'status', ...stamp],
    [activityA, projectA, 'FGD', 'FGD Sintetis A', '2026-11-18', 'Ruang A', 'DRAFT', 1, '2026-11-18T00:00:00.000Z', '2026-11-18T00:00:00.000Z'],
    [activityB, projectB, 'FGD', 'FGD Sintetis B', '2026-11-19', 'Ruang B', 'DRAFT', 1]];
  sheets.agenda_items = [['agenda_item_id', 'activity_id', 'start_time', 'end_time', 'title', 'speaker_person_id', ...stamp],
    ...[0, 1, 2].map(index => [randomUUID(), activityA, (9 + index).toString().padStart(2, '0') + ':00',
      (10 + index).toString().padStart(2, '0') + ':00', 'Sesi ' + index, '', 1]),
    [randomUUID(), activityB, '09:00', '10:00', 'Sesi proyek lain', '', 1]];
  sheets.logbook_entries.push([randomUUID(), projectA, activityA, '2026-11-18', 'Uraian A', 'Hasil A', 1],
    [randomUUID(), projectB, activityB, '2026-11-19', 'Uraian rahasia B', 'Hasil B', 1]);
  const participantId = randomUUID();
  sheets.activity_participants.push([participantId, activityA, sheets.people[1][0], 'ABSENT', 1],
    [randomUUID(), activityB, sheets.people[2][0], 'PRESENT', 1]);
  sheets.distributions.push([randomUUID(), participantId, '', 'TRANSPORT', 1, '2026-11-18T09:00:00.000Z', 1]);
  properties.ACTIVITIES_ENABLED = 'true';
  return env;
}

function setupTransactions() {
  const env = setupParticipants();
  const {sheets, projectA, projectB} = env;
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('active_budget_version_id');
  const versionA = randomUUID(); const versionB = randomUUID();
  sheets.projects[1].push(versionA); sheets.projects[2].push(versionB);
  const categoryA = randomUUID(); const categoryB = randomUUID();
  const itemA = randomUUID(); const itemB = randomUUID();
  sheets.budget_versions = [['budget_version_id', 'project_id', 'version_no', 'status', 'approved_by_user_id', 'approved_at', ...stamp],
    [versionA, projectA, 1, 'APPROVED', '', '', 1], [versionB, projectB, 1, 'APPROVED', '', '', 1]];
  sheets.budget_categories = [['budget_category_id', 'budget_version_id', 'category_code', 'label', 'sort_order', ...stamp],
    [categoryA, versionA, 'A', 'Kegiatan A', 1, 1], [categoryB, versionB, 'B', 'Kegiatan B', 1, 1]];
  sheets.budget_items = [['budget_item_id', 'budget_category_id', 'label', 'volume', 'frequency', 'unit', 'unit_price_amount', ...stamp],
    [itemA, categoryA, 'Honor', 1, 1, 'paket', 900000, 1], [itemB, categoryB, 'Honor B', 1, 1, 'paket', 900000, 1]];
  const payeeA = randomUUID(); const payeeB = randomUUID();
  sheets.payees = [['payee_id', 'payee_kind', 'person_id', 'legal_name', 'tax_profile_ref', ...stamp],
    [payeeA, 'PERSON', sheets.people[1][0], 'Penerima Sintetis A', 'private-profile-A', 1],
    [payeeB, 'ORGANIZATION', '', 'Vendor Proyek B', 'private-profile-B', 1]];
  sheets.transactions = [['transaction_id', 'project_id', 'budget_item_id', 'activity_id', 'payment_date', 'expense_kind', 'description', 'status', ...stamp]];
  sheets.payment_details = [['payment_detail_id', 'transaction_id', 'payee_id', 'receipt_amount', 'withheld_tax_amount', 'added_tax_amount', 'net_paid_amount', ...stamp]];
  sheets.tax_assessments = [['tax_assessment_id', 'payment_detail_id', 'status']];
  sheets.receipts = [['receipt_id', 'payment_detail_id', 'status']];
  const payload = {transaction: {budget_item_id: itemA, activity_id: env.activityA, payment_date: '2026-11-18', expense_kind: 'HONOR', description: '=Honor sintetis'},
    payments: [{payee_id: payeeA, receipt_amount: 900000, withheld_tax_amount: 45000}]};
  const save = (data = payload, id = randomUUID(), account = env.editor, project = projectA) =>
    env.rpc(account, 'transactions.save', project, {request_id: id, payload: data});
  const list = (account = env.editor, project = projectA) => env.rpc(account, 'transactions.list', project);
  return {...env, payload, save, list, itemA, itemB, payeeA, payeeB, versionA};
}

function setupTaxes() {
  const env = setupTransactions();
  const {sheets, properties, driveFiles} = env;
  properties.TRANSACTIONS_ENABLED = 'true';
  properties.TAXES_ENABLED = 'true';
  const created = env.save().data;
  const payment = env.list().data.transactions[0].payments[0];
  sheets.people[0].push('civil_service_grade');
  sheets.people[1].push('III/a');
  sheets.tax_rule_versions = [['tax_rule_version_id', 'rule_code', 'version_no', 'tax_kind', 'expense_kind', 'payee_kind', 'eligibility', 'base_kind', 'rate_bps', 'effective_from', 'effective_to', 'source_ref', 'row_version', 'created_at', 'updated_at']];
  const rule = [randomUUID(), 'SYNTHETIC_HONOR', 1, 'SYNTHETIC_WITHHOLDING', 'HONOR', 'PERSON', JSON.stringify({civil_service_grades: ['III/a']}),
    'RECEIPT_AMOUNT', 500, '2026-01-01', '2026-12-31', 'Synthetic fixture, not a tax regulation', 1];
  sheets.tax_assessments = [['tax_assessment_id', 'payment_detail_id', 'tax_rule_version_id', 'tax_kind', 'tax_treatment', 'tax_base_amount', 'amount', 'status',
    'verified_by_user_id', 'verified_at', 'override_reason', 'decision_source_ref', 'evidence_attachment_id', 'evidence_row_version', 'evidence_drive_file_id', 'evidence_modified_at', 'rule_snapshot', 'row_version', 'created_at', 'updated_at', 'verification_context_digest']];
  const evidenceId = randomUUID(); const driveId = 'synthetic-private-proof-01';
  sheets.attachments = [['attachment_id', 'project_id', 'activity_id', 'transaction_id', 'attachment_kind', 'drive_file_id', 'row_version', 'created_at', 'updated_at'],
    [evidenceId, env.projectA, '', created.transaction_id, 'PAYMENT_PROOF', driveId, 1]];
  sheets.tax_remittance_allocations = [['tax_remittance_allocation_id', 'tax_remittance_id', 'tax_assessment_id', 'amount', 'row_version', 'created_at', 'updated_at']];
  driveFiles.set(driveId, {modified_at: '2026-11-18T00:00:00.000Z'});
  const preview = (account = env.owner, project = env.projectA) => env.rpc(account, 'taxes.preview', project, {payload: {payment_detail_id: payment.payment_detail_id}});
  function decision(data = preview().data) {
    return {payment_detail_id: payment.payment_detail_id, preview_token: data.preview_token,
      expected_transaction_row_version: data.transaction.row_version, expected_payment_row_version: data.payment.row_version,
      expected_assessment_row_version: data.assessment?.row_version || 0, evidence_attachment_id: evidenceId,
      tax_rule_version_id: data.proposal.tax_rule_version_id, tax_kind: data.proposal.tax_kind || 'SYNTHETIC_WITHHOLDING',
      tax_base_amount: data.payment.receipt_amount, amount: data.proposal.amount ?? data.payment.withheld_tax_amount, status: 'VERIFIED',
      decision_source_ref: 'Synthetic source reference', override_reason: ''};
  }
  const verify = (payload, id = randomUUID(), account = env.owner, project = env.projectA) =>
    env.rpc(account, 'taxes.verify', project, {request_id: id, payload});
  return {...env, created, payment, rule, evidenceId, driveId, preview, decision, verify};
}

function setupAttachments() {
  const env = setupTaxes();
  const folderA = 'synthetic-evidence-folder-A', folderB = 'synthetic-evidence-folder-B';
  env.properties.ATTACHMENTS_ENABLED = 'true';
  env.properties.EVIDENCE_FOLDERS_JSON = JSON.stringify({[env.projectA]: folderA, [env.projectB]: folderB});
  env.driveFolders.set(folderA, {}); env.driveFolders.set(folderB, {});
  env.driveFiles.get(env.driveId).parents = [folderA];
  const fileId = 'synthetic-new-proof-A';
  env.driveFiles.set(fileId, {parents: [folderA], modified_at: '2026-11-18T01:00:00.000Z'});
  const call = (action, payload, account = env.editor, project = env.projectA, id = randomUUID()) => env.rpc(account, action, project, {payload, request_id: id});
  const evidence = () => call('attachments.list', {transaction_id: env.created.transaction_id});
  const payload = () => ({transaction_id: env.created.transaction_id, attachment_id: '', expected_attachment_row_version: 0,
    expected_transaction_row_version: evidence().data.transaction_row_version, attachment_kind: 'PAYMENT_PROOF', drive_file_id: fileId});
  return {...env, folderA, folderB, fileId, call, evidence, linkPayload: payload};
}

test('bukti tertaut atomik oleh editor proyek, retry idempoten dan penggantian memerlukan versi terkini', () => {
  const {call, evidence, linkPayload, sheets, fileId, writes, owner, created, folderA} = setupAttachments();
  assert.equal(evidence().data.folder_url, undefined);
  assert.equal(call('attachments.list', {transaction_id: created.transaction_id}, owner).data.folder_url, 'https://drive.google.com/drive/folders/' + folderA);
  const payload = linkPayload();
  const requestId = randomUUID();
  const first = call('attachments.link', payload, undefined, undefined, requestId);
  assert.equal(first.data.row_version, 1);
  assert.equal(first.data.transaction_row_version, payload.expected_transaction_row_version + 1);
  const batches = writes.batches;
  assert.deepEqual(call('attachments.link', payload, undefined, undefined, requestId), first);
  assert.equal(writes.batches, batches);
  assert.equal(sheets.attachments.filter(row => row[5] === fileId).length, 1);
  assert.equal(call('attachments.link', {...payload, drive_file_id: 'different-file-id'}, undefined, undefined, requestId).error.code, 'CONFLICT');
  assert.equal(call('attachments.link', payload).error.code, 'CONFLICT');
  const replace = {...linkPayload(), attachment_id: first.data.attachment_id, expected_attachment_row_version: 1};
  assert.equal(call('attachments.link', {...replace, expected_attachment_row_version: 0}).error.code, 'CONFLICT');
  assert.equal(call('attachments.link', replace).data.row_version, 2);
  assert.equal(evidence().data.attachments.find(row => row.attachment_id === first.data.attachment_id).row_version, 2);
  assert.equal(call('attachments.get', {attachment_id: first.data.attachment_id}).data.attachment.available, true);
  const auditAction = sheets.audit_log[0].indexOf('action');
  assert.equal(sheets.audit_log.slice(1).filter(row => row[auditAction] === 'attachments.link').length, 2);
});

test('bukti menolak viewer, konteks lintas proyek, file di luar folder/publik/shortcut, serta konfigurasi tidak sah', () => {
  const {call, evidence, linkPayload, viewer, editor, owner, evidenceId, projectB, created, fileId, driveFiles, driveReads, driveFolders, folderA, properties, projectA} = setupAttachments();
  driveReads.length = 0;
  assert.equal(call('attachments.list', {transaction_id: created.transaction_id}, viewer).error.code, 'FORBIDDEN');
  assert.equal(call('attachments.list', {transaction_id: created.transaction_id}, editor, projectB).error.code, 'FORBIDDEN');
  assert.equal(call('attachments.get', {attachment_id: randomUUID()}).error.code, 'NOT_FOUND');
  assert.equal(call('attachments.get', {attachment_id: evidenceId}, owner, projectB).error.code, 'NOT_FOUND');
  assert.deepEqual(driveReads, []);
  const file = driveFiles.get(fileId);
  for (const invalid of [{parents: ['different-private-folder']}, {access: 'ANYONE_WITH_LINK'}, {trashed: true},
    {mime: 'application/vnd.google-apps.shortcut'}, {size: 20 * 1024 * 1024 + 1}, {fail: true}]) {
    driveFiles.set(fileId, {...file, ...invalid});
    assert.equal(call('attachments.link', linkPayload()).error.code, 'VALIDATION_ERROR', JSON.stringify(invalid));
  }
  driveFiles.set(fileId, file);
  driveFolders.set(folderA, {access: 'DOMAIN'});
  assert.equal(evidence().error.code, 'TEMPORARY_FAILURE');
  driveFolders.set(folderA, {});
  properties.EVIDENCE_FOLDERS_JSON = JSON.stringify({[projectA]: folderA, [projectB]: folderA});
  assert.equal(evidence().error.code, 'TEMPORARY_FAILURE');
  properties.ATTACHMENTS_ENABLED = 'false';
  assert.equal(evidence().error.code, 'TEMPORARY_FAILURE');
});

test('perubahan bukti mempertahankan keputusan/netto lama, menandai tinjauan ulang dan menolak token pajak lama', () => {
  const {call, evidence, linkPayload, preview, verify, decision, sheets, rule, evidenceId, writes, driveFiles, properties} = setupAttachments();
  sheets.tax_rule_versions.push(rule);
  assert.equal(verify(decision()).ok, true);
  const snapshot = JSON.stringify(sheets.tax_assessments);
  const before = decision();
  const payload = {...linkPayload(), attachment_id: evidenceId, expected_attachment_row_version: 1};
  writes.fail = true;
  const state = JSON.stringify(sheets);
  assert.equal(call('attachments.link', payload).error.code, 'TEMPORARY_FAILURE');
  assert.equal(JSON.stringify(sheets), state);
  writes.fail = false;
  assert.equal(call('attachments.link', payload).ok, true);
  assert.equal(JSON.stringify(sheets.tax_assessments), snapshot);
  assert.equal(preview().data.payment.withheld_tax_amount, 45000);
  assert.equal(preview().data.needs_review, true);
  assert.equal(verify(before).error.code, 'CONFLICT');
  driveFiles.get(payload.drive_file_id).parents = ['other-project-folder'];
  assert.equal(evidence().data.attachments[0].available, false);
  assert.equal(preview().data.evidence[0].available, false);
  properties.ATTACHMENTS_ENABLED = 'false';
  assert.equal(preview().data.evidence[0].available, false);
  properties.ATTACHMENTS_ENABLED = 'true';
  const statusColumn = sheets.transactions[0].indexOf('status');
  sheets.transactions[1][statusColumn] = 'CONFIRMED';
  assert.equal(evidence().data.can_link, false);
  assert.equal(call('attachments.link', {...payload, expected_transaction_row_version: evidence().data.transaction_row_version, expected_attachment_row_version: 2}).error.code, 'CONFLICT');
});

test('penautan bukti ditolak setelah kwitansi/setoran/distribusi, pada arsip, dan untuk file yang sudah tertaut lintas proyek', () => {
  const {call, linkPayload, sheets, evidence, evidenceId, projectB, fileId, created} = setupAttachments();
  const paymentId = sheets.payment_details[1][0];
  const payload = linkPayload();
  sheets.receipts.push([randomUUID(), paymentId, 'DRAFT']);
  assert.equal(call('attachments.link', payload).error.code, 'CONFLICT');
  sheets.receipts.pop();
  const assessmentId = randomUUID();
  sheets.tax_assessments.push([assessmentId, paymentId]);
  sheets.tax_remittance_allocations.push([randomUUID(), randomUUID(), assessmentId, 1]);
  assert.equal(call('attachments.link', payload).error.code, 'CONFLICT');
  sheets.tax_remittance_allocations.pop();
  sheets.tax_assessments.pop();
  const transactionColumn = sheets.distributions[0].indexOf('transaction_id');
  const distribution = sheets.distributions[0].map(() => '');
  distribution[0] = randomUUID();
  distribution[transactionColumn] = created.transaction_id;
  sheets.distributions.push(distribution);
  assert.equal(call('attachments.link', payload).error.code, 'CONFLICT');
  sheets.distributions.pop();
  const projectStatus = sheets.projects[0].indexOf('status');
  sheets.projects[1][projectStatus] = 'ARCHIVED';
  assert.equal(evidence().data.can_link, false);
  assert.equal(call('attachments.link', payload).error.code, 'CONFLICT');
  sheets.projects[1][projectStatus] = 'ACTIVE';
  sheets.attachments.push([randomUUID(), projectB, '', randomUUID(), 'PAYMENT_PROOF', fileId, 1]);
  assert.equal(call('attachments.link', payload).error.code, 'CONFLICT');
  assert.equal(call('attachments.get', {attachment_id: evidenceId}, undefined, projectB).error.code, 'FORBIDDEN');
});

function setupConfirmation() {
  const env = setupAttachments();
  const {sheets} = env;
  for (const [field, value] of [['official_ceiling_amount', 4000000], ['row_version', 1]]) {
    if (!sheets.projects[0].includes(field)) {sheets.projects[0].push(field); sheets.projects.slice(1).forEach(row => row.push(value));}
  }
  sheets.transactions[0].push('confirmed_by_user_id', 'confirmed_at');
  for (const row of sheets.budget_versions.slice(1)) {row[4] = sheets.users[1][0]; row[5] = '2026-11-18T00:00:00.000Z';}
  sheets.tax_rule_versions.push(env.rule);
  const previewConfirmation = (account = env.owner, project = env.projectA) => env.rpc(account, 'transactions.preview_confirmation', project, {payload: {transaction_id: env.created.transaction_id}});
  const confirmationPayload = (data = previewConfirmation().data) => ({transaction_id: env.created.transaction_id, expected_row_version: data.transaction.row_version,
    preview_token: data.preview_token, evidence_reviewed: true});
  const confirm = (payload = confirmationPayload(), id = randomUUID(), account = env.owner, project = env.projectA) =>
    env.rpc(account, 'transactions.confirm', project, {request_id: id, payload});
  return {...env, previewConfirmation, confirmationPayload, confirm};
}

test('konfirmasi hanya oleh pemilik, atomik, dihitung sekali, dan retry mengembalikan hasil yang sama', () => {
  const env = setupConfirmation();
  const {previewConfirmation, confirm, confirmationPayload, verify, decision, editor, viewer, owner, projectB, sheets, writes, list} = env;
  assert.equal(previewConfirmation(editor).error.code, 'FORBIDDEN');
  assert.equal(previewConfirmation(viewer).error.code, 'FORBIDDEN');
  assert.equal(previewConfirmation(owner, projectB).error.code, 'NOT_FOUND');
  assert.equal(previewConfirmation().data.can_confirm, false);
  assert.equal(verify(decision()).ok, true);
  const preview = previewConfirmation();
  assert.deepEqual(preview.data.blockers, []);
  assert.equal(preview.data.can_confirm, true);
  assert.equal(preview.data.payments[0].evidence.name, 'Bukti sintetis');
  const payload = confirmationPayload(preview.data), id = randomUUID();
  assert.equal(confirm(payload, id, editor).error.code, 'FORBIDDEN');
  assert.equal(confirm({...payload, evidence_reviewed: false}).error.code, 'VALIDATION_ERROR');
  writes.fail = true;
  const before = JSON.stringify(sheets);
  assert.equal(confirm(payload, id).error.code, 'TEMPORARY_FAILURE');
  assert.equal(JSON.stringify(sheets), before);
  writes.fail = false;
  const confirmed = confirm(payload, id);
  assert.equal(confirmed.data.status, 'CONFIRMED');
  assert.equal(confirmed.data.confirmed_by_user_id, sheets.users[1][0]);
  assert.equal(confirmed.data.totals.receipt_amount, 900000);
  assert.equal(confirmed.data.totals.net_paid_amount, 855000);
  const batches = writes.batches;
  assert.deepEqual(confirm(payload, id), confirmed);
  assert.equal(writes.batches, batches);
  assert.equal(confirm({...payload, expected_row_version: payload.expected_row_version + 1}, id).error.code, 'CONFLICT');
  assert.equal(confirm(payload).error.code, 'CONFLICT');
  assert.equal(list().data.draft_total_amount, 0);
  assert.equal(list().data.confirmed_total_amount, 900000);
  assert.equal(list().data.transactions[0].can_edit, false);
  assert.equal(list().data.transactions[0].confirmed_at, confirmed.data.confirmed_at);
});

test('konfirmasi mendeteksi perubahan bukti, profil, aturan dan nominal meski ID atau versi induk tidak diganti', () => {
  for (const change of [
    env => {env.driveFiles.get(env.driveId).modified_at = '2026-11-18T02:00:00.000Z';},
    env => {env.driveFiles.get(env.driveId).parents = ['different-folder'];},
    env => {env.sheets.payees[1][env.sheets.payees[0].indexOf('tax_profile_ref')] = 'changed-profile';},
    env => {env.sheets.tax_rule_versions[1][8] = 600;},
    env => {env.sheets.payment_details[1][3] = 910000; env.sheets.payment_details[1][6] = 865000;},
    env => {env.sheets.attachments[1][6]++;},
  ]) {
    const env = setupConfirmation();
    assert.equal(env.verify(env.decision()).ok, true);
    const payload = env.confirmationPayload();
    change(env);
    assert.equal(env.confirm(payload).error.code, 'CONFLICT');
    assert.equal(env.previewConfirmation().data.can_confirm, false);
    assert.equal(env.preview().data.needs_review, true);
  }
});

test('konfirmasi memeriksa seluruh penerima dan tidak membatalkan verifikasi pertama ketika penerima berikutnya diverifikasi', () => {
  const env = setupConfirmation();
  const {sheets, rpc, owner, projectA, created, verify, decision, previewConfirmation, confirm, driveReads} = env;
  const person = [...sheets.people[1]]; person[0] = randomUUID(); person[2] = 'Penerima Kedua Sintetis'; sheets.people.push(person);
  const payee = [...sheets.payees[1]]; payee[0] = randomUUID(); payee[2] = person[0]; payee[3] = 'Penerima Kedua Sintetis'; sheets.payees.push(payee);
  const secondId = randomUUID();
  sheets.payment_details.push([secondId, created.transaction_id, payee[0], 100000, 5000, 0, 95000, 1]);
  assert.equal(verify(decision()).ok, true);
  assert.equal(previewConfirmation().data.can_confirm, false);
  const second = rpc(owner, 'taxes.preview', projectA, {payload: {payment_detail_id: secondId}}).data;
  assert.equal(verify({...decision(second), payment_detail_id: secondId}).ok, true);
  driveReads.length = 0;
  const preview = previewConfirmation().data;
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.payments.length, 2);
  assert.equal(preview.totals.receipt_amount, 1000000);
  assert.equal(preview.totals.net_paid_amount, 950000);
  assert.equal(driveReads.length, 1);
  assert.equal(confirm().data.status, 'CONFIRMED');
});

test('konfirmasi menerima keputusan nol beralasan dan RAB lama yang pernah disahkan, tetapi menahan penilaian tanpa digest', () => {
  const env = setupConfirmation();
  const payload = {...env.decision(), status: 'NOT_APPLICABLE', amount: 0, override_reason: 'Synthetic decision: not applicable after evidence review.'};
  assert.equal(env.verify(payload).ok, true);
  env.sheets.budget_versions[1][3] = 'SUPERSEDED';
  assert.equal(env.previewConfirmation().data.can_confirm, true);
  const digestColumn = env.sheets.tax_assessments[0].indexOf('verification_context_digest');
  env.sheets.tax_assessments[1][digestColumn] = '';
  assert.equal(env.previewConfirmation().data.can_confirm, false);
  assert.equal(env.preview().data.needs_review, true);
  assert.equal(env.verify({...env.decision(), status: 'NOT_APPLICABLE', amount: 0, override_reason: 'Synthetic re-review of legacy assessment.'}).ok, true);
  assert.equal(env.previewConfirmation().data.can_confirm, true);
  assert.equal(env.confirm().data.totals.net_paid_amount, 900000);
});

test('konfirmasi menolak token kedaluwarsa, proyek tidak aktif, RAB asing, serta dokumen/setoran/distribusi tertaut', () => {
  for (const change of [
    env => {env.cache.clear();},
    env => {env.sheets.projects[1][env.sheets.projects[0].indexOf('status')] = 'DRAFT';},
    env => {env.sheets.budget_categories[1][1] = env.versionB;},
    env => {env.sheets.receipts.push([randomUUID(), env.payment.payment_detail_id, 'ACTIVE']);},
    env => {env.sheets.tax_remittance_allocations.push([randomUUID(), randomUUID(), env.sheets.tax_assessments[1][0], 1]);},
    env => {env.sheets.distributions.push([randomUUID(), '', env.created.transaction_id, 'TRANSPORT', 1]);},
  ]) {
    const env = setupConfirmation();
    assert.equal(env.verify(env.decision()).ok, true);
    const payload = env.confirmationPayload();
    change(env);
    assert.equal(env.confirm(payload).error.code, 'CONFLICT');
  }
});

function setupReceipts() {
  const env = setupConfirmation();
  const required = ['receipt_id', 'payment_detail_id', 'project_id', 'receipt_no', 'issued_on', 'status', 'sequence_no', 'issued_by_user_id',
    'template_version', 'document_snapshot', 'snapshot_digest', 'row_version', 'created_at', 'updated_at'];
  env.sheets.receipts[0] = required;
  const previewReceipt = (paymentId = env.payment.payment_detail_id, account = env.owner, project = env.projectA) =>
    env.rpc(account, 'receipts.preview', project, {payload: {payment_detail_id: paymentId}});
  const issuePayload = (data = previewReceipt().data, paymentId = env.payment.payment_detail_id) => ({payment_detail_id: paymentId, preview_token: data.preview_token,
    expected_transaction_row_version: data.transaction_row_version, expected_payment_row_version: data.payment_row_version});
  const issue = (payload = issuePayload(), id = randomUUID(), account = env.owner, project = env.projectA) => env.rpc(account, 'receipts.issue', project, {request_id: id, payload});
  const get = (receiptId, account = env.owner, project = env.projectA) => env.rpc(account, 'receipts.get', project, {payload: {receipt_id: receiptId}});
  return {...env, previewReceipt, issuePayload, issue, get};
}

test('terbilang rupiah menjaga nol, belasan, seratus, seribu dan batas integer aman tanpa pembulatan', () => {
  const {rupiahWords} = setup();
  for (const [amount, expected] of [[0, 'nol rupiah'], [11, 'sebelas rupiah'], [15, 'lima belas rupiah'], [100, 'seratus rupiah'],
    [101, 'seratus satu rupiah'], [1000, 'seribu rupiah'], [1100, 'seribu seratus rupiah'], [855000, 'delapan ratus lima puluh lima ribu rupiah'],
    [1000000000000, 'satu triliun rupiah'], [9007199254740991, 'sembilan kuadriliun tujuh triliun seratus sembilan puluh sembilan miliar dua ratus lima puluh empat juta tujuh ratus empat puluh ribu sembilan ratus sembilan puluh satu rupiah']]) {
    assert.equal(rupiahWords(amount), expected);
  }
  assert.throws(() => rupiahWords(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => rupiahWords(-1));
  assert.throws(() => rupiahWords(1.5));
});

test('kwitansi hanya diterbitkan pemilik setelah konfirmasi, menyimpan netto/pejabat dan mengulang hasil tanpa nomor ganda', () => {
  const env = setupReceipts();
  const {previewReceipt, issuePayload, issue, get, editor, viewer, projectB, owner, verify, decision, confirm, sheets, writes, list} = env;
  sheets.people[0].push('nip'); sheets.people.slice(1).forEach((row, index) => row.push(index === 0 ? '001234567890123456' : ''));
  assert.equal(previewReceipt(undefined, editor).error.code, 'FORBIDDEN');
  assert.equal(previewReceipt(undefined, viewer).error.code, 'FORBIDDEN');
  assert.equal(previewReceipt(undefined, owner, projectB).error.code, 'NOT_FOUND');
  assert.equal(previewReceipt().data.can_issue, false);
  assert.equal(verify(decision()).ok, true);
  assert.equal(confirm().ok, true);
  const preview = previewReceipt().data;
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.document.payment.net_paid_amount, 855000);
  assert.equal(preview.document.payment.amount_in_words, 'delapan ratus lima puluh lima ribu rupiah');
  assert.equal(preview.document.signers.ppk.person_id, sheets.project_people[1][2]);
  assert.equal(preview.document.signers.ppk.nip, '001234567890123456');
  const payload = issuePayload(preview), id = randomUUID();
  assert.equal(issue(payload, randomUUID(), editor).error.code, 'FORBIDDEN');
  const issued = issue(payload, id);
  assert.equal(issued.data.receipt.receipt_no, '0001/KWT/2023');
  assert.equal(issued.data.receipt.issued_on, '2026-11-18');
  const batches = writes.batches;
  assert.deepEqual(issue(payload, id), issued);
  assert.equal(writes.batches, batches);
  assert.equal(issue(payload).error.code, 'CONFLICT');
  assert.equal(issue({...payload, expected_payment_row_version: payload.expected_payment_row_version + 1}, id).error.code, 'CONFLICT');
  assert.equal(get(issued.data.receipt.receipt_id, viewer).error.code, 'FORBIDDEN');
  sheets.project_members.push([randomUUID(), env.projectA, sheets.users[3][0], 'VIEWER', '']);
  assert.deepEqual(get(issued.data.receipt.receipt_id, viewer).data, issued.data);
  assert.equal(get(issued.data.receipt.receipt_id, owner, projectB).error.code, 'NOT_FOUND');
  assert.equal(list().data.transactions[0].payments[0].receipt.receipt_no, '0001/KWT/2023');
  assert.equal(list().data.confirmed_total_amount, 900000);
});

test('snapshot kwitansi tetap sama setelah master/profil/bukti berubah dan mendeteksi snapshot yang rusak', () => {
  const env = setupReceipts();
  assert.equal(env.verify(env.decision()).ok, true); assert.equal(env.confirm().ok, true);
  const issued = env.issue().data;
  env.sheets.people[1][2] = 'Nama master berubah'; env.sheets.projects[1][2] = 'Judul proyek berubah';
  env.sheets.payees[1][3] = 'Nama penerima berubah'; env.driveFiles.get(env.driveId).fail = true;
  assert.deepEqual(env.get(issued.receipt.receipt_id).data, issued);
  const column = env.sheets.receipts[0].indexOf('document_snapshot');
  const document = JSON.parse(env.sheets.receipts[1][column]); document.payment.net_paid_amount = 1;
  env.sheets.receipts[1][column] = JSON.stringify(document);
  assert.equal(env.get(issued.receipt.receipt_id).error.code, 'TEMPORARY_FAILURE');
});

test('dua pembayaran dari pratinjau sejajar mendapat nomor berbeda; kegagalan batch dan lock tidak menghabiskan nomor', () => {
  const env = setupReceipts();
  const {sheets, verify, decision, rpc, owner, projectA, created, previewReceipt, issuePayload, issue, writes} = env;
  const person = [...sheets.people[1]]; person[0] = randomUUID(); sheets.people.push(person);
  const payee = [...sheets.payees[1]]; payee[0] = randomUUID(); payee[2] = person[0]; sheets.payees.push(payee);
  const secondId = randomUUID(); sheets.payment_details.push([secondId, created.transaction_id, payee[0], 100000, 5000, 0, 95000, 1]);
  assert.equal(verify(decision()).ok, true);
  const second = rpc(owner, 'taxes.preview', projectA, {payload: {payment_detail_id: secondId}}).data;
  assert.equal(verify({...decision(second), payment_detail_id: secondId}).ok, true);
  assert.equal(env.confirm().ok, true);
  const one = issuePayload(previewReceipt().data), two = issuePayload(previewReceipt(secondId).data, secondId);
  writes.locked = true; assert.equal(issue(one).error.code, 'TEMPORARY_FAILURE'); writes.locked = false;
  writes.fail = true; const before = JSON.stringify(sheets); const id = randomUUID();
  assert.equal(issue(one, id).error.code, 'TEMPORARY_FAILURE'); assert.equal(JSON.stringify(sheets), before); writes.fail = false;
  assert.equal(issue(one, id).data.receipt.receipt_no, '0001/KWT/2023');
  assert.equal(issue(two).data.receipt.receipt_no, '0002/KWT/2023');
});

test('penerbitan menolak perubahan pejabat/bukti setelah pratinjau, pejabat hilang/ganda dan token kedaluwarsa', () => {
  for (const change of [env => {env.sheets.people[1][2] = 'PPK berubah';}, env => {env.driveFiles.get(env.driveId).modified_at = '2026-11-19T00:00:00Z';},
    env => {env.cache.clear();}, env => {env.sheets.project_people.splice(1, 1);}, env => {env.sheets.project_people.push([...env.sheets.project_people[1]]);},
  ]) {
    const env = setupReceipts(); assert.equal(env.verify(env.decision()).ok, true); assert.equal(env.confirm().ok, true);
    const payload = env.issuePayload(); change(env);
    assert.equal(env.issue(payload).error.code, 'CONFLICT'); assert.equal(env.sheets.receipts.length, 1);
  }
});

function setupStageReport() {
  const env = setupConfirmation();
  const {sheets, projectA, projectB, rpc, editor} = env;
  const stageA = randomUUID(), finalStage = randomUUID(), foreignStage = randomUUID();
  sheets.report_stages = [['report_stage_id', 'project_id', 'sequence_no', 'label', 'target_bps', 'cutoff_date', 'status', 'row_version'],
    [stageA, projectA, 1, 'Tahap 70%', 7000, '2026-11-18', 'DRAFT', 1], [finalStage, projectA, 2, 'Tahap 100%', 10000, '2026-12-31', 'DRAFT', 1],
    [foreignStage, projectB, 1, 'Tahap B', 10000, '2026-12-31', 'DRAFT', 1]];
  const set = (table, row, key, value) => {sheets[table][row][sheets[table][0].indexOf(key)] = value;};
  const preview = (stage = stageA, account = editor, project = projectA) => rpc(account, 'reports.preview', project,
    {payload: {document_kind: 'STAGE_REALIZATION', ...(stage === undefined ? {} : {report_stage_id: stage})}});
  return {...env, stageA, finalStage, foreignStage, preview, set};
}

test('rekap tahap kumulatif memakai bruto sekali, batas inklusif, multi-penerima dan mengecualikan draf/void/lintas proyek', () => {
  const env = setupStageReport();
  const {sheets, set, preview, projectA, projectB, itemA, itemB, payeeA, payeeB, stageA, finalStage, writes} = env;
  set('projects', 1, 'official_ceiling_amount', 17500000);
  set('transactions', 1, 'status', 'CONFIRMED');
  const add = (project, item, date, status, amounts) => {
    const id = randomUUID();
    sheets.transactions.push([id, project, item, '', date, 'HONOR', 'Transaksi sintetis ' + status, status, 1]);
    amounts.forEach(([gross, tax], i) => sheets.payment_details.push([randomUUID(), id, i ? payeeB : payeeA, gross, tax, 0, gross - tax, 1]));
  };
  add(projectA, itemA, '2026-11-01', 'CONFIRMED', [[400000, 20000], [600000, 30000]]);
  add(projectA, itemA, '2026-11-19', 'CONFIRMED', [[3000000, 150000]]);
  add(projectA, itemA, '2026-11-18', 'DRAFT', [[2000000, 0]]);
  add(projectA, itemA, '2026-11-18', 'VOID', [[2000000, 0]]);
  add(projectB, itemB, '2026-11-18', 'CONFIRMED', [[2000000, 0]]);
  sheets.tax_remittances = [['tax_remittance_id', 'amount'], [randomUUID(), 95000]];
  sheets.receipts.push([randomUUID(), sheets.payment_details[1][0], 'ISSUED']);
  const before = JSON.stringify(sheets), batches = writes.batches;
  const first = preview(stageA).data;
  assert.equal(first.is_final, false);
  assert.equal(first.target_amount, 12250000);
  assert.equal(first.totals.receipt_amount, 1900000);
  assert.equal(first.totals.withheld_tax_amount, 95000);
  assert.equal(first.totals.net_paid_amount, 1805000);
  assert.equal(first.transaction_count, 2);
  assert.equal(first.transactions[0].payment_count, 2);
  assert.deepEqual(first.excluded, {draft_count: 1, void_count: 1, later_confirmed_count: 1});
  assert.equal(first.target_difference_amount, -10350000);
  const final = preview(finalStage).data;
  assert.equal(final.totals.receipt_amount, 4900000);
  assert.equal(final.transaction_count, 3);
  assert.equal(final.ceiling_remaining_amount, 12600000);
  assert.equal(JSON.stringify(sheets), before);
  assert.equal(writes.batches, batches);
});

test('rekap tahap menjaga hak terkini, tahap asing, flag dan pemisahan preview kegiatan', () => {
  const env = setupStageReport();
  const {preview, owner, viewer, projectA, foreignStage, rpc, sheets, properties} = env;
  assert.equal(preview(undefined, owner).ok, true);
  assert.equal(preview(undefined, viewer).error.code, 'FORBIDDEN');
  sheets.project_members.push([randomUUID(), projectA, sheets.users[3][0], 'VIEWER', '']);
  assert.equal(preview(undefined, viewer).ok, true);
  sheets.project_members.at(-1)[4] = '2026-11-19T00:00:00Z';
  assert.equal(preview(undefined, viewer).error.code, 'FORBIDDEN');
  assert.equal(preview(foreignStage).error.code, 'NOT_FOUND');
  assert.equal(preview('not-uuid').error.code, 'VALIDATION_ERROR');
  assert.equal(rpc(owner, 'reports.preview', projectA, {payload: {document_kind: 'UNKNOWN'}}).ok, false);
  properties.TRANSACTIONS_ENABLED = 'false';
  assert.equal(preview().error.code, 'TEMPORARY_FAILURE');
});

test('rekap menolak nominal/ID/FK/status tidak konsisten, total overflow dan lock sibuk', () => {
  for (const corrupt of [
    e => {e.sheets.transactions.push([...e.sheets.transactions[1]]);},
    e => {e.sheets.payment_details.push([...e.sheets.payment_details[1]]);},
    e => {e.set('transactions', 1, 'payment_date', '2026-02-30');},
    e => {e.set('transactions', 1, 'status', 'UNKNOWN');},
    e => {e.set('payment_details', 1, 'net_paid_amount', 123);},
    e => {e.set('transactions', 1, 'budget_item_id', e.itemB);},
    e => {e.set('budget_versions', 1, 'status', 'DRAFT');},
    e => {e.sheets.payment_details.splice(1, 1);},
    e => {e.writes.locked = true;},
    e => {
      const row = [...e.sheets.transactions[1]]; row[0] = randomUUID(); e.sheets.transactions.push(row);
      e.set('payment_details', 1, 'receipt_amount', Number.MAX_SAFE_INTEGER); e.set('payment_details', 1, 'withheld_tax_amount', 0); e.set('payment_details', 1, 'net_paid_amount', Number.MAX_SAFE_INTEGER);
      const p = [...e.sheets.payment_details[1]]; p[0] = randomUUID(); p[1] = row[0]; e.sheets.payment_details.push(p);
    },
  ]) {
    const env = setupStageReport(); env.set('transactions', 1, 'status', 'CONFIRMED'); corrupt(env);
    assert.equal(env.preview().error.code, 'TEMPORARY_FAILURE');
  }
});

test('rekap menolak skema tahap cacat dan proyek lama tanpa plafon; mendukung target 60% dan pembulatan aman', () => {
  for (const corrupt of [
    e => {e.sheets.report_stages[1][4] = 10001;},
    e => {e.sheets.report_stages[2][4] = 9000;},
    e => {e.sheets.report_stages[2][5] = '2026-11-01';},
    e => {e.sheets.report_stages[1][2] = 2;},
    e => {e.sheets.report_stages[1][7] = '';},
    e => {e.set('projects', 1, 'official_ceiling_amount', '');},
  ]) {const e = setupStageReport(); corrupt(e); assert.equal(e.preview().error.code, 'TEMPORARY_FAILURE');}
  const e = setupStageReport(); e.sheets.report_stages[1][4] = 6000;
  e.set('projects', 1, 'official_ceiling_amount', 17500000);
  assert.equal(e.preview().data.target_amount, 10500000);
  e.sheets.report_stages[1][4] = 5000; e.set('projects', 1, 'official_ceiling_amount', 1);
  assert.equal(e.preview().data.target_amount, 1);
  e.set('projects', 1, 'official_ceiling_amount', Number.MAX_SAFE_INTEGER);
  e.sheets.report_stages[1][4] = 7000;
  const expected = Number((BigInt(Number.MAX_SAFE_INTEGER) * 7000n + 5000n) / 10000n);
  assert.equal(e.preview().data.target_amount, expected);
  assert.equal(e.preview(e.finalStage).data.target_amount, Number.MAX_SAFE_INTEGER);
});

test('rekap kosong dan proyek arsip tetap preview sumber terkini, RAB superseded tetap dirujuk', () => {
  const e = setupStageReport();
  assert.equal(e.preview().data.transaction_count, 0);
  assert.equal(e.preview().data.totals.receipt_amount, 0);
  e.set('transactions', 1, 'status', 'CONFIRMED');
  e.set('budget_versions', 1, 'status', 'SUPERSEDED');
  e.set('projects', 1, 'status', 'ARCHIVED'); e.sheets.report_stages[1][6] = 'FINALIZED';
  const r = e.preview().data;
  assert.equal(r.is_final, false); assert.equal(r.stage.status, 'FINALIZED');
  assert.equal(r.totals.receipt_amount, 900000); assert.equal(r.totals.net_paid_amount, 855000);
  assert.equal(JSON.stringify(r).includes('private-profile'), false);
  assert.equal(JSON.stringify(r).includes('drive_file_id'), false);
});

function setupRuleEditor() {
  const env = setupTaxes();
  const payload = Object.fromEntries(env.sheets.tax_rule_versions[0].slice(1, 12).map((field, index) => [field, env.rule[index + 1]]));
  delete payload.version_no;
  payload.eligibility = JSON.parse(payload.eligibility);
  payload.expected_latest_version = 0;
  const saveRule = (data = payload, id = randomUUID(), account = env.owner) => env.rpc(account, 'taxes.save_rule_version', undefined, {request_id: id, payload: data});
  const listRules = (account = env.owner) => env.rpc(account, 'taxes.list_rules', undefined);
  return {...env, payload, saveRule, listRules};
}

test('aturan pajak hanya dikelola pemilik, append-only, versi diperiksa dan retry tidak menduplikasi', () => {
  const {saveRule, listRules, payload, sheets, writes, editor, viewer, rpc, owner, projectA} = setupRuleEditor();
  assert.equal(listRules(editor).error.code, 'FORBIDDEN');
  assert.equal(saveRule(payload, randomUUID(), viewer).error.code, 'FORBIDDEN');
  assert.equal(rpc(owner, 'taxes.save_rule_version', projectA, {payload}).error.code, 'VALIDATION_ERROR');
  const id = randomUUID();
  const first = saveRule(payload, id);
  assert.equal(first.data.version_no, 1);
  const old = JSON.stringify(sheets.tax_rule_versions[1]);
  const batches = writes.batches;
  assert.deepEqual(saveRule(payload, id), first);
  assert.equal(writes.batches, batches);
  assert.equal(saveRule({...payload, rate_bps: 600}, id).error.code, 'CONFLICT');
  assert.equal(saveRule(payload).error.code, 'CONFLICT');
  const second = saveRule({...payload, expected_latest_version: 1, rate_bps: 600});
  assert.equal(second.data.version_no, 2);
  assert.equal(JSON.stringify(sheets.tax_rule_versions[1]), old);
  assert.equal(listRules().data.rules.length, 2);
  const audits = sheets.audit_log.slice(1).map(row => Object.fromEntries(sheets.audit_log[0].map((field, index) => [field, row[index]])))
    .filter(row => row.action === 'taxes.save_rule_version');
  assert.equal(audits.length, 2);
  assert.equal(audits[0].project_id, '');
  assert.equal(JSON.parse(audits[1].change_summary).after.rate_bps, 600);
});

test('aturan menolak data invalid/perubahan jenis dan gagal batch tidak menerbitkan versi atau jurnal sebagian', () => {
  const {saveRule, payload, sheets, writes, properties, listRules} = setupRuleEditor();
  for (const invalid of [{rate_bps: 0.5}, {rate_bps: 10001}, {effective_from: '2026-02-30'}, {effective_to: '2025-12-31'},
    {source_ref: ' '}, {rule_code: 'lower'}, {eligibility: {unknown: true}}, {eligibility: {civil_service_grades: ['III/a', 'III/a']}},
    {eligibility: {civil_service_grades: [' ']}}, {expected_latest_version: Number.MAX_SAFE_INTEGER}]) {
    assert.equal(saveRule({...payload, ...invalid}).error.code, 'VALIDATION_ERROR', JSON.stringify(invalid));
  }
  const before = JSON.stringify(sheets);
  writes.fail = true;
  assert.equal(saveRule().error.code, 'TEMPORARY_FAILURE');
  assert.equal(JSON.stringify(sheets), before);
  writes.fail = false;
  assert.equal(saveRule().ok, true);
  assert.equal(saveRule({...payload, expected_latest_version: 1, tax_kind: 'CHANGED_KIND'}).error.code, 'VALIDATION_ERROR');
  properties.TAXES_ENABLED = 'false';
  assert.equal(listRules().error.code, 'TEMPORARY_FAILURE');
});

test('versi aturan dipilih menurut tanggal, mendahului filter golongan, dan penilaian lama tetap tersimpan untuk ditinjau', () => {
  const {saveRule, payload, preview, verify, decision, sheets, payment} = setupRuleEditor();
  const first = saveRule().data;
  assert.equal(preview().data.proposal.amount, 45000);
  assert.equal(verify(decision()).ok, true);
  const snapshot = JSON.stringify(sheets.tax_assessments);
  const staleDecision = decision();
  assert.equal(saveRule({...payload, expected_latest_version: 1, effective_from: '2026-12-01', rate_bps: 600}).ok, true);
  assert.equal(preview().data.proposal.tax_rule_version_id, first.tax_rule_version_id);
  assert.equal(saveRule({...payload, expected_latest_version: 2, effective_from: '2026-11-18', rate_bps: 700}).ok, true);
  assert.equal(preview().data.proposal.amount, 63000);
  assert.equal(preview().data.needs_review, true);
  assert.equal(JSON.stringify(sheets.tax_assessments), snapshot);
  assert.equal(preview().data.payment.withheld_tax_amount, 45000);
  assert.equal(verify(staleDecision).error.code, 'CONFLICT');
  assert.equal(saveRule({...payload, expected_latest_version: 3, eligibility: {civil_service_grades: ['IV/a']}}).ok, true);
  assert.equal(preview().data.proposal.reason, 'NO_MATCHING_RULE');
  const paymentDate = sheets.transactions[0].indexOf('payment_date');
  sheets.transactions[1][paymentDate] = '2026-11-17';
  // Version 4's period covers this earlier date as well; never fall back to a prior grade condition.
  assert.equal(preview().data.proposal.reason, 'NO_MATCHING_RULE');
  assert.equal(saveRule({...payload, rule_code: 'SECOND_SYNTHETIC', eligibility: {}}).ok, true);
  assert.equal(preview().data.proposal.amount, 45000);
  assert.ok(payment.payment_detail_id);
});

test('batas tanggal versi inklusif dan versi lama hanya kembali menjadi acuan di luar periode versi baru', () => {
  const {saveRule, payload, sheets, preview} = setupRuleEditor();
  const old = saveRule().data;
  const next = saveRule({...payload, expected_latest_version: 1, effective_from: '2026-11-18', effective_to: '2026-11-19', rate_bps: 600}).data;
  const dateColumn = sheets.transactions[0].indexOf('payment_date');
  for (const [date, id, amount] of [['2026-11-17', old.tax_rule_version_id, 45000],
    ['2026-11-18', next.tax_rule_version_id, 54000], ['2026-11-19', next.tax_rule_version_id, 54000],
    ['2026-11-20', old.tax_rule_version_id, 45000]]) {
    sheets.transactions[1][dateColumn] = date;
    const result = preview().data.proposal;
    assert.equal(result.tax_rule_version_id, id, date);
    assert.equal(result.amount, amount, date);
  }
});

test('pratinjau pajak memakai tanggal/golongan, menghindari aturan tumpang tindih, dan menghitung basis point tanpa overflow', () => {
  const {preview, sheets, rule, taxAmount, editor, viewer, driveReads} = setupTaxes();
  assert.equal(taxAmount(900000, 500), 45000);
  assert.equal(taxAmount(1, 5000), 1);
  assert.equal(taxAmount(Number.MAX_SAFE_INTEGER, 10000), Number.MAX_SAFE_INTEGER);
  assert.equal(taxAmount(Number.MAX_SAFE_INTEGER + 1, 500), null);
  assert.equal(preview().data.proposal.reason, 'NO_MATCHING_RULE');
  sheets.tax_rule_versions.push(rule);
  assert.equal(preview().data.proposal.amount, 45000);
  assert.equal(preview().data.proposal.status, 'PENDING');
  const profileRef = sheets.payees[1][4];
  sheets.payees[1][4] = '';
  assert.equal(preview().data.proposal.reason, 'PROFILE_INCOMPLETE');
  sheets.payees[1][4] = profileRef;
  driveReads.length = 0;
  assert.equal(preview(editor).data.proposal.amount, 45000);
  assert.equal(preview(editor).data.can_verify, false);
  assert.equal(preview(editor).data.evidence.length, 0);
  assert.equal(JSON.stringify(preview(editor).data).includes('private-profile-A'), false);
  assert.deepEqual(driveReads, []);
  assert.equal(preview(viewer).error.code, 'FORBIDDEN');
  sheets.tax_rule_versions.push([randomUUID(), ...rule.slice(1)]);
  sheets.tax_rule_versions[2][1] = 'OTHER_SYNTHETIC_HONOR';
  sheets.tax_rule_versions[2][2] = 2;
  assert.equal(preview().data.proposal.reason, 'OVERLAPPING_RULES');
  assert.equal(preview().data.proposal.amount, null);
  sheets.tax_rule_versions.pop();
  sheets.tax_rule_versions[1][10] = '2026-11-17';
  assert.equal(preview().data.proposal.reason, 'NO_MATCHING_RULE');
  sheets.tax_rule_versions[1][10] = '2026-12-31';
  sheets.people[1][3] = '';
  assert.equal(preview().data.proposal.reason, 'PROFILE_INCOMPLETE');
  sheets.people[1][3] = 'III/a';
  sheets.transactions[1][5] = 'SNACK';
  sheets.tax_rule_versions[1][4] = 'SNACK';
  assert.equal(preview().data.proposal.reason, 'CLASSIFICATION_REVIEW_REQUIRED');
  assert.equal(preview().data.proposal.amount, null);
});

test('verifikasi pajak hanya oleh pemilik, menyimpan versi/bukti/referensi, memperbarui netto atomik, dan mengaudit koreksi', () => {
  const {preview, verify, decision, sheets, rule, editor, writes, list} = setupTaxes();
  sheets.tax_rule_versions.push(rule);
  const payload = decision();
  assert.equal(verify(payload, randomUUID(), editor).error.code, 'FORBIDDEN');
  const id = randomUUID();
  writes.fail = true;
  assert.equal(verify(payload, id).error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.tax_assessments.length, 1);
  assert.equal(sheets.payment_details[1][7], 1);
  writes.fail = false;
  const first = verify(payload, id).data;
  assert.equal(first.net_paid_amount, 855000);
  assert.equal(first.payment_row_version, 2);
  assert.equal(first.transaction_row_version, 2);
  assert.deepEqual(verify(payload, id).data, first);
  assert.equal(verify({...payload, amount: 1}, id).error.code, 'CONFLICT');
  const reviewed = preview().data;
  assert.equal(reviewed.needs_review, false);
  assert.equal(reviewed.assessment.tax_rule_version_id, rule[0]);
  assert.equal(JSON.parse(reviewed.assessment.rule_snapshot).rate_bps, 500);
  assert.equal(reviewed.assessment.evidence_row_version, 1);
  assert.equal(reviewed.assessment.decision_source_ref, payload.decision_source_ref);
  assert.equal(preview(editor).data.assessment.evidence_drive_file_id, undefined);
  assert.equal(list().data.transactions[0].status, 'DRAFT');
  assert.equal(list().data.confirmed_total_amount, 0);
  assert.equal(list().data.transactions[0].can_edit, false);
  const corrected = {...decision(reviewed), status: 'NOT_APPLICABLE', tax_rule_version_id: '', amount: 0};
  assert.equal(verify(corrected).error.code, 'VALIDATION_ERROR');
  const correctionId = randomUUID();
  corrected.override_reason = 'Synthetic correction according to reviewed evidence';
  const second = verify(corrected, correctionId).data;
  assert.equal(second.net_paid_amount, 900000);
  assert.equal(second.status, 'NOT_APPLICABLE');
  assert.equal(sheets.tax_assessments.length, 2);
  assert.equal(sheets.tax_assessments[1][0], first.tax_assessment_id);
  const audit = JSON.parse(sheets.audit_log[3][8]);
  assert.equal(audit.before.amount, 45000);
  assert.equal(audit.after.amount, 0);
  assert.equal(audit.after.override_reason, corrected.override_reason);
  assert.equal(writes.batches, 3);
  assert.equal(writes.locked, false);
});

test('verifikasi pajak menolak perubahan bukti/versi, bukti publik/asing, token lama, serta pembayaran yang tertaut setoran', () => {
  const {preview, verify, decision, sheets, rule, evidenceId, driveId, driveFiles, cache, owner, projectB} = setupTaxes();
  sheets.tax_rule_versions.push(rule);
  assert.equal(preview(owner, projectB).error.code, 'NOT_FOUND');
  let payload = decision();
  sheets.tax_rule_versions[1][8] = 501;
  assert.equal(verify(payload).error.code, 'CONFLICT');
  sheets.tax_rule_versions[1][8] = 500;
  const profileRef = sheets.payees[1][4];
  sheets.payees[1][4] = 'changed-private-profile';
  assert.equal(verify(payload).error.code, 'CONFLICT');
  sheets.payees[1][4] = profileRef;
  driveFiles.get(driveId).modified_at = '2026-11-18T01:00:00.000Z';
  assert.equal(verify(payload).error.code, 'CONFLICT');
  payload = decision();
  assert.equal(verify({...payload, evidence_attachment_id: randomUUID()}).error.code, 'VALIDATION_ERROR');
  assert.equal(verify({...payload, expected_payment_row_version: 99}).error.code, 'CONFLICT');
  cache.clear();
  assert.equal(verify(payload).error.code, 'CONFLICT');
  driveFiles.get(driveId).access = 'ANYONE_WITH_LINK';
  const unavailable = preview().data;
  assert.equal(unavailable.evidence[0].available, false);
  assert.equal(verify(decision(unavailable)).error.code, 'VALIDATION_ERROR');
  driveFiles.get(driveId).access = 'PRIVATE';
  const firstPayload = decision();
  const firstId = randomUUID();
  const first = verify(firstPayload, firstId).data;
  driveFiles.get(driveId).modified_at = '2026-11-18T02:00:00.000Z';
  assert.deepEqual(verify(firstPayload, firstId).data, first);
  assert.equal(preview().data.needs_review, true);
  const correction = {...decision(), override_reason: 'Synthetic correction after evidence update'};
  sheets.tax_remittance_allocations.push([randomUUID(), randomUUID(), first.tax_assessment_id, 45000, 1]);
  assert.equal(preview().data.can_verify, false);
  assert.equal(verify(correction).error.code, 'CONFLICT');
});

test('transaksi menghitung netto di server, menjaga versi dan audit, serta mengulang hasil tanpa duplikasi', () => {
  const {payload, save, list, sheets, properties, writes, rpc, owner, projectA} = setupTransactions();
  assert.equal(list().error.code, 'TEMPORARY_FAILURE');
  properties.TRANSACTIONS_ENABLED = 'true';
  assert.equal(rpc(owner, 'projects.get', projectA).data.transactions_enabled, true);
  assert.equal(list().data.confirmed_total_amount, 0);
  const id = randomUUID();
  const submitted = {...payload, transaction: {...payload.transaction, status: 'CONFIRMED'},
    payments: [{...payload.payments[0], net_paid_amount: 1}]};
  writes.fail = true;
  assert.equal(save(submitted, id).error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.transactions.length, 1);
  assert.equal(sheets.payment_details.length, 1);
  assert.equal(sheets.audit_log.length, 1);
  writes.fail = false;
  const created = save(submitted, id).data;
  assert.equal(created.status, 'DRAFT');
  assert.deepEqual(created.totals, {receipt_amount: 900000, withheld_tax_amount: 45000, added_tax_amount: 0, net_paid_amount: 855000});
  assert.deepEqual(save(submitted, id).data, created);
  assert.equal(save(payload, id).error.code, 'CONFLICT');
  let row = list().data.transactions[0];
  assert.equal(row.description, '=Honor sintetis');
  assert.equal(row.payments[0].net_paid_amount, 855000);
  assert.equal(list().data.draft_total_amount, 900000);
  assert.equal(list().data.confirmed_total_amount, 0);
  const createdAt = sheets.transactions[1][9];
  const edit = {...payload, transaction_id: row.transaction_id, expected_row_version: row.row_version,
    expected_payment_versions: {[row.payments[0].payment_detail_id]: row.payments[0].row_version},
    payments: [{...payload.payments[0], payment_detail_id: row.payments[0].payment_detail_id, receipt_amount: 1000000}]};
  const editId = randomUUID();
  assert.equal(save(edit, editId).data.row_version, 2);
  assert.equal(save(edit, editId).data.totals.net_paid_amount, 955000);
  assert.equal(save(edit).error.code, 'CONFLICT');
  assert.equal(sheets.transactions[1][9], createdAt);
  assert.equal(sheets.transactions.length, 2);
  assert.equal(sheets.payment_details.length, 2);
  const audit = JSON.parse(sheets.audit_log[2][8]);
  assert.equal(audit.before_payments[0].receipt_amount, 900000);
  assert.equal(audit.after_payments[0].receipt_amount, 1000000);
  row = list().data.transactions[0];
  sheets.tax_assessments.push([randomUUID(), row.payments[0].payment_detail_id, 'PENDING']);
  assert.equal(list().data.transactions[0].can_edit, false);
  assert.equal(save({...edit, expected_row_version: 2}).error.code, 'CONFLICT');
  assert.equal(writes.batches, 2);
  assert.equal(writes.locked, false);
});

test('transaksi menolak rupiah tidak aman, referensi lintas proyek, penerima tanpa cakupan, dan versi pembayaran lama', () => {
  const {save, list, payload, itemB, payeeB, viewer, owner, projectB, sheets, properties} = setupTransactions();
  properties.TRANSACTIONS_ENABLED = 'true';
  assert.equal(save(payload, randomUUID(), viewer, projectB).error.code, 'FORBIDDEN');
  assert.equal(list(viewer).error.code, 'FORBIDDEN');
  assert.equal(save({...payload, transaction: {...payload.transaction, budget_item_id: itemB}}).error.code, 'VALIDATION_ERROR');
  assert.equal(save({...payload, transaction: {...payload.transaction, activity_id: randomUUID()}}).error.code, 'NOT_FOUND');
  assert.equal(save({...payload, payments: [{...payload.payments[0], payee_id: payeeB}]}).error.code, 'FORBIDDEN');
  assert.equal(list().data.payees.some(row => row.payee_id === payeeB), false);
  assert.equal(JSON.stringify(list(owner).data).includes('private-profile'), false);
  for (const payment of [{receipt_amount: 1.5}, {receipt_amount: Number.MAX_SAFE_INTEGER + 1}, {withheld_tax_amount: 900001},
    {withheld_tax_amount: -1}, {added_tax_amount: 1}]) {
    assert.equal(save({...payload, payments: [{...payload.payments[0], ...payment}]}).error.code, 'VALIDATION_ERROR');
  }
  assert.equal(save({...payload, payments: [payload.payments[0], payload.payments[0]]}).error.code, 'VALIDATION_ERROR');
  assert.equal(save({...payload, payments: [
    {...payload.payments[0], receipt_amount: Number.MAX_SAFE_INTEGER, withheld_tax_amount: 0},
    {payee_id: payeeB, receipt_amount: 1, withheld_tax_amount: 0},
  ]}, randomUUID(), owner).error.code, 'VALIDATION_ERROR');
  const created = save().data;
  const row = list().data.transactions[0];
  const edit = {...payload, transaction_id: created.transaction_id, expected_row_version: 1,
    expected_payment_versions: {[row.payments[0].payment_detail_id]: 99}, payments: [payload.payments[0]]};
  assert.equal(save(edit).error.code, 'CONFLICT');
  sheets.payment_details[1][6] = 1;
  assert.equal(list().error.code, 'TEMPORARY_FAILURE');
  sheets.payment_details[1][6] = 855000;
  sheets.transactions[1][7] = 'CONFIRMED';
  assert.equal(list().data.draft_total_amount, 0);
  assert.equal(list().data.confirmed_total_amount, 900000);
  assert.equal(list().data.transactions[0].can_edit, false);
  sheets.projects[1][4] = 'ARCHIVED';
  assert.equal(list().data.can_write, false);
  assert.equal(save().error.code, 'VALIDATION_ERROR');
});

test('transaksi mempertahankan item versi RAB lama dan melarang draf baru memakainya setelah revisi', () => {
  const {save, list, payload, versionA, projectA, sheets, properties} = setupTransactions();
  properties.TRANSACTIONS_ENABLED = 'true';
  const created = save().data;
  const payment = list().data.transactions[0].payments[0];
  sheets.budget_versions[1][3] = 'SUPERSEDED';
  const nextVersion = randomUUID(); const nextCategory = randomUUID(); const nextItem = randomUUID();
  sheets.budget_versions.push([nextVersion, projectA, 2, 'APPROVED', '', '', 1]);
  sheets.budget_categories.push([nextCategory, nextVersion, 'A2', 'Kegiatan revisi', 1, 1]);
  sheets.budget_items.push([nextItem, nextCategory, 'Honor revisi', 1, 1, 'paket', 900000, 1]);
  sheets.projects[1][5] = nextVersion;
  assert.equal(save(payload).error.code, 'VALIDATION_ERROR');
  const edit = {...payload, transaction_id: created.transaction_id, expected_row_version: 1,
    expected_payment_versions: {[payment.payment_detail_id]: payment.row_version}, payments: [{...payload.payments[0], payment_detail_id: payment.payment_detail_id}]};
  assert.equal(save(edit).data.row_version, 2);
  assert.equal(list().data.transactions[0].budget_version_no, 1);
  assert.equal(list().data.budget_items.find(row => row.budget_item_id === payload.transaction.budget_item_id).is_current, false);
  assert.equal(save({...payload, transaction: {...payload.transaction, budget_item_id: nextItem}}).data.status, 'DRAFT');
});

test('penyuntingan kegiatan menjaga ID, memeriksa versi seluruh rundown, dan mengganti sesi atomik', () => {
  const {rpc, editor, owner, viewer, projectA, projectB, activityA, activityB, sheets, writes} = setupActivityDocuments();
  const read = () => rpc(editor, 'activities.get', projectA, {payload: {activity_id: activityA}}).data;
  const old = read();
  assert.equal(old.can_write, true);
  const payload = {activity_id: activityA, expected_row_version: 1,
    expected_agenda_versions: Object.fromEntries(old.agenda.map(row => [row.agenda_item_id, row.row_version])),
    activity: {activity_kind: 'FGD', title: 'Judul direvisi', activity_date: '2026-11-18', location: 'Ruang revisi'},
    agenda: [{agenda_item_id: old.agenda[0].agenda_item_id, start_time: '09:00', end_time: '09:30', title: 'Sesi diperbaiki'},
      {start_time: '09:30', end_time: '10:00', title: 'Sesi baru'}]};
  const requestId = randomUUID();
  const save = (data = payload, request_id = requestId, account = editor, project = projectA) =>
    rpc(account, 'activities.save', project, {payload: data, request_id});
  assert.equal(save({...payload, expected_agenda_versions: {}}).error.code, 'CONFLICT');
  assert.equal(save({...payload, agenda: [{...payload.agenda[0], agenda_item_id: sheets.agenda_items[4][0]}]}).error.code, 'VALIDATION_ERROR');
  assert.equal(save({...payload, activity_id: activityB}, requestId, owner).error.code, 'NOT_FOUND');
  assert.equal(save({...payload, activity_id: activityB}, requestId, viewer, projectB).error.code, 'FORBIDDEN');
  writes.fail = true;
  assert.equal(save().error.code, 'TEMPORARY_FAILURE');
  assert.equal(read().agenda.length, 3);
  assert.equal(read().activity.row_version, 1);
  writes.fail = false;
  assert.deepEqual(save().data, {activity_id: activityA, status: 'DRAFT', row_version: 2});
  assert.deepEqual(save().data, {activity_id: activityA, status: 'DRAFT', row_version: 2});
  assert.equal(save(payload, randomUUID()).error.code, 'CONFLICT');
  const after = read();
  assert.equal(after.activity.title, 'Judul direvisi');
  assert.equal(after.agenda.length, 2);
  assert.equal(after.agenda[0].agenda_item_id, old.agenda[0].agenda_item_id);
  assert.equal(after.agenda[0].row_version, 2);
  assert.equal(sheets.agenda_items.filter(row => row[1] === activityB).length, 1);
  assert.equal(sheets.logbook_entries[1][2], activityA);
  assert.equal(sheets.activity_participants[1][1], activityA);
  assert.equal(sheets.activities[1][8], '2026-11-18T00:00:00.000Z');
  const clear = {...payload, expected_row_version: 2, agenda: [],
    expected_agenda_versions: Object.fromEntries(after.agenda.map(row => [row.agenda_item_id, row.row_version]))};
  assert.equal(save(clear, randomUUID()).data.row_version, 3);
  assert.equal(read().agenda.length, 0);
  assert.equal(sheets.agenda_items.length, 2);
  assert.equal(sheets.audit_log.length, 3);
  assert.equal(writes.locked, false);
});

test('paket pratinjau membaca rundown/logbook/hadir/distribusi dari satu kegiatan dan menolak akses silang', () => {
  const {rpc, editor, viewer, projectA, projectB, activityA, activityB, properties, writes} = setupActivityDocuments();
  const preview = (account = editor, project = projectA, activity = activityA) => rpc(account, 'reports.preview', project,
    {payload: {activity_id: activity, document_kind: 'ACTIVITY_PACKAGE'}});
  assert.equal(preview().error.code, 'TEMPORARY_FAILURE');
  properties.ACTIVITY_REPORTS_ENABLED = 'true';
  assert.equal(preview(viewer).error.code, 'FORBIDDEN');
  assert.equal(preview(editor, projectA, activityB).error.code, 'NOT_FOUND');
  const data = preview().data;
  assert.equal(data.is_final, false);
  assert.equal(data.template_version, 'activity-draft-v1');
  assert.equal(data.activity.activity_id, activityA);
  assert.equal(data.agenda.length, 3);
  assert.deepEqual(data.logbook.map(row => row.description), ['Uraian A']);
  assert.equal(data.participants[0].attendance_status, 'ABSENT');
  assert.equal(data.distributions.find(row => row.distribution_kind === 'TRANSPORT').total_quantity, 1);
  assert.equal(data.distributions.find(row => row.distribution_kind === 'SNACK').rows.length, 0);
  assert.equal(preview(viewer, projectB, activityB).data.logbook[0].description, 'Uraian rahasia B');
  writes.locked = true;
  assert.equal(preview().error.code, 'TEMPORARY_FAILURE');
  writes.locked = false;
  assert.equal(writes.batches, 0);
});

test('impor peserta memerlukan pratinjau terikat pengguna/kegiatan dan menjaga deduplikasi per kegiatan', () => {
  const {call, preview, enroll, rows, owner, viewer, editor, projectA, projectB, activityB, sheets, properties, writes, cache} = setupParticipants();
  assert.equal(preview().error.code, 'TEMPORARY_FAILURE');
  properties.PARTICIPANTS_ENABLED = 'true';
  assert.equal(call('participants.list', {}, viewer).error.code, 'FORBIDDEN');
  assert.equal(call('participants.preview_import', {activity_id: activityB, rows}, viewer, projectB).error.code, 'FORBIDDEN');
  assert.equal(call('participants.list', {activity_id: activityB}).error.code, 'NOT_FOUND');
  assert.equal(call('participants.preview_import', {rows: [...rows, {...rows[0], source_row: 3}]}).data.summary.correction, 2);
  const invalid = call('participants.preview_import', {rows: [{...rows[0], person_id: randomUUID()}]}).data;
  assert.equal(invalid.summary.correction, 1);
  const plan = preview().data;
  const stalePlan = preview().data;
  assert.equal(plan.results[0].display_name, sheets.people[1][2]);
  const commitId = randomUUID();
  const commit = (payload = {rows, import_token: plan.import_token}, account = editor) =>
    call('participants.commit_import', payload, account, projectA, commitId);
  assert.equal(commit(undefined, owner).error.code, 'CONFLICT');
  assert.equal(commit({rows, import_token: plan.import_token, activity_id: activityB}).error.code, 'NOT_FOUND');
  writes.fail = true;
  assert.equal(commit().error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.activity_participants.length, 1);
  assert.equal(sheets.audit_log.length, 1);
  writes.fail = false;
  assert.deepEqual(commit().data, {imported: 1, duplicate: 0, correction: 0});
  assert.deepEqual(commit().data, {imported: 1, duplicate: 0, correction: 0});
  assert.equal(writes.batches, 1);
  assert.equal(call('participants.commit_import', {rows, import_token: stalePlan.import_token}).error.code, 'CONFLICT');
  assert.equal(preview().data.summary.duplicate, 1);
  assert.equal(enroll().error.code, 'VALIDATION_ERROR');
  const second = call('participants.preview_import', {rows, activity_id: activityB}, owner, projectB).data;
  assert.equal(second.summary.valid, 1);
  assert.equal(call('participants.commit_import', {rows, import_token: second.import_token, activity_id: activityB}, owner, projectB).data.imported, 1);
  const expired = call('participants.preview_import', {rows: [{...rows[0], person_id: sheets.people[2][0]}]}).data;
  cache.clear();
  assert.equal(call('participants.commit_import', {rows: [{...rows[0], person_id: sheets.people[2][0]}], import_token: expired.import_token}).error.code, 'CONFLICT');
  assert.equal(call('participants.list').data.participants.length, 1);
});

test('kehadiran dan distribusi terpisah, memakai versi/audit/idempotensi serta menolak hubungan lintas kegiatan', () => {
  const {call, enroll, rows, activityB, owner, viewer, projectB, sheets, properties, writes} = setupParticipants();
  properties.PARTICIPANTS_ENABLED = 'true';
  enroll();
  const participant = call('participants.list').data.participants[0];
  const attendance = {activity_participant_id: participant.activity_participant_id, expected_row_version: 1, attendance_status: 'ABSENT'};
  assert.equal(call('participants.save', attendance).data.row_version, 2);
  assert.equal(call('participants.save', attendance).error.code, 'CONFLICT');
  const distribution = {activity_participant_id: participant.activity_participant_id, expected_row_version: 0,
    distribution_kind: 'TRANSPORT', quantity: 1, received_at: '2026-11-18T09:00:00.000Z'};
  const id = randomUUID();
  const save = (payload = distribution, request_id = id) => call('distributions.save', payload, undefined, undefined, request_id);
  assert.equal(call('distributions.save', {...distribution, activity_id: activityB}, viewer, projectB).error.code, 'FORBIDDEN');
  assert.equal(call('distributions.save', {...distribution, activity_id: activityB}, owner, projectB).error.code, 'NOT_FOUND');
  for (const payload of [{...distribution, quantity: 1.5}, {...distribution, received_at: '2026-02-30T09:00:00.000Z'},
    {...distribution, quantity: 0}, {...distribution, transaction_id: randomUUID()}]) {
    assert.equal(save(payload).error.code, 'VALIDATION_ERROR');
  }
  writes.fail = true;
  assert.equal(save().error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.distributions.length, 1);
  writes.fail = false;
  const result = save().data;
  assert.deepEqual(save().data, result);
  let current = call('participants.list').data.participants[0];
  assert.equal(current.attendance_status, 'ABSENT');
  assert.equal(current.distributions[0].quantity, 1);
  assert.equal(current.row_version, 2);
  assert.equal(save({...distribution, quantity: 2}, randomUUID()).error.code, 'CONFLICT');
  assert.equal(save({...distribution, expected_row_version: 1, quantity: 0, received_at: ''}, randomUUID()).data.row_version, 2);
  current = call('participants.list').data.participants[0];
  assert.equal(current.attendance_status, 'ABSENT');
  assert.equal(current.distributions[0].quantity, 0);
  assert.equal(sheets.distributions.length, 2);
  const duplicatedPlan = call('participants.preview_import', {rows: [{...rows[0], attendance_status: 'PRESENT'}]}).data;
  assert.equal(duplicatedPlan.summary.duplicate, 1);
  assert.equal(call('participants.list').data.participants[0].attendance_status, 'ABSENT');
  sheets.distributions[1][2] = randomUUID();
  assert.equal(save({...distribution, expected_row_version: 2}, randomUUID()).error.code, 'CONFLICT');
  sheets.projects[1][4] = 'ARCHIVED';
  assert.equal(call('participants.list').data.can_write, false);
  assert.equal(call('participants.save', {...attendance, expected_row_version: 2}).error.code, 'VALIDATION_ERROR');
  assert.deepEqual(save().data, result);
  assert.equal(writes.locked, false);
});

test('logbook membuat dan menyunting entri dengan versi, audit, batch atomik, dan retry idempoten', () => {
  const {rpc, owner, editor, projectA, activityA, sheets, properties, writes} = setupLogbook();
  const data = {entry_date: '2026-11-18', description: '=Diskusi rancangan', result: 'Rancangan diperbaiki', activity_id: activityA};
  const createId = randomUUID();
  const save = (payload, request_id = randomUUID()) => rpc(editor, 'logbook.save', projectA, {payload, request_id});
  const list = () => rpc(editor, 'logbook.list', projectA);
  assert.equal(list().error.code, 'TEMPORARY_FAILURE');
  properties.LOGBOOK_ENABLED = 'true';
  assert.equal(rpc(owner, 'projects.get', projectA).data.logbook_enabled, true);
  assert.deepEqual(list().data.entries, []);
  assert.equal(list().data.can_write, true);
  writes.fail = true;
  assert.equal(save(data, createId).error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.logbook_entries.length, 1);
  assert.equal(sheets.audit_log.length, 1);
  assert.equal(sheets.mutation_requests.length, 1);
  assert.equal(writes.locked, false);
  writes.fail = false;
  const created = save(data, createId).data;
  assert.equal(created.row_version, 1);
  assert.deepEqual(save(data, createId).data, created);
  assert.equal(save({...data, result: 'Diubah'}, createId).error.code, 'CONFLICT');
  const entry = list().data.entries[0];
  assert.equal(entry.description, data.description);
  assert.equal(entry.activity_title, 'FGD Sintetis A');
  const createdColumn = sheets.logbook_entries[0].indexOf('created_at');
  const createdAt = sheets.logbook_entries[1][createdColumn];
  const editedData = {...data, logbook_entry_id: created.logbook_entry_id, expected_row_version: 1,
    activity_id: '', result: 'Hasil setelah koreksi'};
  const editId = randomUUID();
  writes.fail = true;
  assert.equal(save(editedData, editId).error.code, 'TEMPORARY_FAILURE');
  assert.equal(list().data.entries[0].result, data.result);
  writes.fail = false;
  const edited = save(editedData, editId).data;
  assert.equal(edited.row_version, 2);
  assert.deepEqual(save(editedData, editId).data, edited);
  assert.equal(save(editedData).error.code, 'CONFLICT');
  assert.deepEqual(save(data, createId).data, created);
  assert.equal(sheets.logbook_entries[1][createdColumn], createdAt);
  assert.equal(sheets.logbook_entries.length, 2);
  assert.equal(sheets.audit_log.length, 3);
  assert.equal(sheets.mutation_requests.length, 3);
  const audit = JSON.parse(sheets.audit_log[2][8]);
  assert.equal(audit.before.result, data.result);
  assert.equal(audit.after.result, editedData.result);
  assert.equal(list().data.entries[0].activity_title, '');
  assert.equal(writes.batches, 2);
  sheets.projects[1][4] = 'ARCHIVED';
  assert.equal(list().data.can_write, false);
  assert.equal(save(data).error.code, 'VALIDATION_ERROR');
  assert.deepEqual(save(editedData, editId).data, edited);
});

test('logbook menolak akses, kegiatan/entri lintas proyek, tanggal salah, serta versi kosong', () => {
  const {rpc, owner, editor, viewer, projectA, projectB, activityA, activityB, sheets, properties, writes} = setupLogbook();
  properties.LOGBOOK_ENABLED = 'true';
  const payload = {entry_date: '2026-11-18', description: 'Kajian literatur', result: 'Daftar rujukan'};
  const save = (data = payload, account = editor, project = projectA) => rpc(account, 'logbook.save', project, {payload: data});
  assert.equal(save(payload, editor, projectB).error.code, 'FORBIDDEN');
  assert.equal(save(payload, viewer, projectB).error.code, 'FORBIDDEN');
  assert.equal(rpc(viewer, 'logbook.list', projectA).error.code, 'FORBIDDEN');
  assert.equal(rpc(viewer, 'logbook.list', projectB).data.can_write, false);
  for (const invalid of [
    {...payload, entry_date: '2026-02-30'}, {...payload, description: ' '}, {...payload, result: 'x'.repeat(4001)},
    {...payload, logbook_entry_id: randomUUID()}, {...payload, activity_id: null},
  ]) assert.equal(save(invalid).error.code, 'VALIDATION_ERROR');
  assert.equal(save({...payload, activity_id: activityB}).error.code, 'NOT_FOUND');
  const foreign = save(payload, owner, projectB).data;
  assert.equal(save({...payload, logbook_entry_id: foreign.logbook_entry_id, expected_row_version: 1}).error.code, 'NOT_FOUND');
  assert.equal(rpc(editor, 'logbook.list', projectA).data.entries.length, 0);
  assert.deepEqual(rpc(editor, 'logbook.list', projectA).data.activities.map(row => row.activity_id), [activityA]);
  writes.locked = true;
  assert.equal(save().error.code, 'TEMPORARY_FAILURE');
  writes.locked = false;
  assert.equal(save().data.row_version, 1);
  assert.equal(rpc(editor, 'logbook.list', projectA).data.entries[0].activity_id, '');
  sheets.project_members[1][4] = '2026-11-18T00:00:00Z';
  assert.equal(rpc(editor, 'logbook.list', projectA).error.code, 'FORBIDDEN');
  assert.equal(save().error.code, 'FORBIDDEN');
});

test('kegiatan dan rundown terikat proyek, disimpan atomik, serta tidak terduplikasi saat retry', () => {
  const {rpc, owner, editor, viewer, projectA, projectB, sheets, properties, writes} = setup();
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('status');
  sheets.projects.slice(1).forEach(row => row.push('ACTIVE'));
  sheets.activities = [['activity_id', 'project_id', 'activity_kind', 'title', 'activity_date', 'location', 'status', ...stamp]];
  sheets.agenda_items = [['agenda_item_id', 'activity_id', 'start_time', 'end_time', 'title', 'speaker_person_id', ...stamp]];
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...stamp]];
  const payload = {
    activity: {activity_kind: 'FGD', title: '=FGD sintetis', activity_date: '2026-11-18', location: 'Ruang uji'},
    agenda: [
      {start_time: '09:00', end_time: '10:00', title: 'Pembukaan', speaker_person_id: sheets.people[1][0]},
      {start_time: '10:00', end_time: '11:00', title: 'Diskusi'},
    ],
  };
  const request_id = randomUUID();
  const save = (data = payload, account = editor, project = projectA, id = request_id) =>
    rpc(account, 'activities.save', project, {request_id: id, payload: data});
  const list = (account = editor, project = projectA) => rpc(account, 'activities.list', project);
  assert.equal(list().error.code, 'TEMPORARY_FAILURE');
  properties.ACTIVITIES_ENABLED = 'true';
  assert.equal(save(payload, viewer, projectB).error.code, 'FORBIDDEN');
  assert.equal(save(payload, editor, projectB).error.code, 'FORBIDDEN');
  assert.equal(list(viewer, projectA).error.code, 'FORBIDDEN');
  assert.deepEqual(list().data.activities, []);
  assert.equal(list().data.can_write, true);
  assert.equal(list(viewer, projectB).data.can_write, false);
  assert.equal(rpc(editor, 'projects.get', projectA).data.activities_enabled, true);
  assert.equal(rpc(editor, 'projects.get', projectA).data.personnel[0].person_id, sheets.people[1][0]);
  for (const data of [
    {...payload, activity: {...payload.activity, activity_date: '2026-02-30'}},
    {...payload, activity: {...payload.activity, title: ' '}},
    {...payload, activity_id: randomUUID()},
    {...payload, agenda: [{...payload.agenda[0], start_time: '24:00'}]},
    {...payload, agenda: [{...payload.agenda[0], end_time: '09:00'}]},
    {...payload, agenda: [payload.agenda[0], {...payload.agenda[1], start_time: '09:59'}]},
    {...payload, agenda: [{...payload.agenda[0], speaker_person_id: randomUUID()}]},
  ]) assert.equal(save(data).error.code, 'VALIDATION_ERROR');
  writes.locked = true;
  assert.equal(save().error.code, 'TEMPORARY_FAILURE');
  writes.locked = false;
  writes.fail = true;
  assert.equal(save().error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.activities.length, 1);
  assert.equal(sheets.agenda_items.length, 1);
  assert.equal(sheets.audit_log.length, 1);
  assert.equal(sheets.mutation_requests.length, 1);
  assert.equal(writes.locked, false);
  writes.fail = false;
  const created = save().data;
  assert.equal(created.status, 'DRAFT');
  assert.deepEqual(save().data, created);
  assert.equal(writes.batches, 1);
  assert.equal(save({...payload, agenda: []}).error.code, 'CONFLICT');
  assert.equal(save(payload, owner).error.code, 'CONFLICT');
  assert.equal(list().data.activities[0].title, '=FGD sintetis');
  const get = (account, project) => rpc(account, 'activities.get', project, {payload: {activity_id: created.activity_id}});
  const detail = get(editor, projectA).data;
  assert.equal(detail.agenda.length, 2);
  assert.equal(detail.agenda[0].speaker_display_name, sheets.people[1][2]);
  assert.ok(detail.agenda.every(item => item.activity_id === created.activity_id));
  assert.equal(detail.agenda[1].speaker_person_id, '');
  assert.equal(get(viewer, projectB).error.code, 'NOT_FOUND');
  sheets.projects[1][4] = 'ARCHIVED';
  assert.equal(list().data.can_write, false);
  assert.equal(save(payload, editor, projectA, randomUUID()).error.code, 'VALIDATION_ERROR');
  assert.deepEqual(save().data, created);
  assert.equal(get(editor, projectA).ok, true);
  sheets.project_members[1][4] = '2026-11-18T00:00:00Z';
  assert.equal(save().error.code, 'FORBIDDEN');
  assert.equal(get(editor, projectA).error.code, 'FORBIDDEN');
});

test('RAB menghitung rupiah, menjaga riwayat revisi, dan hanya dapat disahkan pemilik', () => {
  const {rpc, owner, editor, viewer, projectA, projectB, sheets, properties, writes} = setup();
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('official_ceiling_amount', 'status', 'active_budget_version_id', ...stamp);
  for (const row of sheets.projects.slice(1)) row.push(17500000, 'ACTIVE', '', 1);
  sheets.budget_versions = [['budget_version_id', 'project_id', 'version_no', 'status', 'approved_by_user_id', 'approved_at', ...stamp]];
  sheets.budget_categories = [['budget_category_id', 'budget_version_id', 'category_code', 'label', 'sort_order', ...stamp]];
  sheets.budget_items = [['budget_item_id', 'budget_category_id', 'label', 'volume', 'frequency', 'unit', 'unit_price_amount', ...stamp]];
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...stamp]];
  const item = {label: 'FGD sintetis', volume: 1.505, frequency: 1, unit: 'paket', unit_price_amount: 100};
  const categories = [{category_code: 'FGD', label: 'Kegiatan', items: [item]}];
  const saveId = randomUUID();
  const save = (account, project, data = categories, request_id = saveId) =>
    rpc(account, 'budgets.save_version', project, {request_id, payload: {categories: data}});
  const list = (account, project, id) => rpc(account, 'budgets.list_versions', project, {payload: {budget_version_id: id}});
  assert.equal(list(owner, projectA).error.code, 'TEMPORARY_FAILURE');
  properties.BUDGETS_ENABLED = 'true';
  assert.equal(list(editor, projectB).error.code, 'FORBIDDEN');
  assert.equal(save(viewer, projectB).error.code, 'FORBIDDEN');
  assert.equal(save(editor, projectA, [categories[0], categories[0]]).error.code, 'VALIDATION_ERROR');
  assert.equal(save(editor, projectA, [{...categories[0], items: [{...item, unit_price_amount: 12.5}]}]).error.code, 'VALIDATION_ERROR');
  const first = save(editor, projectA).data;
  assert.equal(first.status, 'DRAFT');
  assert.deepEqual(save(editor, projectA).data, first);
  const before = list(editor, projectA).data;
  assert.equal(before.selected_version.detail_total_amount, 151);
  assert.equal(before.selected_version.difference_amount, 17499849);
  assert.equal(list(viewer, projectB, first.budget_version_id).error.code, 'NOT_FOUND');

  const approve = (account, version, expected_project_row_version, request_id = randomUUID()) =>
    rpc(account, 'budgets.approve_version', projectA, {request_id, payload: {
      budget_version_id: version.budget_version_id, expected_row_version: version.row_version, expected_project_row_version,
    }});
  assert.equal(approve(editor, first, 1).error.code, 'FORBIDDEN');
  assert.equal(approve(owner, first, 2).error.code, 'CONFLICT');
  const approved = approve(owner, first, 1).data;
  assert.equal(approved.status, 'APPROVED');
  const second = save(owner, projectA, [{...categories[0], items: [{...item, unit_price_amount: 1000}]}], randomUUID()).data;
  assert.equal(second.version_no, 2);
  assert.equal(list(owner, projectA).data.active_budget_version_id, first.budget_version_id);
  writes.fail = true;
  const approvalId = randomUUID();
  assert.equal(approve(owner, second, 2, approvalId).error.code, 'TEMPORARY_FAILURE');
  assert.equal(list(owner, projectA).data.active_budget_version_id, first.budget_version_id);
  writes.fail = false;
  assert.equal(approve(owner, second, 2, approvalId).data.status, 'APPROVED');
  assert.equal(approve(owner, second, 2, approvalId).data.status, 'APPROVED');
  const current = list(owner, projectA).data;
  const history = list(editor, projectA, first.budget_version_id).data;
  assert.equal(current.selected_version.detail_total_amount, 1505);
  assert.equal(current.active_budget_version_id, second.budget_version_id);
  assert.equal(history.selected_version.status, 'SUPERSEDED');
  assert.equal(history.selected_version.detail_total_amount, 151);
  assert.equal(history.selected_version.categories[0].items[0].budget_item_id, before.selected_version.categories[0].items[0].budget_item_id);
  assert.equal(writes.batches, 4);
  assert.equal(sheets.audit_log.length, 5);
});

test('impor personel memvalidasi pratinjau, menjaga NIP sebagai teks, dan mencegah duplikasi', () => {
  const {rpc, owner, editor, sheets, properties, writes} = setup();
  const rowFields = ['row_version', 'created_at', 'updated_at'];
  sheets.people[0].push('nip', 'nim', 'unit_name', 'civil_service_grade', 'active', ...rowFields);
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...rowFields]];
  const fields = {person_id: '', person_kind: 'DOSEN', display_name: 'Dosen Sintetis', nip: '001234567890123456', nim: '', unit_name: 'Unit Riset', civil_service_grade: 'III/a'};
  const rows = [{source_row: 3, ...fields}, {source_row: 5, ...fields, nip: 'TIDAK-VALID'}];
  const preview = (account = owner, batch = rows) =>
    rpc(account, 'people.preview_import', undefined, {payload: {rows: batch}});
  assert.equal(preview().error.code, 'TEMPORARY_FAILURE');
  properties.PEOPLE_IMPORT_ENABLED = 'true';
  assert.equal(preview(editor).error.code, 'FORBIDDEN');
  assert.equal(rpc(owner, 'projects.list').data.can_import_people, true);
  const repeated = preview(owner, [rows[0], {...rows[0], source_row: 4}]);
  assert.equal(repeated.data.summary.correction, 2);

  const {data} = preview();
  assert.deepEqual(data.summary, {valid: 1, duplicate: 0, correction: 1});
  assert.deepEqual(data.results.map(row => row.source_row), [3, 5]);
  assert.match(data.results[1].message, /NIP harus berisi 5–30 digit/);
  for (const [changes, expected] of [
    [{nip: '[simpan kolom sebagai teks]'}, /NIP terbaca sebagai angka Excel.*Text.*sumber asli/],
    [{display_name: ''}, /Isi nama lengkap pada kolom display_name/],
    [{person_kind: 'LAINNYA'}, /Pilih person_kind/],
    [{nip: '', nim: 'A!'}, /NIM harus berisi/],
    [{person_id: 'invalid-id'}, /person_id harus berupa UUID/],
    [{nip: '', nim: '', person_id: ''}, /Isi sedikitnya satu identitas/],
  ]) {
    const correction = preview(owner, [{source_row: 2, ...fields, ...changes}]).data.results[0];
    assert.equal(correction.status, 'CORRECTION');
    assert.match(correction.message, expected);
    if (changes.nip === undefined) assert.doesNotMatch(correction.message, /NIP harus/);
  }
  assert.equal(writes.batches, 0);
  const request_id = randomUUID();
  const commit = (batch = rows) => rpc(owner, 'people.commit_import', undefined, {
    request_id, payload: {import_token: data.import_token, rows: batch},
  });
  assert.equal(commit([{...rows[0], display_name: 'Nama berubah'}]).error.code, 'CONFLICT');
  writes.fail = true;
  assert.equal(commit().error.code, 'TEMPORARY_FAILURE');
  writes.fail = false;
  assert.deepEqual(commit().data, {imported: 1, duplicate: 0, correction: 1});
  assert.deepEqual(commit().data, {imported: 1, duplicate: 0, correction: 1});
  assert.equal(writes.batches, 1);
  assert.equal(sheets.people.at(-1)[3], fields.nip);
  assert.equal(sheets.people.at(-1)[7], true);
  assert.equal(preview().data.summary.duplicate, 1);
  assert.equal(preview(owner, [{...rows[0], display_name: 'Nama konflik'}]).data.summary.correction, 1);
});

test('pembuatan draf dan aktivasi memeriksa izin, integritas, versi, dan idempotensi', () => {
  const {rpc, owner, editor, sheets, properties, writes} = setup();
  const rowFields = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('official_ceiling_amount', 'status', 'active_budget_version_id', ...rowFields);
  sheets.project_people[0].push(...rowFields);
  sheets.report_stages = [['report_stage_id', 'project_id', 'sequence_no', 'label', 'target_bps', 'cutoff_date', 'status', ...rowFields]];
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...rowFields]];
  const person = sheets.people[1][0];
  const payload = {
    project: {title: '=Judul tersimpan sebagai teks', project_code: 'UJI', fiscal_year: 2026, official_ceiling_amount: 17500000},
    personnel: ['Ketua', 'Penanggung Jawab', 'PPK', 'Bendahara Pengeluaran'].map(assignment_role => ({assignment_role, person_id: person})),
    stages: [
      {sequence_no: 1, label: 'Tahap awal', target_bps: 6000, cutoff_date: '2026-08-01'},
      {sequence_no: 2, label: 'Tahap akhir', target_bps: 10000, cutoff_date: '2026-12-01'},
    ],
  };
  const request_id = randomUUID();
  const create = (account = owner, data = payload) => rpc(account, 'projects.save', undefined, {request_id, payload: data});
  assert.equal(create().error.code, 'TEMPORARY_FAILURE');
  properties.PROJECT_WRITES_ENABLED = 'true';
  assert.equal(create(editor).error.code, 'FORBIDDEN');
  assert.equal(create(owner, {...payload, personnel: payload.personnel.slice(1)}).error.code, 'VALIDATION_ERROR');
  writes.fail = true;
  assert.equal(create().error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.projects.length, 3);
  assert.equal(sheets.mutation_requests.length, 1);
  writes.fail = false;
  const {project_id} = create().data;
  assert.deepEqual(create().data, {project_id, status: 'DRAFT', row_version: 1});
  assert.equal(create(owner, {...payload, project: {...payload.project, fiscal_year: 2027}}).error.code, 'CONFLICT');
  assert.equal(rpc(owner, 'projects.get', project_id).data.project.title, payload.project.title);
  assert.equal(sheets.report_stages[1][4], 6000);

  const activate = (version, id = randomUUID(), account = owner) =>
    rpc(account, 'projects.activate', project_id, {request_id: id, payload: {expected_row_version: version}});
  assert.equal(activate(1, randomUUID(), editor).error.code, 'FORBIDDEN');
  assert.equal(activate(2).error.code, 'CONFLICT');
  sheets.report_stages[2][5] = '2026-02-30';
  assert.equal(activate(1).error.code, 'VALIDATION_ERROR');
  sheets.report_stages[2][5] = '2026-12-01';
  const activationId = randomUUID();
  assert.deepEqual(activate(1, activationId).data, {project_id, status: 'ACTIVE', row_version: 2});
  assert.equal(activate(1, activationId).data.status, 'ACTIVE');
  assert.equal(activate(1).error.code, 'CONFLICT');
  assert.equal(writes.batches, 2);
  assert.equal(writes.locked, false);
  assert.equal(sheets.audit_log.length, 3);
  assert.equal(sheets.mutation_requests.length, 3);
});

function setupStudentWizard() {
  const env = setup();
  const {sheets, properties, rpc, owner} = env;
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('official_ceiling_amount', 'status', 'active_budget_version_id', ...stamp);
  sheets.project_people[0].push(...stamp);
  sheets.people[0].push('nip', 'nim', 'unit_name', 'civil_service_grade', 'active', ...stamp);
  sheets.people.slice(1).forEach(row => row.push('', '', '', '', true, 1));
  sheets.report_stages = [['report_stage_id', 'project_id', 'sequence_no', 'label', 'target_bps', 'cutoff_date', 'status', ...stamp]];
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...stamp]];
  properties.PROJECT_WRITES_ENABLED = 'true';
  const payload = {project: {title: 'Proyek mahasiswa sintetis', project_code: 'UJI', fiscal_year: 2026, official_ceiling_amount: 17500000},
    personnel: [...['Ketua', 'Penanggung Jawab', 'PPK', 'Bendahara Pengeluaran'].map(assignment_role => ({assignment_role, person_id: sheets.people[1][0]})),
      {assignment_role: 'Mahasiswa', student: {display_name: '=Mahasiswa sintetis', nip: '001234567890', nim: ''}}],
    stages: [{sequence_no: 1, label: 'Final', target_bps: 10000, cutoff_date: '2026-12-31'}]};
  const save = (data = payload, id = randomUUID(), account = owner) => rpc(account, 'projects.save', undefined, {payload: data, request_id: id});
  const person = row => Object.fromEntries(sheets.people[0].map((field, i) => [field, row[i]]));
  return {...env, payload, save, person};
}

test('mahasiswa diketik langsung, nama/NIP teks disimpan atomik bersama proyek dan retry tidak menduplikasi', () => {
  const e = setupStudentWizard(); const {sheets, save, payload, writes, rpc, owner, person} = e;
  const before = JSON.stringify(sheets), id = randomUUID();
  writes.fail = true; assert.equal(save(payload, id).error.code, 'TEMPORARY_FAILURE');
  assert.equal(JSON.stringify(sheets), before); writes.fail = false;
  const result = save(payload, id); assert.equal(result.ok, true);
  const student = person(sheets.people.at(-1));
  assert.equal(student.person_kind, 'MAHASISWA'); assert.equal(student.display_name, '=Mahasiswa sintetis');
  assert.equal(student.nip, '001234567890'); assert.equal(typeof student.nip, 'string'); assert.equal(student.nim, '');
  const assignment = sheets.project_people.at(-1);
  assert.equal(assignment[2], student.person_id); assert.equal(assignment[3], 'Mahasiswa');
  const length = sheets.people.length, batches = writes.batches;
  assert.deepEqual(save(payload, id), result); assert.equal(sheets.people.length, length); assert.equal(writes.batches, batches);
  assert.equal(rpc(owner, 'projects.activate', result.data.project_id, {payload: {expected_row_version: 1}}).ok, true);
});

test('input mahasiswa memeriksa nomor teks, peran, duplikasi dan izin; NIM saja didukung', () => {
  for (const change of [
    p => {p.personnel.at(-1).student.nip = 123456;},
    p => {p.personnel.at(-1).student.display_name = ' ';},
    p => {p.personnel.at(-1).student.nip = '';},
    p => {p.personnel.at(-1).student.nip = '12e10';},
    p => {p.personnel.at(-1).student.nim = 'x';},
    p => {p.personnel.at(-1).assignment_role = 'Ketua';},
    p => {p.personnel.push(structuredClone(p.personnel.at(-1)));},
    p => {p.personnel.at(-1).person_id = randomUUID();},
    p => {p.personnel[p.personnel.length - 1] = {assignment_role: 'Mahasiswa', person_id: p.personnel[0].person_id};},
  ]) {
    const e = setupStudentWizard(); const before = JSON.stringify(e.sheets); change(e.payload);
    assert.equal(e.save().error.code, 'VALIDATION_ERROR'); assert.equal(JSON.stringify(e.sheets), before);
  }
  const e = setupStudentWizard(); assert.equal(e.save(e.payload, randomUUID(), e.editor).error.code, 'FORBIDDEN');
  e.payload.personnel.at(-1).student = {display_name: 'Mahasiswa NIM', nip: '', nim: '00123-AB', person_id: e.sheets.people[1][0], person_kind: 'DOSEN'};
  assert.equal(e.save().ok, true);
  const student = e.person(e.sheets.people.at(-1)); assert.equal(student.nim, '00123-AB'); assert.equal(student.person_kind, 'MAHASISWA');
  assert.notEqual(student.person_id, e.sheets.people[1][0]);
});

test('isian mahasiswa identik memakai identitas yang sama tanpa menimpa master; konflik/inaktif ditolak', () => {
  const e = setupStudentWizard(); assert.equal(e.save().ok, true);
  const before = JSON.stringify(e.sheets.people), student = e.person(e.sheets.people.at(-1));
  assert.equal(e.save().ok, true); assert.equal(JSON.stringify(e.sheets.people), before);
  assert.equal(e.sheets.project_people.at(-1)[2], student.person_id);
  e.payload.personnel.at(-1).student.display_name = 'Nama berbeda';
  assert.equal(e.save().error.code, 'CONFLICT'); assert.equal(JSON.stringify(e.sheets.people), before);
  e.payload.personnel.at(-1).student.display_name = student.display_name;
  e.sheets.people.at(-1)[e.sheets.people[0].indexOf('active')] = false;
  assert.equal(e.save().error.code, 'CONFLICT');
});

test('pemilik melihat kedua tahun dan lulus kedua pemeriksaan hak', () => {
  const {rpc, owner, projectA, projectB} = setup();
  const list = rpc(owner, 'projects.list').data.projects;
  assert.deepEqual(list.map(project => project.fiscal_year), [2023, 2025]);
  for (const project of [projectA, projectB]) {
    assert.equal(rpc(owner, 'projects.get', project).data.access_role, 'OWNER');
    assert.equal(rpc(owner, 'stage0.write_probe', project).data.authorized, true);
    assert.equal(rpc(owner, 'stage0.tax_probe', project).data.authorized, true);
  }
});

test('Master Personel hanya tersedia bagi pemilik dan menyaring entri aktif', () => {
  const {rpc, owner, editor, viewer, sheets, reads} = setup();
  assert.equal(rpc(owner, 'projects.list').data.system_role, 'OWNER');
  assert.equal(rpc(editor, 'projects.list').data.system_role, 'MEMBER');
  reads.length = 0;
  for (const account of [editor, viewer]) {
    assert.equal(rpc(account, 'people.search', undefined, {payload: {query: ''}}).error.code, 'FORBIDDEN');
  }
  assert.equal(reads.includes('people'), false);
  assert.equal(rpc(owner, 'people.search', undefined, {payload: {query: 'x'.repeat(121)}}).error.code, 'VALIDATION_ERROR');

  const search = query => rpc(owner, 'people.search', undefined, {payload: {query}}).data;
  assert.equal(search('  PPK SINTETIS ').total, 2);
  sheets.people[0].push('unit_name', 'active', 'nip');
  sheets.people[1].push('Unit Riset', true, '00001');
  sheets.people[2].push('Unit Riset', false, '00002');
  const result = search('unit riset');
  assert.equal(result.total, 1);
  assert.deepEqual(result.people[0], {
    person_id: sheets.people[1][0], person_kind: 'PEGAWAI', display_name: 'PPK Sintetis A', unit_name: 'Unit Riset',
  });

  for (let index = 0; index < 55; index++) {
    sheets.people.push([randomUUID(), 'DOSEN', 'Peneliti ' + index, 'Unit Riset', true]);
  }
  assert.equal(search('Unit Riset').total, 56);
  assert.equal(search('Unit Riset').people.length, 50);
});

test('editor hanya dapat membaca dan menguji hak tulis proyek yang ditugaskan', () => {
  const {rpc, editor, projectA, projectB} = setup();
  assert.deepEqual(rpc(editor, 'projects.list').data.projects.map(p => p.project_id), [projectA]);
  assert.equal(rpc(editor, 'projects.get', projectA).data.access_role, 'EDITOR');
  assert.equal(rpc(editor, 'stage0.write_probe', projectA).data.authorized, true);
  for (const action of ['projects.get', 'stage0.write_probe']) {
    assert.equal(rpc(editor, action, projectB).error.code, 'FORBIDDEN');
  }
  assert.equal(rpc(editor, 'stage0.tax_probe', projectA).error.code, 'FORBIDDEN');
});

test('viewer ditolak saat menguji hak tulis atau mengirim ID lintas proyek', () => {
  const {rpc, viewer, projectA, projectB} = setup();
  assert.deepEqual(rpc(viewer, 'projects.list').data.projects.map(p => p.project_id), [projectB]);
  assert.equal(rpc(viewer, 'projects.get', projectB).data.access_role, 'VIEWER');
  assert.equal(rpc(viewer, 'projects.get', projectA).error.code, 'FORBIDDEN');
  assert.equal(rpc(viewer, 'stage0.write_probe', projectB).error.code, 'FORBIDDEN');
  assert.equal(rpc(viewer, 'stage0.tax_probe', projectB).error.code, 'FORBIDDEN');
});

test('sesi yang sama kehilangan hak tulis ketika diturunkan dan hak baca setelah dicabut', () => {
  const {rpc, editor, projectA, sheets} = setup();
  assert.equal(rpc(editor, 'stage0.write_probe', projectA).ok, true);
  sheets.project_members[1][3] = 'VIEWER';
  assert.equal(rpc(editor, 'projects.get', projectA).data.access_role, 'VIEWER');
  assert.equal(rpc(editor, 'stage0.write_probe', projectA).error.code, 'FORBIDDEN');
  sheets.project_members[1][4] = '2026-11-17T00:00:00Z';
  assert.deepEqual(rpc(editor, 'projects.list').data.projects, []);
  assert.equal(rpc(editor, 'projects.get', projectA).error.code, 'FORBIDDEN');
  assert.equal(rpc(editor, 'stage0.write_probe', projectA).error.code, 'FORBIDDEN');
});

test('identitas kosong dan domain luar ditolak sebelum Sheet dibaca', () => {
  const {rpc, owner, reads} = setup();
  assert.equal(rpc('', 'projects.list', undefined, {login_email: owner}).error.code, 'UNAUTHENTICATED');
  assert.equal(rpc('user@outside.test', 'projects.list').error.code, 'FORBIDDEN');
  assert.deepEqual(reads, []);
});

test('personel terlihat dalam proyek dan identitas nonanggota tidak diberi akses', () => {
  const {rpc, editor, owner, projectA, sheets} = setup();
  const detail = rpc(editor, 'projects.get', projectA).data;
  assert.deepEqual(detail.personnel.map(person => person.display_name), [
    'PPK Sintetis A', 'Bendahara Sintetis A', 'Mahasiswa Sintetis A',
  ]);
  for (const name of ['ppk', 'bendahara', 'mahasiswa', 'tanpa-undangan']) {
    const result = rpc(name + '@example.test', 'projects.get', projectA, {
      login_email: owner, system_role: 'OWNER', payload: {user_id: sheets.users[1][0]},
    });
    assert.equal(result.error.code, 'FORBIDDEN');
    assert.equal(result.data, undefined);
  }
  sheets.users[2][3] = false;
  assert.equal(rpc(editor, 'projects.get', projectA).error.code, 'FORBIDDEN');
});

test('aksi tak terdaftar, envelope keliru, dan data yang tidak tersedia gagal tertutup', () => {
  const {rpc, owner, editor, projectA, sheets, properties} = setup();
  assert.equal(rpc(owner, 'projects.delete', projectA).error.code, 'VALIDATION_ERROR');
  assert.equal(rpc(owner, 'projects.get').error.code, 'VALIDATION_ERROR');
  assert.equal(rpc(owner, 'projects.list', undefined, {api_version: 2}).error.code, 'VALIDATION_ERROR');
  assert.equal(rpc(owner, 'projects.get', 'missing').error.code, 'NOT_FOUND');
  sheets.project_members.push([...sheets.project_members[1]]);
  assert.equal(rpc(editor, 'projects.get', projectA).error.code, 'FORBIDDEN');
  delete sheets.projects;
  assert.equal(rpc(owner, 'projects.list').error.code, 'TEMPORARY_FAILURE');
  delete properties.CAMPUS_DOMAIN;
  assert.equal(rpc(owner, 'projects.list').error.code, 'TEMPORARY_FAILURE');
});

test('POST Pages hanya memakai identitas terverifikasi dan membaca perubahan akses pada RPC berikutnya', () => {
  const {post, owner, projectA, projectB, sheets, claims} = setup();
  const request = {
    api_version: 1, action: 'projects.get', request_id: randomUUID(), project_id: projectB,
    login_email: owner, system_role: 'OWNER',
  };
  const token = 'test.jwt.signature';
  assert.equal(post(request, token).error.code, 'FORBIDDEN');
  request.project_id = projectA;
  assert.equal(post(request, token).data.access_role, 'EDITOR');
  sheets.project_members[1][3] = 'VIEWER';
  request.action = 'stage0.write_probe';
  assert.equal(post(request, token).error.code, 'FORBIDDEN');
  sheets.project_members[1][4] = '2026-11-17T00:00:00Z';
  request.action = 'projects.get';
  assert.equal(post(request, token).error.code, 'FORBIDDEN');
  claims.email = 'uninvited@gmail.com';
  delete claims.hd;
  assert.equal(post(request, token).error.code, 'FORBIDDEN');
  sheets.users[1][1] = 'invited-owner@gmail.com';
  claims.email = sheets.users[1][1];
  assert.equal(post(request, token).data.access_role, 'OWNER');
});

test('POST Pages menolak token hilang, klaim tak sah dan kegagalan verifier sebelum membaca Sheets', () => {
  const {post, reads, claims, verifier} = setup();
  const request = {api_version: 1, action: 'projects.list', request_id: randomUUID()};
  const token = 'test.jwt.signature';
  assert.equal(post(request).error.code, 'UNAUTHENTICATED');
  assert.equal(verifier.calls, 0);
  const invalid = {
    aud: 'wrong-client', iss: 'https://invalid.test', azp: 'wrong-client',
    exp: 1, sub: '', email_verified: 'false', email: '', hd: undefined,
  };
  for (const [key, value] of Object.entries(invalid)) {
    const validValue = claims[key];
    claims[key] = value;
    assert.equal(post(request, token).error.code, 'UNAUTHENTICATED', key);
    claims[key] = validValue;
  }
  verifier.status = 400;
  assert.equal(post(request, token).error.code, 'UNAUTHENTICATED');
  verifier.status = 429;
  assert.equal(post(request, token).error.code, 'TEMPORARY_FAILURE');
  assert.deepEqual(reads, []);
});
