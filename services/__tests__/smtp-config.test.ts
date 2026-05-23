import { buildSmtpRuntimeConfig as buildDashboardSmtpRuntimeConfig } from '../dashboard/lib/smtp-config';
import { buildSmtpRuntimeConfig as buildClickUpSmtpRuntimeConfig } from '../clickup-integration/lib/smtp-config';
import { buildSmtpRuntimeConfig as buildNotifierSmtpRuntimeConfig } from '../notifier/src/smtp-config';

const builders = [
    ['dashboard', buildDashboardSmtpRuntimeConfig],
    ['clickup-integration', buildClickUpSmtpRuntimeConfig],
    ['notifier', buildNotifierSmtpRuntimeConfig],
] as const;

describe.each(builders)('%s SMTP config', (_serviceName, buildSmtpRuntimeConfig) => {
    test('supports Microsoft 365 IP relay without SMTP auth', () => {
        const config = buildSmtpRuntimeConfig({
            SMTP_AUTH: 'none',
            SMTP_HOST: 'richardsandoval-com.mail.protection.outlook.com',
            SMTP_PORT: '25',
            SMTP_FROM: 'no-reply@richardsandoval.com',
        });

        expect(config.enabled).toBe(true);
        expect(config.authMode).toBe('none');
        expect(config.fromAddress).toBe('no-reply@richardsandoval.com');
        expect(config.transportOptions).toEqual({
            host: 'richardsandoval-com.mail.protection.outlook.com',
            port: 25,
            secure: false,
            requireTLS: true,
        });
    });

    test('keeps authenticated SMTP behavior when SMTP_AUTH is unset', () => {
        const config = buildSmtpRuntimeConfig({
            SMTP_HOST: 'smtp.office365.com',
            SMTP_USER: 'sender@example.com',
            SMTP_PASS: 'secret',
        });

        expect(config.enabled).toBe(true);
        expect(config.authMode).toBe('login');
        expect(config.fromAddress).toBe('sender@example.com');
        expect(config.transportOptions).toEqual({
            host: 'smtp.office365.com',
            port: 587,
            secure: false,
            auth: {
                user: 'sender@example.com',
                pass: 'secret',
            },
        });
    });

    test('does not enable credential SMTP without both username and password', () => {
        const config = buildSmtpRuntimeConfig({
            SMTP_HOST: 'smtp.office365.com',
            SMTP_USER: 'sender@example.com',
        });

        expect(config.enabled).toBe(false);
        expect(config.transportOptions).toBeNull();
    });
});
