import { Octokit } from "octokit";
import { config } from "../config.js";

const octokit = new Octokit({ auth: config.GITHUB_TOKEN });

export async function checkRepoAccess(): Promise<void> {
  await octokit.rest.repos.get({ owner: config.githubOwner, repo: config.githubRepo });
}

export interface PublishFile {
  path: string;
  content: string;
}

const MAX_RETRIES = 3;

/** Atomically commits multiple files in one commit via the Git Data API. */
export async function publishFiles(files: PublishFile[], message: string): Promise<string> {
  const owner = config.githubOwner;
  const repo = config.githubRepo;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data: ref } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: "heads/main",
      });
      const baseSha = ref.object.sha;

      const { data: baseCommit } = await octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: baseSha,
      });

      const blobs = await Promise.all(
        files.map(async (f) => {
          const { data: blob } = await octokit.rest.git.createBlob({
            owner,
            repo,
            content: Buffer.from(f.content, "utf-8").toString("base64"),
            encoding: "base64",
          });
          return { path: f.path, sha: blob.sha };
        }),
      );

      const { data: tree } = await octokit.rest.git.createTree({
        owner,
        repo,
        base_tree: baseCommit.tree.sha,
        tree: blobs.map((b) => ({
          path: b.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: b.sha,
        })),
      });

      const { data: commit } = await octokit.rest.git.createCommit({
        owner,
        repo,
        message,
        tree: tree.sha,
        parents: [baseSha],
      });

      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: "heads/main",
        sha: commit.sha,
      });

      return commit.sha;
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error("unreachable");
}
