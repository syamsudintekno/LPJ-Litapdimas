const BUDGET_VERSION_FIELDS_ = ['budget_version_id', 'project_id', 'version_no', 'status', 'approved_by_user_id', 'approved_at', 'row_version'];
const BUDGET_CATEGORY_FIELDS_ = ['budget_category_id', 'budget_version_id', 'category_code', 'label', 'sort_order'];
const BUDGET_ITEM_FIELDS_ = ['budget_item_id', 'budget_category_id', 'label', 'volume', 'frequency', 'unit', 'unit_price_amount'];

function budgetTotal_(categories) {
  if (!Array.isArray(categories) || !categories.length || categories.length > 30) return null;
  const codes = new Set();
  const details = [];
  let count = 0;
  let total = 0;
  for (const category of categories) {
    if (!category || !budgetText_(category.category_code, 40) || !budgetText_(category.label, 120) ||
        !Array.isArray(category.items) || !category.items.length) return null;
    const code = category.category_code.trim().toLowerCase();
    if (codes.has(code)) return null;
    codes.add(code);
    const items = [];
    for (const item of category.items) {
      if (++count > 200 || !item || !budgetText_(item.label, 240) || !budgetText_(item.unit, 40) ||
          !Number.isSafeInteger(item.frequency) || item.frequency < 1 ||
          !Number.isSafeInteger(item.unit_price_amount) || item.unit_price_amount < 0 ||
          typeof item.volume !== 'number' || item.volume <= 0) return null;
      const scaledVolume = Math.round(item.volume * 1000);
      if (!Number.isSafeInteger(scaledVolume) || scaledVolume / 1000 !== item.volume) return null;
      const scaledAmount = scaledVolume * item.frequency * item.unit_price_amount;
      if (!Number.isSafeInteger(scaledAmount)) return null;
      const remainder = scaledAmount % 1000;
      const amount = (scaledAmount - remainder) / 1000 + (remainder >= 500 ? 1 : 0);
      total += amount;
      if (!Number.isSafeInteger(total)) return null;
      items.push({...item, line_amount: amount});
    }
    details.push({...category, items});
  }
  return {categories: details, detail_total_amount: total};
}

function budgetText_(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function budgetDetails_(spreadsheetId, versionId) {
  const categories = rows_(spreadsheetId, 'budget_categories', BUDGET_CATEGORY_FIELDS_)
    .filter(category => category.budget_version_id === versionId)
    .sort((a, b) => a.sort_order - b.sort_order);
  const byCategory = new Map(categories.map(category => [category.budget_category_id, []]));
  for (const item of rows_(spreadsheetId, 'budget_items', BUDGET_ITEM_FIELDS_)) {
    byCategory.get(item.budget_category_id)?.push(item);
  }
  return budgetTotal_(categories.map(category => ({...category, items: byCategory.get(category.budget_category_id)})));
}

function budgetRpc_(spreadsheetId, user, request) {
  const {action, request_id, project_id, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  if (PropertiesService.getScriptProperties().getProperty('BUDGETS_ENABLED') !== 'true') {
    return fail('TEMPORARY_FAILURE', 'Pengelolaan RAB belum diaktifkan.');
  }
  const list = action === 'budgets.list_versions';
  const save = action === 'budgets.save_version';
  const selectedId = payload?.budget_version_id;
  if ((selectedId !== undefined && (typeof selectedId !== 'string' || !PROJECT_UUID_.test(selectedId))) ||
      (!list && !PROJECT_UUID_.test(request_id)) ||
      (!list && !save && (!selectedId || !Number.isInteger(payload?.expected_row_version) ||
        !Number.isInteger(payload?.expected_project_row_version)))) {
    return fail('VALIDATION_ERROR', 'Identitas atau versi RAB tidak valid.');
  }
  const submitted = save ? budgetTotal_(payload?.categories) : null;
  if (save && !submitted) return fail('VALIDATION_ERROR', 'Periksa kode kategori, rincian item, dan batas nominal RAB.');

  // Readers share the lock so that active version and detail refer to one committed state.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'RAB sedang diproses. Coba lagi.');
  try {
    const project = rows_(spreadsheetId, 'projects', ['project_id'],
      ['status', 'official_ceiling_amount', 'active_budget_version_id', 'row_version'])
      .find(row => row.project_id === project_id);
    if (!project) return fail('NOT_FOUND', 'Proyek tidak ditemukan.');
    const ceiling = Number.isSafeInteger(project.official_ceiling_amount) ? project.official_ceiling_amount : null;
    const versions = rows_(spreadsheetId, 'budget_versions', BUDGET_VERSION_FIELDS_)
      .filter(version => version.project_id === project_id).sort((a, b) => b.version_no - a.version_no);
    if (list) {
      const selected = selectedId ?? (project.active_budget_version_id || versions[0]?.budget_version_id);
      const version = versions.find(row => row.budget_version_id === selected);
      if (selected && !version) return fail('NOT_FOUND', 'Versi RAB tidak ditemukan dalam proyek ini.');
      const details = version ? budgetDetails_(spreadsheetId, selected) : null;
      if (version && !details) return fail('TEMPORARY_FAILURE', 'Rincian versi RAB tidak konsisten.');
      return ok({
        versions, official_ceiling_amount: ceiling, project_row_version: project.row_version,
        active_budget_version_id: project.active_budget_version_id || null,
        can_write: ['DRAFT', 'ACTIVE'].includes(project.status) && ceiling > 0,
        selected_version: version ? {...version, ...details,
          difference_amount: ceiling === null ? null : ceiling - details.detail_total_amount} : null,
      });
    }

    const digest = requestDigest_([action, project_id, payload]);
    const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref'])
      .find(row => row.request_id === request_id);
    if (previous) {
      if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest) {
        return fail('CONFLICT', 'ID permintaan sudah digunakan.');
      }
      return ok(JSON.parse(previous.result_ref));
    }
    if (!['DRAFT', 'ACTIVE'].includes(project.status) || ceiling === null || ceiling <= 0) {
      return fail('VALIDATION_ERROR', 'RAB memerlukan proyek aktif atau draf dengan plafon resmi.');
    }

    const time = new Date().toISOString();
    const stamp = {row_version: 1, created_at: time, updated_at: time};
    const adds = {};
    const updates = [];
    let result;
    let total;
    if (save) {
      const id = Utilities.getUuid();
      const versionNo = (versions[0]?.version_no ?? 0) + 1;
      result = {budget_version_id: id, version_no: versionNo, status: 'DRAFT', row_version: 1};
      total = submitted.detail_total_amount;
      adds.budget_versions = [{...result, project_id, approved_by_user_id: '', approved_at: '', ...stamp}];
      adds.budget_categories = [];
      adds.budget_items = [];
      for (const [index, category] of submitted.categories.entries()) {
        const categoryId = Utilities.getUuid();
        adds.budget_categories.push({budget_category_id: categoryId, budget_version_id: id, category_code: category.category_code.trim(),
          label: category.label.trim(), sort_order: index + 1, ...stamp});
        for (const item of category.items) {
          adds.budget_items.push({budget_item_id: Utilities.getUuid(), budget_category_id: categoryId, label: item.label.trim(),
            volume: item.volume, frequency: item.frequency, unit: item.unit.trim(), unit_price_amount: item.unit_price_amount, ...stamp});
        }
      }
    } else {
      const version = versions.find(row => row.budget_version_id === selectedId);
      if (!version) return fail('NOT_FOUND', 'Versi RAB tidak ditemukan dalam proyek ini.');
      if (version.status !== 'DRAFT' || version.row_version !== payload.expected_row_version ||
          project.row_version !== payload.expected_project_row_version) {
        return fail('CONFLICT', 'Versi proyek atau RAB sudah berubah. Muat ulang sebelum mengesahkan.');
      }
      const approved = versions.filter(row => row.status === 'APPROVED');
      if (approved.length !== (project.active_budget_version_id ? 1 : 0) ||
          (approved.length && approved[0].budget_version_id !== project.active_budget_version_id)) {
        return fail('CONFLICT', 'RAB aktif dan riwayat pengesahan tidak konsisten.');
      }
      const details = budgetDetails_(spreadsheetId, selectedId);
      if (!details) return fail('VALIDATION_ERROR', 'Rincian versi RAB tidak lengkap.');
      total = details.detail_total_amount;
      result = {budget_version_id: selectedId, version_no: version.version_no, status: 'APPROVED', row_version: version.row_version + 1};
      updates.push(['budget_versions', selectedId, {
        status: 'APPROVED', approved_by_user_id: user.user_id, approved_at: time, row_version: result.row_version, updated_at: time,
      }], ['projects', project_id, {
        active_budget_version_id: selectedId, row_version: project.row_version + 1, updated_at: time,
      }]);
      if (approved.length) updates.push(['budget_versions', approved[0].budget_version_id, {
        status: 'SUPERSEDED', row_version: approved[0].row_version + 1, updated_at: time,
      }]);
    }
    adds.audit_log = [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action,
      entity_type: 'budget_version', entity_id: result.budget_version_id, occurred_at: time,
      change_summary: JSON.stringify({status: result.status, detail_total_amount: total, previous_version_id: project.active_budget_version_id || null}),
    }];
    adds.mutation_requests = [{request_id, user_id: user.user_id, action, payload_digest: digest,
      result_ref: JSON.stringify(result), status: 'COMPLETED', ...stamp}];
    budgetBatch_(spreadsheetId, adds, updates);
    return ok(result);
  } finally {
    lock.releaseLock();
  }
}

function budgetBatch_(spreadsheetId, adds, updates, deletes = []) {
  const metadata = Sheets.Spreadsheets.get(spreadsheetId, {fields: 'sheets(properties(sheetId,title))'});
  const ids = Object.fromEntries(metadata.sheets.map(sheet => [sheet.properties.title, sheet.properties.sheetId]));
  const changing = new Set([...updates, ...deletes].map(([name]) => name));
  const tables = Object.fromEntries([...new Set([...Object.keys(adds), ...changing])].map(name => {
    if (ids[name] === undefined) throw new Error('Tab RAB belum disiapkan.');
    const {values = []} = Sheets.Spreadsheets.Values.get(spreadsheetId, name + (changing.has(name) ? '!A:Z' : '!A1:Z1'),
      {valueRenderOption: 'UNFORMATTED_VALUE'});
    return [name, {headers: values[0] ?? [], values, sheetId: ids[name]}];
  }));
  const appendRequests = Object.entries(adds).map(([name, entries]) => {
    const {headers, sheetId} = tables[name];
    if (entries.some(record => Object.keys(record).some(field => !headers.includes(field)))) throw new Error('Header RAB belum lengkap.');
    return {appendCells: {sheetId, fields: 'userEnteredValue',
      rows: entries.map(record => ({values: headers.map(field => projectCell_(record[field]))}))}};
  });
  const requests = [];
  for (const [name, id, changes] of updates) {
    const {headers, values, sheetId} = tables[name];
    const rowIndex = values.findIndex((row, index) => index > 0 && row[0] === id);
    for (const [field, value] of Object.entries(changes)) {
      const columnIndex = headers.indexOf(field);
      if (rowIndex < 1 || columnIndex < 0) throw new Error('Target pembaruan RAB belum lengkap.');
      requests.push({updateCells: {start: {sheetId, rowIndex, columnIndex}, fields: 'userEnteredValue',
        rows: [{values: [projectCell_(value)]}]}});
    }
  }
  const removing = deletes.map(([name, id]) => {
    const {values, sheetId} = tables[name];
    const index = values.findIndex((row, offset) => offset > 0 && row[0] === id);
    if (index < 1) throw new Error('Target penghapusan sesi tidak ditemukan.');
    return {sheetId, index};
  }).sort((a, b) => a.sheetId - b.sheetId || b.index - a.index);
  if (new Set(removing.map(row => row.sheetId + ':' + row.index)).size !== removing.length) throw new Error('Target penghapusan ganda.');
  for (const {sheetId, index} of removing) requests.push({deleteDimension: {
    range: {sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1},
  }});
  requests.push(...appendRequests);
  Sheets.Spreadsheets.batchUpdate({requests}, spreadsheetId);
}
