const REQUIRED_PROJECT_ROLES_ = ['Ketua', 'Penanggung Jawab', 'PPK', 'Bendahara Pengeluaran'];
const OPTIONAL_PROJECT_ROLES_ = ['Anggota Peneliti', 'Mahasiswa', 'Pejabat Tambahan'];
const PROJECT_UUID_ = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function projectValidation_(project, assignments, stages) {
  if (typeof project.title !== 'string' || !project.title.trim() || project.title.length > 240 ||
      typeof project.project_code !== 'string' || project.project_code.length > 80 ||
      !Number.isInteger(project.fiscal_year) || project.fiscal_year < 1900 || project.fiscal_year > 9999 ||
      !Number.isSafeInteger(project.official_ceiling_amount) || project.official_ceiling_amount < 1) {
    return 'Isi judul, tahun anggaran, dan plafon rupiah yang valid.';
  }
  if (!Array.isArray(assignments) || assignments.length > 40 ||
      !assignments.every(row => row && typeof row.person_id === 'string' && PROJECT_UUID_.test(row.person_id) &&
        [...REQUIRED_PROJECT_ROLES_, ...OPTIONAL_PROJECT_ROLES_].includes(row.assignment_role))) {
    return 'Periksa daftar personel dan perannya.';
  }
  if (REQUIRED_PROJECT_ROLES_.some(role => assignments.filter(row => row.assignment_role === role).length !== 1)) {
    return 'Pilih ketua, penanggung jawab, PPK, dan Bendahara Pengeluaran.';
  }
  if (new Set(assignments.map(row => row.assignment_role + ':' + row.person_id)).size !== assignments.length) {
    return 'Orang yang sama tercantum lebih dari satu kali pada peran yang sama.';
  }
  if (!Array.isArray(stages) || !stages.length || stages.length > 10 ||
      !stages.every((stage, index) => stage && typeof stage.label === 'string' && stage.label.trim() &&
        stage.label.length <= 80 && stage.sequence_no === index + 1 &&
        Number.isInteger(stage.target_bps) && stage.target_bps > (index ? stages[index - 1].target_bps : 0) &&
        stage.target_bps <= 10000 && validProjectDate_(stage.cutoff_date) &&
        (!index || stage.cutoff_date > stages[index - 1].cutoff_date)) || stages[stages.length - 1].target_bps !== 10000) {
    return 'Isi nama dan tanggal batas tiap tahap. Persentase dan tanggal harus meningkat, dengan tahap terakhir 100%.';
  }
  return '';
}

function validProjectDate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function writeProject_(spreadsheetId, user, request) {
  const {action, request_id, project_id, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  if (PropertiesService.getScriptProperties().getProperty('PROJECT_WRITES_ENABLED') !== 'true') {
    return fail('TEMPORARY_FAILURE', 'Penyimpanan proyek belum diaktifkan pada deployment ini.');
  }
  const create = action === 'projects.save';
  if (!PROJECT_UUID_.test(request_id) || (create ? project_id !== undefined :
      typeof project_id !== 'string' || !PROJECT_UUID_.test(project_id) ||
      !Number.isInteger(payload?.expected_row_version) || payload.expected_row_version < 1)) {
    return fail('VALIDATION_ERROR', 'Identitas permintaan atau versi proyek tidak valid.');
  }
  const submitted = payload?.project ?? {};
  if (create) {
    const error = projectValidation_(submitted, payload?.personnel, payload?.stages);
    if (error) return fail('VALIDATION_ERROR', error);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Proyek sedang diproses. Coba lagi.');
  try {
    const digest = requestDigest_([action, project_id, payload]);
    const journals = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status']);
    const previous = journals.find(row => row.request_id === request_id);
    if (previous) {
      if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest) {
        return fail('CONFLICT', 'ID permintaan sudah digunakan.');
      }
      return ok(JSON.parse(previous.result_ref));
    }
    const names = ['projects', 'project_people', 'report_stages', 'audit_log', 'mutation_requests'];
    const metadata = Sheets.Spreadsheets.get(spreadsheetId, {fields: 'sheets(properties(sheetId,title))'});
    const sheets = Object.fromEntries(metadata.sheets.map(sheet => [sheet.properties.title, sheet.properties.sheetId]));
    const tables = Object.fromEntries(names.map(name => {
      if (sheets[name] === undefined) throw new Error('Tab proyek belum disiapkan.');
      const {values = []} = Sheets.Spreadsheets.Values.get(spreadsheetId, name + '!A:Z', {valueRenderOption: 'UNFORMATTED_VALUE'});
      if (!values[0]?.length) throw new Error('Header tab proyek belum disiapkan.');
      return [name, {id: sheets[name], headers: values[0], values}];
    }));
    const time = new Date().toISOString();
    const timestamps = {row_version: 1, created_at: time, updated_at: time};
    const batch = [];
    const append = (name, rows) => {
      const table = tables[name];
      for (const record of rows) {
        if (Object.keys(record).some(field => !table.headers.includes(field))) throw new Error('Header tab proyek belum lengkap.');
      }
      if (rows.length) batch.push({appendCells: {
        sheetId: table.id, fields: 'userEnteredValue',
        rows: rows.map(record => ({values: table.headers.map(field => projectCell_(record[field]))})),
      }});
    };

    let id = project_id;
    let version;
    let status;
    let assignments;
    let project;
    let stages;
    if (create) {
      id = Utilities.getUuid();
      version = 1;
      status = 'DRAFT';
      assignments = payload.personnel;
      stages = payload.stages;
      project = {
        project_id: id, fiscal_year: submitted.fiscal_year, title: submitted.title.trim(),
        project_code: submitted.project_code.trim(), official_ceiling_amount: submitted.official_ceiling_amount,
        status, active_budget_version_id: '', ...timestamps,
      };
    } else {
      const table = tables.projects;
      const rowIndex = table.values.findIndex((row, index) => index > 0 && row[0] === id);
      if (rowIndex < 1) return fail('NOT_FOUND', 'Proyek tidak ditemukan.');
      project = Object.fromEntries(table.headers.map((field, index) => [field, table.values[rowIndex][index]]));
      if (project.status !== 'DRAFT' || project.row_version !== payload.expected_row_version) {
        return fail('CONFLICT', 'Status atau versi proyek telah berubah. Muat ulang proyek.');
      }
      assignments = rows_(spreadsheetId, 'project_people', ['project_id', 'person_id', 'assignment_role'])
        .filter(row => row.project_id === id);
      stages = rows_(spreadsheetId, 'report_stages', ['project_id', 'sequence_no', 'label', 'target_bps', 'cutoff_date'])
        .filter(row => row.project_id === id).sort((first, second) => first.sequence_no - second.sequence_no);
      const error = projectValidation_(project, assignments, stages);
      if (error) return fail('VALIDATION_ERROR', error);
      version = project.row_version + 1;
      status = 'ACTIVE';
      for (const [field, value] of Object.entries({status, row_version: version, updated_at: time})) {
        const columnIndex = table.headers.indexOf(field);
        if (columnIndex < 0) throw new Error('Header tab proyek belum lengkap.');
        batch.push({updateCells: {
          start: {sheetId: table.id, rowIndex, columnIndex},
          rows: [{values: [projectCell_(value)]}], fields: 'userEnteredValue',
        }});
      }
    }

    const activePeople = rows_(spreadsheetId, 'people', ['person_id'], ['active'])
      .filter(person => person.active === true || !Object.prototype.hasOwnProperty.call(person, 'active'));
    const personIds = new Set(activePeople.map(person => person.person_id));
    if (assignments.some(row => !personIds.has(row.person_id))) return fail('VALIDATION_ERROR', 'Ada personel yang sudah tidak tersedia.');

    if (create) {
      append('projects', [project]);
      append('project_people', assignments.map(row => ({
        project_person_id: Utilities.getUuid(), project_id: id, person_id: row.person_id, assignment_role: row.assignment_role, ...timestamps,
      })));
      append('report_stages', stages.map(stage => ({
        report_stage_id: Utilities.getUuid(), project_id: id, sequence_no: stage.sequence_no, label: stage.label.trim(),
        target_bps: stage.target_bps, cutoff_date: stage.cutoff_date, status: 'DRAFT', ...timestamps,
      })));
    }
    const result = {project_id: id, status, row_version: version};
    append('audit_log', [{
      audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id: id, action,
      entity_type: 'project', entity_id: id, occurred_at: time,
      change_summary: JSON.stringify(create ? {status, row_version: version, official_ceiling_amount: project.official_ceiling_amount}
        : {status, row_version: version}),
    }]);
    append('mutation_requests', [{
      request_id, user_id: user.user_id, action, payload_digest: digest, result_ref: JSON.stringify(result), status: 'COMPLETED', ...timestamps,
    }]);
    Sheets.Spreadsheets.batchUpdate({requests: batch}, spreadsheetId);
    return ok(result);
  } finally {
    lock.releaseLock();
  }
}

function projectCell_(value) {
  if (value === undefined) return {};
  if (typeof value === 'boolean') return {userEnteredValue: {boolValue: value}};
  return {userEnteredValue: typeof value === 'number' ? {numberValue: value} : {stringValue: value}};
}
