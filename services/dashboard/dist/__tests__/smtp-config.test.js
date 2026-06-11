"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const smtp_config_1 = require("../lib/smtp-config");
describe('smtp runtime config', () => {
    test('login mode requires host, user, and password', () => {
        expect((0, smtp_config_1.buildSmtpRuntimeConfig)({ SMTP_HOST: 'smtp.example.com' }).enabled).toBe(false);
        const config = (0, smtp_config_1.buildSmtpRuntimeConfig)({
            SMTP_HOST: 'smtp.example.com',
            SMTP_USER: 'mailer@example.com',
            SMTP_PASS: 'secret',
        });
        expect(config.enabled).toBe(true);
        expect(config.transportOptions).toMatchObject({
            host: 'smtp.example.com',
            port: 587,
            auth: { user: 'mailer@example.com', pass: 'secret' },
        });
    });
    test('auth none mode needs only a host and defaults to port 25 with TLS required', () => {
        const config = (0, smtp_config_1.buildSmtpRuntimeConfig)({ SMTP_AUTH: 'none', SMTP_HOST: 'relay.example.com' });
        expect(config.enabled).toBe(true);
        expect(config.transportOptions).toMatchObject({ host: 'relay.example.com', port: 25, requireTLS: true });
        expect(config.transportOptions.auth).toBeUndefined();
    });
    test('bounds connection setup so an unreachable relay fails fast instead of hanging', () => {
        const config = (0, smtp_config_1.buildSmtpRuntimeConfig)({
            SMTP_HOST: 'smtp.example.com',
            SMTP_USER: 'mailer@example.com',
            SMTP_PASS: 'secret',
        });
        expect(config.transportOptions).toMatchObject({
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 60000,
        });
    });
});
