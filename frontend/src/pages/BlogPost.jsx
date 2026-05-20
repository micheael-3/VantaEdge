import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { marked } from 'marked';
import { useAuth } from '../context/AuthContext';
import { blog } from '../api/blog';
import './Blog.css';

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function setMeta(name, content) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}
function setOg(prop, content) {
  let el = document.querySelector(`meta[property="${prop}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', prop);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function Nav({ user }) {
  return (
    <nav className="bp-nav">
      <div className="bp-nav-inner">
        <Link to="/" className="bp-brand">
          Vanta<span className="accent-dot">·</span>Edge
        </Link>
        <div className="bp-nav-links">
          <Link to="/blog" className="bp-btn">All posts</Link>
          {user ? (
            <Link to="/dashboard" className="bp-btn bp-btn-primary">Open App</Link>
          ) : (
            <Link to="/register" className="bp-btn bp-btn-primary">Start Free</Link>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function BlogPost() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await blog.get(slug);
        if (cancelled) return;
        setData(res);
        if (res.post) {
          document.title = `${res.post.title} | VantaEdge Blog`;
          setMeta('description', res.post.excerpt);
          setOg('og:title', res.post.title);
          setOg('og:description', res.post.excerpt);
          setOg('og:type', 'article');
        }
      } catch (err) {
        if (!cancelled) setError((err.response && err.response.data && err.response.data.error) || 'Failed to load post');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const html = useMemo(() => {
    if (!data || !data.post) return '';
    marked.setOptions({ breaks: false, gfm: true });
    return marked.parse(data.post.content);
  }, [data]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleTwitter = () => {
    if (!data || !data.post) return;
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(`${data.post.title} via @vantaedge`);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener,noreferrer');
  };

  if (loading) {
    return (
      <div className="blog-page">
        <Nav user={user} />
        <div className="bp-container" style={{ padding: '60px 32px', color: 'var(--bp-text-dim)', fontFamily: 'DM Mono, monospace' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="blog-page">
        <Nav user={user} />
        <div className="bp-container" style={{ padding: '60px 32px' }}>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 28 }}>Post not found</h1>
          <p style={{ color: 'var(--bp-text-dim)', marginTop: 12 }}>{error || 'That post doesn\'t exist.'}</p>
          <Link to="/blog" className="bp-btn" style={{ marginTop: 16, display: 'inline-flex' }}>
            ← Back to blog
          </Link>
        </div>
      </div>
    );
  }

  const post = data.post;
  const related = data.related || [];

  return (
    <div className="blog-page">
      <Nav user={user} />
      <article className="bp-container">
        <header className="bp-post-head">
          <div className="bp-post-meta">
            <span className="bp-cat">{post.category}</span>
            <span>{post.readTime} min read</span>
            <span>·</span>
            <span>{fmtDate(post.publishedAt)}</span>
          </div>
          <h1>{post.title}</h1>
          <div className="bp-share">
            <button className="bp-btn" onClick={handleTwitter}>Share on X</button>
            <button className="bp-btn" onClick={handleCopy}>{copied ? 'Link copied ✓' : 'Copy link'}</button>
          </div>
        </header>

        <div className="bp-prose" dangerouslySetInnerHTML={{ __html: html }} />

        <section className="bp-cta">
          <h3>Put This Into Practice</h3>
          <p>
            Get AI-powered value bets identified across 8 leagues every matchday — with confidence
            scores, EV calculations, and Kelly stake recommendations.
          </p>
          <div className="bp-cta-actions">
            {user ? (
              <Link to="/dashboard" className="bp-btn bp-btn-primary">Open dashboard</Link>
            ) : (
              <Link to="/register" className="bp-btn bp-btn-primary">Start Free</Link>
            )}
            <Link to="/blog" className="bp-btn">Read more articles</Link>
          </div>
        </section>

        {related.length > 0 && (
          <section className="bp-related">
            <h3>Related — More {post.category}</h3>
            <div className="bp-related-list">
              {related.map((r) => (
                <Link key={r.slug} to={`/blog/${r.slug}`} className="bp-card">
                  <div className="bp-card-meta">
                    <span className="bp-cat">{r.category}</span>
                    <span>{r.readTime} min</span>
                  </div>
                  <h2 style={{ fontSize: 18 }}>{r.title}</h2>
                  <p style={{ fontSize: 13 }}>{r.excerpt}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>
    </div>
  );
}
