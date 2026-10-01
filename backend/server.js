import http from 'http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs/swagger.js';
import { initSocket } from './sockets/index.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

// ── Route imports ────────────────────────────────────────────────────────────
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import wishlistRoutes from './routes/wishlistRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import addressRoutes from './routes/addressRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

dotenv.config();

// ── Express + HTTP server ─────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1); // Trust the reverse proxy (Render) to avoid express-rate-limit errors
const server = http.createServer(app);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:8080',
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // 1. no origin / undefined / null -> allow
    if (!origin) return callback(null, true);

    // 2-5. allowed exact origins
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // 6. Vercel deployment URL matching this project
    if (/^https:\/\/.*srivenkateshwara.*\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }

    console.log(`[CORS] Blocked origin: ${origin}`);
    return callback(new Error(`CORS not allowed for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new SocketServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});
initSocket(io);

// ── Security middleware ───────────────────────────────────────────────────────
// Helmet sets sensible HTTP security headers; CSP disabled to allow Swagger UI.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Applied to all /api/* routes — individual sub-limiters can be added per route.
app.use('/api/', apiLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
// Used by Render, Railway, or any uptime monitor.
const healthHandler = (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'Sri Venkateshwara Oil Mill API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// ── Swagger API documentation ─────────────────────────────────────────────────
// Available at /api/docs (UI) and /api/docs.json (raw spec)
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { background-color: #4A3B32; }',
    customSiteTitle: 'SVEM API Docs',
  })
);
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

// ── Error handlers (must be registered last) ──────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '5000', 10);
server.listen(PORT, () => {
  console.log(`\n🚀 SVEM Backend running on http://localhost:${PORT}`);
  console.log(`📚 API Docs:  http://localhost:${PORT}/api/docs`);
  console.log(`🔍 Health:    http://localhost:${PORT}/health`);
  console.log(`📦 Env:       ${process.env.NODE_ENV || 'development'}\n`);
});

export default app;
