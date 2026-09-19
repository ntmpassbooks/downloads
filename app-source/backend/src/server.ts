import { createApp } from './app.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { closeDatabase } from './db/connection.js';
import { BishiSchedulerService } from './modules/notifications/bishi_scheduler.service.js';

// Run database migrations on startup to guarantee schema readiness
runMigrations();

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`=========================================`);
  console.log(`🚀 NTM Passbook Backend API Running`);
  console.log(`📡 Environment: ${env.NODE_ENV}`);
  console.log(`🌐 Host:        ${env.HOST}`);
  console.log(`🌐 Port:        http://${env.HOST}:${env.PORT}`);
  console.log(`🛡️  Security:    Helmet, CORS, Scrypt, RBAC`);
  console.log(`=========================================`);

  if (env.NODE_ENV !== 'test') {
    BishiSchedulerService.startSchedule();
  }
});

// Graceful shutdown handling
const handleShutdown = (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  BishiSchedulerService.stopSchedule();
  server.close(() => {
    console.log('HTTP server closed.');
    closeDatabase();
    console.log('Database connection closed.');
    process.exit(0);
  });

  // Force shutdown after 10 seconds if hanging
  setTimeout(() => {
    console.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
