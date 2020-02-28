import _ from 'lodash';
import dayjs from 'dayjs';
import path from 'path';
import chalk from 'chalk';
import UploadClient from '@uploadcare/upload-client';
import PrezlySdk from '@prezly/sdk';
import {
    BelgaSdk,
    BelgaNewsObject,
    BelgaMediumTypeGroup,
    BelgaAttachmentType,
    BelgaAttachment,
    BelgaAttachmentReference,
} from '../util/belga';
// todo: This can be cleaned up by exporting interfaces from `src/index.ts` and shipping .d.ts files in dist
import { CoverageCreateRequest } from '@prezly/sdk/dist/Sdk/Coverage/types';
import { retry } from './retry';
import { UploadcareFile } from '@uploadcare/upload-client/lib/tools/UploadcareFile';

export class BelgaImporter {
    public constructor(private belga: BelgaSdk, private prezly: PrezlySdk, private uploadCare: UploadClient) {}

    public async importNewsObjects(belgaBoardUuid: string, prezlyNewsroomId: number, offset = 0) {
        const query = {
            board: belgaBoardUuid,
            order: '-publishDate',
            offset,
        };

        await this.belga.chunk<BelgaNewsObject>('/newsobjects', query, async (chunk) => {
            await chunk.data.reduce(async (previous, newsObject) => {
                await previous;
                await this.syncBelgaNewsObjectToPrezlyCoverage(prezlyNewsroomId, newsObject);
            }, new Promise((c) => c()));

            // console.log(chalk.yellowBright(`Waiting for ${syncs.length} syncs to finish.`));

            // await Promise.all(syncs);
        });
    }

    private async syncBelgaNewsObjectToPrezlyCoverage(newsroomId: number, simpleNewsObject: BelgaNewsObject) {
        const newsObjectUuid = simpleNewsObject.uuid;

        const existingCoverage = await retry(
            5,
            async () => await this.prezly.coverage.getByExternalReferenceId(newsObjectUuid),
        );

        if (existingCoverage) {
            console.log(
                chalk.gray(`Belga news object ${newsObjectUuid} (${simpleNewsObject.title}) has already been synced.`),
            );

            return;
        }

        const newCoverage = await this.belgaNewsObjectToCoverage(simpleNewsObject);
        if (!newCoverage) {
            console.log(
                chalk.grey(
                    `Belga news object ${newsObjectUuid} - ${simpleNewsObject.mediumTypeGroup} - ${simpleNewsObject.title} is not supported.`,
                ),
            );

            return;
        }

        newCoverage.newsroom = newsroomId;

        try {
            console.log(chalk.green(`Syncing Belga news object ${newsObjectUuid} (${simpleNewsObject.title}).`));

            await retry(5, async () => {
                try {
                    await this.prezly.coverage.create(newCoverage);

                    console.log(
                        chalk.greenBright(`Belga news object ${newsObjectUuid} (${simpleNewsObject.title}) synced!`),
                    );
                } catch (error) {
                    if (error.status === 500) {
                        console.log(chalk.red(JSON.stringify(error, null, 4)));
                    }
                }
            });
        } catch (error) {
            if (!error.status) {
                console.log(chalk.yellow('Timeout trying to create coverage record.'));
            }

            if (error.status === 409) {
                console.log(chalk.red(`Conflict! ${newsObjectUuid}`));
            }

            throw error;
        }
    }

    private async belgaNewsObjectToCoverage(newsObject: BelgaNewsObject): Promise<null | CoverageCreateRequest> {
        switch (newsObject.mediumTypeGroup) {
            case BelgaMediumTypeGroup.Print:
                return await this.belgaPrintNewsObjectToCoverage(newsObject);
            case BelgaMediumTypeGroup.Social:
                return await this.belgaSocialNewsObjectToCoverage();
            case BelgaMediumTypeGroup.Online:
                return await this.belgaOnlineNewsObjectToCoverage();
            case BelgaMediumTypeGroup.Multimedia:
                return await this.belgaMultimediaNewsObjectToCoverage();
            default:
                return null;
        }
    }

    private async belgaPrintNewsObjectToCoverage(newsObject: BelgaNewsObject): Promise<null | CoverageCreateRequest> {
        const coverage: CoverageCreateRequest = {
            external_reference_id: newsObject.uuid,
            published_at: dayjs(newsObject.publishDate).toISOString(),
            // note: There's also `sourceId`, `authors`, `authorIds`, `subsource` and `subsourceId`
            organisation: newsObject.source,
        };

        const content = newsObject.body || newsObject.lead || newsObject.title;
        if (content) {
            coverage.note_content = { text: content };
        }

        const attachment = await this.getBestAttachment(newsObject);

        if (attachment) {
            coverage.attachment = attachment;
        }

        return coverage;
    }

    private belgaSocialNewsObjectToCoverage(): null | CoverageCreateRequest {
        return null;
    }

    private belgaOnlineNewsObjectToCoverage(): null | CoverageCreateRequest {
        return null;
    }

    private belgaMultimediaNewsObjectToCoverage(): null | CoverageCreateRequest {
        return null;
    }

    private async getBestAttachment(newsObject: BelgaNewsObject): Promise<null | string> {
        if (_.isEmpty(newsObject.attachments)) {
            return null;
        }

        const bestReference: BelgaAttachmentReference = _.chain(newsObject.attachments)
            .filter({ type: BelgaAttachmentType.Page })
            .flatMap('references')
            .filter('href')
            .orderBy((reference) => {
                const position = ['ORIGINAL', 'DETAIL', 'LARGE', 'SMALL', 'CROPTOP'].indexOf(reference.representation);

                return position === -1 ? 0 : position;
            }, 'asc')
            .first()
            .value();

        try {
            const repairedMimeType = this.repairMimeType(bestReference);

            return await this.uploadByUriForPrezly(
                bestReference.href,
                `${newsObject.uuid}.${this.getExtensionForMimeType(repairedMimeType)}`,
                repairedMimeType,
            );
        } catch (error) {
            console.log(
                chalk.yellow(`Best attachment for ${newsObject.uuid} (${bestReference.href}) failed to download.`),
            );

            return null;
        }
    }

    private async uploadByUriForPrezly(uri: string, fileName: string, mimeType: string): Promise<null | string> {
        const uploadedFile = await this.uploadCare.uploadFile(uri, {
            publicKey: process.env.UPLOADCARE_PUBLIC_KEY!,
        });

        return this.uploadcareFileToPrezlyFile(uploadedFile, fileName, mimeType);
    }

    private uploadcareFileToPrezlyFile(file: UploadcareFile, fileName: string, mimeType: string): string {
        return JSON.stringify({
            is_stored: file.isStored,
            done: file.size,
            file_id: file.uuid,
            total: file.size,
            size: file.size,
            uuid: file.uuid,
            is_image: file.isImage,
            filename: fileName,
            video_info: null,
            is_ready: true,
            original_filename: fileName,
            image_info: null,
            mime_type: mimeType,
        });
    }

    private repairMimeType(reference: BelgaAttachmentReference): string {
        // note: Sometimes their stored mime types aren't accurate.
        if (reference.href.match(/\:png\:/)?.length) {
            return 'png';
        }

        switch (reference.mimeType.toLowerCase()) {
            case 'pdf':
                return 'application/pdf';

            case 'jpg':
            case 'image_jpg':
                return 'image/jpeg';

            case 'png':
                return 'image/png';

            default:
                console.log(chalk.yellow(`Unrecognized mime type: ${reference.mimeType}`));
                return reference.mimeType;
        }
    }

    private getExtensionForMimeType(type: string): string {
        switch (type) {
            case 'application/pdf':
                return 'pdf';
            case 'image/jpeg':
                return 'jpg';
            case 'image/png':
                return 'png';
            default:
                return '';
        }
    }
}
