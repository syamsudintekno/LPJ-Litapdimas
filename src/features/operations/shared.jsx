import {useEffect, useRef, useState} from 'react';
import {RefreshCw, Upload} from '../../components/ui/Icons.jsx';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './Operations.module.css';

export const money = value => new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0}).format(value);
export function useRemote(api, action, payload = {}) {
  const [revision, setRevision] = useState(0), [response, setResponse] = useState(null);
  const key = JSON.stringify([api.projectId, action, payload, revision]);
  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(api.endpoint, api.token, action, api.projectId, controller.signal, JSON.parse(JSON.stringify(payload)))
      .then(data => {if (!controller.signal.aborted) setResponse({key, data});})
      .catch(error => {if (!controller.signal.aborted) {if (error.code === 'UNAUTHENTICATED') api.expire(); else setResponse({key, error: error.message});}});
    return () => controller.abort();
  }, [api.endpoint, api.token, api.expire, key]);
  return {...(response?.key === key ? response : {}), loading: response?.key !== key, refresh: () => setRevision(value => value + 1)};
}
export function useOperation(api) {
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null);
  const attempt = useRef(null), controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(action, payload, success) {
    if (controller.current) return;
    attempt.current ??= {id: crypto.randomUUID(), action, payload, success};
    const current = attempt.current, abort = new AbortController(); controller.current = abort; setPending(true); setError(''); setResult(null);
    try {
      const data = await callProjectRpc(api.endpoint, api.token, current.action, api.projectId, abort.signal, current.payload, current.id);
      if (abort.signal.aborted) return;
      attempt.current = null; setUncertain(false); setResult(data); current.success?.(data);
    } catch (failure) {
      if (abort.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') api.expire();
      else {setError(failure.message); if (['VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(failure.code)) {attempt.current = null; setUncertain(false);} else setUncertain(true);}
    } finally {if (!abort.signal.aborted) {controller.current = null; setPending(false);}}
  }
  return {run, retry: () => run('', {}), pending, uncertain, locked: pending || uncertain, error, result};
}
export function Feedback({remote, operation}) {
  return <>{remote?.loading && <p role="status">Memuat data…</p>}{remote?.error && <p role="alert" className={styles.error}>{remote.error}</p>}
    {operation?.error && <p role="alert" className={styles.error}>{operation.error}</p>}
    {operation?.uncertain && <p role="status">Hasil belum diketahui. Coba kembali dengan permintaan yang sama sebelum mengubah isian.</p>}
    {operation?.uncertain && <button className={layout.secondary} type="button" disabled={operation.pending} onClick={operation.retry}><RefreshCw size={16} /> Coba permintaan yang sama</button>}
    {operation?.pending && <p role="status">Sedang memproses. Tetap di bagian ini sampai hasil diterima.</p>}</>;
}
export function UploadEvidence({api, kind, transactionId = '', transactionVersion, onUploaded, disabled}) {
  const op = useOperation(api), [file, setFile] = useState(null), [reading, setReading] = useState(false), [error, setError] = useState('');
  const input = useRef(null);
  async function submit(event) {
    event.preventDefault(); if (!file || reading) return;
    if (op.uncertain) {op.run('attachments.upload', {}, done); return;}
    if (file.size > 20 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {setError('Pilih PDF/JPG/PNG maksimal 20 MiB.'); return;}
    setReading(true); setError('');
    try {
      const base64 = await new Promise((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Berkas tidak dapat dibaca.')); reader.readAsDataURL(file);});
      await op.run('attachments.upload', {name: file.name, mime_type: file.type, base64, attachment_kind: kind,
        transaction_id: transactionId, ...(transactionId ? {expected_transaction_row_version: transactionVersion} : {})}, done);
    } catch (failure) {setError(failure.message);} finally {setReading(false);}
  }
  function done(data) {setFile(null); if (input.current) input.current.value = ''; onUploaded(data);}
  return <form className={styles.form} onSubmit={submit}>
    <label className={styles.field}>{kind === 'DISBURSEMENT_PROOF' ? 'Bukti penerimaan dana' : kind === 'TAX_REMITTANCE_PROOF' ? 'Bukti setoran pajak' : 'Bukti pembayaran transaksi'} (PDF/JPG/PNG)<input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" required disabled={disabled || op.locked || reading} onChange={event => setFile(event.target.files[0] || null)} /></label>
    <p>Berkas disimpan privat di folder proyek. Penautan atau unggahan belum berarti verifikasi.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}<Feedback operation={op} />
    <button className={layout.secondary} type="submit" disabled={disabled || op.pending || reading || !file}><Upload size={16} /> {op.uncertain ? 'Coba unggah kembali' : reading || op.pending ? 'Mengunggah…' : 'Unggah bukti'}</button>
  </form>;
}
export function downloadFile(data) {
  const bytes = Uint8Array.from(atob(data.base64), value => value.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], {type: data.mime_type})), link = document.createElement('a');
  link.href = url; link.download = data.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
