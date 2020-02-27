import { TokenSet, Client } from 'openid-client';
import querystring from 'querystring';
import dayjs from 'dayjs';
import chalk from 'chalk';

export class BelgaSdk {
    private token?: null | TokenSet;

    public constructor(private client: Client, private baseUri: string) {}

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
        let retries = 0;

        do {
            await this.ensureToken();

            try {
                const response = await this.client.requestResource(nextUri, this.token!.access_token!, {
                    method: 'GET',
                    body: '',
                    headers: {
                        'X-Belga-Context': 'SEARCH',
                    },
                });

                const data = JSON.parse(response.body.toString());
                nextUri = data!._links.next;

                await callback(data!);

                retries = 0;
            } catch (error) {
                ++retries;

                if (retries >= 3) {
                    throw error;
                }
            }
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
    private async refreshAccessToken() {
        if (this.client) {
            this.token = await this.client.refresh(this.token!);
        }

        console.log(chalk.yellow('Refreshed Belga access token!'));
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

const enum BelgaMediumTypeGroup {
    Online = 'ONLINE',
}

const enum BelgaAttachmentType {
    Webpage = 'Webpage',
}

interface BelgaAttachment {
    title: null | string;
    type: BelgaAttachmentType;
    date: string;
    source: null | any;
    from: number;
    to: number;
    duration: number;
    references: {
        mimeType: 'NOT_SPECIFIED';
        representation: 'ORIGINAL';
        href: string;
    }[];
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
    authors: any[];
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
