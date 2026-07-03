# Graph Report - hyper-email-mcp-1  (2026-07-03)

## Corpus Check
- 70 files · ~39,794 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 624 nodes · 1755 edges · 33 communities (28 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `030feb08`
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
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 41|Community 41]]

## God Nodes (most connected - your core abstractions)
1. `AccountRecord` - 98 edges
2. `AccountStore` - 40 edges
3. `FolderInfo` - 31 edges
4. `OutlookProvider` - 27 edges
5. `GmailProvider` - 26 edges
6. `EmailSummary` - 25 edges
7. `ImapProvider` - 24 edges
8. `SendInput` - 23 edges
9. `EmailFull` - 22 edges
10. `AttachmentContent` - 18 edges

## Surprising Connections (you probably didn't know these)
- `NewEmailOutput` --references--> `EmailFull`  [EXTRACTED]
  src/tools/new-emails.ts → src/providers/types.ts
- `AccountCandidates` --references--> `AccountRecord`  [EXTRACTED]
  src/tools/new-emails.ts → src/store/account-store.ts
- `registerHandler()` --calls--> `registerComposeTools()`  [EXTRACTED]
  src/tools/compose.test.ts → src/tools/compose.ts
- `load()` --calls--> `loadConfig()`  [EXTRACTED]
  src/config.test.ts → src/config/load.ts
- `GmailProvider` --references--> `GmailClientFactory`  [EXTRACTED]
  src/providers/gmail/index.ts → src/providers/gmail/client.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Unified Email API Surface** — readmemd_unified_email_surface, readmemd_tool_catalog, agentsmd_tool_handlers [INFERRED 0.85]
- **Server Security Posture** — readmemd_account_encryption, hostingmd_encryption_key_management, readmemd_read_only_mode, readmemd_per_tool_filtering [INFERRED 0.80]
- **Multi-Provider Routing Stack** — agentsmd_provider_architecture, readmemd_multi_provider_routing, readmemd_ms_graph_client, readmemd_msal_node [INFERRED 0.90]

## Communities (33 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.21
Nodes (9): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, isSerializedTokens(), makeConfig(), SerializedTokens (+1 more)

### Community 1 - "Community 1"
Cohesion: 0.12
Nodes (14): bugs, url, description, engines, node, files, keywords, license (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (67): addAccount(), completeAddAccount(), extractTokens(), ImapClientFactory, ImapTokens, isImapTokens(), createFolder(), deleteFolder() (+59 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (27): createFolder(), deleteFolder(), listFolders(), renameFolder(), clampLimit(), convertInlineImages(), GraphAttachment, GraphFolder (+19 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+9 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (20): acquireAccessToken(), AuthorizationCodeBeginOptions, AuthorizationCodeCompletionInput, base64Url(), beginAuthorizationCode(), buildOAuth2Client(), codeChallenge(), completeAuthorizationCode() (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (46): AuthorizationCodeBegin, base64urlEncode(), buildRawMessage(), clampLimit(), ComposerAttachment, ComposerOptions, decodeBody(), findHeader() (+38 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (19): Add-account flows, As a hosted HTTP server, Claude Desktop / Claude Code, Development, Docker, Environment Variables, Generic MCP client JSON example, Gmail (+11 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+9 more)

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
Cohesion: 0.10
Nodes (14): OutlookProviderOptions, AccountStore, OpenOptions, StoreFile, key, decrypt(), encrypt(), parseEnvKey() (+6 more)

### Community 26 - "Community 26"
Cohesion: 0.12
Nodes (13): DeviceCodeBegin, clampLimit(), convertInlineImages(), GraphAttachment, GraphFolder, GraphMessage, GraphRecipient, InlineAttachment (+5 more)

### Community 28 - "Community 28"
Cohesion: 0.28
Nodes (3): mapFolder(), FolderInfo, ListFoldersOptions

### Community 35 - "Community 35"
Cohesion: 0.09
Nodes (38): envRaw(), loadConfig(), optionalEnvString(), parsePositiveInteger(), parseStringArray(), parseTransportEnv(), resolveHttpConfig(), resolveProvidersConfig() (+30 more)

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (64): BuildRegistryOptions, Registry, ProviderId, ProvidersConfig, ResolvedTools, htmlToMarkdown(), selectBody(), turndown (+56 more)

## Knowledge Gaps
- **155 isolated node(s):** `Why`, `Claude Desktop / Claude Code`, `As a hosted HTTP server`, `Docker`, `Development` (+150 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Community 25` to `Community 0`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 41`, `Community 23`, `Community 24`, `Community 26`, `Community 27`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Community 24` to `Community 0`, `Community 2`, `Community 3`, `Community 35`, `Community 5`, `Community 6`, `Community 41`, `Community 26`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Community 11` to `Community 1`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `Why`, `Claude Desktop / Claude Code`, `As a hosted HTTP server` to the rest of the system?**
  _155 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07640449438202247 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._