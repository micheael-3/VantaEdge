import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { blog } from '../api/blog';
import './Blog.css';

const CATEGORIES = ['All', 'Strategy', 'Leagues', 'Data'];

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
          <Link to="/blog" className="bp-btn">Blog</Link>
          {user ? (
            <Link to="/dashboard" className="bp-btn bp-btn-primary">Open App</Link>
          ) : (
            <>
              <Link to="/login" className="bp-btn">Login</Link>
              <Link to="/register" className="bp-btn bp-btn-primary">Start Free</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function Blog() {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('All');

  useEffect(() => {
    document.title = 'Football Betting Strategy & Analysis | VantaEdge';
    setMeta(
      'description',
      'Long-form guides on +EV betting, the Kelly criterion, expected goals, and the leagues where the value lives. Plain-English football data analysis from VantaEdge.',
    );
    setOg('og:title', 'VantaEdge Blog — Strategy, Data, Leagues');
    setOg('og:description', 'AI-driven football betting analysis and strategy guides.');
    setOg('og:type', 'website');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await blog.list(category);
        if (!cancelled) setPosts(data.posts || []);
      } catch (err) {
        if (!cancelled) setError((err.response && err.response.data && err.response.data.error) || 'Failed to load posts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category]);

  const filtered = useMemo(() => posts, [posts]);

  return (
    <div className="blog-page">
      <Nav user={user} />
      <div className="bp-container">
        <header className="bp-hero">
          <h1>The VantaEdge Blog</h1>
          <p>
            Long-form guides on +EV betting, the Kelly criterion, expected goals, league-specific
            structural edges, and how bookmakers actually price odds. Read these, then come back to
            the dashboard with a sharper view.
          </p>
        </header>

        <div className="bp-tabs">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`bp-tab ${category === c ? 'active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ color: 'var(--bp-text-dim)', padding: '40px 0', fontFamily: 'DM Mono, monospace' }}>
            Loading posts…
          </div>
        ) : error ? (
          <div style={{ color: 'var(--bp-text-dim)', padding: '40px 0' }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--bp-text-dim)', padding: '40px 0', fontFamily: 'DM Mono, monospace' }}>
            No posts in this category yet.
          </div>
        ) : (
          <div className="bp-grid">
            {filtered.map((p) => (
              <Link key={p.slug} to={`/blog/${p.slug}`} className="bp-card">
                <div className="bp-card-meta">
                  <span className="bp-cat">{p.category}</span>
                  <span>{p.readTime} min read</span>
                  <span>·</span>
                  <span>{fmtDate(p.publishedAt)}</span>
                </div>
                <h2>{p.title}</h2>
                <p>{p.excerpt}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
