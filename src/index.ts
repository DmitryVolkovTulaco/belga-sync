import 'cross-fetch/polyfill';
import log4js from 'log4js';
import Vorpal from 'vorpal';
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

const vorpal = new Vorpal();

vorpal
    .command(
        'import <belga_client_id> <belga_client_secret> <belga_board_uuid> <prezly_access_token> [prezly_newsroom_id] [belga_offset]',
    )
    .action(belgaImport);

vorpal.parse(process.argv);
