# Graph Report - hyper-email-mcp-0  (2026-06-16)

## Corpus Check
- 64 files · ~32,810 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 584 nodes · 1261 edges · 27 communities (26 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `01632516`
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
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 41|Community 41]]

## God Nodes (most connected - your core abstractions)
1. `AccountRecord` - 71 edges
2. `AccountStore` - 27 edges
3. `OutlookProvider` - 24 edges
4. `GmailProvider` - 22 edges
5. `ImapProvider` - 21 edges
6. `FolderInfo` - 19 edges
7. `EmailFull` - 16 edges
8. `compilerOptions` - 15 edges
9. `SendInput` - 15 edges
10. `AgentStore` - 15 edges

## Surprising Connections (you probably didn't know these)
- `HttpSession` --references--> `AgentContext`  [EXTRACTED]
  src/server.ts → src/tools/agent-context.ts
- `PendingFlow` --references--> `AccountRecord`  [EXTRACTED]
  src/providers/gmail/index.ts → src/store/account-store.ts
- `ParsedPayload` --references--> `EmailFull`  [EXTRACTED]
  src/providers/gmail/helpers.ts → src/providers/types.ts
- `load()` --calls--> `loadConfig()`  [EXTRACTED]
  src/config.test.ts → src/config/load.ts
- `BuildRegistryOptions` --references--> `ProvidersConfig`  [EXTRACTED]
  src/providers/registry.ts → src/config.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Unified Email API Surface** — readmemd_unified_email_surface, readmemd_tool_catalog, agentsmd_tool_handlers [INFERRED 0.85]
- **Server Security Posture** — readmemd_account_encryption, hostingmd_encryption_key_management, readmemd_read_only_mode, readmemd_per_tool_filtering [INFERRED 0.80]
- **Multi-Provider Routing Stack** — agentsmd_provider_architecture, readmemd_multi_provider_routing, readmemd_ms_graph_client, readmemd_msal_node [INFERRED 0.90]

## Communities (27 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (25): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedTokens(), makeConfig() (+17 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (14): bugs, url, description, engines, node, files, keywords, license (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (49): extractTokens(), ImapClient, ImapClientFactory, ImapTokens, isImapTokens(), BodyNode, clampLimit(), decodeId() (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.20
Nodes (9): EmailFull, WatchConfig, WatcherManager, runNotifyCommand(), sleep(), spawnWithTimeout(), email, postWebhook() (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (11): authFailures, consoleError, createWatcher(), enqueued, origPush, result, skips, slowPromise (+3 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (21): acquireAccessToken(), AuthorizationCodeBegin, AuthorizationCodeBeginOptions, AuthorizationCodeCompletionInput, base64Url(), beginAuthorizationCode(), buildOAuth2Client(), codeChallenge() (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (40): base64urlEncode(), buildRawMessage(), clampLimit(), findHeader(), GmailMessage, GmailMessageListEntry, GmailMessagePart, mapFolder() (+32 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (19): Add-account flows, As a hosted HTTP server, Claude Desktop / Claude Code, Development, Docker, Email Watch, Environment Variables, Generic MCP client JSON example (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (13): files, code, document, image, paper, video, graphifyignore_patterns, needs_graph (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (12): 1. Create the Application, 2. Set the encryption key, 3. Configure persistent storage, 4. Add a domain, 5. Deploy, 6. Verify, Connecting clients, Deploy hypermail-mcp to Dokploy (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.17
Nodes (12): dependencies, @azure/msal-node, google-auth-library, googleapis, imapflow, isomorphic-fetch, marked, @microsoft/microsoft-graph-client (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.20
Nodes (10): scripts, build, check, dev, dev:http, prepublishOnly, start, test (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.25
Nodes (7): Commands, Dev Workflow, Environment, hypermail-mcp, Key Dependencies, Purpose, Structure

### Community 14 - "Community 14"
Cohesion: 0.25
Nodes (8): devDependencies, tsup, @types/isomorphic-fetch, @types/node, @types/nodemailer, @types/turndown, typescript, vitest

### Community 17 - "Community 17"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 19 - "Community 19"
Cohesion: 0.33
Nodes (5): Docker (minimal), Hosting hypermail-mcp, Quick start, Required environment, Reverse proxies

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (28): AgentDef, agentDefSchema, AgentsConfig, agentsConfigSchema, EmailAccountDef, emailAccountDefSchema, LiveReloadHandle, GmailProviderOptions (+20 more)

### Community 25 - "Community 25"
Cohesion: 0.08
Nodes (11): GmailProvider, ImapProvider, mapFolder(), OutlookProvider, AttachmentContent, CompleteAddAccountResult, CreateFolderInput, FolderInfo (+3 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (48): watchAgentsConfig(), envRaw(), loadConfig(), optionalEnvString(), parseBoolEnv(), parsePositiveInteger(), parsePositiveIntegerEnv(), parseStringArray() (+40 more)

### Community 41 - "Community 41"
Cohesion: 0.08
Nodes (50): Registry, ProviderId, ResolvedTools, htmlToMarkdown(), selectBody(), turndown, markdownToHtml(), registerAccountTools() (+42 more)

## Knowledge Gaps
- **176 isolated node(s):** `Purpose`, `Structure`, `Commands`, `Environment`, `Key Dependencies` (+171 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Community 25` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 41`, `Community 24`?**
  _High betweenness centrality (0.171) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Community 24` to `Community 0`, `Community 2`, `Community 35`, `Community 3`, `Community 5`, `Community 6`, `Community 41`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `AgentStore` connect `Community 24` to `Community 41`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `Purpose`, `Structure`, `Commands` to the rest of the system?**
  _176 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07557354925775979 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07086197778952935 - nodes in this community are weakly interconnected._