import {useEffect, useId, useRef, useState} from 'react';
import {Check, Close, RefreshCw, ShieldCheck} from '../../components/ui/Icons.jsx';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import fields from './TransactionWorkspace.module.css';
import styles from './TransactionEvidence.module.css';

const money = value => new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0}).format(value);

export function TransactionConfirmation({endpoint, token, expire, projectId, transactionId, disabled, onConfirmed}) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  return <div className={styles.evidence}>
    <button ref={button} className={layout.secondary} type="button" disabled={disabled || open} aria-expanded={open} onClick={() => setOpen(true)}><ShieldCheck size={16} /> Tinjau konfirmasi</button>
    {open && <ConfirmationPanel endpoint={endpoint} token={token} expire={expire} projectId={projectId} transactionId={transactionId} disabled={disabled}
      onConfirmed={onConfirmed} onClose={() => {setOpen(false); requestAnimationFrame(() => button.current?.focus());}} />}
  </div>;
}

function ConfirmationPanel({endpoint, token, expire, projectId, transactionId, disabled, onConfirmed, onClose}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef(null);
  const attempt = useRef(null);
  const mutation = useRef(null);
  const current = response?.revision === revision ? response : null;
  const data = current?.data;
  const locked = pending || uncertain || disabled;
  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'transactions.preview_confirmation', projectId, controller.signal, {transaction_id: transactionId})
      .then(data => {
        if (controller.signal.aborted) return;
        setResponse({revision, data}); setReviewed(false); setConflict(false); setError('');
        requestAnimationFrame(() => heading.current?.focus());
      }).catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResponse({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, projectId, transactionId, revision]);
  useEffect(() => () => mutation.current?.abort(), []);
  async function confirm(event) {
    event.preventDefault();
    if (mutation.current || disabled || !data?.can_confirm || !reviewed || conflict) return;
    attempt.current ??= {id: crypto.randomUUID(), payload: {transaction_id: transactionId, preview_token: data.preview_token,
      expected_row_version: data.transaction.row_version, evidence_reviewed: true}};
    const controller = new AbortController();
    mutation.current = controller; setPending(true); setError('');
    try {
      const saved = await callProjectRpc(endpoint, token, 'transactions.confirm', projectId, controller.signal, attempt.current.payload, attempt.current.id);
      if (controller.signal.aborted) return;
      attempt.current = null; setUncertain(false); onConfirmed(saved);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.message);
        if (['VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(failure.code)) {
          attempt.current = null; setUncertain(false); setConflict(true); setReviewed(false);
        } else setUncertain(true);
      }
    } finally {if (!controller.signal.aborted) {mutation.current = null; setPending(false);}}
  }
  return <section className={styles.panel} aria-labelledby={id + '-heading'}>
    <div className={fields.actions}><h5 id={id + '-heading'} ref={heading} tabIndex={-1}><ShieldCheck size={20} /> Tinjauan konfirmasi transaksi</h5>
      <button className={layout.secondary} type="button" disabled={locked} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Muat ulang tinjauan</button></div>
    {!current && <p role="status">Memeriksa syarat konfirmasi…</p>}
    {current?.error && <p role="alert" className={fields.error}>{current.error}</p>}
    {data && <>
      <p>Konfirmasi memasukkan nilai kwitansi ke total terkonfirmasi. Kwitansi bernomor dan paket final disiapkan pada alur berikutnya.</p>
      {data.totals && <dl className={fields.summary}>
        <div><dt>Nilai kwitansi</dt><dd>{money(data.totals.receipt_amount)}</dd></div>
        <div><dt>Potongan pajak</dt><dd>{money(data.totals.withheld_tax_amount)}</dd></div>
        <div><dt>Jumlah diterima</dt><dd>{money(data.totals.net_paid_amount)}</dd></div>
      </dl>}
      {data.blockers.length > 0 && <div role="status"><strong>Belum dapat dikonfirmasi</strong><ul>{data.blockers.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
      <ul className={styles.files} aria-label="Pembayaran yang ditinjau">
        {data.payments.map(payment => <li key={payment.payment_detail_id}>
          <strong>{payment.legal_name || 'Penerima belum lengkap'}</strong>
          <span>Kwitansi {money(payment.receipt_amount)} · Potongan {money(payment.withheld_tax_amount)} · Diterima {money(payment.net_paid_amount)}</span>
          <span>{payment.needs_review ? 'Pajak/bukti perlu ditinjau ulang' : payment.tax_status === 'NOT_APPLICABLE' ? 'Keputusan tidak dikenai pajak tercatat' : 'Pajak telah diverifikasi'}</span>
          {payment.evidence && <a href={'https://drive.google.com/file/d/' + encodeURIComponent(payment.evidence.drive_file_id) + '/view'} target="_blank" rel="noreferrer">Buka bukti: {payment.evidence.name}</a>}
        </li>)}
      </ul>
      {data.can_confirm && <form className={fields.form} onSubmit={confirm}>
        <label><input type="checkbox" required checked={reviewed} disabled={locked} onChange={event => setReviewed(event.target.checked)} /> Saya sudah mencocokkan seluruh bukti, penerima, nilai kwitansi, potongan, dan jumlah diterima.</label>
        <button className={layout.primary} type="submit" disabled={pending || disabled || !reviewed || conflict}><Check size={16} /> {pending ? 'Mengonfirmasi…' : uncertain ? 'Coba konfirmasi kembali' : 'Konfirmasi transaksi'}</button>
      </form>}
    </>}
    {error && <p role="alert" className={fields.error}>{error}</p>}
    {uncertain && <p role="status">Hasil konfirmasi belum diketahui. Coba kembali dengan permintaan yang sama sebelum melanjutkan.</p>}
    {conflict && <p role="status">Muat ulang tinjauan dan periksa kembali data serta bukti sebelum mengonfirmasi.</p>}
    <button className={layout.secondary} type="button" disabled={pending || uncertain} onClick={onClose}><Close size={16} /> Tutup tinjauan</button>
  </section>;
}
