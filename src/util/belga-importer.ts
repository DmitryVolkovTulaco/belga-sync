import _ from 'lodash';
import dayjs from 'dayjs';
import chalk from 'chalk';
import UploadClient from '@uploadcare/upload-client';
import PrezlySdk from '@prezly/sdk';
import {
    BelgaSdk,
    BelgaNewsObject,
    BelgaMediumTypeGroup,
    BelgaAttachmentType,
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
                await this.syncBelgaNewsObjectToPrezlyCoverage(prezlyNewsroomId, newsObject.uuid);
            }, new Promise((c) => c()));
        });
    }

    private async syncBelgaNewsObjectToPrezlyCoverage(newsroomId: number, newsObjectUuid: string) {
        const existingCoverage = await retry(
            5,
            async () => await this.prezly.coverage.getByExternalReferenceId(newsObjectUuid),
        );

        const newsObject: BelgaNewsObject = await retry(
            3,
            async () => await this.belga.get(`/newsobjects/${newsObjectUuid}`),
        );

        if (existingCoverage) {
            console.log(
                chalk.gray(`Belga news object ${newsObjectUuid} (${newsObject.title}) has already been synced.`),
            );

            return;
        }

        const newCoverage = await this.belgaNewsObjectToCoverage(newsObject);
        if (!newCoverage) {
            console.log(
                chalk.grey(
                    `Belga news object ${newsObjectUuid} - ${newsObject.mediumTypeGroup} ${newsObject.mediumType} - ${newsObject.title} is not supported.`,
                ),
            );

            return;
        }

        newCoverage.newsroom = newsroomId;

        try {
            console.log(chalk.green(`Syncing Belga news object ${newsObjectUuid} (${newsObject.title}).`));

            await retry(5, async () => {
                try {
                    await this.prezly.coverage.create(newCoverage);

                    console.log(chalk.greenBright(`Belga news object ${newsObjectUuid} (${newsObject.title}) synced!`));
                } catch (error) {
                    if (error.status === 500 && error.payload.message === 'Undefined property: stdClass::$uuid') {
                        console.log(
                            chalk.yellow(
                                `Coverage for news object ${newsObjectUuid} was created, but the server may have failed to create a thumbnail.`,
                            ),
                        );
                    }
                    if (error.status === 500) {
                        console.log(chalk.red(JSON.stringify(error, null, 4)));
                    }

                    throw error;
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
                return this.belgaSocialNewsObjectToCoverage(newsObject);
            case BelgaMediumTypeGroup.Online:
                return await this.belgaOnlineNewsObjectToCoverage(newsObject);
            case BelgaMediumTypeGroup.Multimedia:
                return await this.belgaMultimediaNewsObjectToCoverage(newsObject);
            default:
                return null;
        }
    }

    private async belgaPrintNewsObjectToCoverage(newsObject: BelgaNewsObject): Promise<null | CoverageCreateRequest> {
        const coverage: CoverageCreateRequest = {
            external_reference_id: newsObject.uuid,
            published_at: dayjs(newsObject.publishDate).toISOString(),
            organisation: newsObject.source || newsObject.subSource,
            note_content: { text: _.startCase(newsObject.mediumType.toLowerCase()) },
        };

        // note: We only support one author.
        if (newsObject.authors.length) {
            coverage.author = newsObject.authors[0];
        }

        const attachment = await this.getBestAttachment(newsObject);
        if (attachment) {
            coverage.attachment = attachment;
        }

        return coverage;
    }

    private belgaSocialNewsObjectToCoverage(newsObject: BelgaNewsObject): null | CoverageCreateRequest {
        const coverage: CoverageCreateRequest = {
            external_reference_id: newsObject.uuid,
            published_at: dayjs(newsObject.publishDate).toISOString(),
            organisation: newsObject.source || newsObject.subSource,
            note_content: { text: _.startCase(newsObject.mediumType.toLowerCase()) },
        };

        const socialUrl: BelgaAttachmentReference = _.chain(newsObject.attachments)
            .filter({ type: BelgaAttachmentType.Twitter })
            .flatMap('references')
            .filter('href')
            .orderBy((reference) => {
                const position = ['ORIGINAL'].indexOf(reference.representation);

                return position === -1 ? 0 : position;
            }, 'asc')
            .first()
            .value();

        if (!socialUrl) {
            return null;
        }

        coverage.url = socialUrl.href;

        return coverage;
    }

    private belgaOnlineNewsObjectToCoverage(newsObject: BelgaNewsObject): null | CoverageCreateRequest {
        const coverage: CoverageCreateRequest = {
            external_reference_id: newsObject.uuid,
            published_at: dayjs(newsObject.publishDate).toISOString(),
            organisation: newsObject.source || newsObject.subSource,
            note_content: { text: _.startCase(newsObject.mediumType.toLowerCase()) },
        };

        const url: BelgaAttachmentReference = _.chain(newsObject.attachments)
            .filter({ type: BelgaAttachmentType.Webpage })
            .flatMap('references')
            .filter('href')
            .orderBy((reference) => {
                const position = ['ORIGINAL'].indexOf(reference.representation);

                return position === -1 ? 0 : position;
            }, 'asc')
            .first()
            .value();

        if (url) {
            coverage.url = url.href;
        }

        return coverage;
    }

    private belgaMultimediaNewsObjectToCoverage(newsObject: BelgaNewsObject): null | CoverageCreateRequest {
        const coverage: CoverageCreateRequest = {
            external_reference_id: newsObject.uuid,
            published_at: dayjs(newsObject.publishDate).toISOString(),
            organisation: newsObject.source || newsObject.subSource,
            note_content: { text: _.startCase(newsObject.mediumType.toLowerCase()) },
        };
        console.log(chalk.blue(`Found a multimedia object! ${newsObject.uuid}`));
        process.exit();
        return coverage;
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

        const repairedMimeType = this.repairMimeType(bestReference);
        const date = dayjs(newsObject.publishDate);

        try {
            return await this.uploadByUriForPrezly(
                bestReference.href,
                `${newsObject.subSource} - ${date.toString()}.${this.getExtensionForMimeType(repairedMimeType)}`,
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
        const uploadedFile = await retry(
            3,
            async () =>
                await this.uploadCare.uploadFile(uri, {
                    publicKey: process.env.UPLOADCARE_PUBLIC_KEY!,
                }),
        );

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
            return 'image/png';
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
