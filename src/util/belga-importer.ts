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

    public async importNewsObjects(belgaBoardUuid: string, prezlyNewsroomId: number, start: string, offset = 0) {
        console.log(start);
        const query = {
            board: belgaBoardUuid,
            order: 'publishDate',
            start,
            //start, //default is 7 days
            //end: '2019-12-01',
            //start: '2020-10-02',
            //end: '2020-10-03',
            count: 50,
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

        this.logger.info(
            chalk.gray(`Search for records with same external_id`),
        );

        const existingCoverage = await retry(
            2,
            async () => await this.prezly.coverage.getByExternalReferenceId(newsObjectUuid),
        );

        if (existingCoverage) {
            this.logger.info(
                chalk.gray(`Belga news object ${newsObjectUuid} has already been synced. Skipping`),
            );

            return;
        }

        this.logger.info(chalk.grey(`Getting full news object ${newsObjectUuid}.`));
        const newsObject: BelgaNewsObject = this.cleanNewsObject(
            await retry(10, async () => await this.belga.get(`/newsobjects/${newsObjectUuid}`)),
        );

        let newCoverage = await this.belgaNewsObjectToCoverage(newsObject);
        if (!newCoverage) {
            this.logger.info(
                chalk.grey(
                    `Belga news object ${newsObjectUuid} - ${newsObject.mediumTypeGroup} ${newsObject.mediumType} - ${newsObject.title} is not supported.`,
                ),
            );

            return;
        }

        newCoverage.newsroom = newsroomId;

        // search for the same item already synced from staging
        let query: any;

        // probably here I need to check if it was made by the integration (and not in interface/manually)
        query = {
            "url": newCoverage.url,
            "newsroom.id": { '$in': { newsroomId }},
            "external_reference_id": { '$ne' : newsObject.uuid }
        };
        if (newsObject.mediumTypeGroup === BelgaMediumTypeGroup.Print) {
            let publishedDate = newCoverage.published_at ? newCoverage.published_at.split('T')[0] : "";
            query = {
                "$and": [
                    { "headline": newCoverage.headline?.trim },
                    { "published_at": {"$ge": publishedDate + " 00:00:00"} },
                    { "published_at": {"$le": publishedDate + " 23:59:59"} },
                    { "newsroom.id": {'$in': [ newsroomId ]} },
                    { "external_reference_id": {"$ne": newsObject.uuid }}
                ]
            };
        }

        // console.log(query);
        // console.log(JSON.stringify(query));

        const CoverageItemCollectionSyncedFromStaging = await retry(
            2,
            async () => await this.prezly.coverage.list({
                includeDeleted: true,
                pageSize: 1,
                jsonQuery: JSON.stringify(query),
            }),
        );

        this.logger.info(
            chalk.yellowBright(`Found #${CoverageItemCollectionSyncedFromStaging.coverage.length} items that look the same from staging data`),
        );

        const CoverageItemSyncedFromStaging = CoverageItemCollectionSyncedFromStaging.coverage[0] ?? null;
        if (CoverageItemSyncedFromStaging) {

            this.logger.info(
                chalk.yellowBright(`Copying newsitem #${CoverageItemSyncedFromStaging.id} into new one`),
            );

            const { author_contact, organisation_contact, newsroom, story, published_at, note_content_json } = CoverageItemSyncedFromStaging;

            // merge everything in from old newsobject
            newCoverage = {
                ...newCoverage,
                external_reference_id: newsObject.uuid,
                author: author_contact?.id,
                organisation: organisation_contact?.id,
                newsroom: newsroom?.id,
                story: story?.id,
                published_at,
                note_content: note_content_json
            }
        }

        this.logger.info(
            chalk.green(
                `Syncing Belga news object ${newsObjectUuid} - ${newsObject.mediumTypeGroup} ${newsObject.mediumType} - (${newsObject.title}).`,
            ),
        );

        try {
            if (newCoverage) {
                const createdCoverage = await retry(
                    2,
                    async () => await this.prezly.coverage.create(<CoverageCreateRequest>newCoverage),
                );

                this.logger.info(
                    chalk.greenBright(`Belga news object ${newsObjectUuid} (${newsObject.title}) synced!`),
                );

                if (CoverageItemSyncedFromStaging && !CoverageItemSyncedFromStaging.is_deleted) {
                    this.logger.info(
                        chalk.yellowBright(`Remove previous staging coverage item ${CoverageItemSyncedFromStaging.id}`),
                    );

                    await this.prezly.coverage.remove(CoverageItemSyncedFromStaging.id);
                }

                if (CoverageItemSyncedFromStaging && CoverageItemSyncedFromStaging.is_deleted) {
                    this.logger.info(
                        chalk.yellowBright(`Staging item #${CoverageItemSyncedFromStaging.id} was deleted, so marking the new as deleted too`),
                    );

                    await this.prezly.coverage.remove(createdCoverage.id);
                }
            }
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
                this.logger.error(chalk.red('Error creating coverage'), [
                    'Error ' + JSON.stringify(error, null, 4),
                    'New coverage ' + JSON.stringify(newCoverage, null, 4),
                ]);

                return;
            }

            if (error.status === 422) {
                this.logger.error(chalk.red('API rejected coverage data'), [
                    'Belga news object ' + JSON.stringify({ newsObjectUuid, error }, null, 4),
                    'New coverage ' + JSON.stringify(newCoverage, null, 4),
                ]);

                return;
            }

            if (error.status === 409) {
                // note: This can often happen when a record is created successfully, but some subsequent server-side operation fails in the same request.
                this.logger.error(
                    chalk.red(`Conflict when attempting to create coverage record for ${newsObjectUuid}`),
                    [JSON.stringify({ newsObjectUuid }, null, 4)],
                );

                return;
            }

            if (!error.status) {
                this.logger.error(chalk.yellow(`Timeout trying to create coverage record for ${newsObjectUuid}.`), [
                    JSON.stringify({ newsObjectUuid }, null, 4),
                ]);

                // eat all errors
                this.logger.error(
                    chalk.red(error),
                );

                return;
            }

            throw error;
        }
    }

    private cleanNewsObject(newsObject: BelgaNewsObject) {
        return {
            ...newsObject,
            title: newsObject.title?.replace(/\n/, ''),
        };
    }

    private async belgaNewsObjectToCoverage(newsObject: BelgaNewsObject): Promise<null | CoverageCreateRequest> {
        switch (newsObject.mediumTypeGroup) {
            case BelgaMediumTypeGroup.Print:
                return this.belgaPrintNewsObjectToCoverage(newsObject);
            case BelgaMediumTypeGroup.Social:
                return this.belgaSocialNewsObjectToCoverage(newsObject);
            case BelgaMediumTypeGroup.Online:
                return this.belgaOnlineNewsObjectToCoverage(newsObject);
            case BelgaMediumTypeGroup.Multimedia:
                return this.belgaMultimediaNewsObjectToCoverage(newsObject);
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
        if (newsObject.authors.length && newsObject.authors[0]!.trim()) {
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
                    //store: process.env.NODE_ENV === 'production',
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
