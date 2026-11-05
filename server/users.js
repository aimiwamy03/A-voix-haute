import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEYLEN = 32;

// A fixed hash so an unknown e-mail costs the same work as a wrong password.
const DUMMY_HASH = hashPassword('not-a-real-password');

export function validEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : '';
}

export function validName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= 60 ? name : '';
}

export function validPassword(value) {
  const password = String(value ?? '');
  return password.length >= 8 && password.length <= 128 ? password : '';
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  let saltBuf;
  let expected;
  try {
    saltBuf = Buffer.from(salt, 'base64url');
    expected = Buffer.from(hash, 'base64url');
  } catch {
    return false;
  }
  if (!saltBuf.length || expected.length !== KEYLEN) return false;
  const actual = await scryptAsync(password, saltBuf, KEYLEN);
  return timingSafeEqual(actual, expected);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    hasPassword: Boolean(user.passwordHash),
    google: Boolean(user.googleSub),
  };
}

export function userStore(file) {
  let chain = Promise.resolve();
  const run = (fn) => {
    const next = chain.then(fn, fn);
    chain = next.then(() => {}, () => {});
    return next;
  };

  async function read() {
    try {
      const users = JSON.parse(await readFile(file, 'utf8'));
      return Array.isArray(users) ? users : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async function write(users) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
    await rename(tmp, file);
  }

  return {
    async create({ name, email, password }) {
      return run(async () => {
        const users = await read();
        if (users.some((user) => user.email === email)) {
          const err = new Error('Un compte existe déjà avec cet e-mail.');
          err.status = 409;
          throw err;
        }
        const user = {
          id: randomBytes(16).toString('hex'),
          name,
          email,
          passwordHash: await hashPassword(password),
          createdAt: new Date().toISOString(),
        };
        users.push(user);
        await write(users);
        return { user: publicUser(user), first: users.length === 1 };
      });
    },

    async authenticate(email, password) {
      const user = await run(async () => (await read()).find((item) => item.email === email) ?? null);
      const stored = user?.passwordHash || await DUMMY_HASH;
      const ok = await verifyPassword(password, stored);
      return user?.passwordHash && ok ? publicUser(user) : null;
    },

    // Same Google account signs in again. A verified e-mail joins the account that already uses it.
    async upsertGoogle({ sub, email, name }) {
      return run(async () => {
        const users = await read();
        const bySub = users.find((item) => item.googleSub === sub);
        if (bySub) return { user: publicUser(bySub), first: false };
        const byEmail = users.find((item) => item.email === email);
        if (byEmail) {
          if (byEmail.googleSub && byEmail.googleSub !== sub) {
            const err = new Error('Cet e-mail est déjà lié à un autre compte Google.');
            err.status = 409;
            throw err;
          }
          byEmail.googleSub = sub;
          await write(users);
          return { user: publicUser(byEmail), first: false };
        }
        const user = {
          id: randomBytes(16).toString('hex'),
          name,
          email,
          passwordHash: null,
          googleSub: sub,
          createdAt: new Date().toISOString(),
        };
        users.push(user);
        await write(users);
        return { user: publicUser(user), first: users.length === 1 };
      });
    },

    async get(id) {
      return run(async () => {
        const user = (await read()).find((item) => item.id === id);
        return user ? publicUser(user) : null;
      });
    },

    async updateName(id, name) {
      return run(async () => {
        const users = await read();
        const user = users.find((item) => item.id === id);
        if (!user) return null;
        user.name = name;
        await write(users);
        return publicUser(user);
      });
    },

    async changePassword(id, current, next) {
      return run(async () => {
        const users = await read();
        const user = users.find((item) => item.id === id);
        if (!user) return null;
        if (!user.passwordHash) {
          const err = new Error('Ce compte n\'a pas de mot de passe.');
          err.status = 400;
          throw err;
        }
        if (!await verifyPassword(current, user.passwordHash)) {
          const err = new Error('Mot de passe actuel incorrect.');
          err.status = 401;
          throw err;
        }
        user.passwordHash = await hashPassword(next);
        await write(users);
        return publicUser(user);
      });
    },
  };
}
