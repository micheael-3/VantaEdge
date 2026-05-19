require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./src/routes/auth');
const predictionsRoutes = require('./src/routes/predictions');
const historyRoutes = require('./src/routes/history');
const userRoutes = require('./src/routes/user');
const webhookRoutes = require('./src/routes/webhook');

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', authRoutes);
app.use('/api/predictions', predictionsRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/user', userRoutes);
app.use('/api/webhook', webhookRoutes);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const port = parseInt(process.env.PORT, 10) || 4000;
app.listen(port, () => {
  console.log(`VantaEdge backend listening on :${port}`);
});
