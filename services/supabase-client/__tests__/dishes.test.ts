jest.mock('../src/client', () => ({
    getSupabaseClient: jest.fn(),
}));

import { getSupabaseClient } from '../src/client';
import { replaceDishesForSubmission } from '../src/dishes';

const mockedGetSupabaseClient = getSupabaseClient as jest.Mock;

describe('approved dish storage', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('replacement deactivates existing submission rows before inserting the new extraction', async () => {
        const deactivateEq = jest.fn().mockResolvedValue({ error: null });
        const update = jest.fn(() => ({ eq: deactivateEq }));
        const select = jest.fn().mockResolvedValue({
            data: [
                {
                    id: 'dish-1',
                    dish_name: 'Guacamole',
                    dish_name_normalized: 'guacamole',
                    is_active: true,
                    created_at: '2026-05-28T00:00:00.000Z',
                },
            ],
            error: null,
        });
        const insert = jest.fn(() => ({ select }));
        const from = jest
            .fn()
            .mockReturnValueOnce({ update })
            .mockReturnValueOnce({ insert });

        mockedGetSupabaseClient.mockReturnValue({ from });

        const result = await replaceDishesForSubmission('sub-1', [
            {
                dish_name: 'Guacamole',
                property: 'Tamayo - Denver',
                source_submission_id: 'sub-1',
            },
        ]);

        expect(result).toHaveLength(1);
        expect(from).toHaveBeenNthCalledWith(1, 'approved_dishes');
        expect(update).toHaveBeenCalledWith({ is_active: false });
        expect(deactivateEq).toHaveBeenCalledWith('source_submission_id', 'sub-1');
        expect(from).toHaveBeenNthCalledWith(2, 'approved_dishes');
        expect(insert).toHaveBeenCalledWith([
            expect.objectContaining({
                dish_name: 'Guacamole',
                dish_name_normalized: 'guacamole',
                source_submission_id: 'sub-1',
            }),
        ]);
    });
});
