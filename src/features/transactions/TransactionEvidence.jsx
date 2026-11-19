import {useEffect, useId, useRef, useState} from 'react';
import {Close, FileText, Pencil, Plus, RefreshCw, Save} from '../../components/ui/Icons.jsx';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import fields from './TransactionWorkspace.module.css';
import styles from './TransactionEvidence.module.css';
import {UploadEvidence} from '../operations/shared.jsx';

function driveId(value) {
  const input = value.trim();
  if (/^[\w-]{10,200}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || url.port) return '';
    const id = url.pathname.match(/^\/file\/d\/([\w-]{10,200})(?:\/view)?\/?$/)?.[1] || (url.pathname === '/open' ? url.searchParams.get('id') : '');
    return /^[\w-]{10,200}$/.test(id || '') ? id : '';
  } catch {return '';}
}

export function TransactionEvidence({endpoint, token, expire, projectId, transactionId, disabled, onLinked}) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  return <div className={styles.evidence}>
    <button ref={button} type="button" className={layout.secondary} disabled={disabled || open} aria-expanded={open} onClick={() => setOpen(true)}><FileText size={16} /> Bukti transaksi</button>
    {open && <EvidencePanel endpoint={endpoint} token={token} expire={expire} projectId={projectId} transactionId={transactionId} disabled={disabled}
      onLinked={onLinked} onClose={() => {setOpen(false); requestAnimationFrame(() => button.current?.focus());}} />}
  </div>;
}

function EvidencePanel({endpoint, token, expire, projectId, transactionId, disabled, onClose, onLinked}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState('');
  const heading = useRef(null);
  const formHeading = useRef(null);
  const input = useRef(null);
  const mutation = useRef(null);
  const attempt = useRef(null);
  const current = response?.revision === revision ? response : null;
  const data = current?.data;
  const locked = pending || uncertain || disabled;

  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'attachments.list', projectId, controller.signal, {transaction_id: transactionId})
      .then(data => {
        if (controller.signal.aborted) return;
        setResponse({revision, data});
        requestAnimationFrame(() => {if (!draft) heading.current?.focus();});
      }).catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResponse({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, projectId, transactionId, revision]);
  useEffect(() => () => mutation.current?.abort(), []);

  function edit(row) {
    setDraft({attachment_id: row?.attachment_id || '', expected_attachment_row_version: row?.row_version || 0, file: row?.drive_file_id || ''});
    setError(''); setMessage(''); setConflict(false);
    requestAnimationFrame(() => formHeading.current?.focus());
  }
  async function link(event) {
    event.preventDefault();
    if (mutation.current || !data || conflict || pending || disabled) return;
    const fileId = driveId(draft.file);
    if (!fileId) {setError('Masukkan ID berkas atau tautan file Google Drive yang valid.'); input.current?.focus(); return;}
    attempt.current ??= {id: crypto.randomUUID(), payload: {transaction_id: transactionId, attachment_id: draft.attachment_id,
      expected_attachment_row_version: draft.expected_attachment_row_version, expected_transaction_row_version: data.transaction_row_version,
      attachment_kind: 'PAYMENT_PROOF', drive_file_id: fileId}};
    const controller = new AbortController();
    mutation.current = controller; setPending(true); setError('');
    try {
      await callProjectRpc(endpoint, token, 'attachments.link', projectId, controller.signal, attempt.current.payload, attempt.current.id);
      if (controller.signal.aborted) return;
      attempt.current = null; setUncertain(false); setDraft(null); setRevision(value => value + 1);
      setMessage('Bukti tertaut. Penautan belum menjadi verifikasi; perubahan bukti perlu ditinjau pemilik.');
      onLinked();
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.message);
        if (['VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(failure.code)) {
          attempt.current = null; setUncertain(false); setConflict(failure.code === 'CONFLICT');
          if (failure.code === 'CONFLICT') setRevision(value => value + 1);
        } else setUncertain(true);
      }
    } finally {if (!controller.signal.aborted) {mutation.current = null; setPending(false);}}
  }
  return <section className={styles.panel} aria-labelledby={id + '-heading'}>
    <div className={fields.actions}>
      <h5 id={id + '-heading'} ref={heading} tabIndex={-1}><FileText size={20} /> Bukti pembayaran</h5>
      <button className={layout.secondary} type="button" disabled={locked} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Muat ulang bukti</button>
    </div>
    {!current && <p role="status">Memuat bukti…</p>}
    {current?.error && <p role="alert" className={fields.error}>{current.error}</p>}
    {message && <p role="status">{message}</p>}
    {data && <>
      <p className={fields.context}>Tautkan PDF/JPG/PNG maksimal 20 MB yang sudah diunggah langsung ke folder bukti proyek. Aplikasi tidak mengubah izin Drive.</p>
      {data.folder_url ? <a href={data.folder_url} target="_blank" rel="noreferrer">Buka folder bukti proyek di Drive</a>
        : <p className={fields.context}>Pemilik menyiapkan berkas di folder proyek dan memberikan ID/tautan untuk ditautkan. Membuka berkas tetap memerlukan izin Drive.</p>}
      {!data.attachments.length && <p>Belum ada bukti tertaut.</p>}
      <ul className={styles.files} aria-label="Bukti tertaut">
        {data.attachments.map(row => <li key={row.attachment_id}>
          <strong>{row.available ? row.name : 'Bukti tidak tersedia atau tidak memenuhi syarat'}</strong>
          <span>Versi {row.row_version} · {row.attachment_kind === 'PAYMENT_PROOF' ? 'Bukti pembayaran' : row.attachment_kind}</span>
          {row.available && <><a href={'https://drive.google.com/file/d/' + encodeURIComponent(row.drive_file_id) + '/view'} target="_blank" rel="noreferrer">Buka bukti di Drive</a>
            <span>Diperbarui {new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'}).format(new Date(row.modified_at))} WIB</span></>}
          {data.can_link && row.attachment_kind === 'PAYMENT_PROOF' && <button className={layout.secondary} type="button" disabled={locked || Boolean(draft)} onClick={() => edit(row)}><Pencil size={16} /> Ganti bukti versi {row.row_version}</button>}
        </li>)}
      </ul>
      {data.can_link ? <button className={layout.secondary} type="button" disabled={locked || Boolean(draft)} onClick={() => edit(null)}><Plus size={16} /> Tautkan bukti</button>
        : <p>Bukti tidak dapat diubah pada status transaksi atau proyek ini.</p>}
      {data.can_link && <UploadEvidence api={{endpoint, token, expire, projectId}} kind="PAYMENT_PROOF" transactionId={transactionId} transactionVersion={data.transaction_row_version}
        disabled={locked || Boolean(draft)} onUploaded={() => {setRevision(value => value + 1); onLinked();}} />}
    </>}
    {draft && <form className={fields.form} onSubmit={link}>
      <h5 ref={formHeading} tabIndex={-1}>{draft.attachment_id ? 'Ganti berkas bukti' : 'Tautkan berkas bukti'}</h5>
      <fieldset disabled={locked}><legend>Berkas Drive</legend><label className={fields.field}>ID atau tautan berkas Drive<input ref={input} required maxLength={1000} value={draft.file} onChange={event => setDraft({...draft, file: event.target.value})} /></label></fieldset>
      {error && <p role="alert" className={fields.error}>{error}</p>}
      {uncertain && <p role="status">Hasil penautan belum diketahui. Coba kembali dengan berkas dan request yang sama sebelum melanjutkan.</p>}
      {conflict && <button type="button" className={layout.secondary} disabled={locked || !data} onClick={() => {
        const previous = data.attachments.find(row => row.attachment_id === draft.attachment_id);
        if (draft.attachment_id && !previous) {setError('Bukti asal tidak ditemukan. Batalkan formulir dan pilih bukti dari daftar terbaru.'); return;}
        setDraft(previousDraft => ({...previousDraft, expected_attachment_row_version: previous?.row_version || 0})); setConflict(false); setError('');
      }}>Gunakan daftar bukti terbaru sebagai acuan</button>}
      <div className={fields.actions}>
        <button className={layout.primary} type="submit" disabled={pending || disabled || conflict || !data?.can_link}><Save size={16} /> {pending ? 'Menautkan…' : uncertain ? 'Coba tautkan bukti kembali' : 'Simpan tautan bukti'}</button>
        <button className={layout.secondary} type="button" disabled={locked} onClick={() => {setDraft(null); setError(''); setConflict(false); requestAnimationFrame(() => heading.current?.focus());}}><Close size={16} /> Batal bukti</button>
      </div>
    </form>}
    <button className={layout.secondary} type="button" disabled={pending || uncertain} onClick={onClose}><Close size={16} /> Tutup bukti</button>
  </section>;
}
