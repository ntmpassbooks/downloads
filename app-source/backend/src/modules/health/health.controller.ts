import { Request, Response } from 'express';
import { getDatabase } from '../../db/connection.js';
import { env } from '../../config/env.js';

export function getHealth(_req: Request, res: Response): void {
  try {
    const db = getDatabase();
    const result = db.prepare('SELECT 1 as alive').get() as { alive: number } | undefined;

    if (result && result.alive === 1) {
      res.status(200).json({
        status: 'healthy',
        environment: env.NODE_ENV,
        database: 'connected',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
      });
      return;
    }

    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: 'error',
      timestamp: new Date().toISOString(),
    });
  }
}
