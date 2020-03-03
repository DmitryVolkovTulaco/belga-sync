export async function retry<ReturnType>(maxTries: number, callback: () => Promise<ReturnType>): Promise<ReturnType> {
    let attempts = 0;
    let lastError = null;

    do {
        ++attempts;

        try {
            return await callback();
        } catch (error) {
            lastError = error;
        }
    } while (attempts < maxTries);

    throw lastError;
}
