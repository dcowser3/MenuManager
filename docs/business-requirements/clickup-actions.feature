Feature: ClickUp action rules
  Business-readable ClickUp rules should be executable so workflow edge cases
  are captured before service code changes.

  Scenario: Normal chef review completion routes the task to Marketing
    Given a Menu Manager submission for "chef@example.com" is waiting for reviewer corrections
    When the ClickUp task moves from "pending initial isa review" to "approved"
    Then the approval webhook finalizes the corrected DOCX
    And ClickUp Marketing is assigned
    And ClickUp task status is moved to "to do"

  Scenario: Normal chef review completion already in the post-approval status
    Given a Menu Manager submission for "chef@example.com" is waiting for reviewer corrections
    When the ClickUp task moves from "approved" to "to do"
    Then the approval webhook finalizes the corrected DOCX
    And ClickUp Marketing is assigned
    And ClickUp task status is not moved again

  Scenario: Isabella direct handoff is not reprocessed after a manual status move
    Given a Menu Manager submission for "isabella@richardsandoval.com" is already marked "sent_to_marketing"
    When the ClickUp task moves from "to do" to "approved"
    Then the approval webhook skips reprocessing the submission
    And ClickUp task status and assignees are not mutated
