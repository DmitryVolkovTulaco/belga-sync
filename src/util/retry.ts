import log4js from 'log4js';
import chalk from 'chalk';

const logger = log4js.getLogger();

export async function retry<ReturnType>(maxTries: number, callback: () => Promise<ReturnType>): Promise<ReturnType> {
    let attempts = 0;
    let lastError = null;

    do {
        ++attempts;

        try {
            return await callback();
        } catch (error) {
            logger.debug(chalk.yellow('Retrying...'));

            lastError = error;
        }
    } while (attempts < maxTries);

    logger.error(chalk.red(`Failed after ${maxTries} tries.`));

    throw lastError;
}
