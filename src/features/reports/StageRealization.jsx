import {useEffect, useId, useState} from 'react';
import {ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search} from '../../components/ui/Icons.jsx';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './StageRealization.module.css';

const money = value => new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0}).format(value);
const date = value => new Intl.DateTimeFormat('id-ID', {dateStyle: 'long', timeZone: 'Asia/Jakarta'}).format(new Date(value + 'T00:00:00Z'));
const percent = value => new Intl.NumberFormat('id-ID', {maximumFractionDigits: 2}).format(value / 100) + '%';

export function StageRealization({endpoint, token, expire, project}) {
  const id = useId();
  const [stageId, setStageId] = useState('');
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const current = response?.stageId === stageId && response.revision === revision ? response : null;
  const data = current?.data;
  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'reports.preview', project.project_id, controller.signal,
      {document_kind: 'STAGE_REALIZATION', ...(stageId ? {report_stage_id: stageId} : {})})
      .then(data => {if (!controller.signal.aborted) setResponse({stageId, revision, data});})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResponse({stageId, revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, project.project_id, stageId, revision]);
  const keyword = query.trim().toLocaleLowerCase('id-ID');
  const rows = (data?.transactions || []).filter(row => [row.description, row.budget_item_label, row.payment_date].some(value => value.toLocaleLowerCase('id-ID').includes(keyword)));
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  const selectedPage = Math.min(page, pages - 1);
  return <section className={styles.workspace} aria-labelledby={id} aria-busy={!current}>
    <div className={styles.actions}>
      <h3 id={id}><ClipboardList size={18} /> Realisasi per tahap</h3>
      <button type="button" className={layout.secondary} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Muat ulang realisasi</button>
    </div>
    <p className={styles.context}>{project.fiscal_year} · {project.title}</p>
    <p>Rekap kumulatif sejak awal proyek sampai tanggal batas, memakai nilai kwitansi bruto transaksi terkonfirmasi. Potongan pajak sudah termasuk di dalamnya.</p>
    {response?.data && <label className={styles.field}>Tahap laporan
      <select value={stageId || response.data.stage.report_stage_id} onChange={event => {setStageId(event.target.value); setPage(0); setQuery('');}}>
        {response.data.stages.map(stage => <option key={stage.report_stage_id} value={stage.report_stage_id}>{stage.label} · {percent(stage.target_bps)}</option>)}
      </select>
    </label>}
    {!current && <p role="status">Memuat realisasi tahap…</p>}
    {current?.error && <p className={styles.error} role="alert">{current.error}</p>}
    {data && <>
      <p><strong>Draf rekap terkini</strong> · Batas inklusif {date(data.stage.cutoff_date)}. Diperbarui {new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'}).format(new Date(data.generated_at))} WIB.</p>
      <p>{data.stage.status === 'FINALIZED' ? 'Tahap berstatus final. Tampilan ini tetap membaca sumber terkini dan bukan salinan arsip final.' : 'Rekap ini belum difinalkan dan belum menjadi arsip laporan.'}</p>
      <dl className={styles.summary}>
        <div><dt>Plafon resmi</dt><dd>{money(data.project.official_ceiling_amount)}</dd></div>
        <div><dt>Target kumulatif {percent(data.stage.target_bps)}</dt><dd>{money(data.target_amount)}</dd></div>
        <div><dt>Realisasi bruto</dt><dd>{money(data.totals.receipt_amount)}</dd></div>
        <div><dt>{data.target_difference_amount >= 0 ? 'Di atas target' : 'Kurang dari target'}</dt><dd>{money(Math.abs(data.target_difference_amount))}</dd></div>
        <div><dt>{data.ceiling_remaining_amount >= 0 ? 'Sisa plafon' : 'Melebihi plafon'}</dt><dd>{money(Math.abs(data.ceiling_remaining_amount))}</dd></div>
        <div><dt>Potongan pajak dalam bruto</dt><dd>{money(data.totals.withheld_tax_amount)}</dd></div>
        <div><dt>Jumlah diterima (netto)</dt><dd>{money(data.totals.net_paid_amount)}</dd></div>
        {data.funding && <><div><dt>Dana aktual diterima sampai batas</dt><dd>{money(data.funding.received_total_amount)}</dd></div><div><dt>Pajak disetor sampai batas</dt><dd>{money(data.funding.remitted_total_amount)}</dd></div><div><dt>Potongan tahap belum disetor</dt><dd>{money(data.funding.unremitted_withheld_amount)}</dd></div></>}
      </dl>
      <p role="status">{data.transaction_count} transaksi terkonfirmasi dihitung. Dikecualikan: {data.excluded.draft_count} draf dan {data.excluded.void_count} dibatalkan sampai batas; {data.excluded.later_confirmed_count} terkonfirmasi setelah batas.</p>
      <p>Penerbitan kwitansi dan setoran pajak tidak menambah realisasi kedua kali. Penerimaan dana aktual serta setoran ditampilkan terpisah dari belanja bruto.</p>
      <label className={styles.field}><span><Search size={16} /> Cari rincian realisasi</span>
        <input type="search" maxLength={120} value={query} onChange={event => {setQuery(event.target.value); setPage(0);}} placeholder="Tujuan, item RAB, atau YYYY-MM-DD" />
      </label>
      <p>{rows.length} dari {data.transaction_count} transaksi ditampilkan oleh pencarian. Ringkasan nominal tetap mencakup seluruh tahap.</p>
      {rows.length ? <div className={styles.tableWrap} role="region" aria-label="Rincian realisasi tahap" tabIndex={0}>
        <table><caption>Transaksi terkonfirmasi sampai {date(data.stage.cutoff_date)}</caption>
          <thead><tr><th scope="col">Tanggal dan tujuan</th><th scope="col">Item RAB</th><th scope="col">Bruto</th><th scope="col">Potongan</th><th scope="col">Netto</th></tr></thead>
          <tbody>{rows.slice(selectedPage * 8, (selectedPage + 1) * 8).map(row => <tr key={row.transaction_id}>
            <td><time dateTime={row.payment_date}>{date(row.payment_date)}</time><p>{row.description}</p><small>{row.payment_count} penerima</small></td>
            <td>{row.budget_item_label}<small>Versi {row.budget_version_no}</small></td>
            <td>{money(row.receipt_amount)}</td><td>{money(row.withheld_tax_amount)}</td><td>{money(row.net_paid_amount)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p>{data.transaction_count ? 'Tidak ada transaksi yang cocok dengan pencarian.' : 'Belum ada transaksi terkonfirmasi sampai tanggal batas tahap ini.'}</p>}
      {pages > 1 && <nav className={styles.actions} aria-label="Halaman realisasi">
        <button type="button" className={layout.secondary} disabled={!selectedPage} onClick={() => setPage(selectedPage - 1)}><ChevronLeft size={16} /> Sebelumnya</button>
        <span>Halaman {selectedPage + 1} dari {pages}</span>
        <button type="button" className={layout.secondary} disabled={selectedPage + 1 >= pages} onClick={() => setPage(selectedPage + 1)}>Berikutnya <ChevronRight size={16} /></button>
      </nav>}
    </>}
  </section>;
}
