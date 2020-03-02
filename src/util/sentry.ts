import * as Sentry from '@sentry/node';
import log4js from 'log4js';

interface Log4jsSentryConfiguration {
    dsn: string;
}

function configure(config: Log4jsSentryConfiguration) {
    Sentry.init({
        dsn: config.dsn,
    });

    return function(loggingEvent: log4js.LoggingEvent) {
        Sentry.captureEvent({
            environment: process.env.NODE_ENV,
            extra: loggingEvent,
        });
    };
}

export default {
    configure,
};
