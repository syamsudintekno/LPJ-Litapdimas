import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readParticipantsCsv} from './readParticipantsCsv.js';

test('CSV peserta menjaga ID sebagai teks dan memberi status belum dicatat bila kosong', async () => {
  const rows = await readParticipantsCsv(new File(['\ufeffperson_id,attendance_status\n0000123,PRESENT\ncontoh-id,\n'], 'peserta.csv'));
  assert.deepEqual(rows, [
    {source_row: 2, person_id: '0000123', attendance_status: 'PRESENT'},
    {source_row: 3, person_id: 'contoh-id', attendance_status: 'UNRECORDED'},
  ]);
  await assert.rejects(readParticipantsCsv(new File(['nama\nNama'], 'salah.csv')), /header person_id/);
  await assert.rejects(readParticipantsCsv(new File(['person_id,person_id\na,b'], 'ganda.csv')), /header person_id/);
  await assert.rejects(readParticipantsCsv(new File(['person_id\n'], 'kosong.csv')), /1–1.000/);
  assert.equal((await readParticipantsCsv(new File(['person_id\ncontoh-id'], 'satu-kolom.csv')))[0].attendance_status, 'UNRECORDED');
  await assert.rejects(readParticipantsCsv(new File(['person_id,attendance_status\n"kutip-tidak-lengkap,PRESENT'], 'kutip.csv')), /tidak dapat dibaca/);
});
