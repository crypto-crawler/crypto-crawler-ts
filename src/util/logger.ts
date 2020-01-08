import { createLogger as createLoggerWinston, Logger, transports } from 'winston';

export default function createLogger(prefix: string): Logger {
  return createLoggerWinston({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
      new transports.Console(),
      new transports.File({
        filename: `${prefix}-${new Date().toISOString().substring(0, 10)}.log`,
      }),
    ],
  });
}
