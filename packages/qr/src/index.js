import pako from 'pako';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { crc32 } from 'crc';

const batches = new Map();

export async function encodeFormsToQRFrames(formDataArray, meta) {
  const json = JSON.stringify(formDataArray);
  const gzipped = pako.gzip(json);
  const b64 = Buffer.from(gzipped).toString('base64');
  const batchId = uuidv4();
  const chunks = b64.match(/.{1,800}/g) || [];

  return Promise.all(chunks.map((chunk, index) => {
    const frame = {
      v: 1,
      batch: batchId,
      frame: index + 1,
      total: chunks.length,
      device: meta.deviceUid,
      scout: meta.scoutName,
      event: meta.eventKey,
      ts: Math.floor(Date.now() / 1000),
      crc: crc32(chunk).toString(16),
      data: chunk
    };

    return QRCode.toDataURL(JSON.stringify(frame), {
      errorCorrectionLevel: 'M',
      width: 360
    });
  }));
}

export function onQRFrameScanned(rawString, onBatchComplete) {
  const frame = JSON.parse(rawString);
  const expected = crc32(frame.data).toString(16);
  if (expected !== frame.crc) throw new Error(`CRC mismatch on frame ${frame.frame}/${frame.total}`);

  if (!batches.has(frame.batch)) batches.set(frame.batch, { frames: new Map() });
  const batch = batches.get(frame.batch);
  batch.frames.set(frame.frame, frame.data);

  if (batch.frames.size === frame.total) {
    const assembled = [...Array(frame.total).keys()].map((i) => batch.frames.get(i + 1)).join('');
    const bytes = Buffer.from(assembled, 'base64');
    const json = pako.ungzip(bytes, { to: 'string' });
    const data = JSON.parse(json);
    batches.delete(frame.batch);
    onBatchComplete(frame.batch, frame, data);
  }

  return {
    batchId: frame.batch,
    received: batch.frames.size,
    total: frame.total,
    complete: batch.frames.size === frame.total
  };
}
