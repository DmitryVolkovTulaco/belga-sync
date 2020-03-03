declare namespace NodeJS {
    interface ProcessEnv {
        NODE_ENV: 'development' | 'production';
        SENTRY_DSN: string;
        BELGA_OIDC_WELL_KNOWN_URI: string;
        BELGA_API_BASE_URI: string;
        BELGA_CLIENT_ID: string;
        BELGA_CLIENT_SECRET: string;
        PREZLY_API_BASE_URI: string;
        PREZLY_ACCESS_TOKEN: string;
        UPLOADCARE_PUBLIC_KEY: string;
        UPLOADCARE_BASE_CDN_URI: string;
    }
}
