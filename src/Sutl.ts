export function assertUnhandled(x: never): never {
    throw new Error('unexpected case');
}
