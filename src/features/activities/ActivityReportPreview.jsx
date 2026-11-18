import {useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './ActivityReportPreview.module.css';
import '../../styles/print.css';

const date = value => new Intl.DateTimeFormat('id-ID', {dateStyle: 'long', timeZone: 'Asia/Jakarta'}).format(new Date(value + 'T00:00:00Z'));
const timestamp = value => new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'}).format(new Date(value));
const attendance = {UNRECORDED: 'Belum dicatat', PRESENT: 'Hadir', ABSENT: 'Tidak hadir'};
const kinds = {SNACK: 'Daftar penerimaan snack', CONSUMPTION: 'Daftar penerimaan konsumsi', TRANSPORT: 'Daftar penerimaan transport'};

function Sheet({data, title, children}) {
  return <section className={styles.sheet}>
    <header className={styles.header}>
      <p className={styles.draft}>Draf pratinjau · Bukan arsip final</p>
      <h2>{title}</h2><p>{data.project.title}</p>
      <p>Tahun anggaran {data.project.fiscal_year}{data.project.project_code && ' · ' + data.project.project_code}</p>
      <h3>{data.activity.title}</h3><p>{date(data.activity.activity_date)} · {data.activity.location}</p>
    </header>
    {children}
    <footer className={styles.footer}>Draf disiapkan {timestamp(data.generated_at)} WIB · {data.template_version}</footer>
  </section>;
}

export function ActivityReportPreview({endpoint, token, expire, projectId, activityId, onClose}) {
  const id = useId();
  const dialog = useRef(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const current = result?.revision === revision ? result : null;
  const data = current?.data;

  useEffect(() => {
    dialog.current.showModal();
    document.body.dataset.printActivity = 'true';
    return () => {delete document.body.dataset.printActivity;};
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'reports.preview', projectId, controller.signal,
      {activity_id: activityId, document_kind: 'ACTIVITY_PACKAGE'})
      .then(data => {if (!controller.signal.aborted) setResult({revision, data});})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResult({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, projectId, activityId, revision]);

  return createPortal(<div data-activity-print-root>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={id} onCancel={event => {event.preventDefault(); onClose();}}>
      <div className={styles.toolbar} data-print-controls>
        <h2 id={id}>Pratinjau dokumen kegiatan</h2>
        <div className={styles.actions}>
          <button className={layout.secondary} type="button" onClick={() => setRevision(value => value + 1)}>Muat ulang dokumen</button>
          <button className={layout.primary} type="button" disabled={!data} onClick={() => window.print()}>Cetak draf</button>
          <button className={layout.secondary} type="button" onClick={onClose} autoFocus>Tutup pratinjau</button>
        </div>
        <p>Data yang sudah tersimpan ditampilkan sebagai draf. Gunakan dialog cetak browser untuk mencetak atau menyimpan PDF.</p>
      </div>
      {!current && <p className={styles.feedback} role="status">Menyiapkan dokumen kegiatan…</p>}
      {current?.error && <p className={styles.feedback} role="alert">{current.error}</p>}
      {data && <div className={styles.pages}>
        <Sheet data={data} title="Rundown kegiatan">
          {data.agenda.length ? <div className={styles.tableArea}><table>
            <thead><tr><th scope="col">No.</th><th scope="col">Waktu (WIB)</th><th scope="col">Sesi</th><th scope="col">Pembicara</th></tr></thead>
            <tbody>{data.agenda.map((row, index) => <tr key={row.agenda_item_id}>
              <td>{index + 1}</td><td>{row.start_time} - {row.end_time}</td><td>{row.title}</td><td>{row.speaker_display_name || 'Belum ditetapkan'}</td>
            </tr>)}</tbody></table></div> : <p>Belum ada sesi rundown.</p>}
        </Sheet>
        <Sheet data={data} title="Logbook kegiatan">
          {data.logbook.length ? <div className={styles.tableArea}><table className={styles.logbookTable}>
            <thead><tr><th scope="col">Tanggal</th><th scope="col">Uraian</th><th scope="col">Hasil</th></tr></thead>
            <tbody>{data.logbook.map(row => <tr className={styles.longRow} key={row.logbook_entry_id}>
              <td>{date(row.entry_date)}</td><td>{row.description}</td><td>{row.result}</td>
            </tr>)}</tbody></table></div> : <p>Belum ada logbook yang tertaut ke kegiatan ini.</p>}
        </Sheet>
        <Sheet data={data} title="Daftar hadir kegiatan">
          {data.participants.length ? <div className={styles.tableArea}><table>
            <thead><tr><th scope="col">No.</th><th scope="col">Nama</th><th scope="col">Unit</th><th scope="col">Kehadiran</th><th scope="col">Tanda tangan</th></tr></thead>
            <tbody>{data.participants.map((row, index) => <tr key={row.activity_participant_id}>
              <td>{index + 1}</td><td>{row.display_name}</td><td>{row.unit_name || '—'}</td><td>{attendance[row.attendance_status] || row.attendance_status}</td><td className={styles.signature}></td>
            </tr>)}</tbody></table></div> : <p>Belum ada peserta terdaftar.</p>}
        </Sheet>
        {data.distributions.map(group => <Sheet key={group.distribution_kind} data={data} title={kinds[group.distribution_kind]}>
          <p className={styles.summary}>Total penerimaan tercatat: {group.total_quantity} unit.</p>
          {group.rows.length ? <div className={styles.tableArea}><table>
            <thead><tr><th scope="col">No.</th><th scope="col">Nama penerima</th><th scope="col">Unit diterima</th><th scope="col">Waktu penerimaan (WIB)</th><th scope="col">Tanda tangan</th></tr></thead>
            <tbody>{group.rows.map((row, index) => <tr key={row.distribution_id}>
              <td>{index + 1}</td><td>{row.display_name}</td><td>{row.quantity}</td><td>{timestamp(row.received_at)}</td><td className={styles.signature}></td>
            </tr>)}</tbody></table></div> : <p>Belum ada penerimaan tercatat untuk jenis ini.</p>}
        </Sheet>)}
      </div>}
    </dialog>
  </div>, document.body);
}
