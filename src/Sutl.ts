export function assertUnhandled(x: never): never {
    throw new Error('unexpected case');
}

export async function delayMs(timeoutMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, timeoutMs));
}

export async function waitFor<T>(
    test: () => T, // return truthy value to pass
    intervalMs: number,
    timeoutMs: number
): Promise<T> {
    const startTime = performance.now();
    let value = test();

    while (!value) {
        await delayMs(intervalMs);
        if (performance.now() - startTime > timeoutMs) break;
        value = test();
    }

    return value;
}

