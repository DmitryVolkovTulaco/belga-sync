import { Args } from 'vorpal';
import { BelgaSdk, BelgaNewsObject } from '../util/belga';
import PrezlySdk from '@prezly/sdk';
import chalk from 'chalk';
// todo: This can be cleaned up by exporting interfaces from `src/index.ts` and shipping .d.ts files in dist
import { CoverageCreateRequest } from '@prezly/sdk/dist/Sdk/Coverage/types';

let belga: null | BelgaSdk = null;
let prezly: null | PrezlySdk = null;

export async function belgaImport(args: Args): Promise<void> {
    const newsroomId = parseInt(args.prezly_newsroom_id!);

    belga = new BelgaSdk(args.belga_client_id, args.belga_client_secret);
    prezly = new PrezlySdk({
        accessToken: args.prezly_access_token,
        baseUrl: process.env.PREZLY_API_BASE_URI,
    });

    const query = {
        board: args.belga_board_uuid,
        order: '-publishDate',
    };

    await belga.chunk<BelgaNewsObject>('/newsobjects', query, async (chunk) => {
        const syncs = chunk.data.map((newsObject) => syncBelgaNewsObjectToPrezlyCoverage(newsroomId, newsObject));

        console.log(chalk.yellowBright(`Waiting for ${syncs.length} syncs to finish.`));
        await Promise.all(syncs);
    });
}

async function syncBelgaNewsObjectToPrezlyCoverage(newsroomId: number, simpleNewsObject: BelgaNewsObject) {
    const newsObjectUuid = simpleNewsObject.uuid;

    console.log(chalk.white(`Belga news object ${newsObjectUuid} (${simpleNewsObject.title}).`));

    const existing = await prezly!.coverage.list({
        jsonQuery: JSON.stringify({
            external_reference_id: {
                $in: [newsObjectUuid],
            },
        }),
    });

    if (existing.coverage.length) {
        console.log(
            chalk.gray(`Belga news object ${newsObjectUuid} (${simpleNewsObject.title}) has already been synced.`),
        );

        return;
    }

    const newCoverage: CoverageCreateRequest = {
        newsroom: newsroomId,
        external_reference_id: newsObjectUuid,
        note_content: { text: `bodymassage!!` },
    };

    try {
        await prezly!.coverage.create(newCoverage);
    } catch (error) {
        console.log(error);
    }

    console.log(chalk.greenBright(`Belga news object ${newsObjectUuid} (${simpleNewsObject.title}) synced!`));
}

declare module 'vorpal/index' {
    interface Args {
        belga_client_id: string;
        belga_client_secret: string;
        belga_board_uuid: string;
        prezly_access_token: string;
        prezly_newsroom_id?: string;
    }
}
