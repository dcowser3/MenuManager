'use strict';
const crypto = require('crypto');
const DIGEST = /^(?:sha256:)?[a-f0-9]{64}$/;
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function validateDeliveryIdentity(identity) {
    if (!identity || !DIGEST.test(`${identity.delivery_image_id || ''}`) || !DIGEST.test(`${identity.delivery_runtime_id || ''}`)
        || !DIGEST.test(`${identity.delivery_driver_sha256 || ''}`) || !DIGEST.test(`${identity.delivery_source_sha256 || ''}`)
        || typeof identity.browser_version !== 'string' || typeof identity.quill_version !== 'string') throw new Error('Delivery identity is incomplete.');
    const { identity_sha256: claimed, ...body } = identity;
    const computed = hash(body);
    if (claimed !== undefined && claimed !== computed) throw new Error('Delivery identity hash mismatch.');
    return Object.freeze({ ...body, identity_sha256: computed });
}
module.exports = { validateDeliveryIdentity };
