export default function KellyStake({ kelly }) {
  if (!kelly || kelly <= 0) {
    return <span className="badge mono small">Kelly · 0%</span>;
  }
  const pct = Math.round(kelly * 1000) / 10;
  return <span className="badge accent mono small">Kelly · {pct}% bankroll</span>;
}
