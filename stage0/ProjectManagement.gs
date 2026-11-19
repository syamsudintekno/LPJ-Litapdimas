function projectEditData_(spreadsheetId, request) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return failure_(request.request_id, 'TEMPORARY_FAILURE', 'Proyek sedang diproses.');
  try {
    const project = rows_(spreadsheetId, 'projects', ['project_id', 'title', 'project_code', 'fiscal_year', 'official_ceiling_amount', 'status', 'row_version']).find(row => row.project_id === request.project_id);
    if (!project) return failure_(request.request_id, 'NOT_FOUND', 'Proyek tidak ditemukan.');
    const people = rows_(spreadsheetId, 'people', ['person_id', 'person_kind', 'display_name', 'nip', 'nim', 'row_version']);
    const personnel = rows_(spreadsheetId, 'project_people', ['project_person_id', 'project_id', 'person_id', 'assignment_role']).filter(row => row.project_id === project.project_id).map(row => {
      const person = people.find(person => person.person_id === row.person_id);
      return {...row, person, ...(row.assignment_role === 'Mahasiswa' ? {student_source_id: person?.person_id, expected_student_row_version: person?.row_version,
        student: {display_name: person?.display_name || '', nip: person?.nip || '', nim: person?.nim || ''}} : {})};
    });
    const stages = rows_(spreadsheetId, 'report_stages', ['report_stage_id', 'project_id', 'sequence_no', 'label', 'target_bps', 'cutoff_date', 'status', 'row_version']).filter(row => row.project_id === project.project_id).sort((a, b) => a.sequence_no - b.sequence_no);
    return {ok: true, request_id: request.request_id, data: {project, personnel, stages}};
  } finally {lock.releaseLock();}
}
function projectUpdate_(spreadsheetId, user, request) {
  return opMutation_(spreadsheetId, user, request, ({project, time, stamp}) => {
    const p = request.payload;
    if (p.expected_row_version !== project.row_version) return opError_('Proyek berubah. Muat ulang sebelum menyunting.', 'CONFLICT');
    const error = projectValidation_(p.project || {}, p.personnel, p.stages, true);
    if (error) return opError_(error);
    const finals = rows_(spreadsheetId, 'final_documents', FINAL_FIELDS_).filter(row => row.project_id === project.project_id);
    if (finals.length) return opError_('Identitas proyek/tahap yang sudah memiliki arsip final tidak diubah melalui wizard.', 'CONFLICT');
    const transactions = rows_(spreadsheetId, 'transactions', TRANSACTION_FIELDS_).filter(row => row.project_id === project.project_id);
    if (transactions.length && p.project.fiscal_year !== project.fiscal_year) return opError_('Tahun tidak dapat diganti setelah ada transaksi.');
    const payments = rows_(spreadsheetId, 'payment_details', PAYMENT_FIELDS_).filter(row => transactions.some(tx => tx.transaction_id === row.transaction_id && tx.status === 'CONFIRMED'));
    if (opSum_(payments, 'receipt_amount') > p.project.official_ceiling_amount) return opError_('Plafon baru di bawah nilai transaksi terkonfirmasi.');
    const people = opRows_(spreadsheetId, 'people', ['person_id', 'person_kind', 'display_name', 'nip', 'nim', 'active', 'row_version']);
    const priorAssignments = rows_(spreadsheetId, 'project_people', ['project_person_id', 'project_id', 'person_id', 'assignment_role']).filter(row => row.project_id === project.project_id);
    const assignments = [], newPeople = [], peopleUpdates = [];
    for (const row of p.personnel) {
      let personId = row.person_id;
      if (row.student) {
        const student = {display_name: row.student.display_name.trim(), nip: row.student.nip, nim: row.student.nim};
        if (row.student_source_id) {
          const source = people.find(person => person.person_id === row.student_source_id);
          if (!source || source.person_kind !== 'MAHASISWA' || source.active !== true || source.row_version !== row.expected_student_row_version ||
              !priorAssignments.some(item => item.person_id === source.person_id && item.assignment_role === 'Mahasiswa')) return opError_('Identitas mahasiswa berubah. Muat ulang wizard.', 'CONFLICT');
          if (people.some(person => person.person_id !== source.person_id && ((student.nip && String(person.nip) === student.nip) || (student.nim && String(person.nim).toLowerCase() === student.nim.toLowerCase())))) return opError_('NIP/NIM sudah dipakai personel lain.', 'CONFLICT');
          if (source.row_version !== '' && (!Number.isSafeInteger(source.row_version) || source.row_version < 1)) return opError_('Versi Master Personel tidak valid.', 'CONFLICT');
          peopleUpdates.push(['people', source.person_id, {...student, row_version: (source.row_version || 0) + 1, updated_at: time}]);
          personId = source.person_id;
          assignments.push({project_person_id: Utilities.getUuid(), project_id: project.project_id, person_id: personId, assignment_role: row.assignment_role, ...stamp});
          continue;
        }
        const matches = people.filter(person => (student.nip && String(person.nip) === student.nip) || (student.nim && String(person.nim).toLowerCase() === student.nim.toLowerCase()));
        if (matches.length && (matches.length !== 1 || matches[0].active !== true || matches[0].person_kind !== 'MAHASISWA' || matches[0].display_name !== student.display_name ||
            matches[0].nip !== student.nip || String(matches[0].nim).toLowerCase() !== student.nim.toLowerCase())) return opError_('NIP/NIM mahasiswa bertentangan dengan master. Periksa identitas tanpa menimpa orang lain.', 'CONFLICT');
        personId = matches[0]?.person_id || Utilities.getUuid();
        if (!matches.length) newPeople.push({person_id: personId, person_kind: 'MAHASISWA', ...student, unit_name: '', civil_service_grade: '', active: true, ...stamp});
      } else if (!people.some(person => person.person_id === personId && person.active === true)) return opError_('Personel yang dipilih tidak aktif.');
      assignments.push({project_person_id: Utilities.getUuid(), project_id: project.project_id, person_id: personId, assignment_role: row.assignment_role, ...stamp});
    }
    if (new Set(assignments.map(row => row.assignment_role + ':' + row.person_id)).size !== assignments.length) return opError_('Personel tercantum lebih dari sekali pada peran yang sama.');
    const previous = rows_(spreadsheetId, 'report_stages', ['report_stage_id', 'project_id', 'status', 'row_version']).filter(row => row.project_id === project.project_id);
    const income = rows_(spreadsheetId, 'disbursements', DISBURSEMENT_FIELDS_);
    const adds = {project_people: assignments}, updates = [...peopleUpdates], deletes = [];
    if (newPeople.length) adds.people = newPeople;
    const submittedIds = p.stages.filter(row => row.report_stage_id).map(row => row.report_stage_id);
    if (new Set(submittedIds).size !== submittedIds.length) return opError_('ID tahap ganda.');
    for (const row of previous) {
      if (row.status !== 'DRAFT') return opError_('Tahap yang sudah final tidak dapat disunting.', 'CONFLICT');
      if (!submittedIds.includes(row.report_stage_id)) {
        if (income.some(item => item.report_stage_id === row.report_stage_id)) return opError_('Tahap dengan penerimaan dana tidak dapat dihapus.');
        deletes.push(['report_stages', row.report_stage_id]);
      }
    }
    for (const stage of p.stages) {
      const before = previous.find(row => row.report_stage_id === stage.report_stage_id);
      const value = {sequence_no: stage.sequence_no, label: stage.label.trim(), target_bps: stage.target_bps, cutoff_date: stage.cutoff_date, updated_at: time};
      if (stage.report_stage_id) {
        if (!before || before.row_version !== stage.expected_row_version) return opError_('Tahap berubah. Muat ulang wizard.', 'CONFLICT');
        if (before.row_version !== '' && (!Number.isSafeInteger(before.row_version) || before.row_version < 1)) return opError_('Versi tahap tidak valid.', 'CONFLICT');
        updates.push(['report_stages', before.report_stage_id, {...value, row_version: (before.row_version || 0) + 1}]);
      } else {
        if (!adds.report_stages) adds.report_stages = [];
        adds.report_stages.push({report_stage_id: Utilities.getUuid(), project_id: project.project_id, status: 'DRAFT', ...stamp, ...value});
      }
    }
    const oldAssignments = rows_(spreadsheetId, 'project_people', ['project_person_id', 'project_id']).filter(row => row.project_id === project.project_id);
    deletes.push(...oldAssignments.map(row => ['project_people', row.project_person_id]));
    if (project.row_version !== '' && (!Number.isSafeInteger(project.row_version) || project.row_version < 1)) return opError_('Versi proyek tidak valid.', 'CONFLICT');
    const after = {title: p.project.title.trim(), project_code: p.project.project_code.trim(), fiscal_year: p.project.fiscal_year,
      official_ceiling_amount: p.project.official_ceiling_amount, row_version: (project.row_version || 0) + 1, updated_at: time};
    updates.push(['projects', project.project_id, after]);
    return {data: {project_id: project.project_id, row_version: after.row_version, status: project.status}, adds, updates, deletes, audit: {before: project, after, created_student_ids: newPeople.map(row => row.person_id)}};
  });
}

function payeeSave_(spreadsheetId, user, request) {
  return opMutation_(spreadsheetId, user, request, ({stamp}) => {
    const p = request.payload;
    if (!['PERSON', 'ORGANIZATION', 'GROUP'].includes(p.payee_kind) || !budgetText_(p.legal_name, 240) || typeof p.tax_profile_ref !== 'string' || p.tax_profile_ref.length > 240) return opError_('Isi jenis dan nama resmi penerima yang valid.');
    if (p.payee_kind === 'PERSON' && (!opUuid_(p.person_id) || !rows_(spreadsheetId, 'project_people', ['project_id', 'person_id']).some(row => row.project_id === request.project_id && row.person_id === p.person_id))) return opError_('Pilih personel yang ditugaskan pada proyek.');
    const people = rows_(spreadsheetId, 'people', ['person_id', 'display_name', 'active']);
    if (p.payee_kind === 'PERSON' && !people.some(row => row.person_id === p.person_id && row.active === true)) return opError_('Personel tidak aktif.');
    const existing = rows_(spreadsheetId, 'payees', ['payee_id', 'payee_kind', 'person_id', 'legal_name', 'tax_profile_ref']);
    const matching = existing.filter(row => (p.payee_kind === 'PERSON' && row.person_id === p.person_id) ||
      (row.payee_kind === p.payee_kind && row.legal_name.toLowerCase() === p.legal_name.trim().toLowerCase()));
    if (matching.length) return opError_('Penerima sudah terdaftar. Muat ulang transaksi untuk memilihnya.', 'CONFLICT');
    const id = Utilities.getUuid();
    return {data: {payee_id: id}, entity_id: id, adds: {payees: [{payee_id: id, payee_kind: p.payee_kind, person_id: p.payee_kind === 'PERSON' ? p.person_id : '',
      legal_name: p.legal_name.trim(), tax_profile_ref: p.tax_profile_ref.trim(), ...stamp}]}, audit: {payee_id: id, payee_kind: p.payee_kind}};
  });
}
