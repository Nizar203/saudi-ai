// تخزين مشاريع المستخدمين على الخادم.
// - إذا ضُبط DATABASE_URL (Postgres من Neon أو Supabase أو Render): تُحفظ المشاريع في قاعدة البيانات بشكل دائم.
// - بدونه: تُحفظ في ملف data/projects.json (مناسب للتجربة فقط؛ قرص Render المجاني يُمسح عند كل نشر).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL || '';
const MAX_PROJECTS = Number(process.env.MAX_PROJECTS_PER_USER || 100);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

export const storageKind = DATABASE_URL ? 'postgres' : 'file';

const newSlug = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toLowerCase() +
  crypto.randomBytes(2).toString('hex');

function limitError() {
  const e = new Error(`وصلت للحد الأقصى (${MAX_PROJECTS} مشروع). احذف مشاريع قديمة أولاً.`);
  e.code = 'limit';
  return e;
}

// ---------------- Postgres ----------------
function pgStore() {
  let poolP;
  async function pool() {
    if (!poolP) {
      poolP = (async () => {
        const { default: pg } = await import('pg');
        const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
        const p = new pg.Pool({
          connectionString: DATABASE_URL,
          ssl: local || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
          max: 5,
        });
        await p.query(`CREATE TABLE IF NOT EXISTS projects (
          owner TEXT NOT NULL,
          id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          html TEXT NOT NULL DEFAULT '',
          brief TEXT NOT NULL DEFAULT '',
          log JSONB NOT NULL DEFAULT '[]',
          data JSONB NOT NULL DEFAULT '{}',
          slug TEXT UNIQUE,
          pub_html TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (owner, id)
        )`);
        return p;
      })().catch((e) => { poolP = null; throw e; });
    }
    return poolP;
  }
  const q = async (sql, args) => (await pool()).query(sql, args);
  return {
    async list(owner) {
      const r = await q('SELECT id, name, slug, updated_at FROM projects WHERE owner=$1 ORDER BY updated_at DESC', [owner]);
      return r.rows;
    },
    async get(owner, id) {
      const r = await q('SELECT id, name, html, brief, log, data, slug, updated_at FROM projects WHERE owner=$1 AND id=$2', [owner, id]);
      return r.rows[0] || null;
    },
    async put(owner, id, p) {
      const exists = await q('SELECT 1 FROM projects WHERE owner=$1 AND id=$2', [owner, id]);
      if (!exists.rowCount) {
        const c = await q('SELECT count(*)::int AS n FROM projects WHERE owner=$1', [owner]);
        if (c.rows[0].n >= MAX_PROJECTS) throw limitError();
      }
      await q(`INSERT INTO projects (owner, id, name, html, brief, log, data, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,now())
        ON CONFLICT (owner, id) DO UPDATE SET name=$3, html=$4, brief=$5, log=$6, data=$7, updated_at=now()`,
      [owner, id, p.name, p.html, p.brief, JSON.stringify(p.log), JSON.stringify(p.data)]);
    },
    async del(owner, id) {
      await q('DELETE FROM projects WHERE owner=$1 AND id=$2', [owner, id]);
    },
    async publish(owner, id) {
      const cur = await this.get(owner, id);
      if (!cur) return null;
      const slug = cur.slug || newSlug();
      await q('UPDATE projects SET slug=$3, pub_html=html WHERE owner=$1 AND id=$2', [owner, id, slug]);
      return slug;
    },
    async unpublish(owner, id) {
      await q('UPDATE projects SET slug=NULL, pub_html=NULL WHERE owner=$1 AND id=$2', [owner, id]);
    },
    async getPublished(slug) {
      const r = await q('SELECT name, pub_html FROM projects WHERE slug=$1 AND pub_html IS NOT NULL', [slug]);
      return r.rows[0] ? { name: r.rows[0].name, html: r.rows[0].pub_html } : null;
    },
    async ping() { await q('SELECT 1'); },
  };
}

// ---------------- ملف JSON (للتجربة) ----------------
function fileStore() {
  const file = path.join(DATA_DIR, 'projects.json');
  let db = { users: {}, slugs: {} };
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
  let timer;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(db));
        fs.renameSync(file + '.tmp', file);
      } catch (e) { console.error('[store] تعذّر الحفظ:', e.message); }
    }, 200);
  };
  const user = (o) => (db.users[o] ||= {});
  return {
    async list(owner) {
      return Object.values(user(owner))
        .map(({ id, name, slug, updated_at }) => ({ id, name, slug: slug || null, updated_at }))
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    },
    async get(owner, id) {
      const p = user(owner)[id];
      if (!p) return null;
      const { pub_html, ...rest } = p;
      return { ...rest, slug: p.slug || null };
    },
    async put(owner, id, p) {
      const u = user(owner);
      if (!u[id] && Object.keys(u).length >= MAX_PROJECTS) throw limitError();
      u[id] = { ...(u[id] || {}), id, ...p, updated_at: new Date().toISOString() };
      persist();
    },
    async del(owner, id) {
      const p = user(owner)[id];
      if (p?.slug) delete db.slugs[p.slug];
      delete user(owner)[id];
      persist();
    },
    async publish(owner, id) {
      const p = user(owner)[id];
      if (!p) return null;
      p.slug ||= newSlug();
      p.pub_html = p.html;
      db.slugs[p.slug] = { owner, id };
      persist();
      return p.slug;
    },
    async unpublish(owner, id) {
      const p = user(owner)[id];
      if (p?.slug) delete db.slugs[p.slug];
      if (p) { p.slug = null; p.pub_html = null; }
      persist();
    },
    async getPublished(slug) {
      const ref = db.slugs[slug];
      const p = ref && db.users[ref.owner]?.[ref.id];
      return p?.pub_html ? { name: p.name, html: p.pub_html } : null;
    },
    async ping() {},
  };
}

export const store = DATABASE_URL ? pgStore() : fileStore();
