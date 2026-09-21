const { validateDeliveryIdentity } = require('../lib/code-proposal-delivery-identity');
const digest = (char) => `${char}`.repeat(64);
test('delivery identity is separate and hash-bound', () => {
    const identity = validateDeliveryIdentity({ delivery_image_id: digest('a'), delivery_runtime_id: digest('b'), delivery_driver_sha256: digest('c'), delivery_source_sha256: digest('d'), browser_version: 'Chromium 148', quill_version: '1.3.6' });
    expect(identity.identity_sha256).toHaveLength(64);
    expect(() => validateDeliveryIdentity({ ...identity, quill_version: '' })).toThrow();
});
