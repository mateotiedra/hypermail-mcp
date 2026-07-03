# Graph Report - hyper-email-mcp-1  (2026-07-03)

## Corpus Check
- 73 files · ~40,816 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 630 nodes · 1476 edges · 30 communities (28 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `23abe9f0`
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
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
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
1. `AccountRecord` - 87 edges
2. `AccountStore` - 39 edges
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
- `main()` --calls--> `startServer()`  [EXTRACTED]
  src/cli.ts → src/server.ts
- `load()` --calls--> `loadConfig()`  [EXTRACTED]
  src/config.test.ts → src/config/load.ts
- `BuildRegistryOptions` --references--> `ProvidersConfig`  [EXTRACTED]
  src/providers/registry.ts → src/config.ts

## Import Cycles
- None detected.

## Communities (30 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (29): ParsedPayload, GmailProvider, ImapProvider, OutlookProvider, AttachmentContent, AttachmentInput, CompleteAddAccountInput, CompleteAddAccountResult (+21 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (54): Registry, ProviderId, ResolvedTools, htmlToMarkdown(), selectBody(), turndown, Logger, markdownToHtml() (+46 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (59): acquireAccessToken(), AuthorizationCodeBegin, AuthorizationCodeBeginOptions, AuthorizationCodeCompletionInput, base64Url(), beginAuthorizationCode(), buildOAuth2Client(), codeChallenge() (+51 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (50): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedTokens(), makeConfig() (+42 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (45): addAccount(), completeAddAccount(), extractTokens(), ImapClient, ImapClientFactory, ImapTokens, isImapTokens(), createFolder() (+37 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (28): envRaw(), loadConfig(), optionalEnvString(), parsePositiveInteger(), parseStringArray(), parseTransportEnv(), resolveDebugLogging(), resolveHttpConfig() (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.14
Nodes (5): GmailProviderOptions, OutlookProviderOptions, BuildRegistryOptions, AccountStore, delay()

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
Cohesion: 0.16
Nodes (8): NewEmailClaimCandidate, Handler, isDelivered(), mergeCheckpoint(), normalizeTimestamp(), registerHandler(), tools, uniqueIds()

### Community 11 - "Community 11"
Cohesion: 0.24
Nodes (13): buildRegistry(), AppConfig, resolveTools(), escapeHtml(), firstHeader(), handleGmailOAuthCallback(), HttpSession, requestBaseUrl() (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.15
Nodes (12): 1. Create the Application, 2. Set the encryption key, 3. Configure persistent storage, 4. Add a domain, 5. Deploy, 6. Verify, Connecting clients, Deploy hypermail-mcp to Dokploy (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.21
Nodes (9): createLogger(), CreateLoggerOptions, LogFields, noopLogger, sanitizeFields(), sanitizeValue(), key, withDataDir() (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.24
Nodes (11): compareTimestamp(), isAlreadyDelivered(), mergeNewEmailCheckpoints(), NewEmailCheckpoint, normalizeCheckpoint(), normalizeTimestamp(), OpenOptions, StoreFile (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.23
Nodes (6): decrypt(), parseEnvKey(), resolveKey(), MANAGED_KEYS, tryKeytarGet(), tryKeytarSet()

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
- **136 isolated node(s):** `Path`, `int`, `jobs`, `name`, `version` (+131 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 10`, `Community 13`, `Community 14`?**
  _High betweenness centrality (0.161) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Community 6` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 10`, `Community 11`, `Community 13`, `Community 14`, `Community 15`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Community 16` to `Community 9`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `Path`, `int`, `jobs` to the rest of the system?**
  _136 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.051201671891327065 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0747871158830063 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06012176560121765 - nodes in this community are weakly interconnected._