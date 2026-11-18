// Manual deployment helper for the synthetic workspace; never dispatched as an RPC.
const DEPLOYMENT_HEADERS_ = {
  "projects": [
    "project_id",
    "fiscal_year",
    "title",
    "project_code",
    "official_ceiling_amount",
    "status",
    "active_budget_version_id",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "project_people": [
    "project_person_id",
    "project_id",
    "person_id",
    "assignment_role",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "report_stages": [
    "report_stage_id",
    "project_id",
    "sequence_no",
    "label",
    "target_bps",
    "cutoff_date",
    "status",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "audit_log": [
    "audit_id",
    "request_id",
    "user_id",
    "project_id",
    "action",
    "entity_type",
    "entity_id",
    "occurred_at",
    "change_summary"
  ],
  "mutation_requests": [
    "request_id",
    "user_id",
    "action",
    "payload_digest",
    "result_ref",
    "status",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "budget_versions": [
    "budget_version_id",
    "project_id",
    "version_no",
    "status",
    "approved_by_user_id",
    "approved_at",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "budget_categories": [
    "budget_category_id",
    "budget_version_id",
    "category_code",
    "label",
    "sort_order",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "budget_items": [
    "budget_item_id",
    "budget_category_id",
    "label",
    "volume",
    "frequency",
    "unit",
    "unit_price_amount",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "activities": [
    "activity_id",
    "project_id",
    "activity_kind",
    "title",
    "activity_date",
    "location",
    "status",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "agenda_items": [
    "agenda_item_id",
    "activity_id",
    "start_time",
    "end_time",
    "title",
    "speaker_person_id",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "activity_participants": [
    "activity_participant_id",
    "activity_id",
    "person_id",
    "attendance_status",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "distributions": [
    "distribution_id",
    "activity_participant_id",
    "transaction_id",
    "distribution_kind",
    "quantity",
    "received_at",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "payees": [
    "payee_id",
    "payee_kind",
    "person_id",
    "legal_name",
    "tax_profile_ref",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "transactions": [
    "transaction_id",
    "project_id",
    "budget_item_id",
    "activity_id",
    "payment_date",
    "expense_kind",
    "description",
    "status",
    "row_version",
    "created_at",
    "updated_at",
    "confirmed_by_user_id",
    "confirmed_at"
  ],
  "payment_details": [
    "payment_detail_id",
    "transaction_id",
    "payee_id",
    "receipt_amount",
    "withheld_tax_amount",
    "added_tax_amount",
    "net_paid_amount",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "tax_assessments": [
    "tax_assessment_id",
    "payment_detail_id",
    "tax_rule_version_id",
    "tax_kind",
    "tax_treatment",
    "tax_base_amount",
    "amount",
    "status",
    "verified_by_user_id",
    "verified_at",
    "override_reason",
    "decision_source_ref",
    "evidence_attachment_id",
    "evidence_row_version",
    "evidence_drive_file_id",
    "evidence_modified_at",
    "rule_snapshot",
    "row_version",
    "created_at",
    "updated_at",
    "verification_context_digest"
  ],
  "receipts": [
    "receipt_id",
    "payment_detail_id",
    "project_id",
    "receipt_no",
    "issued_on",
    "status",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "tax_rule_versions": [
    "tax_rule_version_id",
    "rule_code",
    "version_no",
    "tax_kind",
    "expense_kind",
    "payee_kind",
    "eligibility",
    "base_kind",
    "rate_bps",
    "effective_from",
    "effective_to",
    "source_ref",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "attachments": [
    "attachment_id",
    "project_id",
    "activity_id",
    "transaction_id",
    "attachment_kind",
    "drive_file_id",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "tax_remittance_allocations": [
    "tax_remittance_allocation_id",
    "tax_remittance_id",
    "tax_assessment_id",
    "amount",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "logbook_entries": [
    "logbook_entry_id",
    "project_id",
    "activity_id",
    "entry_date",
    "description",
    "result",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "users": [
    "user_id",
    "login_email",
    "system_role",
    "active"
  ],
  "people": [
    "person_id",
    "person_kind",
    "display_name",
    "nip",
    "nim",
    "unit_name",
    "civil_service_grade",
    "active",
    "row_version",
    "created_at",
    "updated_at"
  ],
  "project_members": [
    "project_member_id",
    "project_id",
    "user_id",
    "project_role",
    "revoked_at"
  ]
};

function setupSyntheticFeatures() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  const email = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!spreadsheetId || !email) throw new Error('Jalankan dari editor Apps Script dengan akun pemilik.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Konfigurasi sedang diproses. Coba lagi.');
  try {
    const users = rows_(spreadsheetId, 'users', DEPLOYMENT_HEADERS_.users)
      .filter(user => normalizeEmail_(user.login_email) === email);
    if (users.length !== 1 || users[0].active !== true || users[0].system_role !== 'OWNER') throw new Error('Hanya pemilik aktif yang dapat mengaktifkan fitur.');
    const metadata = Sheets.Spreadsheets.get(spreadsheetId, {fields: 'properties(title),sheets(properties(title))'});
    if (!/Data Uji/i.test(metadata.properties?.title || '')) throw new Error('Helper hanya untuk spreadsheet Data Uji, bukan data produksi.');
    const titles = new Set(metadata.sheets.map(sheet => sheet.properties.title));
    for (const [name, required] of Object.entries(DEPLOYMENT_HEADERS_)) {
      if (!titles.has(name)) throw new Error('Tab belum siap: ' + name);
      const header = Sheets.Spreadsheets.Values.get(spreadsheetId, name + '!A1:Z1', {valueRenderOption: 'UNFORMATTED_VALUE'}).values?.[0] || [];
      if (header[0] !== required[0] || new Set(header).size !== header.length || required.some(field => !header.includes(field))) throw new Error('Header belum siap: ' + name);
    }
    const projects = rows_(spreadsheetId, 'projects', ['project_id']);
    if (!projects.length || projects.some(row => !PROJECT_UUID_.test(row.project_id)) ||
        new Set(projects.map(row => row.project_id)).size !== projects.length) throw new Error('ID proyek uji belum konsisten.');
    let folders;
    if (props.getProperty('EVIDENCE_FOLDERS_JSON')) {
      folders = JSON.parse(props.getProperty('EVIDENCE_FOLDERS_JSON'));
      for (const project of projects) evidenceFolder_(project.project_id);
    } else {
      const parents = DriveApp.getFileById(spreadsheetId).getParents();
      if (!parents.hasNext()) throw new Error('Spreadsheet harus berada dalam folder LPJ privat.');
      const root = parents.next();
      if (parents.hasNext() || root.isTrashed() || root.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Folder induk harus tunggal dan privat.');
      folders = {};
      for (const project of projects) {
        const matches = root.getFoldersByName('Bukti ' + project.project_id);
        if (!matches.hasNext()) throw new Error('Folder bukti proyek belum dibuat.');
        const folder = matches.next();
        if (matches.hasNext() || folder.isTrashed() || folder.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('Folder bukti harus tunggal dan privat.');
        folders[project.project_id] = folder.getId();
      }
      if (new Set(Object.values(folders)).size !== projects.length) throw new Error('Setiap proyek harus memakai folder bukti berbeda.');
    }
    const flags = Object.fromEntries(['PROJECT_WRITES_ENABLED', 'PEOPLE_IMPORT_ENABLED', 'BUDGETS_ENABLED',
      'ACTIVITIES_ENABLED', 'LOGBOOK_ENABLED', 'PARTICIPANTS_ENABLED', 'ACTIVITY_REPORTS_ENABLED',
      'TRANSACTIONS_ENABLED', 'TAXES_ENABLED', 'ATTACHMENTS_ENABLED'].map(name => [name, 'true']));
    props.setProperties({...flags, EVIDENCE_FOLDERS_JSON: JSON.stringify(folders)}, false);
    const result = {ok: true, enabled_features: Object.keys(flags), project_count: projects.length};
    console.log(JSON.stringify(result));
    return result;
  } finally {lock.releaseLock();}
}

