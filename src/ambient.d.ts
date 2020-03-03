declare namespace NodeJS {
    interface ProcessEnv {
        NODE_ENV: 'development' | 'production';
        SENTRY_DSN: string;
        BELGA_OIDC_WELL_KNOWN_URI: string;
        BELGA_API_BASE_URI: string;
        PREZLY_API_BASE_URI: string;
        UPLOADCARE_PUBLIC_KEY: string;
        UPLOADCARE_BASE_CDN_URI: string;
    }
}
