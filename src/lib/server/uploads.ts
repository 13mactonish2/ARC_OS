// REDSEC 6.0 — shared upload storage (Task 67).
// The uploads directory deliberately lives OUTSIDE the project working tree:
// the sandbox platform periodically resets untracked paths inside
// /home/z/my-project, which used to wipe every stored chat photo (the DB rows
// survived, the bytes vanished → "Photo unavailable"). /home/z/.redsec-uploads
// is outside that reset scope, so photos are saved forever like the messages.
import { mkdir } from 'fs/promises'

export const UPLOAD_DIR = '/home/z/.redsec-uploads'

export async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true })
}
