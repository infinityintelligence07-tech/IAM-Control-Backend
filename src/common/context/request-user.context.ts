import { AsyncLocalStorage } from 'node:async_hooks';

type RequestUserContextStore = {
    userId?: number;
};

const requestUserContextStorage = new AsyncLocalStorage<RequestUserContextStore>();

const normalizeUserId = (value: unknown): number | undefined => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }
    return parsed;
};

export const runWithRequestUserContext = <T>(userId: unknown, callback: () => T): T => {
    return requestUserContextStorage.run(
        { userId: normalizeUserId(userId) },
        callback,
    );
};

export const getRequestUserId = (): number | undefined => {
    return requestUserContextStorage.getStore()?.userId;
};

