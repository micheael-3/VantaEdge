const express = require('express');
const prisma = require('../prisma/client');
const authMiddleware = require('../middleware/auth');
const { requireAnalyst } = require('../middleware/tierGate');

const router = express.Router();

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

router.get('/', authMiddleware, requireAnalyst, async (req, res, next) => {
  try {
    const user = req.dbUser;
    const isEdge = user.tier === 'EDGE';
    const since = isEdge ? new Date(0) : daysAgo(30);

    const predictions = await prisma.prediction.findMany({
      where: { userId: user.id, createdAt: { gte: since } },
      orderBy: { kickoff: 'desc' },
    });

    const settled = predictions.filter((p) => p.overHit !== null || p.bttsHit !== null);
    const overHits = settled.filter((p) => p.overHit === true).length;
    const totalOver = settled.filter((p) => p.overHit !== null).length;
    const bttsHits = settled.filter((p) => p.bttsHit === true).length;
    const totalBtts = settled.filter((p) => p.bttsHit !== null).length;

    const byLeague = {};
    for (const p of predictions) {
      if (!byLeague[p.league]) byLeague[p.league] = { league: p.league, predictions: 0, hits: 0 };
      byLeague[p.league].predictions += 1;
      if (p.overHit === true) byLeague[p.league].hits += 1;
    }
    const leagueRows = Object.values(byLeague).map((row) => ({
      ...row,
      accuracy: row.predictions ? Math.round((row.hits / row.predictions) * 1000) / 10 : 0,
    }));

    let bestLeague = null;
    for (const row of leagueRows) {
      if (!bestLeague || row.accuracy > bestLeague.accuracy) bestLeague = row;
    }

    const byDay = {};
    for (const p of predictions) {
      const day = p.kickoff.toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { date: day, total: 0, hits: 0 };
      byDay[day].total += 1;
      if (p.overHit === true) byDay[day].hits += 1;
    }
    const rolling = Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ date: d.date, accuracy: d.total ? Math.round((d.hits / d.total) * 1000) / 10 : 0 }));

    const overall =
      totalOver + totalBtts > 0
        ? Math.round(((overHits + bttsHits) / (totalOver + totalBtts)) * 1000) / 10
        : 0;

    return res.json({
      summary: {
        totalPredictions: predictions.length,
        overallAccuracy: overall,
        bestLeague: bestLeague ? bestLeague.league : null,
        windowDays: isEdge ? null : 30,
      },
      leagues: leagueRows,
      rolling,
      recent: predictions.slice(0, 50).map((p) => ({
        id: p.id,
        date: p.kickoff,
        league: p.league,
        match: `${p.homeTeam} vs ${p.awayTeam}`,
        overLine: p.overLine,
        overConfidence: p.overConfidence,
        overHit: p.overHit,
        btts: p.btts,
        bttsConfidence: p.bttsConfidence,
        bttsHit: p.bttsHit,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/accuracy', authMiddleware, requireAnalyst, async (req, res, next) => {
  try {
    const user = req.dbUser;
    const rows = await prisma.predictionHistory.findMany({
      where: { userId: user.id },
      orderBy: { date: 'asc' },
    });
    return res.json({ rows });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
