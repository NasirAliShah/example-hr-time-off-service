import * as winston from 'winston';

const loggers: Map<string, winston.Logger> = new Map();

export function getLogger(label: string): winston.Logger {
  if (loggers.has(label)) {
    return loggers.get(label)!;
  }

  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    defaultMeta: { service: 'timeoff-service', label },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `${timestamp} [${label}] ${level}: ${message} ${metaStr}`;
          }),
        ),
      }),
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
      }),
    ],
  });

  loggers.set(label, logger);
  return logger;
}
