# Graph Report - hyper-email-mcp-0  (2026-06-20)

## Corpus Check
- 62 files · ~33,057 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 583 nodes · 1241 edges · 28 communities (26 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7a4ddf52`
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
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 41|Community 41]]

## God Nodes (most connected - your core abstractions)
1. `AccountRecord` - 74 edges
2. `AccountStore` - 28 edges
3. `OutlookProvider` - 24 edges
4. `GmailProvider` - 22 edges
5. `ImapProvider` - 21 edges
6. `FolderInfo` - 19 edges
7. `compilerOptions` - 15 edges
8. `SendInput` - 15 edges
9. `ResolvedTools` - 14 edges
10. `shouldRegister()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `HttpSession` --references--> `AgentContext`  [EXTRACTED]
  src/server.ts → src/tools/agent-context.ts
- `PendingFlow` --references--> `AccountRecord`  [EXTRACTED]
  src/providers/gmail/index.ts → src/store/account-store.ts
- `AccountCandidates` --references--> `AccountRecord`  [EXTRACTED]
  src/tools/new-emails.ts → src/store/account-store.ts
- `Candidate` --references--> `AccountRecord`  [EXTRACTED]
  src/tools/new-emails.ts → src/store/account-store.ts
- `load()` --calls--> `loadConfig()`  [EXTRACTED]
  src/config.test.ts → src/config/load.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Unified Email API Surface** — readmemd_unified_email_surface, readmemd_tool_catalog, agentsmd_tool_handlers [INFERRED 0.85]
- **Server Security Posture** — readmemd_account_encryption, hostingmd_encryption_key_management, readmemd_read_only_mode, readmemd_per_tool_filtering [INFERRED 0.80]
- **Multi-Provider Routing Stack** — agentsmd_provider_architecture, readmemd_multi_provider_routing, readmemd_ms_graph_client, readmemd_msal_node [INFERRED 0.90]

## Communities (28 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (24): GmailProviderOptions, acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedTokens() (+16 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (14): bugs, url, description, engines, node, files, keywords, license (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (53): extractTokens(), ImapClientFactory, ImapTokens, isImapTokens(), BodyNode, clampLimit(), decodeId(), encodeId() (+45 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (22): htmlToMarkdown(), selectBody(), turndown, AccountCandidates, advanceCheckpoint(), Candidate, collectCandidatesForAccount(), compareNewEmailOutputOldestFirst() (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (11): authFailures, consoleError, createWatcher(), enqueued, origPush, result, skips, slowPromise (+3 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (20): acquireAccessToken(), AuthorizationCodeBegin, AuthorizationCodeBeginOptions, AuthorizationCodeCompletionInput, base64Url(), beginAuthorizationCode(), buildOAuth2Client(), codeChallenge() (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (36): GmailClientFactory, base64urlEncode(), buildRawMessage(), clampLimit(), findHeader(), GmailMessage, GmailMessageListEntry, GmailMessagePart (+28 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (19): Add-account flows, As a hosted HTTP server, Claude Desktop / Claude Code, Development, Docker, Environment Variables, Generic MCP client JSON example, Gmail (+11 more)

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
Cohesion: 0.08
Nodes (24): AgentDef, agentDefSchema, AgentsConfig, agentsConfigSchema, EmailAccountDef, emailAccountDefSchema, LiveReloadHandle, OpenOptions (+16 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (16): GmailProvider, ImapProvider, clampLimit(), convertInlineImages(), mapFolder(), OutlookProvider, AttachmentContent, CompleteAddAccountResult (+8 more)

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (39): watchAgentsConfig(), envRaw(), loadConfig(), optionalEnvString(), parsePositiveInteger(), parseStringArray(), parseTransportEnv(), resolveHttpConfig() (+31 more)

### Community 41 - "Community 41"
Cohesion: 0.08
Nodes (49): BuildRegistryOptions, Registry, ProviderId, ProvidersConfig, ResolvedTools, markdownToHtml(), registerAccountTools(), AgentContext (+41 more)

## Knowledge Gaps
- **179 isolated node(s):** `Why`, `Claude Desktop / Claude Code`, `As a hosted HTTP server`, `Docker`, `Development` (+174 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Community 25` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 41`, `Community 24`?**
  _High betweenness centrality (0.197) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Community 0` to `Community 2`, `Community 35`, `Community 3`, `Community 5`, `Community 6`, `Community 41`, `Community 24`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `AgentStore` connect `Community 24` to `Community 41`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `Why`, `Claude Desktop / Claude Code`, `As a hosted HTTP server` to the rest of the system?**
  _179 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07179487179487179 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07211538461538461 - nodes in this community are weakly interconnected._