import { TokenSet, Client } from 'openid-client';
import querystring from 'querystring';
import dayjs from 'dayjs';
import chalk from 'chalk';
import log4js from 'log4js';
import { retry } from './retry';

export class BelgaSdk {
    private token?: null | TokenSet;

    public constructor(private logger: log4js.Logger, private client: Client, private baseUri: string) {}

    public async get<DataType = any>(baseEndpoint: string): Promise<DataType> {
        await this.ensureToken();

        const response = await this.client.requestResource(
            `${this.baseUri}${baseEndpoint}`,
            this.token!.access_token!,
            {
                method: 'GET',
                body: '',
                headers: {
                    'X-Belga-Context': 'SEARCH',
                },
            },
        );

        return JSON.parse(response.body.toString());
    }

    public async chunk<DataType = any>(
        baseEndpoint: string,
        query: any,
        callback: (data: BelgaPaginationResponse<DataType>) => Promise<void>,
    ) {
        const queryString = querystring.encode(query);

        let nextUri: string = `${this.baseUri}${baseEndpoint}?${queryString}`;

        do {
            this.logger.info(chalk.whiteBright(`Currently on: ${nextUri}`));

            await retry(3, async () => await this.ensureToken());

            const response = await retry(10, () =>
                this.client.requestResource(nextUri, this.token!.access_token!, {
                    method: 'GET',
                    body: '',
                    headers: {
                        'X-Belga-Context': 'SEARCH',
                    },
                }),
            );

            if (response.statusCode >= 400) {
                const responseJson = JSON.stringify(JSON.parse(response.body.toString()), null, 4);

                throw new Error(`Error response from Belga: \n ${responseJson}`);
            }

            const data = JSON.parse(response.body.toString());
            nextUri = data._links?.next;

            await callback(data);
        } while (nextUri);
    }

    private async ensureToken() {
        if (!this.token) {
            this.token = await this.client.grant({
                grant_type: 'client_credentials',
            });

            return;
        }

        const now = dayjs();
        const tokenExpiry = dayjs.unix(this.token?.expires_at!);

        if (tokenExpiry.isBefore(now)) {
            await this.refreshAccessToken();
        }
    }

    // note: We're going to have tokens expire as we're using them (paginating long result sets).
    private async refreshAccessToken(): Promise<void> {
        if (this.client) {
            this.logger.info(chalk.white('Refreshing Belga access token.'));

            try {
                this.token = await this.client.refresh(this.token!);
            } catch (error) {
                this.logger.warn(chalk.yellow('There was an issue refreshing the Belga access token.'), [
                    JSON.stringify(error, null, 4),
                ]);

                // note: If token renew fails, just nuke & pave it. 💥
                this.token = null;

                await this.ensureToken();
            }
        }

        this.logger.info(chalk.yellow('Refreshed Belga access token!'));
    }
}

export interface BelgaPaginationResponse<DataType = any> {
    data: DataType[];
    _links: {
        next?: string;
        self: string;
    };
    _meta: {
        total: number;
    };
}

const enum BelgaMediumType {
    Website = 'WEBSITE',
}

export const enum BelgaMediumTypeGroup {
    Print = 'PRINT',
    Online = 'ONLINE',
    Social = 'SOCIAL',
    Multimedia = 'MULTIMEDIA',
}

export const enum BelgaAttachmentType {
    Page = 'Page',
    Webpage = 'Webpage',
    Twitter = 'Twitter',
    Rtv = 'Rtv',
}

export interface BelgaAttachmentReference {
    mimeType: string;
    representation: 'ORIGINAL' | 'DETAIL' | 'LARGE' | 'SMALL';
    href: string;
}

export interface BelgaAttachment {
    title: null | string;
    type: BelgaAttachmentType;
    date: string;
    source: null | any;
    from: number;
    to: number;
    duration: number;
    references: BelgaAttachmentReference[];
}

// todo: Ensure non-nullable fields are in fact non-nullable.
// todo: Get types for `any[]`s and `any`s
export interface BelgaNewsObject {
    uuid: string;
    title: string;
    lead: string;
    body: null | string;
    createDate: null | string;
    publishDate: string;
    sourceLogo: null | string;
    source: null | string;
    sourceGroup: null | any;
    mediumType: BelgaMediumType;
    mediumTypeGroup: BelgaMediumTypeGroup;
    subSource: string;
    editions: any[];
    keywords: any[];
    page: number;
    language: string;
    authors: string[];
    attachments: BelgaAttachment[];
    wordCount: number;
    account: any;
    sentiment: any;
    mediaValue: any;
    audience: number;
    subSourceId: number;
    sourceGroupId: 0;
    subSourceGroupId: 0;
    mediumTypeId: 3;
    mediumTypeGroupId: 2;
    sourceId: 18;
    publisher: null;
    categories: [];
    entities: [];
    topic: null;
    tags: [];
    duplicates: 0;
}
