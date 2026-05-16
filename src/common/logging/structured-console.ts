import { getRequestId, getRequestUserId } from '../context/request-user.context';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

const LEVEL_MAP: Record<ConsoleMethod, 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'> = {
    log: 'INFO',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
    debug: 'DEBUG',
};

const serializeArg = (value: unknown): unknown => {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }
    return value;
};

export function installStructuredConsoleLogging(): void {
    const original = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console),
    };

    const shouldBypass = process.env.LOG_FORMAT === 'plain';

    (Object.keys(LEVEL_MAP) as ConsoleMethod[]).forEach((method) => {
        console[method] = (...args: unknown[]) => {
            if (shouldBypass) {
                original[method](...args);
                return;
            }

            const payload = {
                ts: new Date().toISOString(),
                level: LEVEL_MAP[method],
                requestId: getRequestId(),
                userId: getRequestUserId(),
                message: args
                    .map((arg) => {
                        if (typeof arg === 'string') return arg;
                        try {
                            return JSON.stringify(serializeArg(arg));
                        } catch {
                            return `[unserializable:${Object.prototype.toString.call(arg)}]`;
                        }
                    })
                    .join(' '),
                data: args.length > 1 ? args.slice(1).map(serializeArg) : undefined,
            };

            original[method](JSON.stringify(payload));
        };
    });
}
