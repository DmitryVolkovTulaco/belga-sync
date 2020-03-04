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
        if (loggingEvent.level === log4js.levels.INFO) {
            return;
        }

        const extra: log4js.LoggingEvent = {
            ...loggingEvent,
            data: loggingEvent.data.map((dataItem) => {
                if (typeof dataItem === 'string') {
                    return dataItem.replace(/\u001b\[.*?m/g, '');
                }

                return dataItem;
            }),
        };

        Sentry.captureEvent({
            message: `Belga Import - ${extra.data[0]}`,
            environment: process.env.NODE_ENV,
            level: log4jsLevelToSentrySeverity(extra.level),
            extra,
        });
    };
}

function log4jsLevelToSentrySeverity(level: log4js.Level): Sentry.Severity {
    switch (level.levelStr) {
        case 'DEBUG':
            return Sentry.Severity.Debug;
        case 'INFO':
            return Sentry.Severity.Info;
        case 'WARN':
            return Sentry.Severity.Warning;
        case 'ERROR':
            return Sentry.Severity.Error;
        default:
            throw new Error('Unable to map log4js level to Sentry severity.');
    }
}

export default {
    configure,
};
