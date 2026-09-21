'use strict';

const fs = require('fs');
const path = require('path');

test('RPC migration is restricted and updates only the two target fields', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/20260921_add_contextual_descriptor_reconciliation_rpc.sql'), 'utf8');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reconcile_contextual_descriptor_proposal/);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/locked_xmin <> p_expected_xmin/);
    expect(sql).toMatch(/p\.xmin::text INTO locked, locked_xmin/);
    expect(sql).toMatch(/to_jsonb\(locked\) - 'xmin'/);
    expect(sql).toMatch(/SET proposed_rules = p_new_proposed_rules,\s+correction_routing = p_new_correction_routing/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION .* TO service_role/);
    expect(sql).not.toMatch(/SET eval_summary/);
});
