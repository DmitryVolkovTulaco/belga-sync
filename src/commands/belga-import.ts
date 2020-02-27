import { Args } from 'vorpal';
import { BelgaSdk } from '../util/belga';
import PrezlySdk from '@prezly/sdk';
import { discoverClient } from '../util/oidc';
import { BelgaImporter } from '../util/belga-importer';

export async function belgaImport(args: Args): Promise<void> {
    const belgaOidcWellKnownUri = process.env.BELGA_OIDC_WELL_KNOWN_URI!;
    const belgaApiBaseUri = process.env.BELGA_API_BASE_URI!;
    const belgaBoardUuid = args.belga_board_uuid;
    const prezlyNewsroomId = parseInt(args.prezly_newsroom_id);
    const prezlyAccessToken = args.prezly_access_token;
    const prezlyApiBaseUri = process.env.PREZLY_API_BASE_URI;

    const belgaClient = await discoverClient(belgaOidcWellKnownUri, args.belga_client_id, args.belga_client_secret);

    const belga = new BelgaSdk(belgaClient, belgaApiBaseUri);
    const prezly = new PrezlySdk({
        accessToken: prezlyAccessToken,
        baseUrl: prezlyApiBaseUri,
    });

    const belgaImport = new BelgaImporter(belga, prezly);

    await belgaImport.importNewsObjects(belgaBoardUuid, prezlyNewsroomId);
}

declare module 'vorpal/index' {
    interface Args {
        belga_client_id: string;
        belga_client_secret: string;
        belga_board_uuid: string;
        prezly_access_token: string;
        prezly_newsroom_id: string;
    }
}
