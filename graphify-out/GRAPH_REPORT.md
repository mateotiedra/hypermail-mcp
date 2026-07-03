# Graph Report - hyper-email-mcp-0  (2026-07-03)

## Corpus Check
- 76 files · ~42,278 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 651 nodes · 1523 edges · 26 communities (24 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dd35f6c9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]

## God Nodes (most connected - your core abstractions)
1. `AccountRecord` - 90 edges
2. `AccountStore` - 40 edges
3. `GmailProvider` - 25 edges
4. `OutlookProvider` - 24 edges
5. `ImapProvider` - 23 edges
6. `FolderInfo` - 21 edges
7. `EmailSummary` - 17 edges
8. `EmailFull` - 16 edges
9. `SendInput` - 15 edges
10. `compilerOptions` - 15 edges

## Surprising Connections (you probably didn't know these)
- `OpenOptions` --references--> `Logger`  [EXTRACTED]
  src/store/account-store.ts → src/logger.ts
- `registerHandler()` --calls--> `registerNewEmailTool()`  [EXTRACTED]
  src/tools/new-emails.test.ts → src/tools/new-emails.ts
- `registerHandlers()` --calls--> `registerAccountTools()`  [EXTRACTED]
  src/tools/accounts.test.ts → src/tools/accounts.ts
- `load()` --calls--> `loadConfig()`  [EXTRACTED]
  src/config.test.ts → src/config/load.ts
- `BuildRegistryOptions` --references--> `ProvidersConfig`  [EXTRACTED]
  src/providers/registry.ts → src/config.ts

## Import Cycles
- None detected.

## Communities (26 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (28): ParsedPayload, GmailProvider, ImapProvider, OutlookProvider, AttachmentInput, CompleteAddAccountInput, CompleteAddAccountResult, CreateFolderInput (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (60): Registry, ProviderId, ResolvedTools, htmlToMarkdown(), selectBody(), turndown, Logger, markdownToHtml() (+52 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (63): acquireAccessToken(), AuthorizationCodeBegin, AuthorizationCodeBeginOptions, AuthorizationCodeCompletionInput, base64Url(), beginAuthorizationCode(), buildOAuth2Client(), codeChallenge() (+55 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (45): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedTokens(), makeConfig() (+37 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (56): addAccount(), completeAddAccount(), extractTokens(), ImapClient, ImapClientFactory, ImapTokens, isImapTokens(), createFolder() (+48 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (40): envRaw(), loadConfig(), optionalEnvString(), parsePositiveInteger(), parseStringArray(), parseTransportEnv(), resolveDebugLogging(), resolveHttpConfig() (+32 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (23): GmailProviderOptions, OutlookProviderOptions, BuildRegistryOptions, AccountStore, compareTimestamp(), delay(), isAlreadyDelivered(), mergeNewEmailCheckpoints() (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (19): Add-account flows, As a hosted HTTP server, Claude Desktop / Claude Code, Development, Docker, Environment Variables, Generic MCP client JSON example, Gmail (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (14): bugs, url, description, engines, node, files, keywords, license (+6 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (17): createLogger(), CreateLoggerOptions, LogFields, noopLogger, sanitizeFields(), sanitizeValue(), NewEmailClaimCandidate, key (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.15
Nodes (12): 1. Create the Application, 2. Set the encryption key, 3. Configure persistent storage, 4. Add a domain, 5. Deploy, 6. Verify, Connecting clients, Deploy hypermail-mcp to Dokploy (+4 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (12): dependencies, @azure/msal-node, google-auth-library, googleapis, imapflow, isomorphic-fetch, marked, @microsoft/microsoft-graph-client (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (9): Any, call_get_new_emails(), call_get_new_emails_async(), load_hypermail_config(), main(), spawn_agent(), int, Path (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.20
Nodes (10): scripts, build, check, dev, dev:http, prepublishOnly, start, test (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (7): Commands, Dev Workflow, Environment, hypermail-mcp, Key Dependencies, Purpose, Structure

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (8): devDependencies, tsup, @types/isomorphic-fetch, @types/node, @types/nodemailer, @types/turndown, typescript, vitest

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (5): Docker (minimal), Hosting hypermail-mcp, Quick start, Required environment, Reverse proxies

### Community 22 - "Community 22"
Cohesion: 0.33
Nodes (5): Adapting the example, Expected Hermes config, Files, Hermes Hypermail poller example, How it works

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **140 isolated node(s):** `Why`, `Claude Desktop / Claude Code`, `As a hosted HTTP server`, `Docker`, `Development` (+135 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 10`?**
  _High betweenness centrality (0.183) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Community 6` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 10`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Community 16` to `Community 9`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `Why`, `Claude Desktop / Claude Code`, `As a hosted HTTP server` to the rest of the system?**
  _140 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05132317562149158 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06376726417866588 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05627705627705628 - nodes in this community are weakly interconnected._