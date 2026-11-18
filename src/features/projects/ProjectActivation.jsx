import {Check} from '../../components/ui/Icons.jsx';
import {useEffect, useRef, useState} from 'react';
import {callProjectRpc} from '../../rpc.js';
import styles from '../../Home.module.css';

export function ProjectActivation({endpoint, token, expire, project, onActivated}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(null);
  const inflight = useRef(null);
  useEffect(() => () => inflight.current?.abort(), []);

  async function activate() {
    if (inflight.current) return;
    const controller = new AbortController();
    inflight.current = controller;
    requestId.current ??= crypto.randomUUID();
    setPending(true);
    setError('');
    try {
      await callProjectRpc(endpoint, token, 'projects.activate', project.project_id, controller.signal,
        {expected_row_version: project.row_version}, requestId.current);
      if (!controller.signal.aborted) onActivated();
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setError(failure.message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
        inflight.current = null;
      }
    }
  }

  return <div className={styles.activation}>
    <button type="button" className={styles.primary} disabled={pending} onClick={activate}>
      <Check size={16} /> {pending ? 'Mengaktifkan…' : 'Aktifkan proyek'}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
