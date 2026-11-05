import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Orals saved before accounts existed sit next to the user folders. The first account takes them.
export async function adoptOrphanSessions(dir, userId) {
  let names;
  try {
    names = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  const files = names.filter((name) => name.endsWith('.json'));
  if (!files.length) return;
  const dest = path.join(dir, userId);
  await mkdir(dest, { recursive: true });
  for (const name of files) {
    await rename(path.join(dir, name), path.join(dest, name));
  }
}

const ID = /^[a-z0-9-]{1,64}$/;

function exchangeCount(session) {
  if (Array.isArray(session.exchanges)) {
    const count = session.exchanges.filter((item) => item?.reply?.text).length;
    if (count) return count;
  }
  return session.reply?.text ? 1 : 0;
}

export const validSessionId = (id) => ID.test(String(id));

// One JSON file per practice session. Writes go through a temp file so a crash never leaves half a session.
export function sessionStore(dir) {
  const file = (id) => path.join(dir, `${id}.json`);

  return {
    async list() {
      let names;
      try {
        names = await readdir(dir);
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
      const items = [];
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        try {
          const session = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
          items.push({
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            excerpt: String(session.monologue?.text ?? '').slice(0, 160),
            hasReply: exchangeCount(session) > 0,
            exchangeCount: exchangeCount(session),
          });
        } catch {
          // Skip unreadable files rather than hiding the whole history.
        }
      }
      return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    async get(id) {
      try {
        return JSON.parse(await readFile(file(id), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },

    async save(id, session) {
      await mkdir(dir, { recursive: true });
      const tmp = `${file(id)}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(session, null, 2));
      await rename(tmp, file(id));
    },

    async remove(id) {
      await rm(file(id), { force: true });
    },
  };
}
