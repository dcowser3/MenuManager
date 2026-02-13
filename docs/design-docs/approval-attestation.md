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

## Design Decision: Attestation-Based

This is an **attestation-based system**. We do NOT maintain a database of managers or positions. Submitters self-report who approved the menu. This was chosen for simplicity — the system trusts the chef's attestation rather than requiring a lookup against an org chart.
