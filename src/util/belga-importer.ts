import { BelgaSdk, BelgaNewsObject } from '../util/belga';
import PrezlySdk from '@prezly/sdk';
import chalk from 'chalk';
// todo: This can be cleaned up by exporting interfaces from `src/index.ts` and shipping .d.ts files in dist
import { CoverageCreateRequest } from '@prezly/sdk/dist/Sdk/Coverage/types';

export class BelgaImporter {
    public constructor(private belga: BelgaSdk, private prezly: PrezlySdk) {}

    public async importNewsObjects(belgaBoardUuid: string, prezlyNewsroomId: number) {
        const query = {
            board: belgaBoardUuid,
            order: '-publishDate',
        };

        await this.belga.chunk<BelgaNewsObject>('/newsobjects', query, async (chunk) => {
            const syncs = chunk.data.map((newsObject) =>
                this.syncBelgaNewsObjectToPrezlyCoverage(prezlyNewsroomId, newsObject),
            );

            console.log(chalk.yellowBright(`Waiting for ${syncs.length} syncs to finish.`));

            await Promise.all(syncs);
        });
    }

    private async syncBelgaNewsObjectToPrezlyCoverage(newsroomId: number, simpleNewsObject: BelgaNewsObject) {
        const newsObjectUuid = simpleNewsObject.uuid;

        console.log(chalk.white(`Belga news object ${newsObjectUuid} (${simpleNewsObject.title}) seen...`));

        const existing = await this.prezly.coverage.getByExternalReferenceId(newsObjectUuid);

        if (existing) {
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
            await this.prezly.coverage.create(newCoverage);
        } catch (error) {
            console.log(error);
        }

        console.log(chalk.greenBright(`Belga news object ${newsObjectUuid} (${simpleNewsObject.title}) synced!`));
    }
}
