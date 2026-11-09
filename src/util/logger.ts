import { Logger as HomebridgeLogger } from 'homebridge';

export function sanitizeRobotName(name: string): string {
  return Array.from(name, (character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 ? ' ' : character;
  }).join('').slice(0, 256);
}

export function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'request failed';
  const code = error.message.match(/(?:HTTP|cloud code|Dreame code) -?\d{1,8}\b/);
  if (code) return code[0];
  if (/timed out|timeout/i.test(error.message)) return 'request timed out';
  if (/not authorized|unauthorized/i.test(error.message)) return 'authorization failed';
  return 'request failed';
}

export class Logger {
  constructor(private readonly log: HomebridgeLogger, private readonly name: string, private readonly context = '') {}

  forRobot(name: string): Logger {
    return new Logger(this.log, this.name, sanitizeRobotName(name));
  }

  private prefix(): string {
    return `[${this.name}]${this.context ? ` [${this.context}]` : ''}`;
  }

  info(message: string, ...parameters: unknown[]): void {
    this.log.info(`${this.prefix()} ${message}`, ...parameters);
  }

  warn(message: string, ...parameters: unknown[]): void {
    this.log.warn(`${this.prefix()} ${message}`, ...parameters);
  }

  error(message: string, ...parameters: unknown[]): void {
    this.log.error(`${this.prefix()} ${message}`, ...parameters);
  }

  debug(message: string, ...parameters: unknown[]): void {
    this.log.debug(`${this.prefix()} ${message}`, ...parameters);
  }

  getRaw(): HomebridgeLogger {
    return this.log;
  }
}
