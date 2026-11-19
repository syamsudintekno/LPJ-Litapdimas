import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mapPeopleRows, readPeopleImport} from './readPeopleImport.js';

test('CSV dosen melewati subheader dan menjaga nol awal pada NIP', async () => {
  const file = new File([
    'NO,NIP,NIDN,NAMA,L/P,JENIS PEGAWAI,UNIT,Homebase Program Studi,PANGKAT,NO HP,EMAIL,ALAMAT\n',
    ',,,,,,Sesuai PDDIKTI,Sesuai PDDIKTI,GOL/ RUANG,,,\n',
    '1,001234567890123456,,Dosen Sintetis,,,Unit Riset,,III/a,000,ignored@example.test,Alamat sintetis\n',
    '\n',
    '2,001234567890123457,,Dosen Lain,,,Unit Riset,,III/b,,,\n',
  ], 'dosen.csv');
  const rows = await readPeopleImport(file);
  assert.deepEqual(rows[0], {
    source_row: 3, person_id: '', person_kind: 'DOSEN', display_name: 'Dosen Sintetis',
    nip: '001234567890123456', nim: '', unit_name: 'Unit Riset', civil_service_grade: 'III/a',
  });
  assert.equal(rows[1].source_row, 5);
});

test('NIP numerik dari Excel ditandai untuk koreksi', () => {
  const [row] = mapPeopleRows([['NAMA', 'NIP'], ['Dosen Sintetis', 123456789012345678]]);
  assert.equal(row.nip, '[simpan kolom sebagai teks]');
  const [identifiers] = mapPeopleRows([['person_id', 'person_kind', 'display_name', 'nip', 'nim'], [12345, 'MAHASISWA', 'Mahasiswa Sintetis', '', 123456]]);
  assert.equal(identifiers.person_id, '[simpan kolom sebagai teks]');
  assert.equal(identifiers.nim, '[simpan kolom sebagai teks]');
});
