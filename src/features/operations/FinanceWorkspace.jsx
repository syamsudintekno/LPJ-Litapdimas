import {useState} from 'react';
import {Pencil, RefreshCw, Save, Wallet} from '../../components/ui/Icons.jsx';
import {Feedback, money, UploadEvidence, useOperation, useRemote} from './shared.jsx';
import layout from '../../Home.module.css';
import styles from './Operations.module.css';

export function FinanceWorkspace({api}) {
  const remote = useRemote(api, 'finance.list'), op = useOperation(api), data = remote.data;
  const [income, setIncome] = useState({received_date: '', received_amount: '', attachment_id: '', report_stage_id: ''});
  const [remit, setRemit] = useState({paid_at: '', attachment_id: ''}), [allocations, setAllocations] = useState({});
  const [links, setLinks] = useState({});
  const done = () => remote.refresh();
  const allocationTotal = Object.values(allocations).reduce((sum, value) => sum + Number(value || 0), 0);
  const evidence = (kind, value, change) => <label className={styles.field}>Bukti yang sudah diunggah<select required value={value} onChange={event => change(event.target.value)}>
    <option value="">Pilih bukti</option>{data.attachments.filter(row => row.attachment_kind === kind).map(row => <option key={row.attachment_id} value={row.attachment_id}>Bukti {row.attachment_id.slice(0, 8)}</option>)}
  </select></label>;
  return <section className={styles.workspace} aria-label="Pencairan, setoran, dan distribusi">
    <div className={styles.actions}><h3><Wallet size={20} /> Pencairan, setoran, dan distribusi</h3><button className={layout.secondary} disabled={op.locked} onClick={remote.refresh}><RefreshCw size={16} /> Muat ulang keuangan</button></div>
    <Feedback remote={remote} operation={op} />
    {op.result && <p role="status">Perubahan tersimpan.</p>}
    {data && <>
      <dl className={styles.summary}><div><dt>Dana aktual diterima</dt><dd>{money(data.received_total_amount)}</dd></div><div><dt>Pajak sudah disetor</dt><dd>{money(data.remitted_total_amount)}</dd></div></dl>
      <p>Penerimaan dana dicatat sesuai tanggal dan bukti aktual. Setoran dialokasikan ke potongan asal dan tidak menambah realisasi belanja.</p>
      <h4>Penerimaan dana aktual</h4>
      <ul className={styles.list}>{data.disbursements.map(row => <li key={row.disbursement_id}>
        <strong>{row.received_date} · {money(row.received_amount)}</strong><span>{data.stages.find(stage => stage.report_stage_id === row.report_stage_id)?.label}</span>
        {data.can_write && <button className={layout.secondary} disabled={op.locked} onClick={() => setIncome({...row, received_amount: String(row.received_amount), expected_row_version: row.row_version, correction_reason: ''})}><Pencil size={16} /> Koreksi penerimaan</button>}
      </li>)}{!data.disbursements.length && <li>Belum ada penerimaan dana.</li>}</ul>
      {data.can_write && <>
        <UploadEvidence api={api} kind="DISBURSEMENT_PROOF" disabled={op.locked} onUploaded={row => {setIncome(value => ({...value, attachment_id: row.attachment_id})); done();}} />
        <form className={styles.form} onSubmit={event => {event.preventDefault(); const stage = data.stages.find(row => row.report_stage_id === income.report_stage_id);
          op.run('disbursements.save', {...income, received_amount: Number(income.received_amount), expected_stage_row_version: stage?.row_version}, () => {setIncome({received_date: '', received_amount: '', attachment_id: '', report_stage_id: ''}); done();});}}>
          <fieldset disabled={op.locked}><legend>{income.disbursement_id ? 'Koreksi penerimaan' : 'Catat penerimaan'}</legend><div className={styles.fields}>
            <label className={styles.field}>Tahap<select required value={income.report_stage_id} onChange={event => setIncome({...income, report_stage_id: event.target.value})}><option value="">Pilih tahap</option>{data.stages.filter(row => row.status === 'DRAFT').map(row => <option key={row.report_stage_id} value={row.report_stage_id}>{row.label}</option>)}</select></label>
            <label className={styles.field}>Tanggal diterima<input type="date" required value={income.received_date} onChange={event => setIncome({...income, received_date: event.target.value})} /></label>
            <label className={styles.field}>Jumlah diterima (rupiah)<input type="number" min="1" step="1" max={Number.MAX_SAFE_INTEGER} required value={income.received_amount} onChange={event => setIncome({...income, received_amount: event.target.value})} /></label>
          </div>{evidence('DISBURSEMENT_PROOF', income.attachment_id, value => setIncome({...income, attachment_id: value}))}
            {income.disbursement_id && <label className={styles.field}>Alasan koreksi<textarea required maxLength={1000} value={income.correction_reason} onChange={event => setIncome({...income, correction_reason: event.target.value})} /></label>}
          </fieldset><button className={layout.primary} disabled={op.pending}><Save size={16} /> {op.uncertain ? 'Coba simpan kembali' : 'Simpan penerimaan'}</button>
        </form>
      </>}
      <h4>Setoran pajak</h4>
      <ul className={styles.list}>{data.remittances.map(row => <li key={row.tax_remittance_id}><strong>{row.paid_at} · {money(row.amount)}</strong><span>{data.allocations.filter(item => item.tax_remittance_id === row.tax_remittance_id).length} alokasi potongan asal</span></li>)}{!data.remittances.length && <li>Belum ada setoran.</li>}</ul>
      <ul className={styles.list}>{data.outstanding.filter(row => row.amount > 0).map(row => <li key={row.tax_assessment_id}><strong>{row.payee_name} · {row.tax_kind}</strong><span>{row.payment_date} · {row.description}</span><span>Potongan {money(row.amount)} · Disetor {money(row.allocated_amount)} · Sisa {money(row.remaining_amount)}</span></li>)}</ul>
      {data.can_write && <>
        <UploadEvidence api={api} kind="TAX_REMITTANCE_PROOF" disabled={op.locked} onUploaded={row => {setRemit(value => ({...value, attachment_id: row.attachment_id})); done();}} />
        <form className={styles.form} onSubmit={event => {event.preventDefault(); op.run('tax_remittances.save', {...remit, amount: allocationTotal,
          allocations: data.outstanding.filter(row => Number(allocations[row.tax_assessment_id]) > 0).map(row => ({tax_assessment_id: row.tax_assessment_id, amount: Number(allocations[row.tax_assessment_id]), expected_row_version: row.row_version}))}, () => {setRemit({paid_at: '', attachment_id: ''}); setAllocations({}); done();});}}>
          <fieldset disabled={op.locked}><legend>Catat setoran dan alokasi</legend><label className={styles.field}>Tanggal setoran<input type="date" required value={remit.paid_at} onChange={event => setRemit({...remit, paid_at: event.target.value})} /></label>
            {evidence('TAX_REMITTANCE_PROOF', remit.attachment_id, value => setRemit({...remit, attachment_id: value}))}
            {data.outstanding.filter(row => row.can_allocate).map(row => <label className={styles.field} key={row.tax_assessment_id}>{row.payee_name} · {row.tax_kind} · Sisa {money(row.remaining_amount)}<input aria-label={'Alokasi ' + row.payee_name + ' ' + row.tax_assessment_id.slice(0, 8)} type="number" min="0" max={row.remaining_amount} step="1" value={allocations[row.tax_assessment_id] || ''} onChange={event => setAllocations({...allocations, [row.tax_assessment_id]: event.target.value})} /></label>)}
          </fieldset><p>Total setoran dari alokasi: <strong>{money(allocationTotal)}</strong></p><button className={layout.primary} disabled={op.pending || allocationTotal < 1}><Save size={16} /> {op.uncertain ? 'Coba catat kembali' : 'Catat setoran pajak'}</button>
        </form>
      </>}
      <h4>Penautan distribusi ke transaksi asal</h4>
      <p>Penautan menelusuri bukti penerimaan peserta. Nilai belanja tetap berasal dari transaksi dan tidak dijumlahkan lagi dari daftar distribusi.</p>
      <ul className={styles.list}>{data.distributions.filter(row => row.quantity > 0).map(row => <li key={row.distribution_id}>
        <strong>{row.person_name} · {row.distribution_kind}</strong><span>{row.activity_title} · {row.quantity} unit</span>
        {row.transaction_id ? <span>Tertaut ke {data.transactions.find(tx => tx.transaction_id === row.transaction_id)?.description || row.transaction_id}</span> : data.can_write ? <>
          <label className={styles.field}>Transaksi asal<select disabled={op.locked} value={links[row.distribution_id] || ''} onChange={event => setLinks({...links, [row.distribution_id]: event.target.value})}><option value="">Pilih transaksi terkonfirmasi</option>{data.transactions.filter(tx => tx.activity_id === row.activity_id && tx.expense_kind === row.distribution_kind).map(tx => <option key={tx.transaction_id} value={tx.transaction_id}>{tx.payment_date} · {tx.description}</option>)}</select></label>
          <button className={layout.secondary} disabled={op.pending || (!op.uncertain && !links[row.distribution_id])} onClick={() => op.run('distributions.link', {distribution_id: row.distribution_id, transaction_id: links[row.distribution_id], expected_row_version: row.row_version}, done)}><Save size={16} /> {op.uncertain ? 'Coba tautkan kembali' : 'Tautkan distribusi'}</button>
        </> : <span>Belum tertaut.</span>}
      </li>)}</ul>
    </>}
  </section>;
}
