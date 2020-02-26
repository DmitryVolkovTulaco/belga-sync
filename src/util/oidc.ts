import { Issuer } from 'openid-client';

export async function discoverClient(
    wellKnownEndpoint: string,
    client_id: string,
    client_secret: string,
) {
    const issuer = await Issuer.discover(wellKnownEndpoint);

    return new issuer.Client({
        client_id,
        client_secret,
    });
}
