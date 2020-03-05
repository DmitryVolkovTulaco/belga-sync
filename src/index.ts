import 'cross-fetch/polyfill';
import log4js from 'log4js';
import Vorpal, { Args } from 'vorpal';
import { belgaImport } from './commands/belga-import';
import dotenv from 'dotenv';
import sentryExporter from './util/sentry';

dotenv.config();

log4js.configure({
    appenders: {
        out: {
            type: 'stdout',
        },
        sentry: {
            type: sentryExporter,
            dsn: process.env.SENTRY_DSN,
        },
    },
    categories: {
        default: {
            appenders: ['out', 'sentry'],
            level: 'debug',
        },
    },
});

const logger = log4js.getLogger();

const vorpal = new Vorpal();

vorpal.command('import <belga_board_uuid> <prezly_newsroom_id> [belga_offset]').action(wrapCommand(belgaImport));

vorpal.parse(process.argv);

function wrapCommand<ArgsType extends Args>(command: (args: ArgsType) => Promise<any>) {
    return async (args: ArgsType) => {
        try {
            await command(args);
        } catch (error) {
            logger.fatal(`Unhandled exception.`, [JSON.stringify(error, null, 4)]);
        }
    };
}
