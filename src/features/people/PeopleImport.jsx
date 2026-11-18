import {useEffect, useRef, useState} from 'react';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './PeopleDirectory.module.css';
import {readPeopleImport} from './readPeopleImport.js';

const labels = {VALID: 'Siap diimpor', DUPLICATE: 'Duplikat', CORRECTION: 'Perlu koreksi'};
const pageSize = 25;

export function PeopleImport({endpoint, token, expire, onCommitted}) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const controllerRef = useRef(null);
  const input = useRef(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  async function run(mode) {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError('');
    try {
      if (mode === 'preview') {
        setPreview(null);
        setResult(null);
        const rows = await readPeopleImport(file);
        if (controller.signal.aborted) return;
        const data = await callProjectRpc(endpoint, token, 'people.preview_import', undefined, controller.signal, {rows});
        if (controller.signal.aborted) return;
        setPage(0);
        setPreview({...data, rows, requestId: crypto.randomUUID()});
      } else {
        const data = await callProjectRpc(endpoint, token, 'people.commit_import', undefined, controller.signal,
          {rows: preview.rows, import_token: preview.import_token}, preview.requestId);
        if (controller.signal.aborted) return;
        setPreview(null);
        setFile(null);
        input.current.value = '';
        setResult(data);
        onCommitted();
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else setError(failure.message || 'Impor gagal diproses.');
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
        controllerRef.current = null;
      }
    }
  }

  return <section className={styles.importArea} aria-labelledby="import-heading">
    <h3 id="import-heading">Impor personel</h3>
    <form className={styles.importForm} onSubmit={event => {event.preventDefault(); run('preview');}}>
      <label>
        Berkas CSV atau XLSX
        <input ref={input} type="file" accept=".csv,.xlsx" required disabled={pending} onChange={event => {
          setFile(event.target.files[0] ?? null);
          setPreview(null);
          setError('');
          setResult(null);
        }} />
      </label>
      <button className={layout.secondary} disabled={pending || !file} type="submit">Pratinjau</button>
    </form>
    <p className={styles.help}>Untuk Excel, simpan kolom NIP, NIM, dan ID sebagai teks. Gunakan lembar pertama untuk data yang akan diimpor.</p>
    {pending && <p role="status">Memproses berkas…</p>}
    {error && <p role="alert" className={styles.importError}>{error}</p>}
    {result && <p role="status">{result.imported} personel diimpor, {result.duplicate} duplikat, {result.correction} perlu koreksi.</p>}
    {preview && <>
      <p role="status">{preview.summary.valid} siap diimpor, {preview.summary.duplicate} duplikat, {preview.summary.correction} perlu koreksi.</p>
      <div className={styles.tableArea} role="region" aria-label="Pratinjau impor" tabIndex={0}>
        <table>
          <thead><tr><th scope="col">Baris</th><th scope="col">Nama</th><th scope="col">Status</th><th scope="col">Keterangan</th></tr></thead>
          <tbody>{preview.results.slice(page * pageSize, (page + 1) * pageSize).map((row, index) => <tr key={row.source_row}>
            <th scope="row">{row.source_row}</th>
            <td>{preview.rows[page * pageSize + index].display_name || '—'}</td>
            <td>{labels[row.status]}</td>
            <td>{row.message || '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className={styles.importForm}>
        <button className={layout.secondary} disabled={page === 0 || pending} type="button" onClick={() => setPage(page - 1)}>Sebelumnya</button>
        <span>Halaman {page + 1} dari {Math.ceil(preview.results.length / pageSize)}</span>
        <button className={layout.secondary} disabled={(page + 1) * pageSize >= preview.results.length || pending}
          type="button" onClick={() => setPage(page + 1)}>Berikutnya</button>
        <button className={layout.primary} disabled={!preview.summary.valid || pending} type="button" onClick={() => run('commit')}>
          Impor {preview.summary.valid} baris valid
        </button>
      </div>
    </>}
  </section>;
}
