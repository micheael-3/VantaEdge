const { sql } = require('./_shared/db');
const { json, error, notFound, subPath } = require('./_shared/response');
const { POSTS } = require('./_shared/blog-content');

let seeded = false;

async function lazySeed() {
  if (seeded) return;
  try {
    const [{ n }] = await sql()`SELECT COUNT(*)::int AS n FROM blog_posts`;
    if (Number(n) >= POSTS.length) {
      seeded = true;
      return;
    }
    for (const p of POSTS) {
      await sql()`
        INSERT INTO blog_posts (slug, title, excerpt, content, category, read_time, published_at)
        VALUES (${p.slug}, ${p.title}, ${p.excerpt}, ${p.content}, ${p.category}, ${p.readTime}, NOW())
        ON CONFLICT (slug) DO NOTHING`;
    }
    seeded = true;
  } catch (e) {
    console.error('blog lazySeed failed:', e.message);
  }
}

function shape(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    category: row.category,
    readTime: row.read_time,
    publishedAt: row.published_at,
  };
}

function shapeFull(row) {
  return { ...shape(row), content: row.content };
}

async function list(event) {
  await lazySeed();
  const params = event.queryStringParameters || {};
  const category = (params.category || '').trim();

  const rows = category
    ? await sql()`SELECT id, slug, title, excerpt, category, read_time, published_at
                  FROM blog_posts WHERE category = ${category}
                  ORDER BY published_at DESC`
    : await sql()`SELECT id, slug, title, excerpt, category, read_time, published_at
                  FROM blog_posts
                  ORDER BY published_at DESC`;
  return json(200, { posts: rows.map(shape) });
}

async function getOne(slug) {
  await lazySeed();
  const rows = await sql()`
    SELECT id, slug, title, excerpt, content, category, read_time, published_at
    FROM blog_posts WHERE slug = ${slug}`;
  if (rows.length === 0) return notFound();
  const post = shapeFull(rows[0]);

  const related = await sql()`
    SELECT id, slug, title, excerpt, category, read_time, published_at
    FROM blog_posts
    WHERE category = ${post.category} AND slug <> ${post.slug}
    ORDER BY published_at DESC
    LIMIT 3`;

  return json(200, { post, related: related.map(shape) });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };
    if (event.httpMethod !== 'GET') return error(405, 'Method not allowed');
    const path = subPath(event, 'blog');
    if (path === '/' || path === '') return await list(event);
    const m = path.match(/^\/([a-z0-9-]+)\/?$/);
    if (m) return await getOne(m[1]);
    return notFound();
  } catch (err) {
    console.error('blog handler error:', err);
    return error(500, err.message || 'Internal server error');
  }
};
