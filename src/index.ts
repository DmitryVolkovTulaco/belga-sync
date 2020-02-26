import 'cross-fetch/polyfill';
import Vorpal from 'vorpal';
import { belgaImport } from './commands/belga-import';
import dotenv from 'dotenv';

dotenv.config();

const vorpal = new Vorpal();

vorpal
    .command(
        'import <belga_client_id> <belga_client_secret> <belga_board_uuid> <prezly_access_token> [prezly_newsroom_id]',
    )
    .action(belgaImport);

vorpal.parse(process.argv);
