const canonical = ['person_id', 'person_kind', 'display_name', 'nip', 'nim', 'unit_name', 'civil_service_grade'];
const normalizeHeader = value => String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase();

export function mapPeopleRows(grid) {
  const headerIndex = grid.slice(0, 10).findIndex(row => {
    const fields = row.map(normalizeHeader);
    return fields.includes('display_name') || (fields.includes('nama') && fields.includes('nip'));
  });
  if (headerIndex < 0) throw new Error('Header berkas harus memuat display_name atau pasangan NAMA dan NIP.');
  const header = grid[headerIndex].map(normalizeHeader);
  const lecturerSheet = !header.includes('display_name');
  const sourceFields = lecturerSheet
    ? ['person_id', 'person_kind', 'nama', 'nip', 'nim', 'unit', 'pangkat']
    : canonical;
  const indexes = sourceFields.map(field => {
    const index = header.indexOf(field);
    if (index >= 0 && index !== header.lastIndexOf(field)) throw new Error('Kolom ' + field + ' muncul lebih dari sekali.');
    return index;
  });
  const subheader = lecturerSheet && grid[headerIndex + 1]?.some(cell =>
    /sesuai pddikti|gol\s*\/\s*ruang/i.test(String(cell ?? '')));
  const first = headerIndex + (subheader ? 2 : 1);
  const rows = grid.slice(first).flatMap((row, index) => {
    if (!indexes.some(column => column >= 0 && String(row[column] ?? '').trim())) return [];
    const mapped = Object.fromEntries(canonical.map((field, position) => {
      const raw = row[indexes[position]];
      const identifier = ['person_id', 'nip', 'nim'].includes(field);
      const text = identifier && typeof raw === 'number' ? '[simpan kolom sebagai teks]' : String(raw ?? '').trim();
      return [field, text];
    }));
    if (lecturerSheet) mapped.person_kind = 'DOSEN';
    else mapped.person_kind = mapped.person_kind.toUpperCase();
    return [{source_row: first + index + 1, ...mapped}];
  });
  if (!rows.length) throw new Error('Berkas belum berisi baris personel.');
  if (rows.length > 1000) throw new Error('Batas impor 1.000 baris per berkas.');
  return rows;
}

export async function readPeopleImport(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran berkas maksimal 5 MB.');
  if (/\.csv$/i.test(file.name)) {
    const {default: Papa} = await import('papaparse');
    const parsed = Papa.parse(await file.text(), {delimitersToGuess: [',', ';', '\t']});
    if (parsed.errors.length) throw new Error('CSV tidak dapat dibaca. Periksa pemisah dan tanda kutip.');
    return mapPeopleRows(parsed.data);
  }
  if (/\.xlsx$/i.test(file.name)) {
    const {readSheet} = await import('read-excel-file/browser');
    return mapPeopleRows(await readSheet(file));
  }
  throw new Error('Pilih berkas CSV atau XLSX.');
}
