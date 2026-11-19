import {useRef, useState} from 'react';
import {Check, FileText, Printer, RefreshCw, Save} from '../../components/ui/Icons.jsx';
import {downloadFile, Feedback, useOperation, useRemote} from './shared.jsx';
import layout from '../../Home.module.css';
import styles from './Operations.module.css';

export function ArchiveWorkspace({api, owner}) {
  const remote = useRemote(api, 'reports.list_final'), op = useOperation(api), [stageId, setStageId] = useState('');
  const [preview, setPreview] = useState(null), [approved, setApproved] = useState(false), [notice, setNotice] = useState('');
  const frame = useRef(null);
  function review() {setApproved(false); setPreview(null); setNotice(''); op.run('reports.package_preview', {report_stage_id: stageId}, data => setPreview({...data, draft: true}));}
  return <section className={styles.workspace} aria-label="Paket dan arsip LPJ">
    <div className={styles.actions}><h3><FileText size={20} /> Paket dan arsip LPJ</h3><button className={layout.secondary} disabled={op.locked} onClick={remote.refresh}><RefreshCw size={16} /> Muat ulang arsip</button></div>
    <Feedback remote={remote} operation={op} />{notice && <p role="status">{notice}</p>}
    <p>Arsip final menyimpan PDF, snapshot data, penandatangan dan salinan bukti dalam Drive privat. Perubahan master sesudahnya tidak mengubah versi yang sudah diterbitkan.</p>
    {owner && remote.data && <>
      <label className={styles.field}>Tahap paket<select value={stageId} disabled={op.locked} onChange={event => {setStageId(event.target.value); setPreview(null); setApproved(false);}}><option value="">Pilih tahap</option>{remote.data.stages.map(stage => <option key={stage.report_stage_id} value={stage.report_stage_id}>{stage.label} · {stage.cutoff_date}</option>)}</select></label>
      <button className={layout.secondary} disabled={!stageId || op.locked} onClick={review}><FileText size={16} /> Tinjau paket tahap</button>
    </>}
    {preview && <>
      <h4>{preview.draft ? 'Draf paket untuk ditinjau' : 'Salinan snapshot arsip final'}</h4>
      {preview.blockers?.length > 0 && <div role="status"><strong>Lengkapi sebelum finalisasi</strong><ul>{preview.blockers.map((reason, i) => <li key={i}>{reason}</li>)}</ul></div>}
      <iframe ref={frame} className={styles.preview} title="Pratinjau paket LPJ" sandbox="allow-same-origin allow-modals" srcDoc={preview.html} />
      <button className={layout.secondary} disabled={op.locked} onClick={() => frame.current?.contentWindow?.print()}><Printer size={16} /> {preview.draft ? 'Cetak draf paket' : 'Cetak snapshot'}</button>
      {!preview.draft && <ul className={styles.list}>{preview.document.evidence.map(row => <li key={row.archived_drive_file_id}><span>{row.name}</span><button className={layout.secondary} disabled={op.locked} onClick={() => op.run('reports.download', {final_document_id: preview.final_document_id, file_kind: 'EVIDENCE', archived_drive_file_id: row.archived_drive_file_id}, downloadFile)}><Save size={16} /> Unduh salinan bukti</button></li>)}</ul>}
      {preview.draft && owner && <>
        <label className={styles.check}><input type="checkbox" disabled={op.locked} checked={approved} onChange={event => setApproved(event.target.checked)} /> Saya sudah mencocokkan format dengan dokumen LPJ dan memeriksa seluruh isi, penandatangan, kwitansi serta bukti.</label>
        <button className={layout.primary} disabled={op.locked || !approved || Boolean(preview.blockers?.length)} onClick={() => op.run('reports.finalize', {report_stage_id: stageId, preview_token: preview.preview_token, format_approved: true}, row => {
          setPreview(null); setApproved(false); setNotice('Paket final versi ' + row.version_no + ' tersimpan. PDF dan snapshot tersedia di arsip.'); remote.refresh();
        })}><Check size={16} /> Finalkan dan simpan PDF privat</button>
      </>}
    </>}
    <ul className={styles.list}>{remote.data?.documents.map(row => <li key={row.final_document_id}>
      <strong>{remote.data.stages.find(stage => stage.report_stage_id === row.report_stage_id)?.label} · Versi {row.version_no}</strong><span>{row.finalized_at} · {row.template_version}</span>
      <div className={styles.actions}>
        <button className={layout.secondary} disabled={op.locked} onClick={() => op.run('reports.get_final', {final_document_id: row.final_document_id}, data => setPreview({...data, draft: false}))}><FileText size={16} /> Buka snapshot</button>
        <button className={layout.secondary} disabled={op.locked} onClick={() => op.run('reports.download', {final_document_id: row.final_document_id, file_kind: 'PDF'}, downloadFile)}><Save size={16} /> Unduh PDF</button>
        {owner && <button className={layout.secondary} disabled={op.locked} onClick={() => op.run('reports.download', {final_document_id: row.final_document_id, file_kind: 'SNAPSHOT'}, downloadFile)}><Save size={16} /> Unduh snapshot JSON</button>}
      </div>
    </li>)}{remote.data && !remote.data.documents.length && <li>Belum ada paket final.</li>}</ul>
  </section>;
}
