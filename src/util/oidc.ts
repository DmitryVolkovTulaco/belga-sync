import { Issuer, Client } from 'openid-client';
import { retry } from './retry';

export async function discoverClient(
    wellKnownEndpoint: string,
    clientId: string,
    clientSecret: string,
): Promise<Client> {
    const issuer = await retry(3, async () => {
        return await Issuer.discover(wellKnownEndpoint);
    });

    return new issuer.Client({
        client_id: clientId,
        client_secret: clientSecret,
    });
}
