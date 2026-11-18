export async function readParticipantsCsv(file) {
  if (!file || file.size > 5 * 1024 * 1024) throw new Error('Pilih CSV dengan ukuran maksimal 5 MB.');
  const {default: Papa} = await import('papaparse');
  const parsed = Papa.parse(await file.text(), {skipEmptyLines: 'greedy'});
  if (parsed.errors.some(error => error.code !== 'UndetectableDelimiter')) throw new Error('CSV tidak dapat dibaca. Periksa pemisah dan tanda kutip.');
  const [rawHeaders = [], ...values] = parsed.data;
  const headers = rawHeaders.map(value => value.trim().toLowerCase());
  if (!headers.includes('person_id') || new Set(headers).size !== headers.length) {
    throw new Error('CSV memerlukan header person_id yang unik. Kolom attendance_status bersifat opsional.');
  }
  if (!values.length || values.length > 1000) throw new Error('CSV harus berisi 1–1.000 peserta.');
  return values.map((row, index) => ({source_row: index + 2,
    person_id: (row[headers.indexOf('person_id')] || '').trim(),
    attendance_status: (row[headers.indexOf('attendance_status')] || '').trim() || 'UNRECORDED',
  }));
}
