import _ from 'lodash';
import dayjs from 'dayjs';
import chalk from 'chalk';
import log4js from 'log4js';
import UploadClient from '@uploadcare/upload-client';
import PrezlySdk, { CoverageCreateRequest } from '@prezly/sdk';
import {
    BelgaSdk,
    BelgaNewsObject,
    BelgaMediumTypeGroup,
    BelgaAttachmentType,
    BelgaAttachmentReference,
} from '../util/belga';
import { retry } from './retry';
import { UploadcareFile } from '@uploadcare/upload-client/lib/tools/UploadcareFile';
import { OEmbedInfo } from '@prezly/sdk/dist/Sdk/Coverage/types';

export class BelgaImporter {
    public constructor(
        private logger: log4js.Logger,
        private belga: BelgaSdk,
        private prezly: PrezlySdk,
        private uploadCare: UploadClient,
    ) {}

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
            }, Promise.resolve());
        });
    }

    private async syncBelgaNewsObjectToPrezlyCoverage(newsroomId: number, newsObjectUuid: string) {
        const existingCoverage = await retry(
            5,
            async () => await this.prezly.coverage.getByExternalReferenceId(newsObjectUuid),
        );

        const newsObject: BelgaNewsObject = this.cleanNewsObject(
            await retry(3, async () => await this.belga.get(`/newsobjects/${newsObjectUuid}`)),
        );

        if (existingCoverage) {
            this.logger.info(
                chalk.gray(`Belga news object ${newsObjectUuid} (${newsObject.title}) has already been synced.`),
            );

            return;
        }

        const newCoverage = await this.belgaNewsObjectToCoverage(newsObject);
        if (!newCoverage) {
            this.logger.info(
                chalk.grey(
                    `Belga news object ${newsObjectUuid} - ${newsObject.mediumTypeGroup} ${newsObject.mediumType} - ${newsObject.title} is not supported.`,
                ),
            );

            return;
        }

        newCoverage.newsroom = newsroomId;

        try {
            this.logger.info(
                chalk.green(
                    `Syncing Belga news object ${newsObjectUuid} - ${newsObject.mediumTypeGroup} ${newsObject.mediumType} - (${newsObject.title}).`,
                ),
            );

            await retry(5, async () => {
                try {
                    await this.prezly.coverage.create(newCoverage);

                    this.logger.info(
                        chalk.greenBright(`Belga news object ${newsObjectUuid} (${newsObject.title}) synced!`),
                    );
                } catch (error) {
                    if (error.status === 500 && error.payload.message === 'Undefined property: stdClass::$uuid') {
                        this.logger.warn(
                            chalk.yellow(
                                `Coverage for news object ${newsObjectUuid} was created, but the server may have failed to create a thumbnail.`,
                            ),
                            [JSON.stringify({ newsObjectUuid }, null, 4)],
                        );

                        return;
                    }

                    if (error.status === 500) {
                        this.logger.error(chalk.red('Error creating coverage'), [JSON.stringify(error, null, 4)]);

                        return;
                    }

                    if (error.status === 422) {
                        this.logger.error(chalk.red('API rejected coverage data'), [
                            JSON.stringify(
                                {
                                    newsObjectUuid,
                                    error,
                                },
                                null,
                                4,
                            ),
                        ]);

                        return;
                    }

                    throw error;
                }
            });
        } catch (error) {
            if (!error.status) {
                this.logger.error(chalk.yellow(`Timeout trying to create coverage record for ${newsObjectUuid}.`), [
                    JSON.stringify({ newsObjectUuid }, null, 4),
                ]);
            }

            if (error.status === 409) {
                // note: This can often happen when a record is created successfully, but some subsequent server-side operation fails in the same request.
                this.logger.error(
                    chalk.red(`Conflict when attempting to create coverage record for ${newsObjectUuid}`),
                    [JSON.stringify({ newsObjectUuid }, null, 4)],
                );
            }

            throw error;
        }
    }

    private cleanNewsObject(newsObject: BelgaNewsObject) {
        return {
            ...newsObject,
            title: newsObject.title.replace(/\n/, ''),
        };
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
            organisation: newsObject.source?.trim() || newsObject.subSource?.trim(),
            note_content: { text: _.startCase(newsObject.mediumType.toLowerCase()) },
            headline: newsObject.title,
            original_metadata_source: JSON.stringify(newsObject),
        };

        if (newsObject.body) {
            coverage.attachment_plaintext_content = newsObject.body;
        }

        // note: We only support one author.
        if (newsObject.authors.length) {
            coverage.author = newsObject.authors[0];
        }

        const attachment = await this.getBestAttachment(newsObject);
        if (attachment) {
            coverage.attachment = attachment;

            const oembed: OEmbedInfo = {
                version: '1.0',
                title: newsObject.title,
                description: newsObject.lead,
                type: 'link',
                url: this.getBestReference(newsObject).href,
            };

            if (newsObject.source) {
                oembed.provider_name = newsObject.source;
            }

            coverage.attachment_oembed = oembed;
        }

        return coverage;
    }

    private belgaSocialNewsObjectToCoverage(newsObject: BelgaNewsObject): null | CoverageCreateRequest {
        const coverage: CoverageCreateRequest = {
            external_reference_id: newsObject.uuid,
            published_at: dayjs(newsObject.publishDate).toISOString(),
            organisation: newsObject.source?.trim() || newsObject.subSource?.trim(),
            note_content: { text: _.startCase(newsObject.mediumType.toLowerCase()) },
            headline: newsObject.title,
            original_metadata_source: JSON.stringify(newsObject),
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
            organisation: newsObject.source?.trim() || newsObject.subSource?.trim(),
            note_content: { text: _.startCase(newsObject.mediumType.toLowerCase()) },
            headline: newsObject.title,
            original_metadata_source: JSON.stringify(newsObject),
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
            organisation: newsObject.source?.trim() || newsObject.subSource?.trim(),
            note_content: { text: _.startCase(newsObject.mediumType.toLowerCase()) },
            headline: newsObject.title,
            original_metadata_source: JSON.stringify(newsObject),
        };

        const url: BelgaAttachmentReference = _.chain(newsObject.attachments)
            .filter({ type: BelgaAttachmentType.Rtv })
            .flatMap('references')
            .filter('href')
            .orderBy((reference) => {
                const position = ['MD_PLAYER', 'STREAM', 'SMALL', 'MEDIUM'].indexOf(reference.representation);

                return position === -1 ? 0 : position;
            }, 'asc')
            .first()
            .value();

        if (url) {
            coverage.url = url.href;
        }

        return coverage;
    }

    private getBestReference(newsObject: BelgaNewsObject): BelgaAttachmentReference {
        return _.chain(newsObject.attachments)
            .filter({ type: BelgaAttachmentType.Page })
            .flatMap('references')
            .filter('href')
            .orderBy((reference) => {
                const position = ['ORIGINAL', 'DETAIL', 'LARGE', 'SMALL', 'CROPTOP'].indexOf(reference.representation);

                return position === -1 ? 0 : position;
            }, 'asc')
            .first()
            .value();
    }

    private async getBestAttachment(newsObject: BelgaNewsObject): Promise<null | string> {
        if (_.isEmpty(newsObject.attachments)) {
            return null;
        }

        const bestReference = this.getBestReference(newsObject);
        const repairedMimeType = this.repairMimeType(bestReference);
        const date = dayjs(newsObject.publishDate);

        try {
            return await this.uploadByUriForPrezly(
                bestReference.href,
                `${newsObject.subSource} - ${date.toString()}.${this.getExtensionForMimeType(repairedMimeType)}`,
                repairedMimeType,
            );
        } catch (error) {
            this.logger.warn(
                chalk.yellow(`Best attachment for ${newsObject.uuid} (${bestReference.href}) failed to download.`),
                [JSON.stringify({ newsObjectUuid: newsObject.uuid })],
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

            case 'm3u':
            case 'm3u8':
                return 'audio/x-mpequrl';

            default:
                this.logger.warn(chalk.yellow(`Unrecognized mime type: ${reference.mimeType}`));
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
