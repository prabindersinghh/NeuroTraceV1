/**
 * User-initiated export for local Awaaz learning pairs.
 *
 * This module never uploads. It verifies every WAV against its registered SHA-256 and
 * builds an uncompressed POSIX tar archive in memory so a caregiver can explicitly hand
 * the consented data to an authorised training workflow. The download is sensitive: once
 * created, it is outside the browser vault and the app can no longer revoke or protect it.
 */
import { sha256Blob, type LocalAudioPair } from "./awaazAudioVault";

const BLOCK_BYTES = 512;

interface ArchiveFile {
  name: string;
  bytes: Uint8Array;
}

function writeAscii(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) throw new Error(`Tar field is too long: ${value}`);
  target.set(bytes, offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const encoded = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, "0");
  writeAscii(target, offset, length, `${encoded}\0`);
}

function header(file: ArchiveFile, modifiedAtSeconds: number): Uint8Array {
  const out = new Uint8Array(BLOCK_BYTES);
  writeAscii(out, 0, 100, file.name);
  writeOctal(out, 100, 8, 0o600);
  writeOctal(out, 108, 8, 0);
  writeOctal(out, 116, 8, 0);
  writeOctal(out, 124, 12, file.bytes.byteLength);
  writeOctal(out, 136, 12, modifiedAtSeconds);
  out.fill(0x20, 148, 156);
  writeAscii(out, 156, 1, "0");
  writeAscii(out, 257, 6, "ustar\0");
  writeAscii(out, 263, 2, "00");
  writeAscii(out, 265, 32, "awaaz");
  writeAscii(out, 297, 32, "awaaz");
  const checksum = out.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeAscii(out, 148, 8, `${checksumText}\0 `);
  return out;
}

function pad(bytes: Uint8Array): Uint8Array {
  const remainder = bytes.byteLength % BLOCK_BYTES;
  if (remainder === 0) return bytes;
  const out = new Uint8Array(bytes.byteLength + BLOCK_BYTES - remainder);
  out.set(bytes);
  return out;
}

export function trainingArchiveFilename(patientId: string, createdAt: Date): string {
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const patientTag = patientId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "patient";
  return `awaaz-learning-${patientTag}-${stamp}.tar`;
}

export async function buildLocalTrainingArchive(
  pairs: LocalAudioPair[],
  createdAt = new Date(),
): Promise<Blob> {
  if (pairs.length === 0) throw new Error("There are no local learning pairs to export");
  const ordered = [...pairs].sort((a, b) => a.capture_id.localeCompare(b.capture_id));
  const patientId = ordered[0].patient_id;
  if (ordered.some((pair) => pair.patient_id !== patientId)) {
    throw new Error("A training archive cannot mix patients");
  }

  const audioFiles: ArchiveFile[] = [];
  const manifestPairs = [];
  for (const pair of ordered) {
    const actualHash = await sha256Blob(pair.audio);
    if (actualHash !== pair.sha256) {
      throw new Error(`Local audio integrity check failed for capture ${pair.capture_id}`);
    }
    const audioName = `audio/${pair.capture_id}.wav`;
    audioFiles.push({ name: audioName, bytes: new Uint8Array(await pair.audio.arrayBuffer()) });
    manifestPairs.push({
      capture_id: pair.capture_id,
      source: pair.source,
      card_id: pair.card_id ?? null,
      utterance_id: pair.utterance_id ?? null,
      target_text: pair.target_text,
      lang: pair.lang,
      duration_seconds: pair.duration_seconds,
      sha256: pair.sha256,
      size_bytes: pair.audio.size,
      created_at: pair.created_at,
      audio_file: audioName,
    });
  }

  const encoder = new TextEncoder();
  const files: ArchiveFile[] = [
    {
      name: "README.txt",
      bytes: encoder.encode(
        "Sensitive Awaaz patient-voice export. Keep it encrypted and share only with an authorised training workflow. No file was uploaded by NeuroTrace.\n",
      ),
    },
    {
      name: "manifest.json",
      bytes: encoder.encode(`${JSON.stringify({
        schema_version: 1,
        patient_id: patientId,
        exported_at: createdAt.toISOString(),
        media_uploaded_by_app: false,
        pairs: manifestPairs,
      }, null, 2)}\n`),
    },
    ...audioFiles,
  ];

  const modifiedAtSeconds = Math.floor(createdAt.getTime() / 1000);
  const chunks: Uint8Array[] = [];
  for (const file of files) {
    chunks.push(header(file, modifiedAtSeconds), pad(file.bytes));
  }
  chunks.push(new Uint8Array(BLOCK_BYTES * 2));
  return new Blob(chunks as BlobPart[], { type: "application/x-tar" });
}
