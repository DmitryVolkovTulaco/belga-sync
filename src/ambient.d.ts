declare namespace NodeJS {
    interface ProcessEnv {
        NODE_ENV: 'development' | 'production';
        BELGA_OIDC_WELL_KNOWN_URI: string;
        BELGA_API_BASE_URI: string;
        PREZLY_API_BASE_URI: string;
    }
}
