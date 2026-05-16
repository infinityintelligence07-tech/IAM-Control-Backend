import { AsyncLocalStorage } from 'node:async_hooks';

type RequestUserContextStore = {
    userId?: number;
    requestId?: string;
};

const requestUserContextStorage = new AsyncLocalStorage<RequestUserContextStore>();

const normalizeUserId = (value: unknown): number | undefined => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }
    return parsed;
};

type RunContextInput = {
    userId?: unknown;
    requestId?: string;
};

export const runWithRequestUserContext = <T>(context: RunContextInput, callback: () => T): T => {
    return requestUserContextStorage.run(
        {
            userId: normalizeUserId(context.userId),
            requestId: context.requestId?.trim() || undefined,
        },
        callback,
    );
};

export const getRequestUserId = (): number | undefined => {
    return requestUserContextStorage.getStore()?.userId;
};

export const getRequestId = (): string | undefined => {
    return requestUserContextStorage.getStore()?.requestId;
};
