import PrezlySdk from '@prezly/sdk';
import UploadClient from '@uploadcare/upload-client';
import log4js from 'log4js';
import { Args } from 'vorpal';
import { BelgaSdk } from '../util/belga';
import { discoverClient } from '../util/oidc';
import { BelgaImporter } from '../util/belga-importer';

export async function belgaImport(args: Args): Promise<void> {
    const belgaOidcWellKnownUri = process.env.BELGA_OIDC_WELL_KNOWN_URI!;
    const belgaApiBaseUri = process.env.BELGA_API_BASE_URI!;
    const belgaBoardUuid = args.belga_board_uuid;
    const prezlyNewsroomId = parseInt(args.prezly_newsroom_id);
    const belgaOffset = parseInt(args.belga_offset || '0');
    const prezlyAccessToken = process.env.PREZLY_ACCESS_TOKEN!;
    const prezlyApiBaseUri = process.env.PREZLY_API_BASE_URI!;

    const logger = log4js.getLogger();
    logger.level = 'debug';

    const belgaClient = await discoverClient(
        belgaOidcWellKnownUri,
        process.env.BELGA_CLIENT_ID!,
        process.env.BELGA_CLIENT_SECRET!,
    );

    const belga = new BelgaSdk(logger, belgaClient, belgaApiBaseUri);
    const prezly = new PrezlySdk({
        accessToken: prezlyAccessToken,
        baseUrl: prezlyApiBaseUri,
    });
    const uploadCare = new UploadClient({
        publicKey: process.env.UPLOADCARE_PUBLIC_KEY,
        baseCDN: process.env.UPLOADCARE_BASE_CDN_URI,
    });

    const belgaImport = new BelgaImporter(logger, belga, prezly, uploadCare);

    await belgaImport.importNewsObjects(belgaBoardUuid, prezlyNewsroomId, belgaOffset);
}

declare module 'vorpal/index' {
    interface Args {
        belga_board_uuid: string;
        prezly_newsroom_id: string;
        belga_offset: string;
    }
}
