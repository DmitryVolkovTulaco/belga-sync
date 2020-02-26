import { Issuer } from 'openid-client';

export async function discoverClient(wellKnownEndpoint: string, clientId: string, clientSecret: string) {
    const issuer = await Issuer.discover(wellKnownEndpoint);

    return new issuer.Client({
        client_id: clientId,
        client_secret: clientSecret,
    });
}
