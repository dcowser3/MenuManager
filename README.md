# Menu Manager

Menu Manager is an AI-powered service designed to automate the review process for menu design submissions. It monitors an email inbox for new submissions, validates them against a template, uses AI to review the content, and sends notifications back to the submitter.

## Project Architecture

This project is structured as a **monorepo** using npm workspaces, containing several independent microservices. This architecture was chosen to separate concerns, allowing each service to be developed, deployed, and scaled independently.

### Services

The monorepo contains the following services located in the `services/` directory:

-   **`inbound-email`**: Monitors a Microsoft Outlook mailbox using the Graph API. When a new email with a `.docx` attachment arrives, it downloads the attachment and forwards it to the `parser` service.
-   **`parser`**: Receives `.docx` files, validates them against a predefined template (checking for required headings, fields, etc.), and extracts the text content. If validation passes, the content is sent to the `ai-review` service.
-   **`ai-review`**: Takes the parsed text, constructs a prompt including company SOPs and few-shot examples, and sends it to the OpenAI API for review. It returns a structured JSON object with the results.
-   **`notifier`**: Receives the review results from the `ai-review` service. It sends an email to the original submitter, either with a list of issues if changes are required, or with a corrected, red-lined document attached.
-   **`db`**: A simple service for storing submission and report data. For this implementation, it uses a file-based JSON database for simplicity, but can be replaced with a more robust database solution.

## Getting Started

### Prerequisites

-   Node.js (v18 or higher recommended)
-   npm (v7 or higher for workspace support)
-   Access to:
    -   Microsoft Azure for Graph API credentials
    -   An SMTP server for sending emails
    -   An OpenAI API key

### Installation and Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd MenuManager
    ```

2.  **Install dependencies:**
    This command will install dependencies for the root project and all the services in the monorepo.
    ```bash
    npm install
    ```

3.  **Create and configure the environment file:**
    Create a `.env` file in the root of the project by copying the example. Then, fill in your credentials.
    ```bash
    cp .env.example .env
    ```
    *Note: If `.env.example` does not exist, create `.env` manually with the variables listed below.*


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
