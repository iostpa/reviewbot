# is-a.dev reviewbot

This is the source code of the is-a.dev reviewbot! The bot uses [octokit.js](https://github.com/octokit/octokit.js) as the library.

## Requirements

- Bun and Node.js
- A GitHub App subscribed to **Pull Request**, **Workflow job** and **Workflow run** events with the following permissions:
  - Pull requests: Read & write
  - Metadata: Read-only
  - Actions: Read-only
- (For local development) A tunnel to expose your local server to the internet (e.g. [smee](https://smee.io/), [ngrok](https://ngrok.com/))
- Your GitHub App Webhook must be configured to receive events at a URL that is accessible from the internet.

## Setup

### Manual
1. Clone this repository.
2. Create a `.env` file similar to `.env.example` and set actual values.
3. Install dependencies with `bun`.
4. Start the server with `bun run server`.
5. Ensure your server is reachable from the internet.
    - If you're using `smee`, run `smee -u <smee_url> -t http://localhost:3000/api/webhook`.
6. Ensure your GitHub App includes at least one repository on its installations.

### Docker
1. Clone this repository.
2. Add the private-key.pem file to the same directory.
3. Create a `.env` file similar to `.env.example` and set actual values.
4. Run `sudo docker compose up -d`

## Contributing

Any contribution to the is-a.dev reviewbot is welcomed! If you have any suggestions or fixes that you want to make feel free to make a pull request or make a GitHub issue! To get it resolved faster you can contact me.