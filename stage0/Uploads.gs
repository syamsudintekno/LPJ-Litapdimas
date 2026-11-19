function uploadEvidence_(spreadsheetId, user, request, role) {
  return opMutation_(spreadsheetId, user, request, ({project, time, stamp}) => {
    const p = request.payload;
    if (!['PAYMENT_PROOF', 'DISBURSEMENT_PROOF', 'TAX_REMITTANCE_PROOF'].includes(p.attachment_kind) ||
        (p.attachment_kind !== 'PAYMENT_PROOF' && role !== 'OWNER') || !budgetText_(p.name, 180) ||
        !['application/pdf', 'image/jpeg', 'image/png'].includes(p.mime_type) || typeof p.base64 !== 'string' ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(p.base64) || p.base64.length > 27962032) return opError_('Pilih PDF/JPG/PNG maksimal 20 MiB dengan nama yang valid.');
    let tx;
    if (p.attachment_kind === 'PAYMENT_PROOF') {
      tx = rows_(spreadsheetId, 'transactions', TRANSACTION_FIELDS_).find(row => row.transaction_id === p.transaction_id && row.project_id === project.project_id);
      if (!tx || tx.status !== 'DRAFT' || tx.row_version !== p.expected_transaction_row_version) return opError_('Transaksi berubah atau bukan draf. Muat ulang bukti.', 'CONFLICT');
      const payments = rows_(spreadsheetId, 'payment_details', ['payment_detail_id', 'transaction_id']).filter(row => row.transaction_id === tx.transaction_id);
      if (rows_(spreadsheetId, 'receipts', ['payment_detail_id']).some(row => payments.some(payment => payment.payment_detail_id === row.payment_detail_id)) ||
          rows_(spreadsheetId, 'distributions', ['transaction_id']).some(row => row.transaction_id === tx.transaction_id)) return opError_('Transaksi sudah memiliki dokumen atau distribusi tertaut.', 'CONFLICT');
    } else if (p.transaction_id) return opError_('Bukti penerimaan/setoran tidak memakai transaksi belanja.');
    const bytes = Utilities.base64Decode(p.base64), head = bytes.slice(0, 8).map(value => (value + 256) % 256);
    if (!bytes.length || bytes.length > 20 * 1024 * 1024 ||
        (p.mime_type === 'application/pdf' && String.fromCharCode(...head.slice(0, 5)) !== '%PDF-') ||
        (p.mime_type === 'image/jpeg' && !(head[0] === 255 && head[1] === 216 && head[2] === 255)) ||
        (p.mime_type === 'image/png' && head.join(',') !== '137,80,78,71,13,10,26,10')) return opError_('Isi berkas tidak sesuai jenis atau batas ukuran.');
    const fileDigest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
    const name = request.request_id + '-' + p.name.replace(/[\\/\x00-\x1F]/g, '_');
    const folder = managedFolder_(spreadsheetId, project.project_id, 'Bukti');
    const file = operationFile_(folder, name, Utilities.newBlob(bytes, p.mime_type, name));
    // A leftover file from a failed metadata commit may be reused only if its bytes match.
    if (Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, file.getBlob().getBytes())) !== fileDigest) return opError_('Berkas operasi berbeda. Gunakan permintaan baru.', 'CONFLICT');
    evidenceFile_(project.project_id, file.getId());
    const id = Utilities.getUuid();
    const row = {attachment_id: id, project_id: project.project_id, transaction_id: tx?.transaction_id || '', activity_id: tx?.activity_id || '',
      attachment_kind: p.attachment_kind, drive_file_id: file.getId(), ...stamp};
    return {data: {attachment_id: id, drive_file_id: file.getId(), name: p.name, row_version: 1}, entity_id: id,
      adds: {attachments: [row]}, updates: tx ? [['transactions', tx.transaction_id, {row_version: tx.row_version + 1, updated_at: time}]] : [],
      audit: {attachment_id: id, attachment_kind: p.attachment_kind, transaction_id: tx?.transaction_id || '', file_digest: fileDigest, byte_count: bytes.length}};
  });
}
