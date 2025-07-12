import pino from 'pino';

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:dd-mm-yyyy HH:MM:ss',
        ignore: 'pid,hostname',
      },
      level: 'info'
    },
    {
      target: 'pino-roll',
      options: {
        file: './crash.log',
        frequency: 'daily',
        size: '10m',
        mkdir: true
      },
      level: 'warn'
    }
  ]
});

const logger = pino(transport);

export default logger;