import pino from 'pino';
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.passwordHash'] });
