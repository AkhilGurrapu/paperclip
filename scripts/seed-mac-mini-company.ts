import { createDb, companies } from "../packages/db/src/index.js";

const dbUrl = process.env.DATABASE_URL?.trim();
if (!dbUrl) {
  throw new Error("DATABASE_URL is required for seed-mac-mini-company.ts");
}

const companyName = process.env.MAC_MINI_COMPANY_NAME?.trim() || "aisarva-mac-mini";
const description =
  process.env.MAC_MINI_COMPANY_DESCRIPTION?.trim() ||
  "Mac Mini operator control plane for Aisarva infrastructure.";
const preferredPrefix = sanitizePrefix(process.env.MAC_MINI_ISSUE_PREFIX || "MMI");

function sanitizePrefix(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  return normalized || "MMI";
}

function isIssuePrefixConflict(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  return record.code === "23505" && record.constraint === "companies_issue_prefix_idx";
}

async function main() {
  const db = createDb(dbUrl!);
  const closableDb = db as typeof db & {
    $client?: {
      end?: (options?: { timeout?: number }) => Promise<void>;
    };
  };

  try {
    const existing = await db
      .select({ id: companies.id, name: companies.name, issuePrefix: companies.issuePrefix })
      .from(companies)
      .then((rows) => rows.find((company) => company.name === companyName) ?? null);

    if (existing) {
      console.log(
        JSON.stringify({
          status: "exists",
          companyId: existing.id,
          name: existing.name,
          issuePrefix: existing.issuePrefix,
        }),
      );
      return;
    }

    const candidatePrefixes = Array.from(
      new Set([
        preferredPrefix,
        "MMI",
        "MAC",
        "AIS",
        `${preferredPrefix}A`,
        `${preferredPrefix}B`,
      ]),
    );

    for (const issuePrefix of candidatePrefixes) {
      try {
        const created = await db
          .insert(companies)
          .values({
            name: companyName,
            description,
            status: "active",
            issuePrefix,
            budgetMonthlyCents: 0,
            spentMonthlyCents: 0,
            requireBoardApprovalForNewAgents: true,
          })
          .returning({ id: companies.id, name: companies.name, issuePrefix: companies.issuePrefix })
          .then((rows) => rows[0]);

        console.log(
          JSON.stringify({
            status: "created",
            companyId: created.id,
            name: created.name,
            issuePrefix: created.issuePrefix,
          }),
        );
        return;
      } catch (error) {
        if (isIssuePrefixConflict(error)) continue;
        throw error;
      }
    }

    throw new Error(`Could not allocate an issue prefix for ${companyName}`);
  } finally {
    await closableDb.$client?.end?.({ timeout: 5 }).catch(() => undefined);
  }
}

await main();
