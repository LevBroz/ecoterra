import express from 'express';
import cors from 'cors';
import { requireAuth, requireRole } from './middleware/auth.js';
import paymentsRouter from './routes/payments.js';
import feesRouter from './routes/fees.js';
import usersRouter from './routes/users.js';

const app = express();
const PORT = process.env.PORT || 3001;

// FRONTEND_URL: uno o varios orígenes separados por coma.
// Se normalizan barras finales (https://app.netlify.app/ === https://app.netlify.app)
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : '*' }));
app.use(express.json());

// Healthcheck (Render lo usa, también sirve para "despertar" el free tier)
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Rutas protegidas: solo admin opera pagos/cuotas/usuarios
app.use('/api/payments', requireAuth, requireRole('admin'), paymentsRouter);
app.use('/api/fees', requireAuth, requireRole('admin'), feesRouter);
app.use('/api/users', requireAuth, requireRole('admin'), usersRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

app.listen(PORT, () => console.log(`EcoTerra API en puerto ${PORT}`));
