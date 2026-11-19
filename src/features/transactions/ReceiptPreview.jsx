import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, Close, FileText, Printer, RefreshCw} from '../../components/ui/Icons.jsx';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './ReceiptPreview.module.css';
import '../../styles/print.css';

const money = value => new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0}).format(value);
const date = value => new Intl.DateTimeFormat('id-ID', {dateStyle: 'long', timeZone: 'Asia/Jakarta'}).format(new Date(value + 'T00:00:00Z'));

function ReceiptPage({data}) {
  const document = data.document, payment = document.payment;
  const issued = Boolean(data.receipt);
  return <article className={styles.page} aria-label="Lembar kwitansi">
    {!issued && <p className={styles.draft}>Draf pratinjau · Belum diterbitkan</p>}
    {data.receipt?.status === 'VOID' && <p className={styles.draft}>DIBATALKAN · VOID</p>}
    <header className={styles.header}>
      <p>{document.project.title}</p>
      <p>Tahun anggaran {document.project.fiscal_year}{document.project.project_code && ' · ' + document.project.project_code}</p>
      <h2>Kwitansi Pembayaran</h2>
      <p>Nomor: <strong>{document.receipt.receipt_no || 'Belum diterbitkan'}</strong></p>
    </header>
    <dl className={styles.identities}>
      <div><dt>Sudah diterima dari</dt><dd>Bendahara Pengeluaran · {document.signers.treasurer.display_name}</dd></div>
      <div><dt>Penerima</dt><dd>{payment.legal_name}</dd></div>
      <div><dt>Tanggal pembayaran</dt><dd>{date(document.transaction.payment_date)}</dd></div>
      <div><dt>Item RAB</dt><dd>{document.transaction.budget_item_label}</dd></div>
    </dl>
    <section className={styles.purpose}><h3>Untuk pembayaran</h3><p>{document.transaction.description}</p></section>
    <table className={styles.amounts}><tbody>
      <tr><th scope="row">Nilai kwitansi (bruto)</th><td>{money(payment.receipt_amount)}</td></tr>
      <tr><th scope="row">Potongan pajak</th><td>{money(payment.withheld_tax_amount)}</td></tr>
      <tr><th scope="row">Jumlah diterima (netto)</th><td>{money(payment.net_paid_amount)}</td></tr>
    </tbody></table>
    <section className={styles.words}><h3>Terbilang jumlah diterima</h3><p>{payment.amount_in_words}</p></section>
    <p className={styles.issuedOn}>Tanggal kwitansi: {date(document.receipt.issued_on)}</p>
    <div className={styles.signatures}>
      <div><p>Pejabat Pembuat Komitmen</p><strong>{document.signers.ppk.display_name}</strong>{document.signers.ppk.nip && <span>NIP {document.signers.ppk.nip}</span>}</div>
      <div><p>Bendahara Pengeluaran</p><strong>{document.signers.treasurer.display_name}</strong>{document.signers.treasurer.nip && <span>NIP {document.signers.treasurer.nip}</span>}</div>
      <div><p>Penerima</p><strong>{payment.legal_name}</strong></div>
    </div>
    <footer>{issued ? 'Kwitansi ' + document.receipt.receipt_no + ' · Salinan cetak dari snapshot aplikasi.' : 'Draf belum memiliki nomor dan belum menjadi kwitansi terbit.'}</footer>
  </article>;
}

export function ReceiptControl({endpoint, token, expire, projectId, paymentId, receipt, disabled, onIssued}) {
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  const button = useRef(null);
  return <>
    <button ref={button} className={layout.secondary} type="button" disabled={disabled || open} onClick={() => setOpen(true)}><FileText size={16} /> {receipt ? 'Lihat kwitansi ' + receipt.receipt_no : 'Tinjau kwitansi'}</button>
    {open && <ReceiptDialog endpoint={endpoint} token={token} expire={expire} projectId={projectId} paymentId={paymentId} initialReceiptId={receipt?.receipt_id}
      onIssued={() => setChanged(true)} onClose={() => {
        setOpen(false);
        if (changed) {setChanged(false); onIssued();}
        else requestAnimationFrame(() => button.current?.focus());
      }} />}
  </>;
}

function ReceiptDialog({endpoint, token, expire, projectId, paymentId, initialReceiptId, onIssued, onClose}) {
  const id = useId(), dialog = useRef(null);
  const [receiptId, setReceiptId] = useState(initialReceiptId);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const mutation = useRef(null), attempt = useRef(null);
  const current = result?.revision === revision && result.receiptId === receiptId ? result : null;
  const data = current?.data, locked = pending || uncertain;
  useEffect(() => {
    dialog.current.showModal(); document.body.dataset.printReceipt = 'true';
    return () => {delete document.body.dataset.printReceipt;};
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, receiptId ? 'receipts.get' : 'receipts.preview', projectId, controller.signal,
      receiptId ? {receipt_id: receiptId} : {payment_detail_id: paymentId})
      .then(data => {if (!controller.signal.aborted) {setResult({revision, receiptId, data}); setConflict(false); setError(''); if (data.already_issued) onIssued();}})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResult({revision, receiptId, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, projectId, paymentId, receiptId, revision]);
  useEffect(() => () => mutation.current?.abort(), []);
  async function issue() {
    if (mutation.current || !data?.can_issue || conflict) return;
    attempt.current ??= {id: crypto.randomUUID(), payload: {payment_detail_id: paymentId, preview_token: data.preview_token,
      expected_transaction_row_version: data.transaction_row_version, expected_payment_row_version: data.payment_row_version}};
    const controller = new AbortController(); mutation.current = controller; setPending(true); setError('');
    try {
      const saved = await callProjectRpc(endpoint, token, 'receipts.issue', projectId, controller.signal, attempt.current.payload, attempt.current.id);
      if (controller.signal.aborted) return;
      attempt.current = null; setUncertain(false); setReceiptId(saved.receipt.receipt_id); onIssued();
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.message);
        if (['VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(failure.code)) {attempt.current = null; setUncertain(false); setConflict(true);}
        else setUncertain(true);
      }
    } finally {if (!controller.signal.aborted) {mutation.current = null; setPending(false);}}
  }
  return createPortal(<div data-receipt-print-root>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onCancel={event => {event.preventDefault(); if (!locked) onClose();}}>
      <div className={styles.toolbar} data-print-controls>
        <h2 id={id}><FileText size={20} /> {data?.receipt ? 'Kwitansi terbit' : 'Pratinjau kwitansi'}</h2>
        <div className={styles.actions}>
          <button className={layout.secondary} type="button" disabled={locked} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Muat ulang kwitansi</button>
          <button className={layout.secondary} type="button" disabled={!data?.document || locked} onClick={() => window.print()}><Printer size={16} /> {data?.receipt ? 'Cetak kwitansi' : 'Cetak draf kwitansi'}</button>
          {data?.can_issue && <button className={layout.primary} type="button" disabled={pending || conflict} onClick={issue}><Check size={16} /> {pending ? 'Menerbitkan…' : uncertain ? 'Coba terbitkan kembali' : 'Terbitkan kwitansi'}</button>}
          <button className={layout.secondary} type="button" disabled={locked} onClick={onClose} autoFocus><Close size={16} /> Tutup kwitansi</button>
        </div>
        <p>{data?.receipt ? 'Nomor dan isi dibaca dari snapshot saat penerbitan; perubahan master tidak mengubah salinan ini.' : 'Nomor dialokasikan server setelah diterbitkan. Tinjau penerima, nominal, tanggal dan penandatangan sebelum menerbitkan.'}</p>
        <p>Pratinjau/cetak ini belum membuat arsip PDF final. Format perlu dicocokkan dengan ketentuan dokumen LPJ.</p>
        {data?.blockers?.length > 0 && <div role="status"><strong>Kwitansi belum dapat diterbitkan</strong><ul>{data.blockers.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
        {error && <p role="alert">{error}</p>}
        {uncertain && <p role="status">Hasil penerbitan belum diketahui. Coba kembali dengan permintaan yang sama sebelum menutup.</p>}
        {conflict && <p role="status">Muat ulang kwitansi dan tinjau data terbaru sebelum menerbitkan.</p>}
      </div>
      {!current && <p className={styles.feedback} role="status">Menyiapkan kwitansi…</p>}
      {current?.error && <p className={styles.feedback} role="alert">{current.error}</p>}
      {data?.document && <ReceiptPage data={data} />}
    </dialog>
  </div>, document.body);
}
