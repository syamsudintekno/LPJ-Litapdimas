function activityReport_(spreadsheetId, request, alreadyLocked = false) {
  const {request_id, project_id, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  if (PropertiesService.getScriptProperties().getProperty('ACTIVITY_REPORTS_ENABLED') !== 'true') {
    return fail('TEMPORARY_FAILURE', 'Pratinjau dokumen kegiatan belum diaktifkan.');
  }
  if (payload?.document_kind !== 'ACTIVITY_PACKAGE' || typeof payload.activity_id !== 'string' || !PROJECT_UUID_.test(payload.activity_id)) {
    return fail('VALIDATION_ERROR', 'Pilih paket dokumen dan ID kegiatan yang valid.');
  }
  const lock = LockService.getScriptLock();
  if (!alreadyLocked && !lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Data kegiatan sedang diproses. Coba lagi.');
  try {
    const project = rows_(spreadsheetId, 'projects', ['project_id', 'title', 'fiscal_year', 'project_code'], ['row_version'])
      .find(row => row.project_id === project_id);
    if (!project) return fail('NOT_FOUND', 'Proyek tidak ditemukan.');
    const activity = rows_(spreadsheetId, 'activities', ACTIVITY_FIELDS_)
      .find(row => row.activity_id === payload.activity_id && row.project_id === project_id);
    if (!activity) return fail('NOT_FOUND', 'Kegiatan tidak ditemukan dalam proyek ini.');
    const people = rows_(spreadsheetId, 'people', ['person_id', 'display_name'], ['unit_name']);
    const personFor = id => people.find(person => person.person_id === id);
    const agenda = rows_(spreadsheetId, 'agenda_items', AGENDA_FIELDS_)
      .filter(row => row.activity_id === activity.activity_id).sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map(row => ({...row, speaker_display_name: personFor(row.speaker_person_id)?.display_name || ''}));
    const logbook = rows_(spreadsheetId, 'logbook_entries', LOGBOOK_FIELDS_)
      .filter(row => row.project_id === project_id && row.activity_id === activity.activity_id)
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.logbook_entry_id.localeCompare(b.logbook_entry_id));
    const participants = rows_(spreadsheetId, 'activity_participants', PARTICIPANT_FIELDS_)
      .filter(row => row.activity_id === activity.activity_id).map(row => ({...row,
        display_name: personFor(row.person_id)?.display_name || 'Personel tidak tersedia', unit_name: personFor(row.person_id)?.unit_name || '',
      })).sort((a, b) => a.display_name.localeCompare(b.display_name, 'id-ID') || a.person_id.localeCompare(b.person_id));
    const byId = new Map(participants.map(row => [row.activity_participant_id, row]));
    const distributions = rows_(spreadsheetId, 'distributions', DISTRIBUTION_FIELDS_)
      .filter(row => byId.has(row.activity_participant_id));
    const keys = distributions.map(row => row.activity_participant_id + ':' + row.distribution_kind);
    if (new Set(keys).size !== keys.length || distributions.some(row => !DISTRIBUTION_KINDS_.includes(row.distribution_kind) ||
        !Number.isSafeInteger(row.quantity) || row.quantity < 0 || (row.quantity > 0 && !Number.isFinite(Date.parse(row.received_at))))) {
      return fail('TEMPORARY_FAILURE', 'Data distribusi tidak konsisten. Periksa sebelum mencetak.');
    }
    const groups = DISTRIBUTION_KINDS_.map(kind => {
      const rows = distributions.filter(row => row.distribution_kind === kind && row.quantity > 0).map(row => ({...row,
        display_name: byId.get(row.activity_participant_id).display_name,
      })).sort((a, b) => a.display_name.localeCompare(b.display_name, 'id-ID'));
      return {distribution_kind: kind, rows, total_quantity: rows.reduce((sum, row) => sum + row.quantity, 0)};
    });
    return {ok: true, request_id, data: {is_final: false, template_version: 'activity-draft-v1',
      generated_at: new Date().toISOString(), project, activity, agenda, logbook, participants, distributions: groups}};
  } finally {
    if (!alreadyLocked) lock.releaseLock();
  }
}
