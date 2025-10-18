# Menu Manager

Menu Manager is an AI-powered service designed to automate the review process for menu design submissions. It monitors an email inbox for new submissions, validates them against a template, uses AI to review the content, and sends notifications back to the submitter.

## Project Architecture

This project is structured as a **monorepo** using npm workspaces, containing several independent microservices. This architecture was chosen to separate concerns, allowing each service to be developed, deployed, and scaled independently.

### The Review Workflow
The service operates on an intelligent, multi-tier review process that combines AI analysis with essential human oversight to ensure the highest quality feedback.

1.  **Template Validation**: The `parser` service first validates that the submission is a `.docx` file and conforms to the required template structure (e.g., correct headings). If it fails, the process stops, and the user is notified before any AI analysis is performed.

2.  **Tier 1 AI Review (General QA)**: If the template is valid, the `ai-review` service performs a high-level check using a general prompt defined in the company SOP. It looks for common errors in spelling, grammar, clarity, and consistency.

3.  **Decision Point**: The system analyzes the output of the Tier 1 review. If a significant number of high-level issues are found, the submission is considered not yet ready for detailed correction. The `notifier` service sends an email to the user with only this high-level feedback, asking them to resubmit a corrected version.

4.  **Tier 2 AI Review (Draft Generation)**: If the submission passes the Tier 1 check, it proceeds to an intensive review. A second AI prompt instructs the model to correct the entire document based on the specific, structured rules in `sop_rules.json`. This process generates a draft version of the red-lined `.docx` document.

5.  **Human-in-the-Loop (HITL) Approval**: This is a critical quality control step.
    *   **Internal Notification**: Instead of being sent automatically to the chef, the AI-generated draft is held, and an internal notification is sent to a designated company reviewer.
    *   **Review Dashboard**: The reviewer is directed to a dashboard where they can download both the original submission and the AI's red-lined draft.
    *   **Final Edits**: The reviewer makes any final corrections or additions to the AI's work and uploads the final, human-approved version back to the system.

6.  **Learning & Improvement**: After the human reviewer submits the final version, the system performs a comparison between the AI's draft and the human-approved document. The differences are logged to create a valuable dataset that will be used to fine-tune and improve the AI model over time, reducing the need for future corrections.

7.  **Final Notification to Chef**: Once the final version is uploaded and approved by the human reviewer, the `notifier` service sends the notification email to the original chef, attaching the fully-vetted and approved red-lined `.docx` document.

### Services

The monorepo contains the following services located in the `services/` directory:

-   **`inbound-email`**: Monitors a Microsoft Outlook mailbox. When a valid email arrives, it downloads the `.docx` attachment and forwards it to the `parser` service.
-   **`parser`**: Validates the file type and template structure. If successful, it extracts the text and passes it to the `ai-review` service.
-   **`ai-review`**: Orchestrates the two-tier AI review. It runs a general QA check, and if the submission is high quality, proceeds to generate a red-lined draft for human review.
-   **`notifier`**: Handles all email communications. It sends Tier 1 feedback to chefs, internal notifications to reviewers, and the final, human-approved document back to the original chef.
-   **`db`**: Stores submission data, review status, and paths to the original, AI-drafted, and final approved documents.
-   **`dashboard`**: A web interface for internal reviewers to see pending reviews, download documents, and upload the final approved versions. Access at http://localhost:3005
-   **`differ`**: A service responsible for comparing the AI draft with the final human-approved version and logging the differences for future model training.

## SOP Processing

A separate directory, `sop-processor`, contains Python scripts and data files for converting the human-readable SOP document into machine-readable formats (`sop_rules.json`, `qa_prompt.txt`). See the `README.md` within that directory for more details.

## Getting Started

### Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Follow the detailed setup guides:**
   - **[GET-STARTED-NOW.md](./GET-STARTED-NOW.md)** - Step-by-step setup instructions
   - **[DASHBOARD-GUIDE.md](./DASHBOARD-GUIDE.md)** - Dashboard & human review workflow
   - **[WORKFLOW-GUIDE.md](./WORKFLOW-GUIDE.md)** - Complete email processing workflow
   - **[BEVERAGE-SUPPORT.md](./BEVERAGE-SUPPORT.md)** - Food & beverage template support
   - **[QUICK-START.md](./QUICK-START.md)** - Fast reference guide

### Prerequisites

-   Node.js (v18 or higher recommended)
-   npm (v7 or higher for workspace support)
-   Access to:
    -   Microsoft Azure for Graph API credentials
    -   An SMTP server for sending emails
    -   An OpenAI API key
    -   ngrok (for local testing)


### Environment Variables

To run this project, you will need to create a `.env` file in the root directory and add the following environment variables:

```
GRAPH_CLIENT_ID=...
GRAPH_CLIENT_SECRET=...
GRAPH_TENANT_ID=...
GRAPH_MAILBOX_ADDRESS=designapproval@richardsandoval.com
APPROVED_SENDER_DOMAINS=example.com,anotherexample.com
SMTP_HOST=...
SMTP_USER=...
SMTP_PASS=...
STORAGE_BUCKET=...
DATABASE_URL=...
OPENAI_API_KEY=...
SOP_DOC_PATH=samples/sop.txt
```

### Building the Project

To compile the TypeScript code for all services, run the following command from the root directory:
```bash
npm run build --workspaces
```

### Running the Services

Each service can be started individually from the root directory.

-   **Start the inbound-email service:**
    ```bash
    npm start --workspace=@menumanager/inbound-email
    ```

-   **Start the parser service:**
    ```bash
    npm start --workspace=@menumanager/parser
    ```

-   **Start the ai-review service:**
    ```bash
    npm start --workspace=@menumanager/ai-review
    ```

-   **Start the notifier service:**
    ```bash
    npm start --workspace=@menumanager/notifier
    ```

-   **Start the db service:**
    ```bash
    npm start --workspace=@menumanager/db
    ```

### Running Tests

To run all the unit tests for the project, use the following command from the root directory:
```bash
npm test
```
