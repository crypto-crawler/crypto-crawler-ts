import { Logger, transports, createLogger as createLoggerWinston } from 'winston';

export default function createLogger(prefix: string): Logger {
  return createLoggerWinston({
    level: 'info',
    transports: [
      new transports.Console(),
      new transports.File({
        filename: `${prefix}-${new Date().toISOString().substring(0, 10)}.log`,
      }),
    ],
  });
}
