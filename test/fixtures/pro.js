// Tests that try Pro features run with a licence that is always Pro.
const License = require('../../src/license');
const proLicense = () => ({ pro: () => true, view: () => ({ pro: true, name: 'Test', kind: 'pro', until: null, expired: false, free: License.FREE, features: License.FEATURES, price: License.PRICE, shop: License.SHOP }), activate() { return this.view(); }, remove() { return this.view(); } });
module.exports = { proLicense };
