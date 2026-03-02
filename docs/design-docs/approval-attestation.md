# Required Approval Attestation

**Status:** Complete

Submitters must attest that the menu has been reviewed and approved by management before submission.

## How It Works

- Select Yes/No for approval status
- Enter approver's first and last name
- Enter approver's position
- Option to add an additional approver if needed
- Submission cannot proceed unless the approval is marked "Yes"

## Approver Role Hints

The form displays hint text suggesting appropriate approver roles based on menu type:

- **Food menus:** Property GM, Director of F&B, Executive Chef, Chef de Cuisine
- **Beverage menus:** Head of Mixology, Bar Director, Regional Director of Operations
- **Non-beverage templates:** AI review is skipped and the submission can proceed directly after required attestations.

## Current Required Approval Behavior

### Menu submission form (`/form`)

- Requires one approval attestation (`Yes/No`, name, position)
- Optional second approver can be added
- Submission is blocked unless the required approver is `Yes`
- Works for `food`, `beverage`, and `non_beverage` template types

### Design approval (`/design-approval`)

- Includes a separate required approvals box with two defaults:
  - `RSH Culinary` (default `Yes`)
  - `RSH Regional` (default `Yes`)
- Comparison cannot run unless both are marked `Yes`
- Approval values are stored on the design-approval submission record

## Design Decision: Attestation-Based

This is an **attestation-based system**. We do NOT maintain a database of managers or positions. Submitters self-report who approved the menu. This was chosen for simplicity — the system trusts the chef's attestation rather than requiring a lookup against an org chart.
