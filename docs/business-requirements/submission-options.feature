Feature: Submission upload options
  Submission option behavior should be specified as executable requirements
  because each route chooses a different DOCX extraction mode.

  Scenario: Upload Prior Approved DOCX strips imported redlines before editing
    Given a modification submission selected "Upload Prior Approved DOCX"
    When the approval baseline is loaded from the uploaded DOCX
    Then the approved DOCX extractor is used
    And imported redlines are stripped from the editable menu
    And reviewer edits add approval highlights

  Scenario: Upload Unapproved DOCX preserves imported redlines in the preview
    Given a modification submission selected "Upload Unapproved DOCX"
    When the approval baseline is loaded from the uploaded DOCX
    Then the unapproved DOCX extractor is used
    And imported redlines are preserved in the approval preview
    And the editable menu uses the clean accepted text
    And reviewer edits add approval highlights
